// backend/src/coordinator/bridges/ProviderAdapters.ts
// 多厂商 LLM API 适配器 — 统一请求/响应格式，支持流式与非流式

import { logger } from '../../utils/logger';

// ═══════════════════════════════════════════════════════════════════════
//  统一类型
// ═══════════════════════════════════════════════════════════════════════

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  topP?: number;
  stop?: string[];
  tools?: unknown[];
  responseFormat?: { type: 'text' | 'json_object' };
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  provider: string;
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string;
  createdAt: string;
}

export interface ChatCompletionChunk {
  id: string;
  model: string;
  provider: string;
  delta: string;
  finishReason?: string;
}

export type ChatCompletionResult = ChatCompletionResponse | AsyncGenerator<ChatCompletionChunk>;

// ═══════════════════════════════════════════════════════════════════════
//  OpenAI 兼容格式适配器 (OpenAI / DeepSeek / Moonshot / Google / Ollama / Azure)
// ═══════════════════════════════════════════════════════════════════════

export async function* openaiChatCompletion(
  baseUrl: string,
  apiKey: string,
  providerId: string,
  request: ChatCompletionRequest,
): AsyncGenerator<ChatCompletionChunk, ChatCompletionResponse | undefined> {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map((m) => ({
      role: m.role === 'tool' ? 'assistant' : m.role, // OpenAI 没有 tool 角色，转为 assistant
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
    })),
    stream: !!request.stream,
  };

  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  if (request.topP !== undefined) body.top_p = request.topP;
  if (request.stop) body.stop = request.stop;
  if (request.tools) body.tools = request.tools;
  if (request.responseFormat) body.response_format = request.responseFormat;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  // Kimi Code API 需要 Coding Agent 的 User-Agent
  if (providerId === 'kimi-code' || baseUrl.includes('api.kimi.com')) {
    headers['User-Agent'] = 'KimiCLI/0.77';
  }

  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`[${providerId}] HTTP ${res.status}: ${errText}`);
  }

  // ── 非流式 ───────────────────────────────────────
  if (!request.stream) {
    const data = (await res.json()) as any;
    return {
      id: data.id || `sync-${Date.now()}`,
      model: data.model || request.model,
      provider: providerId,
      content: data.choices?.[0]?.message?.content || '',
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens || 0,
            completionTokens: data.usage.completion_tokens || 0,
            totalTokens: data.usage.total_tokens || 0,
          }
        : undefined,
      finishReason: data.choices?.[0]?.finish_reason || 'stop',
      createdAt: new Date().toISOString(),
    };
  }

  // ── 流式 SSE ─────────────────────────────────────
  if (!res.body) throw new Error(`[${providerId}] Stream body empty`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastChunkId = `stream-${Date.now()}`;
  let lastModel = request.model;
  let totalContent = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;

        const payload = trimmed.slice(6);
        if (payload === '[DONE]') {
          yield { id: lastChunkId, model: lastModel, provider: providerId, delta: '', finishReason: 'stop' };
          return {
            id: lastChunkId,
            model: lastModel,
            provider: providerId,
            content: totalContent,
            finishReason: 'stop',
            createdAt: new Date().toISOString(),
          };
        }

        try {
          const chunk = JSON.parse(payload);
          if (chunk.id) lastChunkId = chunk.id;
          if (chunk.model) lastModel = chunk.model;

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta?.content || '';
          const finishReason = choice.finish_reason;

          if (delta || finishReason) {
            totalContent += delta;
            yield {
              id: lastChunkId,
              model: lastModel,
              provider: providerId,
              delta,
              finishReason,
            };
          }
        } catch {
          // ignore malformed JSON in stream
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // stream ended without [DONE]
  return {
    id: lastChunkId,
    model: lastModel,
    provider: providerId,
    content: totalContent,
    finishReason: 'stop',
    createdAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Anthropic Messages API 适配器
// ═══════════════════════════════════════════════════════════════════════

export async function* anthropicChatCompletion(
  apiKey: string,
  providerId: string,
  request: ChatCompletionRequest,
): AsyncGenerator<ChatCompletionChunk, ChatCompletionResponse | undefined> {
  const url = 'https://api.anthropic.com/v1/messages';

  // Anthropic 不支持 system role 在 messages 中，需要提取到顶层 system 字段
  const systemMessages = request.messages.filter((m) => m.role === 'system');
  const otherMessages = request.messages.filter((m) => m.role !== 'system');

  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxTokens ?? 4096,
    messages: otherMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    stream: !!request.stream,
  };

  if (systemMessages.length > 0) {
    body.system = systemMessages.map((m) => m.content).join('\n\n');
  }

  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.topP !== undefined) body.top_p = request.topP;
  if (request.stop) body.stop_sequences = request.stop;

  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`[${providerId}] HTTP ${res.status}: ${errText}`);
  }

  // ── 非流式 ───────────────────────────────────────
  if (!request.stream) {
    const data = (await res.json()) as any;
    const textBlocks = data.content?.filter((c: any) => c.type === 'text') || [];
    const content = textBlocks.map((c: any) => c.text).join('');
    return {
      id: data.id || `anthropic-${Date.now()}`,
      model: data.model || request.model,
      provider: providerId,
      content,
      usage: data.usage
        ? {
            promptTokens: data.usage.input_tokens || 0,
            completionTokens: data.usage.output_tokens || 0,
            totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
          }
        : undefined,
      finishReason: data.stop_reason || 'stop',
      createdAt: new Date().toISOString(),
    };
  }

  // ── 流式 SSE ─────────────────────────────────────
  if (!res.body) throw new Error(`[${providerId}] Stream body empty`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let msgId = `anthropic-${Date.now()}`;
  let totalContent = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;

        const payload = trimmed.slice(6);
        if (payload === '[DONE]') continue;

        try {
          const event = JSON.parse(payload);

          if (event.type === 'message_start') {
            msgId = event.message?.id || msgId;
          }

          if (event.type === 'content_block_delta') {
            const delta = event.delta?.text || '';
            totalContent += delta;
            yield {
              id: msgId,
              model: request.model,
              provider: providerId,
              delta,
            };
          }

          if (event.type === 'message_stop') {
            yield {
              id: msgId,
              model: request.model,
              provider: providerId,
              delta: '',
              finishReason: 'stop',
            };
            return {
              id: msgId,
              model: request.model,
              provider: providerId,
              content: totalContent,
              finishReason: 'stop',
              createdAt: new Date().toISOString(),
            };
          }
        } catch {
          // ignore malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    id: msgId,
    model: request.model,
    provider: providerId,
    content: totalContent,
    finishReason: 'stop',
    createdAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  统一执行入口
// ═══════════════════════════════════════════════════════════════════════

export async function executeChatCompletion(
  apiFormat: string,
  baseUrl: string,
  apiKey: string,
  providerId: string,
  request: ChatCompletionRequest,
): Promise<AsyncGenerator<ChatCompletionChunk, ChatCompletionResponse | undefined>> {
  if (apiFormat === 'anthropic') {
    return anthropicChatCompletion(apiKey, providerId, request);
  }
  // 其余全部走 OpenAI 兼容格式（openai, openai-compatible, bedrock, vertex, zhipu, etc.）
  return openaiChatCompletion(baseUrl, apiKey, providerId, request);
}

// ═══════════════════════════════════════════════════════════════════════
//  工具：计算请求 tokens（简易估算）
// ═══════════════════════════════════════════════════════════════════════

export function estimateTokens(text: string): number {
  // 粗略估算：1 token ≈ 4 字符（英文），中文 ≈ 1 token / 字符
  // 这里用一个混合公式
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars + otherChars / 4);
}
