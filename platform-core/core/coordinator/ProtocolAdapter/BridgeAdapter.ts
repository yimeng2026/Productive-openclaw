/**
 * BridgeAdapter — 桥接适配器（跨语言/跨进程）
 * 用于 AgentZero (Python)、Ollama、其他语言运行时之间的通信
 * 底层可以是 gRPC、Unix Socket、Named Pipe、共享内存等
 */

import type {
  AxisMessage,
  AxisMessageReply,
  AxisStreamChunk,
} from '../AxisMessage';
import { createReply } from '../AxisMessage';
import { BaseAdapter, type AdapterStats } from './BaseAdapter';

export class BridgeAdapter extends BaseAdapter {
  readonly protocol = 'bridge';

  private transport: 'grpc' | 'unix-socket' | 'named-pipe' | 'stdio' | 'tcp';
  private endpoint: string;
  private timeout: number;
  /** 自定义发送函数（由外部注入，适配不同桥接底层） */
  private sender?: (msg: AxisMessage) => Promise<unknown>;
  private streamSender?: (
    msg: AxisMessage,
    onChunk: (chunk: AxisStreamChunk) => void
  ) => Promise<void>;

  constructor(opts?: {
    transport?: 'grpc' | 'unix-socket' | 'named-pipe' | 'stdio' | 'tcp';
    endpoint?: string;
    timeout?: number;
    sender?: (msg: AxisMessage) => Promise<unknown>;
    streamSender?: (msg: AxisMessage, onChunk: (chunk: AxisStreamChunk) => void) => Promise<void>;
  }) {
    super();
    this.transport = opts?.transport ?? 'tcp';
    this.endpoint = opts?.endpoint ?? 'localhost:50051';
    this.timeout = opts?.timeout ?? 30000;
    this.sender = opts?.sender;
    this.streamSender = opts?.streamSender;
    this.setStatus('connected');
  }

  /** 设置自定义发送函数（用于注入 gRPC/stdio 等实现） */
  setSender(sender: (msg: AxisMessage) => Promise<unknown>): void {
    this.sender = sender;
  }

  setStreamSender(
    sender: (msg: AxisMessage, onChunk: (chunk: AxisStreamChunk) => void) => Promise<void>
  ): void {
    this.streamSender = sender;
  }

  // ──────────── RPC ────────────

  async send(msg: AxisMessage): Promise<AxisMessageReply> {
    const start = Date.now();
    this.recordSent();

    if (!this.sender) {
      this.recordError();
      return createReply(msg, 'error', null, {
        code: 'BRIDGE_NOT_CONFIGURED',
        message: 'BridgeAdapter sender not configured. Call setSender() first.',
      });
    }

    try {
      const result = await Promise.race([
        this.sender(msg),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Bridge timeout')), this.timeout)
        ),
      ]);

      this.recordLatency(Date.now() - start);
      this.recordReceived();

      // 如果返回的是 AxisMessageReply 透传
      if (result && typeof result === 'object' && 'version' in result && 'status' in result) {
        return result as AxisMessageReply;
      }

      return createReply(msg, 'ok', result);
    } catch (err) {
      this.recordError();
      return createReply(msg, 'error', null, {
        code: 'BRIDGE_ERROR',
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

    if (!this.streamSender) {
      this.recordError();
      onChunk({
        streamId: msg.header.msgId,
        sequence: 0,
        isLast: true,
        chunk: {
          type: 'error',
          message: 'BridgeAdapter streamSender not configured. Call setStreamSender() first.',
        },
      });
      return;
    }

    try {
      await this.streamSender(msg, (chunk) => {
        this.recordReceived();
        onChunk(chunk);
      });
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

    if (!this.sender) {
      this.recordError();
      console.error('[BridgeAdapter] No sender configured');
      return;
    }

    this.sender(msg).catch((err) => {
      this.recordError();
      console.error('[BridgeAdapter] Emit failed:', err);
    });
  }

  // ──────────── 统计 ────────────

  override isHealthy(): boolean {
    return this.sender !== undefined && this.stats.connectionStatus === 'connected';
  }

  override getStats(): AdapterStats {
    return {
      ...this.stats,
      connectionStatus: this.sender ? 'connected' : 'error',
    };
  }

  /** 获取桥接配置信息 */
  getBridgeInfo(): Record<string, unknown> {
    return {
      transport: this.transport,
      endpoint: this.endpoint,
      senderConfigured: !!this.sender,
      streamSenderConfigured: !!this.streamSender,
    };
  }
}
