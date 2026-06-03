/**
 * WsAdapter — WebSocket 协议适配器
 * 双向实时通信首选：Agent 对话、群组编排等流式场景
 */

import type {
  AxisMessage,
  AxisMessageReply,
  AxisStreamChunk,
} from '../AxisMessage';
import { createReply } from '../AxisMessage';
import { BaseAdapter, type AdapterStats } from './BaseAdapter';

interface PendingRequest {
  resolve: (reply: AxisMessageReply) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class WsAdapter extends BaseAdapter {
  readonly protocol = 'ws';

  private baseUrl: string;
  private timeout: number;
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private streamCallbacks = new Map<string, (chunk: AxisStreamChunk) => void>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private messageQueue: AxisMessage[] = [];

  constructor(opts?: {
    baseUrl?: string;
    timeout?: number;
    maxReconnectAttempts?: number;
  }) {
    super();
    this.baseUrl = opts?.baseUrl ?? '';
    this.timeout = opts?.timeout ?? 30000;
    this.maxReconnectAttempts = opts?.maxReconnectAttempts ?? 5;
    this.connect();
  }

  // ──────────── 连接管理 ────────────

  private connect(): void {
    if (typeof WebSocket === 'undefined') {
      // Node.js 环境需要 ws 库
      try {
        const WS = require('ws');
        this.ws = new WS(this.baseUrl || 'ws://localhost:3000/axis/ws');
      } catch {
        this.setStatus('error');
        return;
      }
    } else {
      this.ws = new WebSocket(this.baseUrl || 'ws://localhost:3000/axis/ws');
    }

    this.ws!.onopen = () => {
      this.setStatus('connected');
      this.reconnectAttempts = 0;
      // 发送队列中的消息
      while (this.messageQueue.length > 0) {
        const msg = this.messageQueue.shift()!;
        this.ws!.send(JSON.stringify(msg));
      }
    };

    this.ws!.onmessage = (event: MessageEvent | { data: string }) => {
      this.handleMessage(event.data as string);
    };

    this.ws!.onclose = () => {
      this.setStatus('disconnected');
      this.attemptReconnect();
    };

    this.ws!.onerror = (err: Event) => {
      this.recordError();
      console.error('[WsAdapter] WebSocket error:', err);
    };
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setStatus('error');
      return;
    }

    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  private handleMessage(raw: string): void {
    try {
      const data = JSON.parse(raw);

      // 响应消息
      if (data?.header?.correlationId) {
        const pending = this.pending.get(data.header.correlationId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(data.header.correlationId);
          this.recordReceived();
          pending.resolve(data as AxisMessageReply);
          return;
        }
      }

      // 流式分块
      if (data?.streamId) {
        const cb = this.streamCallbacks.get(data.streamId);
        if (cb) {
          this.recordReceived();
          cb(data as AxisStreamChunk);
          if (data.isLast) {
            this.streamCallbacks.delete(data.streamId);
          }
        }
        return;
      }
    } catch {
      console.warn('[WsAdapter] Failed to parse message:', raw.slice(0, 200));
    }
  }

  private ensureConnected(): Promise<void> {
    if (this.ws?.readyState === 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), this.timeout);
      const check = () => {
        if (this.ws?.readyState === 1) {
          clearTimeout(timer);
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  // ──────────── RPC ────────────

  async send(msg: AxisMessage): Promise<AxisMessageReply> {
    const start = Date.now();
    this.recordSent();

    try {
      await this.ensureConnected();

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(msg.header.msgId);
          this.recordError();
          reject(new Error('WebSocket RPC timeout'));
        }, this.timeout);

        this.pending.set(msg.header.msgId, { resolve, reject, timer });
        this.ws!.send(JSON.stringify(msg));
      }).then((reply) => {
        this.recordLatency(Date.now() - start);
        return reply as AxisMessageReply;
      });
    } catch (err) {
      this.recordError();
      return createReply(msg, 'error', null, {
        code: 'WS_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ──────────── 流式 ────────────

  async sendStream(
    msg: AxisMessage,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void> {
    this.recordSent();

    try {
      await this.ensureConnected();
      this.streamCallbacks.set(msg.header.msgId, onChunk);
      this.ws!.send(JSON.stringify(msg));
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
      if (this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify(msg));
      } else {
        this.messageQueue.push(msg);
      }
    } catch (err) {
      this.recordError();
      console.error('[WsAdapter] Emit failed:', err);
    }
  }

  // ──────────── 健康 ────────────

  override isHealthy(): boolean {
    return this.ws?.readyState === 1 && this.stats.connectionStatus === 'connected';
  }

  override getStats(): AdapterStats {
    return {
      ...this.stats,
      connectionStatus: this.ws?.readyState === 1 ? 'connected' : 'disconnected',
      totalSent: this.stats.totalSent,
      totalReceived: this.stats.totalReceived,
    };
  }

  /** 关闭 WebSocket */
  async close(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    // 拒绝所有 pending
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('WebSocket closed'));
    }
    this.pending.clear();
    this.streamCallbacks.clear();
    this.ws?.close();
    this.setStatus('disconnected');
  }
}
