/**
 * InternalAdapter — 进程内/本地调用适配器
 * 同进程内模块通信：零序列化开销，直接函数调用
 */

import type {
  AxisMessage,
  AxisMessageReply,
  AxisStreamChunk,
} from '../AxisMessage';
import { createReply } from '../AxisMessage';
import { BaseAdapter, type AdapterStats } from './BaseAdapter';

/** 本地处理器注册表 */
const localHandlers = new Map<string, (msg: AxisMessage) => Promise<unknown>>();
const localStreamHandlers = new Map<string, (msg: AxisMessage, onChunk: (chunk: AxisStreamChunk) => void) => Promise<void>>();

export class InternalAdapter extends BaseAdapter {
  readonly protocol = 'internal';

  constructor() {
    super();
    this.setStatus('connected');
  }

  // ──────────── 本地处理器注册 ────────────

  static registerHandler(moduleId: string, handler: (msg: AxisMessage) => Promise<unknown>): void {
    localHandlers.set(moduleId, handler);
  }

  static registerStreamHandler(
    moduleId: string,
    handler: (msg: AxisMessage, onChunk: (chunk: AxisStreamChunk) => void) => Promise<void>
  ): void {
    localStreamHandlers.set(moduleId, handler);
  }

  static unregisterHandler(moduleId: string): void {
    localHandlers.delete(moduleId);
    localStreamHandlers.delete(moduleId);
  }

  // ──────────── RPC ────────────

  async send(msg: AxisMessage): Promise<AxisMessageReply> {
    const start = Date.now();
    this.recordSent();

    const targetModule = msg.header.target.y;
    const handler = localHandlers.get(targetModule);

    if (!handler) {
      this.recordError();
      return createReply(msg, 'error', null, {
        code: 'NO_LOCAL_HANDLER',
        message: `No local handler registered for module: ${targetModule}`,
      });
    }

    try {
      const result = await handler(msg);
      this.recordLatency(Date.now() - start);
      this.recordReceived();
      return createReply(msg, 'ok', result);
    } catch (err) {
      this.recordError();
      return createReply(msg, 'error', null, {
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ──────────── 流式 ────────────

  async sendStream(
    msg: AxisMessage,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void> {
    const start = Date.now();
    this.recordSent();

    const targetModule = msg.header.target.y;
    const handler = localStreamHandlers.get(targetModule);

    if (!handler) {
      this.recordError();
      onChunk({
        streamId: msg.header.msgId,
        sequence: 0,
        isLast: true,
        chunk: {
          type: 'error',
          message: `No local stream handler for module: ${targetModule}`,
        },
      });
      return;
    }

    try {
      await handler(msg, (chunk) => {
        this.recordReceived();
        onChunk(chunk);
      });
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

    const targetModule = msg.header.target.y;
    const handler = localHandlers.get(targetModule);

    if (!handler) {
      this.recordError();
      console.error(`[InternalAdapter] No handler for module: ${targetModule}`);
      return;
    }

    // fire-and-forget：不等待结果
    handler(msg).catch((err) => {
      this.recordError();
      console.error('[InternalAdapter] Emit handler error:', err);
    });
  }

  // ──────────── 统计 ────────────

  override isHealthy(): boolean {
    // 进程内通信始终健康（除非进程挂了）
    return true;
  }

  override getStats(): AdapterStats {
    return {
      ...this.stats,
      connectionStatus: 'connected',
      averageLatencyMs: this.stats.averageLatencyMs || 0,
    };
  }
}
