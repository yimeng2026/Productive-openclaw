/**
 * SseAdapter — Server-Sent Events 协议适配器
 * 流式场景首选：SSE 是单向服务器推送的标准方案
 */

import type {
  AxisMessage,
  AxisMessageReply,
  AxisStreamChunk,
} from '../AxisMessage';
import { createReply } from '../AxisMessage';
import { BaseAdapter, type AdapterStats } from './BaseAdapter';

export class SseAdapter extends BaseAdapter {
  readonly protocol = 'sse';

  private baseUrl: string;
  private timeout: number;
  private headers: Record<string, string>;
  /** 活跃 SSE 连接池 */
  private connections = new Map<string, EventSource>();

  constructor(opts?: {
    baseUrl?: string;
    timeout?: number;
    headers?: Record<string, string>;
  }) {
    super();
    this.baseUrl = opts?.baseUrl ?? '';
    this.timeout = opts?.timeout ?? 60000;
    this.headers = {
      'X-Protocol': '3dacp-sse',
      ...opts?.headers,
    };
    this.setStatus('connected');
  }

  // ──────────── RPC（SSE fallback） ────────────

  async send(msg: AxisMessage): Promise<AxisMessageReply> {
    // SSE 本质上是流式，RPC 模式下收集全部 chunk 后返回
    const chunks: unknown[] = [];
    let lastError: string | null = null;

    await this.sendStream(msg, (chunk) => {
      if (chunk.isLast && (chunk.chunk as any)?.type === 'error') {
        lastError = (chunk.chunk as any).message;
        return;
      }
      if (!chunk.isLast) {
        chunks.push(chunk.chunk);
      }
    });

    if (lastError) {
      return createReply(msg, 'error', null, {
        code: 'SSE_RPC_ERROR',
        message: lastError,
      });
    }

    return createReply(msg, 'ok', chunks.length === 1 ? chunks[0] : chunks);
  }

  // ──────────── 流式 ────────────

  async sendStream(
    msg: AxisMessage,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void> {
    const start = Date.now();
    this.recordSent();

    const streamId = msg.header.msgId;
    const url = this.buildStreamUrl(msg);

    try {
      // 服务端 SSE 端点需要 POST 初始化 + 后续 EventSource 接收
      // 先 POST 消息体获取 stream token
      const initResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(msg),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!initResponse.ok) {
        throw new Error(`HTTP ${initResponse.status}: ${initResponse.statusText}`);
      }

      // 读取 SSE 流
      const reader = initResponse.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sequence = 0;

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
              const parsed = JSON.parse(payload);
              this.recordReceived();
              onChunk({
                streamId,
                sequence: sequence++,
                isLast: false,
                chunk: parsed,
              });
            } catch {
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
        streamId,
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
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(msg),
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (err) {
      this.recordError();
      console.error('[SseAdapter] Emit failed:', err);
    }
  }

  // ──────────── 内部工具 ────────────

  private buildUrl(msg: AxisMessage): string {
    if (this.baseUrl) {
      return `${this.baseUrl.replace(/\/$/, '')}/axis/${msg.header.target.y}`;
    }
    return `/axis/${msg.header.target.y}`;
  }

  private buildStreamUrl(msg: AxisMessage): string {
    if (this.baseUrl) {
      return `${this.baseUrl.replace(/\/$/, '')}/axis/stream`;
    }
    return '/axis/stream';
  }

  override isHealthy(): boolean {
    return this.stats.connectionStatus === 'connected';
  }

  override getStats(): AdapterStats {
    return {
      ...this.stats,
      connectionStatus: this.isHealthy() ? 'connected' : 'error',
    };
  }

  /** 关闭所有 SSE 连接 */
  async close(): Promise<void> {
    for (const [id, es] of this.connections) {
      es.close();
      this.connections.delete(id);
    }
    this.setStatus('disconnected');
  }
}
