/**
 * RestAdapter — RESTful HTTP 协议适配器
 * 默认首选适配器：简单请求走 REST，不维护长连接
 */

import type {
  AxisMessage,
  AxisMessageReply,
  AxisStreamChunk,
} from '../AxisMessage';
import { createReply } from '../AxisMessage';
import { BaseAdapter, type AdapterStats } from './BaseAdapter';

export class RestAdapter extends BaseAdapter {
  readonly protocol = 'rest';

  /** 目标基础 URL */
  private baseUrl: string;
  /** 请求超时（毫秒） */
  private timeout: number;
  /** 默认请求头 */
  private headers: Record<string, string>;

  constructor(opts?: {
    baseUrl?: string;
    timeout?: number;
    headers?: Record<string, string>;
  }) {
    super();
    this.baseUrl = opts?.baseUrl ?? '';
    this.timeout = opts?.timeout ?? 30000;
    this.headers = {
      'Content-Type': 'application/json',
      'X-Protocol': '3dacp-rest',
      ...opts?.headers,
    };
    this.setStatus('connected');
  }

  // ──────────── RPC ────────────

  async send(msg: AxisMessage): Promise<AxisMessageReply> {
    const start = Date.now();
    this.recordSent();

    try {
      const url = this.buildUrl(msg);
      const response = await fetch(url, {
        method: this.httpMethod(msg),
        headers: this.headers,
        body: JSON.stringify(msg),
        signal: AbortSignal.timeout(this.timeout),
      });

      this.recordLatency(Date.now() - start);

      if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText);
        this.recordError();
        return createReply(msg, 'error', null, {
          code: `HTTP_${response.status}`,
          message: errText,
        });
      }

      const data: any = await response.json().catch(() => null);
      this.recordReceived();

      // 如果服务端返回的是 AxisMessageReply，直接透传；否则包装
      if (data?.version === '3dacp/v1' && data?.status) {
        return data as AxisMessageReply;
      }

      return createReply(msg, 'ok', data);
    } catch (err) {
      this.recordError();
      return createReply(msg, 'error', null, {
        code: 'REST_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ──────────── 流式（SSE fallback） ────────────

  async sendStream(
    msg: AxisMessage,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void> {
    const start = Date.now();
    this.recordSent();

    try {
      const url = this.buildUrl(msg);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...this.headers,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(msg),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sequence = 0;
      const streamId = msg.header.msgId;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;

            const payload = trimmed.slice(6);
            if (payload === '[DONE]') {
              onChunk({
                streamId,
                sequence: sequence++,
                isLast: true,
                chunk: { type: 'done' },
              });
              continue;
            }

            try {
              const chunk = JSON.parse(payload) as AxisStreamChunk;
              this.recordReceived();
              onChunk(chunk);
            } catch {
              // 非 JSON 行也作为 chunk 透传
              onChunk({
                streamId,
                sequence: sequence++,
                isLast: false,
                chunk: payload,
              });
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      this.recordLatency(Date.now() - start);
    } catch (err) {
      this.recordError();
      onChunk({
        streamId: msg.header.msgId,
        sequence: 0,
        isLast: true,
        chunk: {
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  // ──────────── Emit ────────────

  async emit(msg: AxisMessage): Promise<void> {
    this.recordSent();

    try {
      const url = this.buildUrl(msg);
      await fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(msg),
        signal: AbortSignal.timeout(this.timeout),
      });
      // fire-and-forget，不等待响应
    } catch (err) {
      this.recordError();
      console.error('[RestAdapter] Emit failed:', err);
    }
  }

  // ──────────── 内部工具 ────────────

  private buildUrl(msg: AxisMessage): string {
    const target = msg.header.target;
    // 如果有基础 URL 就用，否则构造 /axis/{moduleId} 路径
    if (this.baseUrl) {
      return `${this.baseUrl.replace(/\/$/, '')}/axis/${target.y}`;
    }
    return `/axis/${target.y}`;
  }

  private httpMethod(msg: AxisMessage): string {
    switch (msg.payload.action) {
      case 'create':
        return 'POST';
      case 'read':
      case 'subscribe':
        return 'GET';
      case 'update':
        return 'PUT';
      case 'delete':
      case 'unsubscribe':
        return 'DELETE';
      case 'invoke':
      case 'stream':
        return 'POST';
      default:
        return 'POST';
    }
  }

  // ──────────── 重载统计 ────────────

  override isHealthy(): boolean {
    // REST 不需要持久连接，只要近期没有连续错误就算健康
    const recent = this.stats.totalErrors < this.stats.totalSent * 0.1;
    return recent || this.stats.connectionStatus === 'connected';
  }

  override getStats(): AdapterStats {
    return {
      ...this.stats,
      connectionStatus: this.isHealthy() ? 'connected' : 'error',
    };
  }
}
