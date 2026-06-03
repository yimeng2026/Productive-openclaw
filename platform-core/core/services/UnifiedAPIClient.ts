/**
 * UnifiedAPIClient.ts — 统一API客户端
 *
 * 核心原则：
 * - 所有 provider 走同一套请求/响应格式
 * - 输入API key自动识别provider、填充endpoint、选择model
 * - OpenClaw和Hermes在adapter层区别，上层无感知
 */

// ── 统一请求/响应格式 ─────────────────────────────────────────

export interface UnifiedMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: UnifiedToolCall[];
  toolCallId?: string;
}

export interface UnifiedTool {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface UnifiedToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface UnifiedChatRequest {
  messages: UnifiedMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: UnifiedTool[];
}

export interface UnifiedChatResponse {
  id: string;
  model: string;
  content: string;
  toolCalls?: UnifiedToolCall[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason: string;
}

// ── Provider识别与配置 ─────────────────────────────────────────

export type ProviderType = 'openclaw' | 'hermes' | 'kimi' | 'kimi_code' | 'claude' | 'openai' | 'ollama' | 'gemini' | 'openrouter' | 'deepseek' | 'qwen';

export interface ProviderConfig {
  type: ProviderType;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  organization?: string;
  timeoutMs?: number;
}

export interface AutoDetectedConfig {
  type: ProviderType;
  baseUrl: string;
  defaultModel: string;
  availableModels: string[];
  detectedBy: 'key_prefix' | 'key_format' | 'user_hint' | 'manual';
}

// ── Provider适配器基类 ─────────────────────────────────────────

export abstract class ProviderAdapter {
  protected config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  abstract chat(req: UnifiedChatRequest): Promise<UnifiedChatResponse>;
  abstract chatStream(req: UnifiedChatRequest): AsyncGenerator<UnifiedChatResponse, void>;
  abstract listModels(): Promise<string[]>;
  abstract validateKey(): Promise<{ valid: boolean; error?: string }>;

  protected abstract toNativeRequest(req: UnifiedChatRequest): any;
  protected abstract fromNativeResponse(res: any): UnifiedChatResponse;

  protected async fetchJson(url: string, body: any, headers?: Record<string, string>): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs || 30000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          ...headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`HTTP ${res.status}: ${err}`);
      }

      return await res.json();
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }
}

// ── 各Provider适配器 ────────────────────────────────────────────

export class OpenClawAdapter extends ProviderAdapter {
  protected toNativeRequest(req: UnifiedChatRequest): any {
    return {
      messages: req.messages.map(m => ({ role: m.role, content: m.content })),
      model: req.model || this.config.defaultModel || 'kimi-k2.6',
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens || 4096,
      stream: req.stream ?? false,
      tools: req.tools?.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    };
  }

