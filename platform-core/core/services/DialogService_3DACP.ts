/**
 * DialogService — 3DACP 接入层
 * 对话中心：聊天、上下文管理、流式响应
 */

import { ServiceAdapter } from '../coordinator/ServiceAdapter';
import type { AxisMessage, AxisStreamChunk } from '../coordinator/AxisMessage';

const KIMI_BASE_URL = "https://api.kimi.com/coding/v1";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

const agentContexts = new Map<string, ChatMessage[]>();

function getContext(agentId: string): ChatMessage[] {
  if (!agentContexts.has(agentId)) {
    agentContexts.set(agentId, [
      {
        role: "system",
        content: "你是千界花园的智能助手，帮助用户完成各种任务。",
        timestamp: new Date().toISOString(),
      },
    ]);
  }
  return agentContexts.get(agentId)!;
}

export class DialogService extends ServiceAdapter {
  constructor() {
    super({ moduleId: 'dialog', supportsStreaming: true });
  }

  protected async handleAction(action: string, data: unknown): Promise<unknown> {
    switch (action) {
      case 'create':
        return this.createContext(data as { agentId: string });
      case 'read':
        return this.getHistory(data as { agentId: string });
      case 'update':
        return this.appendMessage(data as { agentId: string; message: ChatMessage });
      case 'delete':
        return this.clearContext(data as { agentId: string });
      case 'invoke':
        return this.chat(data as { agentId: string; content: string });
      default:
        throw new Error(`DialogService: unsupported action '${action}'`);
    }
  }

  protected async handleStreamingAction(
    action: string,
    data: unknown,
    _msg: AxisMessage,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void> {
    if (action === 'stream') {
      const { agentId, content } = data as { agentId: string; content: string };
      return this.chatStream(agentId, content, onChunk);
    }
    throw new Error(`DialogService: streaming action '${action}' not supported`);
  }

  private createContext(data: { agentId: string }): { agentId: string; created: boolean } {
    getContext(data.agentId);
    return { agentId: data.agentId, created: true };
  }

  private getHistory(data: { agentId: string }): ChatMessage[] {
    return getContext(data.agentId);
  }

  private appendMessage(data: { agentId: string; message: ChatMessage }): ChatMessage[] {
    const ctx = getContext(data.agentId);
    ctx.push(data.message);
    return ctx;
  }

  private clearContext(data: { agentId: string }): { agentId: string; cleared: boolean } {
    agentContexts.delete(data.agentId);
    return { agentId: data.agentId, cleared: true };
  }

  private async chat(data: { agentId: string; content: string }): Promise<unknown> {
    const { agentId, content } = data;
    const ctx = getContext(agentId);
    ctx.push({ role: 'user', content, timestamp: new Date().toISOString() });

    const apiKey = process.env.KIMICODE_API_KEY || process.env.KIMI_CODE_API_KEY_1 || '';
    const res = await fetch(`${KIMI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'KimiCLI/0.77',
      },
      body: JSON.stringify({
        model: 'kimi-for-coding',
        messages: ctx,
        stream: false,
        temperature: 0.7,
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const json: any = await res.json();
    const assistantMsg = json.choices?.[0]?.message?.content || '';
    ctx.push({ role: 'assistant', content: assistantMsg, timestamp: new Date().toISOString() });
    return { agentId, message: assistantMsg, context: ctx };
  }

  private async chatStream(
    agentId: string,
    content: string,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void> {
    const ctx = getContext(agentId);
    ctx.push({ role: 'user', content, timestamp: new Date().toISOString() });

    const apiKey = process.env.KIMICODE_API_KEY || process.env.KIMI_CODE_API_KEY_1 || '';
    const res = await fetch(`${KIMI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'KimiCLI/0.77',
      },
      body: JSON.stringify({
        model: 'kimi-for-coding',
        messages: ctx,
        stream: true,
        temperature: 0.7,
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Stream error: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let seq = 0;

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
            const chunk = json.choices?.[0]?.delta?.content || '';
            if (chunk) {
              onChunk({
                streamId: `dialog-${agentId}`,
                sequence: seq++,
                isLast: false,
                chunk: { text: chunk },
              });
            }
          } catch { /* ignore */ }
        }
      }
    }

    onChunk({
      streamId: `dialog-${agentId}`,
      sequence: seq,
      isLast: true,
      chunk: { text: '', done: true },
    });
  }
}

export function createDialogServiceAdapter(): DialogService {
  return new DialogService();
}
