/**
 * BaseAdapter — ProtocolAdapter 统一接口定义
 * 所有 3DACP 协议适配器必须实现此接口
 */

import type {
  AxisMessage,
  AxisMessageReply,
  AxisStreamChunk,
} from '../AxisMessage';

// ───────────────────────── 适配器统计 ─────────────────────────

export interface AdapterStats {
  /** 总发送消息数 */
  totalSent: number;
  /** 总接收消息数 */
  totalReceived: number;
  /** 总错误数 */
  totalErrors: number;
  /** 平均延迟（毫秒） */
  averageLatencyMs: number;
  /** 当前连接状态 */
  connectionStatus: 'connected' | 'disconnected' | 'connecting' | 'error';
  /** 最后活动时间 */
  lastActivityAt: number;
  /** 协议类型 */
  protocol: string;
}

// ───────────────────────── 适配器接口 ─────────────────────────

export interface ProtocolAdapter {
  /** 协议标识 */
  readonly protocol: string;

  /** 发送 RPC 消息并等待响应 */
  send(msg: AxisMessage): Promise<AxisMessageReply>;

  /** 发送流式消息，通过回调接收分块 */
  sendStream(
    msg: AxisMessage,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void>;

  /** 发送单向事件（fire-and-forget） */
  emit(msg: AxisMessage): Promise<void>;

  /** 健康检查 */
  isHealthy(): boolean;

  /** 获取统计信息 */
  getStats(): AdapterStats;

  /** 关闭适配器，清理资源 */
  close?(): Promise<void>;
}

// ───────────────────────── 适配器基类（共享统计逻辑） ─────────────────────────

export abstract class BaseAdapter implements ProtocolAdapter {
  abstract readonly protocol: string;

  protected stats: AdapterStats = {
    totalSent: 0,
    totalReceived: 0,
    totalErrors: 0,
    averageLatencyMs: 0,
    connectionStatus: 'disconnected',
    lastActivityAt: 0,
    protocol: '',
  };

  protected latencySamples: number[] = [];
  protected maxLatencySamples = 100;

  constructor() {
    // protocol is set by subclass constructor
  }

  abstract send(msg: AxisMessage): Promise<AxisMessageReply>;
  abstract sendStream(
    msg: AxisMessage,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void>;
  abstract emit(msg: AxisMessage): Promise<void>;

  isHealthy(): boolean {
    return this.stats.connectionStatus === 'connected';
  }

  getStats(): AdapterStats {
    return { ...this.stats };
  }

  /** 记录发送 */
  protected recordSent(): void {
    this.stats.totalSent++;
    this.stats.lastActivityAt = Date.now();
  }

  /** 记录接收 */
  protected recordReceived(): void {
    this.stats.totalReceived++;
    this.stats.lastActivityAt = Date.now();
  }

  /** 记录错误 */
  protected recordError(): void {
    this.stats.totalErrors++;
    this.stats.lastActivityAt = Date.now();
  }

  /** 记录延迟 */
  protected recordLatency(ms: number): void {
    this.latencySamples.push(ms);
    if (this.latencySamples.length > this.maxLatencySamples) {
      this.latencySamples.shift();
    }
    const sum = this.latencySamples.reduce((a, b) => a + b, 0);
    this.stats.averageLatencyMs = Math.round(sum / this.latencySamples.length);
  }

  /** 更新连接状态 */
  protected setStatus(status: AdapterStats['connectionStatus']): void {
    this.stats.connectionStatus = status;
    this.stats.lastActivityAt = Date.now();
  }
}