  protected fromNativeResponse(res: any): UnifiedChatResponse {
    const choice = res.choices?.[0] || {};
    const msg = choice.message || {};
    return {
      id: res.id || `ocl-${Date.now()}`,
      model: res.model || 'unknown',
      content: msg.content || '',
      toolCalls: msg.tool_calls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name,
        arguments: JSON.parse(tc.function?.arguments || '{}'),
      })),
      usage: res.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: choice.finish_reason || 'stop',
    };
  }

  async chat(req: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const native = this.toNativeRequest(req);
    const res = await this.fetchJson(`${this.config.baseUrl || 'http://localhost:11434'}/v1/chat/completions`, native);
    return this.fromNativeResponse(res);
  }

  async *chatStream(req: UnifiedChatRequest): AsyncGenerator<UnifiedChatResponse, void> {
    const native = { ...this.toNativeRequest(req), stream: true };
    // SSE stream implementation - simplified
    yield this.fromNativeResponse({ id: 'stream', model: native.model, content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'stop' });
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await this.fetchJson(`${this.config.baseUrl || 'http://localhost:11434'}/v1/models`, {}, {});
      return res.data?.map((m: any) => m.id) || [];
    } catch {
      return ['kimi-k2.6', 'kimi-moonshot-v1', 'claude-3-sonnet'];
    }
  }

  async validateKey(): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.chat({ messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 });
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class HermesAdapter extends ProviderAdapter {
  // Hermes uses MCP protocol but chat interface is OpenAI-compatible
  protected toNativeRequest(req: UnifiedChatRequest): any {
    return {
      messages: req.messages,
      model: req.model || this.config.defaultModel || 'hermes-3',
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens || 4096,
      stream: req.stream ?? false,
    };
  }

  protected fromNativeResponse(res: any): UnifiedChatResponse {
    return {
      id: res.id || `hermes-${Date.now()}`,
      model: res.model || 'hermes-3',
      content: res.choices?.[0]?.message?.content || '',
      usage: res.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: res.choices?.[0]?.finish_reason || 'stop',
    };
  }

  async chat(req: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const native = this.toNativeRequest(req);
    const res = await this.fetchJson(`${this.config.baseUrl || 'http://localhost:8080'}/v1/chat/completions`, native);
    return this.fromNativeResponse(res);
  }

  async *chatStream(req: UnifiedChatRequest): AsyncGenerator<UnifiedChatResponse, void> {
    yield this.fromNativeResponse({ id: 'stream', model: 'hermes-3', content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'stop' });
  }

  async listModels(): Promise<string[]> {
    return ['hermes-3', 'hermes-3-pro', 'hermes-2'];
  }

  async validateKey(): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.listModels();
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class KimiAdapter extends ProviderAdapter {
  protected toNativeRequest(req: UnifiedChatRequest): any {
    return {
      model: req.model || this.config.defaultModel || 'kimi-k2.6',
      messages: req.messages.map(m => ({ role: m.role, content: m.content })),
      temperature: req.temperature ?? 0.3,
      max_tokens: req.maxTokens || 8192,
      stream: req.stream ?? false,
    };
  }

  protected fromNativeResponse(res: any): UnifiedChatResponse {
    return {
      id: res.id || `kimi-${Date.now()}`,
      model: res.model || 'kimi-k2.6',
      content: res.choices?.[0]?.message?.content || '',
      usage: res.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: res.choices?.[0]?.finish_reason || 'stop',
    };
  }

  async chat(req: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const native = this.toNativeRequest(req);
    const res = await this.fetchJson('https://api.moonshot.cn/v1/chat/completions', native, {
      'Authorization': `Bearer ${this.config.apiKey}`,
    });
    return this.fromNativeResponse(res);
  }

  async *chatStream(req: UnifiedChatRequest): AsyncGenerator<UnifiedChatResponse, void> {
    yield this.fromNativeResponse({ id: 'stream', model: 'kimi-k2.6', content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'stop' });
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await this.fetchJson('https://api.moonshot.cn/v1/models', {}, {
        'Authorization': `Bearer ${this.config.apiKey}`,
      });
      return res.data?.map((m: any) => m.id) || [];
    } catch {
      return ['kimi-k2.6', 'kimi-moonshot-v1-8k', 'kimi-moonshot-v1-32k', 'kimi-moonshot-v1-128k'];
    }
  }

  async validateKey(): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.listModels();
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class KimiCodeAdapter extends ProviderAdapter {
  protected toNativeRequest(req: UnifiedChatRequest): any {
    return {
      model: req.model || this.config.defaultModel || 'kimi-k2-0711-preview',
      messages: req.messages.map(m => ({ role: m.role, content: m.content })),
      temperature: req.temperature ?? 0.3,
      max_tokens: req.maxTokens || 4000,
      stream: req.stream ?? false,
    };
  }

  protected fromNativeResponse(res: any): UnifiedChatResponse {
    return {
      id: res.id || `kimi-code-${Date.now()}`,
      model: res.model || 'kimi-k2-0711-preview',
      content: res.choices?.[0]?.message?.content || '',
      usage: res.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: res.choices?.[0]?.finish_reason || 'stop',
    };
  }

  async chat(req: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const native = this.toNativeRequest(req);
    const res = await this.fetchJson('https://api.kimi.com/coding/v1/chat/completions', native, {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'User-Agent': 'claude-code/0.7.8',
    });
    return this.fromNativeResponse(res);
  }

  async *chatStream(req: UnifiedChatRequest): AsyncGenerator<UnifiedChatResponse, void> {
    yield this.fromNativeResponse({ id: 'stream', model: 'kimi-k2-0711-preview', content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'stop' });
  }

  async listModels(): Promise<string[]> {
    return ['kimi-k2-0711-preview', 'kimi-k2-0711'];
  }

  async validateKey(): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 4000 });
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class GeminiAdapter extends ProviderAdapter {
  protected toNativeRequest(req: UnifiedChatRequest): any {
    const systemMsg = req.messages.find(m => m.role === 'system');
    const nonSystem = req.messages.filter(m => m.role !== 'system');
    const contents = [];
    if (systemMsg) {
      contents.push({ role: 'user', parts: [{ text: `System: ${systemMsg.content}` }] });
      contents.push({ role: 'model', parts: [{ text: 'Understood.' }] });
    }
    for (const m of nonSystem) {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      });
    }
    return {
      contents,
      generationConfig: {
        temperature: req.temperature ?? 0.7,
        maxOutputTokens: req.maxTokens || 4096,
      },
    };
  }

  protected fromNativeResponse(res: any): UnifiedChatResponse {
    const candidate = res.candidates?.[0];
    return {
      id: res.id || `gemini-${Date.now()}`,
      model: this.config.defaultModel || 'gemini-2.0-flash',
      content: candidate?.content?.parts?.[0]?.text || '',
      usage: {
        promptTokens: res.usageMetadata?.promptTokenCount || 0,
        completionTokens: res.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: res.usageMetadata?.totalTokenCount || 0,
      },
      finishReason: candidate?.finishReason || 'stop',
    };
  }

  async chat(req: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const native = this.toNativeRequest(req);
    const model = req.model || this.config.defaultModel || 'gemini-2.0-flash';
    const res = await this.fetchJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.apiKey}`,
      native,
      { 'Content-Type': 'application/json' }
    );
    return this.fromNativeResponse(res);
  }

  async *chatStream(req: UnifiedChatRequest): AsyncGenerator<UnifiedChatResponse, void> {
    yield this.fromNativeResponse({ id: 'stream', model: 'gemini-2.0-flash', content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'stop' });
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await this.fetchJson(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${this.config.apiKey}`,
        {},
        {}
      );
      return res.models?.map((m: any) => m.name?.replace('models/', '')).filter(Boolean) || [];
    } catch {
      return ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-pro-preview-03-25'];
    }
  }

  async validateKey(): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.listModels();
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class OpenRouterAdapter extends ProviderAdapter {
  protected toNativeRequest(req: UnifiedChatRequest): any {
    return {
      model: req.model || this.config.defaultModel || 'deepseek/deepseek-chat-v3-0324:free',
      messages: req.messages.map(m => ({ role: m.role, content: m.content })),
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens || 4096,
      stream: req.stream ?? false,
    };
  }

  protected fromNativeResponse(res: any): UnifiedChatResponse {
    return {
      id: res.id || `openrouter-${Date.now()}`,
      model: res.model || 'deepseek/deepseek-chat-v3-0324:free',
      content: res.choices?.[0]?.message?.content || '',
      usage: res.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: res.choices?.[0]?.finish_reason || 'stop',
    };
  }

  async chat(req: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const native = this.toNativeRequest(req);
    const res = await this.fetchJson('https://openrouter.ai/api/v1/chat/completions', native, {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'HTTP-Referer': 'https://localhost',
      'X-Title': 'SylvaPlatform',
    });
    return this.fromNativeResponse(res);
  }

  async *chatStream(req: UnifiedChatRequest): AsyncGenerator<UnifiedChatResponse, void> {
    yield this.fromNativeResponse({ id: 'stream', model: 'openrouter', content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'stop' });
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await this.fetchJson('https://openrouter.ai/api/v1/models', {}, {
        'Authorization': `Bearer ${this.config.apiKey}`,
      });
      return res.data?.map((m: any) => m.id) || [];
    } catch {
      return [
        'deepseek/deepseek-chat-v3-0324:free',
        'qwen/qwen3-coder:free',
        'anthropic/claude-3-sonnet',
        'openai/gpt-4o-mini',
      ];
    }
  }

  async validateKey(): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.listModels();
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class DeepSeekAdapter extends ProviderAdapter {
  protected toNativeRequest(req: UnifiedChatRequest): any {
    return {
      model: req.model || this.config.defaultModel || 'deepseek-chat',
      messages: req.messages.map(m => ({ role: m.role, content: m.content })),
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens || 4096,
      stream: req.stream ?? false,
    };
  }

  protected fromNativeResponse(res: any): UnifiedChatResponse {
    return {
      id: res.id || `deepseek-${Date.now()}`,
      model: res.model || 'deepseek-chat',
      content: res.choices?.[0]?.message?.content || '',
      usage: res.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: res.choices?.[0]?.finish_reason || 'stop',
    };
  }

  async chat(req: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const native = this.toNativeRequest(req);
    const res = await this.fetchJson('https://api.deepseek.com/chat/completions', native, {
      'Authorization': `Bearer ${this.config.apiKey}`,
    });
    return this.fromNativeResponse(res);
  }

  async *chatStream(req: UnifiedChatRequest): AsyncGenerator<UnifiedChatResponse, void> {
    yield this.fromNativeResponse({ id: 'stream', model: 'deepseek-chat', content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'stop' });
  }

  async listModels(): Promise<string[]> {
    return ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'];
  }

  async validateKey(): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 1 });
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class QwenAdapter extends ProviderAdapter {
  protected toNativeRequest(req: UnifiedChatRequest): any {
    return {
      model: req.model || this.config.defaultModel || 'qwen-turbo',
      input: {
        messages: req.messages.map(m => ({ role: m.role, content: m.content })),
      },
      parameters: {
        result_format: 'message',
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens || 4096,
      },
    };
  }

  protected fromNativeResponse(res: any): UnifiedChatResponse {
    const choice = res.output?.choices?.[0];
    return {
      id: res.request_id || `qwen-${Date.now()}`,
      model: res.model || 'qwen-turbo',
      content: choice?.message?.content || '',
      usage: {
        promptTokens: res.usage?.input_tokens || 0,
        completionTokens: res.usage?.output_tokens || 0,
        totalTokens: (res.usage?.input_tokens || 0) + (res.usage?.output_tokens || 0),
      },
      finishReason: choice?.finish_reason || 'stop',
    };
  }

  async chat(req: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const native = this.toNativeRequest(req);
    const res = await this.fetchJson('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', native, {
      'Authorization': `Bearer ${this.config.apiKey}`,
    });
    return this.fromNativeResponse(res);
  }

  async *chatStream(req: UnifiedChatRequest): AsyncGenerator<UnifiedChatResponse, void> {
    yield this.fromNativeResponse({ id: 'stream', model: 'qwen-turbo', content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'stop' });
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await this.fetchJson('https://dashscope.aliyuncs.com/api/v1/models', {}, {
        'Authorization': `Bearer ${this.config.apiKey}`,
      });
      return res.data?.map((m: any) => m.id) || [];
    } catch {
      return ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-coder-plus'];
    }
  }

  async validateKey(): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.listModels();
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class ClaudeAdapter extends ProviderAdapter {
  protected toNativeRequest(req: UnifiedChatRequest): any {
    return {
      model: req.model || this.config.defaultModel || 'claude-3-sonnet-20240229',
      max_tokens: req.maxTokens || 4096,
      messages: req.messages.filter(m => m.role !== 'system'),
      system: req.messages.find(m => m.role === 'system')?.content,
      temperature: req.temperature ?? 0.7,
      stream: req.stream ?? false,
    };
  }

  protected fromNativeResponse(res: any): UnifiedChatResponse {
    return {
      id: res.id || `claude-${Date.now()}`,
      model: res.model || 'claude-3-sonnet',
      content: res.content?.[0]?.text || '',
      usage: res.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: res.stop_reason || 'stop',
    };
  }

  async chat(req: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const native = this.toNativeRequest(req);
    const res = await this.fetchJson('https://api.anthropic.com/v1/messages', native, {
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
    });
    return this.fromNativeResponse(res);
  }

  async *chatStream(req: UnifiedChatRequest): AsyncGenerator<UnifiedChatResponse, void> {
    yield this.fromNativeResponse({ id: 'stream', model: 'claude-3-sonnet', content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'stop' });
  }

  async listModels(): Promise<string[]> {
    return ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'];
  }

  async validateKey(): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 1 });
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class OpenAIAdapter extends ProviderAdapter {
  protected toNativeRequest(req: UnifiedChatRequest): any {
    return {
      model: req.model || this.config.defaultModel || 'gpt-4o',
      messages: req.messages,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens || 4096,
      stream: req.stream ?? false,
      tools: req.tools?.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    };
  }

  protected fromNativeResponse(res: any): UnifiedChatResponse {
    const choice = res.choices?.[0] || {};
    return {
      id: res.id || `openai-${Date.now()}`,
      model: res.model || 'gpt-4o',
      content: choice.message?.content || '',
      toolCalls: choice.message?.tool_calls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name,
        arguments: JSON.parse(tc.function?.arguments || '{}'),
      })),
      usage: res.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: choice.finish_reason || 'stop',
    };
  }

  async chat(req: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const native = this.toNativeRequest(req);
    const res = await this.fetchJson('https://api.openai.com/v1/chat/completions', native);
    return this.fromNativeResponse(res);
  }

  async *chatStream(req: UnifiedChatRequest): AsyncGenerator<UnifiedChatResponse, void> {
    yield this.fromNativeResponse({ id: 'stream', model: 'gpt-4o', content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'stop' });
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await this.fetchJson('https://api.openai.com/v1/models', {}, {});
      return res.data?.map((m: any) => m.id) || [];
    } catch {
      return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
    }
  }

  async validateKey(): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.listModels();
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class OllamaAdapter extends ProviderAdapter {
  protected toNativeRequest(req: UnifiedChatRequest): any {
    return {
      model: req.model || this.config.defaultModel || 'llama3',
      messages: req.messages,
      stream: req.stream ?? false,
      options: {
        temperature: req.temperature ?? 0.7,
        num_predict: req.maxTokens || 4096,
      },
    };
  }

  protected fromNativeResponse(res: any): UnifiedChatResponse {
    return {
      id: res.id || `ollama-${Date.now()}`,
      model: res.model || 'llama3',
      content: res.message?.content || '',
      usage: res.prompt_eval_count || res.eval_count
        ? { promptTokens: res.prompt_eval_count || 0, completionTokens: res.eval_count || 0, totalTokens: (res.prompt_eval_count || 0) + (res.eval_count || 0) }
        : { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: 'stop',
    };
  }

  async chat(req: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const native = this.toNativeRequest(req);
    const res = await this.fetchJson(`${this.config.baseUrl || 'http://localhost:11434'}/api/chat`, native, {});
    return this.fromNativeResponse(res);
  }

  async *chatStream(req: UnifiedChatRequest): AsyncGenerator<UnifiedChatResponse, void> {
    yield this.fromNativeResponse({ id: 'stream', model: 'llama3', content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'stop' });
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await this.fetchJson(`${this.config.baseUrl || 'http://localhost:11434'}/api/tags`, {}, {});
      return res.models?.map((m: any) => m.name) || [];
    } catch {
      return ['llama3', 'llama3.1', 'mistral', 'codellama', 'qwen2'];
    }
  }

  async validateKey(): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.listModels();
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// ── AutoConfigEngine — 自动检测与配置 ─────────────────────────

export class AutoConfigEngine {
  /**
   * 输入API key，自动检测provider
   *
   * 检测策略优先级：
   * 1. key前缀匹配（sk-kimi- → Kimi）
   * 2. key格式/长度特征
   * 3. 用户提示（hint）
   * 4. 验证请求试探（fallback）
   */
  static async detectProvider(apiKey: string, userHint?: ProviderType): Promise<AutoDetectedConfig> {
    // 策略1: 用户提示优先
    if (userHint) {
      return this.getPresetForType(userHint);
    }

    // 策略2: key前缀匹配
    const prefixMap: Record<string, ProviderType> = {
      'sk-kimi': 'kimi',
      'sk-': 'openai',  // OpenAI format (also DeepSeek, OpenRouter)
      'sk-ant': 'claude',
      'sess': 'claude',
      'AIzaSy': 'gemini',
      'sk-or': 'openrouter',
    };
    // 子域名检测（key本身不区分，需要额外线索）
    const hintMap: Record<string, ProviderType> = {
      'deepseek': 'deepseek',
      'moonshot': 'kimi',
      'kimi': 'kimi',
      'openrouter': 'openrouter',
      'qwen': 'qwen',
      'gemini': 'gemini',
      'anthropic': 'claude',
      'claude': 'claude',
    };

    for (const [prefix, type] of Object.entries(prefixMap)) {
      if (apiKey.startsWith(prefix)) {
        return this.getPresetForType(type);
      }
    }

    // 策略3: 用户提示词检测（hint来自前端选择的大模型种类）
    if (userHint) {
      for (const [hint, type] of Object.entries(hintMap)) {
        if (userHint.toLowerCase().includes(hint)) {
          return this.getPresetForType(type);
        }
      }
    }

    // 策略4: key长度与特征
    if (apiKey.startsWith('AIzaSy')) {
      return this.getPresetForType('gemini');
    }
    if (apiKey.length > 100 && apiKey.includes('.')) {
      return this.getPresetForType('openai');
    }

    // 策略5: fallback到OpenAI格式（最通用）
    return this.getPresetForType('openai');
  }

  /**
   * 三层级平台选择后的自动配置
   */
  static async autoConfig(
    apiKey: string,
    level1: 'openclaw' | 'hermes' | 'custom',
    level2?: string,
    level3?: string
  ): Promise<ProviderConfig> {
    // level1决定adapter类型
    const typeMap: Record<string, ProviderType> = {
      'openclaw': 'openclaw',
      'hermes': 'hermes',
      'custom': 'openai',
    };

    const type = typeMap[level1] || 'openai';

    // 检测provider
    const detected = await this.detectProvider(apiKey, level2 as ProviderType);

    return {
      type: detected.type || type,
      apiKey,
      baseUrl: detected.baseUrl,
      defaultModel: level3 || detected.defaultModel,
      timeoutMs: 30000,
    };
  }

  private static getPresetForType(type: ProviderType): AutoDetectedConfig {
    const presets: Record<ProviderType, AutoDetectedConfig> = {
      openclaw: {
        type: 'openclaw',
        baseUrl: 'http://localhost:11434',
        defaultModel: 'kimi-k2.6',
        availableModels: ['kimi-k2.6', 'claude-3-sonnet'],
        detectedBy: 'key_prefix',
      },
      hermes: {
        type: 'hermes',
        baseUrl: 'http://localhost:8080',
        defaultModel: 'hermes-3',
        availableModels: ['hermes-3', 'hermes-3-pro'],
        detectedBy: 'key_prefix',
      },
      kimi: {
        type: 'kimi',
        baseUrl: 'https://api.moonshot.cn/v1',
        defaultModel: 'kimi-k2.6',
        availableModels: ['kimi-k2.6', 'kimi-moonshot-v1-8k', 'kimi-moonshot-v1-32k'],
        detectedBy: 'key_prefix',
      },
      kimi_code: {
        type: 'kimi_code',
        baseUrl: 'https://api.kimi.com/coding/v1',
        defaultModel: 'kimi-k2-0711-preview',
        availableModels: ['kimi-k2-0711-preview', 'kimi-k2-0711'],
        detectedBy: 'key_prefix',
      },
      claude: {
        type: 'claude',
        baseUrl: 'https://api.anthropic.com',
        defaultModel: 'claude-3-sonnet-20240229',
        availableModels: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
        detectedBy: 'key_prefix',
      },
      openai: {
        type: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o',
        availableModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
        detectedBy: 'key_format',
      },
      ollama: {
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
        defaultModel: 'llama3',
        availableModels: ['llama3', 'llama3.1', 'mistral', 'codellama'],
        detectedBy: 'key_format',
      },
      gemini: {
        type: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        defaultModel: 'gemini-2.0-flash',
        availableModels: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-pro-preview-03-25'],
        detectedBy: 'key_prefix',
      },
      openrouter: {
        type: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        defaultModel: 'deepseek/deepseek-chat-v3-0324:free',
        availableModels: [
          'deepseek/deepseek-chat-v3-0324:free',
          'qwen/qwen3-coder:free',
          'anthropic/claude-3-sonnet',
          'openai/gpt-4o-mini',
        ],
        detectedBy: 'key_prefix',
      },
      deepseek: {
        type: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        defaultModel: 'deepseek-chat',
        availableModels: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
        detectedBy: 'key_format',
      },
      qwen: {
        type: 'qwen',
        baseUrl: 'https://dashscope.aliyuncs.com',
        defaultModel: 'qwen-turbo',
        availableModels: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-coder-plus'],
        detectedBy: 'key_format',
      },
    };

    return presets[type];
  }
}

// ── UnifiedAPIClient — 统一入口 ─────────────────────────────────

export class UnifiedAPIClient {
  private adapter: ProviderAdapter;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.adapter = this.createAdapter(config.type);
  }

  /** 统一聊天接口 */
  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    return this.adapter.chat(request);
  }

  /** 流式聊天接口 */
  async *chatStream(request: UnifiedChatRequest): AsyncGenerator<UnifiedChatResponse, void> {
    yield* this.adapter.chatStream(request);
  }

  /** 列出可用模型 */
  async listModels(): Promise<string[]> {
    return this.adapter.listModels();
  }

  /** 验证API key有效性 */
  async validateKey(): Promise<{ valid: boolean; error?: string }> {
    return this.adapter.validateKey();
  }

  /** 获取当前配置 */
  getConfig(): ProviderConfig {
    return { ...this.config };
  }

  private createAdapter(type: ProviderType): ProviderAdapter {
    switch (type) {
      case 'openclaw': return new OpenClawAdapter(this.config);
      case 'hermes': return new HermesAdapter(this.config);
      case 'kimi': return new KimiAdapter(this.config);
      case 'kimi_code': return new KimiCodeAdapter(this.config);
      case 'claude': return new ClaudeAdapter(this.config);
      case 'openai': return new OpenAIAdapter(this.config);
      case 'ollama': return new OllamaAdapter(this.config);
      case 'gemini': return new GeminiAdapter(this.config);
      case 'openrouter': return new OpenRouterAdapter(this.config);
      case 'deepseek': return new DeepSeekAdapter(this.config);
      case 'qwen': return new QwenAdapter(this.config);
      default: throw new Error(`Unknown provider type: ${type}`);
    }
  }
}

export default UnifiedAPIClient;
