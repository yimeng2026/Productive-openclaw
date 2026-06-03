/**
 * SwarmMessageBus.ts — SYLVA 蜂群消息总线
 * 
 * 支持两种模式：
 * - local:   基于 Node.js EventEmitter，单进程内零延迟通信
 * - redis:   基于 Redis Pub/Sub，跨进程/跨机器分布式通信
 * 
 * 统一接口：publish / subscribe / unsubscribe
 * 消息格式：JSON序列化的 SwarmMessage
 */

import { EventEmitter } from 'events';

// 消息类型枚举 — 覆盖蜂群全生命周期
export enum MessageType {
  // 任务相关
  TASK_SUBMIT     = 'TASK_SUBMIT',     // 提交新任务
  TASK_ASSIGN     = 'TASK_ASSIGN',     // 任务分配给节点
  TASK_START      = 'TASK_START',      // 节点开始执行
  TASK_COMPLETE   = 'TASK_COMPLETE',   // 节点执行完成
  TASK_FAIL       = 'TASK_FAIL',       // 节点执行失败
  TASK_TIMEOUT    = 'TASK_TIMEOUT',    // 任务超时
  
  // 协调相关
  TASK_DECOMPOSE  = 'TASK_DECOMPOSE',  // 任务分解请求
  TASK_AGGREGATE  = 'TASK_AGGREGATE',  // 结果聚合请求
  REBALANCE       = 'REBALANCE',       // 负载重平衡指令
  NODE_REGISTER   = 'NODE_REGISTER',   // 节点注册
  NODE_HEARTBEAT  = 'NODE_HEARTBEAT',  // 节点心跳
  NODE_DEREGISTER = 'NODE_DEREGISTER', // 节点注销
  
  // 状态与配置
  CONFIG_UPDATE   = 'CONFIG_UPDATE',   // 配置变更
  STATE_SYNC      = 'STATE_SYNC',      // 状态同步
  ERROR_REPORT    = 'ERROR_REPORT',    // 错误上报
  
  // 用户自定义
  CUSTOM          = 'CUSTOM',          // 自定义消息
}

/** 消息体结构 */
export interface SwarmMessage<TPayload = unknown> {
  /** 消息唯一ID */
  id: string;
  /** 消息类型 */
  type: MessageType;
  /** 主题（routing key） */
  topic: string;
  /** 发送方节点ID */
  sender: string;
  /** 目标节点ID（空字符串 = 广播） */
  target?: string;
  /** 消息载荷 */
  payload: TPayload;
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 递归深度（用于追踪消息传播层级） */
  depth?: number;
  /** 关联的任务ID */
  taskId?: string;
  /** 父消息ID（用于消息链追踪） */
  parentId?: string;
}

/** 消息处理器类型 */
export type MessageHandler<TPayload = unknown> = (msg: SwarmMessage<TPayload>) => void | Promise<void>;

// ──────────────────────────────────────────
// 抽象接口
// ──────────────────────────────────────────

export interface IMessageBus {
  /** 发布消息到指定主题 */
  publish<TPayload>(topic: string, message: Omit<SwarmMessage<TPayload>, 'id' | 'timestamp'>): Promise<void>;
  /** 订阅主题 */
  subscribe<TPayload>(topic: string, handler: MessageHandler<TPayload>): string; // 返回订阅ID
  /** 取消订阅 */
  unsubscribe(subscriptionId: string): void;
  /** 关闭连接 */
  close(): Promise<void>;
  /** 当前连接状态 */
  isConnected(): boolean;
}

// ──────────────────────────────────────────
// Local 模式：EventEmitter 实现
// ──────────────────────────────────────────

export class LocalMessageBus implements IMessageBus {
  private emitter = new EventEmitter();
  private subscriptions = new Map<string, { topic: string; handler: MessageHandler }>();
  private counter = 0;
  private connected = true;

  async publish<TPayload>(
    topic: string,
    message: Omit<SwarmMessage<TPayload>, 'id' | 'timestamp'>
  ): Promise<void> {
    if (!this.connected) throw new Error('LocalMessageBus: bus is closed');

    const fullMessage: SwarmMessage<TPayload> = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      topic,
    };

