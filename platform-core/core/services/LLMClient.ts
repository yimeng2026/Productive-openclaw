/**
 * LLMClient — 千界花园统一 LLM 请求客户端
 * 
 * 整合 ProviderOptimization 配置 + 重试 + 熔断器 + Token 预算检查
 * 类比 Kimi Code API 的 5 个核心优化点，推广到全部 10 个 Provider
 */

import {
  ProviderOptimization,
  PROVIDER_REGISTRY,
  getTokenBudget,
  getTimeout,
  checkTokenBudget,
  calculateBackoffDelay,
  shouldRetry,
  getProviderHeaders,
} from '../config/ProviderOptimization';

interface CircuitState {
  status: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailureTime: number;
  halfOpenCalls: number;
}

export interface LLMRequest {
  provider: string;
  messages: Array<{ role: string; content: string }>;
  taskType?: 'simple' | 'normal' | 'code' | 'long';
  stream?: boolean;
  temperature?: number;
  systemPrompt?: string;
  model?: string;
}

export interface LLMResponse {
  content: string;
  reasoning?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  finish_reason?: string;
  provider: string;
  model: string;
  latencyMs: number;
}

export class LLMClient {
  private circuits = new Map<string, CircuitState>();

  /**
   * 发送 LLM 请求（带重试 + 熔断器 + Token 预算检查）
   */
  async chat(req: LLMRequest): Promise<LLMResponse> {
    const config = PROVIDER_REGISTRY[req.provider];
    if (!config) throw new Error(`Unknown provider: ${req.provider}`);

    // 1. Token 预算预检查
    const taskType = req.taskType || 'normal';
    const inputText = req.messages.map(m => m.content).join('\n');
    const expectedOutput = getTokenBudget(req.provider, taskType) * 0.6; // 预留 60% 给输出
    checkTokenBudget(req.provider, taskType, inputText, expectedOutput);

    // 2. 熔断器检查
    this.checkCircuitBreaker(req.provider, config);

    // 3. 构建请求
    const maxTokens = getTokenBudget(req.provider, taskType);
    const timeout = getTimeout(req.provider, taskType);
    const apiKey = this.getApiKey(req.provider);
    const headers = getProviderHeaders(req.provider, apiKey);

    const body = this.buildRequestBody(req, config, maxTokens);

    // 4. 发送请求（带重试）
    const start = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= config.retry.maxRetries + 1; attempt++) {
      try {
        const res = await fetch(config.endpoint + '/chat/completions', {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeout),
        });

        if (!res.ok) {
          const status = res.status;
          const txt = await res.text().catch(() => res.statusText);
          
          if (shouldRetry(status, req.provider) && attempt <= config.retry.maxRetries) {
            const delay = calculateBackoffDelay(
              attempt,
              config.retry.baseDelayMs,
              config.retry.maxDelayMs,
              config.retry.jitter
            );
            console.log(`[LLMClient] ${req.provider} retry ${attempt}/${config.retry.maxRetries} after ${Math.round(delay)}ms (HTTP ${status})`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          
          throw new Error(`HTTP ${status}: ${txt}`);
        }

        // 解析响应
        const json = await res.json();
        const result = this.parseResponse(json, config, req.provider);
        result.latencyMs = Date.now() - start;

        // 成功：重置熔断器
        this.recordSuccess(req.provider);
        return result;

      } catch (e: any) {
        lastError = e;
        
        // 超时/连接错误 → 可重试
        const isRetryable = e.name === 'TimeoutError' || e.name === 'AbortError' || e.message?.includes('fetch');
        
        if (isRetryable && attempt <= config.retry.maxRetries) {
          const delay = calculateBackoffDelay(
            attempt,
            config.retry.baseDelayMs,
            config.retry.maxDelayMs,
            config.retry.jitter
          );
          console.log(`[LLMClient] ${req.provider} retry ${attempt}/${config.retry.maxRetries} after ${Math.round(delay)}ms (${e.message})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        
        // 记录失败
        this.recordFailure(req.provider);
        break;
      }
    }

    throw lastError || new Error(`All retries exhausted for ${req.provider}`);
  }

  /**
   * 流式请求（带超时恢复）
   */
  async *chatStream(req: LLMRequest): AsyncGenerator<{ chunk: string; reasoning?: string; isLast: boolean }, void, unknown> {
    const config = PROVIDER_REGISTRY[req.provider];
    if (!config) throw new Error(`Unknown provider: ${req.provider}`);
    if (!config.streamingSupported) throw new Error(`${req.provider} does not support streaming`);

    const taskType = req.taskType || 'normal';
    const maxTokens = getTokenBudget(req.provider, taskType);
    const timeout = getTimeout(req.provider, taskType);
    const apiKey = this.getApiKey(req.provider);
    const headers = getProviderHeaders(req.provider, apiKey);

    const body = this.buildRequestBody(req, config, maxTokens);
    body.stream = true;

    const res = await fetch(config.endpoint + '/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Stream error: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let partialContent = '';
    let partialReasoning = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:') && trimmed !== 'data: [DONE]') {
            try {
              const json = JSON.parse(trimmed.slice(5).trim());
              const delta = json.choices?.[0]?.delta || {};
              const content = delta.content || '';
              const reasoning = delta[config.reasoningField || 'reasoning_content'] || '';
              
              if (content) partialContent += content;
              if (reasoning) partialReasoning += reasoning;
              
              yield {
                chunk: content,
                reasoning: reasoning || undefined,
                isLast: false,
              };
            } catch { /* ignore parse errors */ }
          }
        }
      }
    } catch (e: any) {
      // 流式超时：返回已收到的部分
      if (partialContent || partialReasoning) {
        console.log(`[LLMClient] Stream interrupted after ${partialContent.length} chars. Returning partial content.`);
        yield {
          chunk: '\n[生成中断，以上为部分结果]',
          reasoning: undefined,
          isLast: true,
        };
        return;
      }
      throw e;
    }

    yield { chunk: '', reasoning: undefined, isLast: true };
  }

  // ========== 私有方法 ==========

  private buildRequestBody(req: LLMRequest, config: ProviderOptimization, maxTokens: number): Record<string, any> {
    const body: Record<string, any> = {
      model: req.model || 'default',
      messages: req.messages,
      max_tokens: maxTokens,
      temperature: req.temperature ?? 0.7,
      stream: req.stream ?? false,
    };

    // Anthropic: 顶层 system 字段
    if (config.name === 'anthropic' && req.systemPrompt) {
      body.system = req.systemPrompt;
      body.messages = req.messages.filter(m => m.role !== 'system');
    }

    // Gemini: contents 格式
    if (config.name === 'gemini') {
      body.contents = req.messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : m.role,
        parts: [{ text: m.content }],
      }));
      delete body.messages;
      if (req.systemPrompt) {
        body.systemInstruction = { parts: [{ text: req.systemPrompt }] };
      }
    }

    // o1/o3: 禁用 temperature
    if (config.name === 'openai' || config.name === 'azure') {
      if (req.model?.startsWith('o1') || req.model?.startsWith('o3')) {
        delete body.temperature;
        body.max_completion_tokens = maxTokens;
        delete body.max_tokens;
      }
    }

    // DeepSeek: /v1 端点已包含在 endpoint 中
    // OpenRouter: provider 排序
    if (config.name === 'openrouter') {
      body.provider = { order: ['DeepSeek', 'Moonshot', 'OpenAI'] };
    }

    return body;
  }

  private parseResponse(json: any, config: ProviderOptimization, provider: string): LLMResponse {
    const msg = json.choices?.[0]?.message || {};
    let content = msg.content || '';
    let reasoning = '';

    // 字段合并
    if (config.reasoningField && msg[config.reasoningField]) {
      reasoning = msg[config.reasoningField];
      if (config.mergeStrategy === 'concat') {
        content = reasoning + '\n\n' + content;
      }
    }

    return {
      content,
      reasoning: reasoning || undefined,
      usage: json.usage,
      finish_reason: json.choices?.[0]?.finish_reason,
      provider,
      model: json.model || 'unknown',
      latencyMs: 0,
    };
  }

  private getApiKey(provider: string): string {
    const envMap: Record<string, string> = {
      'kimi-code': 'KIMICODE_API_KEY',
      'openai': 'OPENAI_API_KEY',
      'azure': 'AZURE_API_KEY',
      'anthropic': 'ANTHROPIC_API_KEY',
      'deepseek': 'DEEPSEEK_API_KEY',
      'moonshot': 'MOONSHOT_API_KEY',
      'gemini': 'GEMINI_API_KEY',
      'glm': 'GLM_API_KEY',
      'openrouter': 'OPENROUTER_API_KEY',
      'qwen': 'QWEN_API_KEY',
    };
    return process.env[envMap[provider]] || '';
  }

  // ========== 熔断器 ==========

  private getCircuit(provider: string): CircuitState {
    if (!this.circuits.has(provider)) {
      this.circuits.set(provider, {
        status: 'closed',
        failures: 0,
        lastFailureTime: 0,
        halfOpenCalls: 0,
      });
    }
    return this.circuits.get(provider)!;
  }

  private checkCircuitBreaker(provider: string, config: ProviderOptimization): void {
    if (!config.circuitBreaker.enabled) return;
    
    const circuit = this.getCircuit(provider);
    
    if (circuit.status === 'open') {
      const elapsed = Date.now() - circuit.lastFailureTime;
      if (elapsed < config.circuitBreaker.recoveryTimeoutMs) {
        throw new Error(
          `Circuit breaker OPEN for ${provider}. ` +
          `Retry after ${Math.ceil((config.circuitBreaker.recoveryTimeoutMs - elapsed) / 1000)}s.`
        );
      }
      // 进入半开状态
      circuit.status = 'half-open';
      circuit.halfOpenCalls = 0;
    }
    
    if (circuit.status === 'half-open') {
      if (circuit.halfOpenCalls >= config.circuitBreaker.halfOpenMaxCalls) {
        throw new Error(`Circuit breaker half-open limit reached for ${provider}`);
      }
      circuit.halfOpenCalls++;
    }
  }

  private recordSuccess(provider: string): void {
    const circuit = this.getCircuit(provider);
    if (circuit.status === 'half-open') {
      circuit.status = 'closed';
      circuit.failures = 0;
    }
  }

  private recordFailure(provider: string): void {
    const circuit = this.getCircuit(provider);
    circuit.failures++;
    circuit.lastFailureTime = Date.now();
    
    const config = PROVIDER_REGISTRY[provider];
    if (config && circuit.failures >= config.circuitBreaker.failureThreshold) {
      circuit.status = 'open';
      console.warn(`[LLMClient] Circuit breaker OPENED for ${provider} after ${circuit.failures} failures`);
    }
  }
}

export default LLMClient;