    // 使用 setImmediate 模拟异步，但保持单线程内零网络延迟
    setImmediate(() => {
      this.emitter.emit(topic, fullMessage);
      // 同时触发通配符监听
      this.emitter.emit('*', fullMessage);
    });
  }

  subscribe<TPayload>(topic: string, handler: MessageHandler<TPayload>): string {
    const id = `sub-${++this.counter}`;
    const wrappedHandler = (msg: SwarmMessage<TPayload>) => {
      // 如果是定向消息，检查目标匹配
      if (msg.target && msg.target !== '' && msg.target !== msg.sender) {
        // 定向消息不匹配本节点，跳过
        // 注意：这里假设 sender 是当前节点ID，实际应由调用方传入
      }
      handler(msg);
    };

    this.subscriptions.set(id, { topic, handler: wrappedHandler as MessageHandler });
    this.emitter.on(topic, wrappedHandler);
    return id;
  }

  unsubscribe(subscriptionId: string): void {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) {
      this.emitter.off(sub.topic, sub.handler);
      this.subscriptions.delete(subscriptionId);
    }
  }

  async close(): Promise<void> {
    this.connected = false;
    this.emitter.removeAllListeners();
    this.subscriptions.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// ──────────────────────────────────────────
// Redis 模式：分布式 Pub/Sub 实现
// ──────────────────────────────────────────

interface RedisLikeClient {
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  on(event: 'message', handler: (channel: string, message: string) => void): void;
  on(event: 'connect' | 'disconnect' | 'error', handler: () => void): void;
  quit(): Promise<void>;
  isReady: boolean;
}

export class RedisMessageBus implements IMessageBus {
  private client!: RedisLikeClient;
  private subscriptions = new Map<string, { topic: string; handler: MessageHandler; subId: string }>();
  private counter = 0;
  private connected = false;
  private nodeId: string;

  constructor(
    nodeId: string,
    private redisFactory: () => RedisLikeClient | Promise<RedisLikeClient>
  ) {
    this.nodeId = nodeId;
  }

  async connect(): Promise<void> {
    this.client = await this.redisFactory();
    
    this.client.on('connect', () => {
      this.connected = true;
    });
    
    this.client.on('disconnect', () => {
      this.connected = false;
    });

    // 监听所有订阅频道的消息
    this.client.on('message', (channel: string, message: string) => {
      try {
        const parsed = JSON.parse(message) as SwarmMessage;
        // 定向消息过滤：不是发给我的就丢弃
        if (parsed.target && parsed.target !== '' && parsed.target !== this.nodeId) {
          return;
        }
        
        // 分发到本地处理器
        for (const [, sub] of this.subscriptions) {
          if (sub.topic === channel || sub.topic === '*') {
            sub.handler(parsed);
          }
        }
      } catch (err) {
        console.error(`RedisMessageBus: failed to parse message from ${channel}`, err);
      }
    });

    this.connected = this.client.isReady;
  }

  async publish<TPayload>(
    topic: string,
    message: Omit<SwarmMessage<TPayload>, 'id' | 'timestamp'>
  ): Promise<void> {
    if (!this.connected) throw new Error('RedisMessageBus: not connected');

    const fullMessage: SwarmMessage<TPayload> = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      topic,
    };

    await this.client.publish(topic, JSON.stringify(fullMessage));
  }

  subscribe<TPayload>(topic: string, handler: MessageHandler<TPayload>): string {
    const id = `sub-${++this.counter}`;
    this.subscriptions.set(id, { topic, handler: handler as MessageHandler, subId: id });
    
    // 异步订阅 Redis 频道
    this.client.subscribe(topic).catch(err => {
      console.error(`RedisMessageBus: failed to subscribe to ${topic}`, err);
    });
    
    return id;
  }

  unsubscribe(subscriptionId: string): void {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) {
      this.client.unsubscribe(sub.topic).catch(() => {});
      this.subscriptions.delete(subscriptionId);
    }
  }

  async close(): Promise<void> {
    this.connected = false;
    for (const [, sub] of this.subscriptions) {
      await this.client.unsubscribe(sub.topic).catch(() => {});
    }
    this.subscriptions.clear();
    await this.client.quit();
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// ──────────────────────────────────────────
// 工厂：根据配置自动选择实现
// ──────────────────────────────────────────

export async function createMessageBus(
  mode: 'local' | 'redis',
  nodeId: string,
  redisFactory?: () => RedisLikeClient | Promise<RedisLikeClient>
): Promise<IMessageBus> {
  if (mode === 'local') {
    return new LocalMessageBus();
  }
  
  if (mode === 'redis') {
    if (!redisFactory) {
      throw new Error('Redis mode requires redisFactory callback');
    }
    const bus = new RedisMessageBus(nodeId, redisFactory);
    await bus.connect();
    return bus;
  }
  
  throw new Error(`Unsupported message bus mode: ${mode}`);
}
