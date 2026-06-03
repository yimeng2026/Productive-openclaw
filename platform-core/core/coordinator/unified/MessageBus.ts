// MessageBus.ts — Mega Coordinator 消息总线 v2.1
// 集成 TopicRegistry + MessageRouter + WebSocket + 连接池 + 生命周期管理
// 对接 ProviderBridge 和 SkillBridge

import { logger } from '../../utils/logger';
import { getWebSocketManager } from '../../websocket';
import type { ServerEvent } from '../../websocket/types';
import {
  TopicRegistry,
  type TopicName,
  type TopicHandler,
  type SubscriptionOptions,
  type MessageMeta,
} from './TopicRegistry';
import {
  MessageRouter,
  type RouterOptions,
  type RouteResult,
  type RoutingStrategy,
} from './MessageRouter';
import type { AgentRegistry } from './AgentRegistry';
import type {
  AgentMessage,
  MessageHandler,
  MessageBusOptions as LegacyOptions,
  MessageType,
} from './types';

// ─────────────────────────────────────────────
// 扩展类型
// ─────────────────────────────────────────────

export type BusBackend = 'local' | 'redis' | 'websocket' | 'hybrid';

export interface ConnectionPoolEntry {
  id: string;
  type: 'agent' | 'skill' | 'provider' | 'websocket' | 'internal';
  connectedAt: number;
  lastActivityAt: number;
  messageCount: number;
  status: 'connected' | 'disconnected' | 'reconnecting' | 'error';
  metadata?: Record<string, unknown>;
}

export interface MessageBusOptions {
  backend: BusBackend;
  redisUrl?: string;
  websocketUrl?: string;
  maxConnections?: number;
  messageTimeoutMs?: number;
  enablePersistence?: boolean;
  maxHistory?: number;
  routerOptions?: RouterOptions;
}

export interface BusStats {
  backend: string;
  totalConnections: number;
  activeConnections: number;
  totalMessagesPublished: number;
  totalMessagesDelivered: number;
  totalMessagesFailed: number;
  topicStats: ReturnType<TopicRegistry['getStats']>;
  routerStats: ReturnType<MessageRouter['getStats']>;
  historySize: number;
  maxHistory: number;
  uptimeMs: number;
}

export interface PublishOptions {
  source?: string;
  correlationId?: string;
  headers?: Record<string, unknown>;
  strategy?: RoutingStrategy;
  requireAck?: boolean;
  ttlMs?: number;
}

// ─────────────────────────────────────────────
// 消息总线类
// ─────────────────────────────────────────────

export class MessageBus {
  private options: Required<Pick<MessageBusOptions, 'backend' | 'maxConnections' | 'messageTimeoutMs' | 'enablePersistence' | 'maxHistory'>> & MessageBusOptions;
  private topicRegistry: TopicRegistry;
  private messageRouter: MessageRouter;
  private agentRegistry?: AgentRegistry;

  // 连接池
  private connections = new Map<string, ConnectionPoolEntry>();
  private connCounter = 0;

  // 历史消息（兼容旧版）
  private history: AgentMessage[] = [];

  // 旧版订阅（向后兼容）
  private legacySubscriptions = new Map<string, { id: string; handler: MessageHandler; filter?: MessageType[]; source?: string; target?: string }>();
  private legacySubCounter = 0;

  // 生命周期
  private started = false;
  private startTime = 0;
  private cleanupTimer: NodeJS.Timeout | null = null;

  // Provider/Skill 桥接钩子
  private providerPublishHook?: (topic: string, payload: Record<string, unknown>) => Promise<void>;
  private skillPublishHook?: (topic: string, payload: Record<string, unknown>) => Promise<void>;

  constructor(options: MessageBusOptions = { backend: 'local' }) {
    this.options = {
      backend: options.backend ?? 'local',
      redisUrl: options.redisUrl,
      websocketUrl: options.websocketUrl,
      maxConnections: options.maxConnections ?? 1000,
      messageTimeoutMs: options.messageTimeoutMs ?? 30000,
      enablePersistence: options.enablePersistence ?? false,
      maxHistory: options.maxHistory ?? 1000,
      routerOptions: options.routerOptions,
    };

    this.topicRegistry = new TopicRegistry();
    this.messageRouter = new MessageRouter(this.topicRegistry, undefined, options.routerOptions);

    logger.info({ backend: this.options.backend }, '[MessageBus] Initialized');
  }

  // ── 生命周期 ─────────────────────────────────

  async start(agentRegistry?: AgentRegistry): Promise<void> {
    if (this.started) return;
    this.agentRegistry = agentRegistry;
    this.messageRouter = new MessageRouter(this.topicRegistry, agentRegistry, this.options.routerOptions);
    this.started = true;
    this.startTime = Date.now();

    // 启动定时清理
    this.cleanupTimer = setInterval(() => {
      this.topicRegistry.cleanupExpired();
      this.cleanupStaleConnections();
    }, 60000);

    logger.info('[MessageBus] Started');
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // 断开所有连接
    for (const [id, conn] of this.connections) {
      conn.status = 'disconnected';
      logger.debug({ connId: id }, '[MessageBus] Connection closed on stop');
    }
    this.connections.clear();

    this.topicRegistry.reset();
    this.messageRouter.reset();
    this.history = [];
    this.legacySubscriptions.clear();

    logger.info('[MessageBus] Stopped');
  }

  get isRunning(): boolean {
    return this.started;
  }

  // ── 连接池管理 ─────────────────────────────

  registerConnection(
    type: ConnectionPoolEntry['type'],
    metadata?: Record<string, unknown>
  ): string {
    if (this.connections.size >= this.options.maxConnections) {
      throw new Error(`Connection pool full: ${this.options.maxConnections}`);
    }

    this.connCounter += 1;
    const id = `conn_${type}_${this.connCounter}_${Date.now()}`;
    const now = Date.now();

    const entry: ConnectionPoolEntry = {
      id,
      type,
      connectedAt: now,
      lastActivityAt: now,
      messageCount: 0,
      status: 'connected',
      metadata,
    };

    this.connections.set(id, entry);
    logger.debug({ connId: id, type, poolSize: this.connections.size }, '[MessageBus] Connection registered');
    return id;
  }

  unregisterConnection(connId: string): boolean {
    const conn = this.connections.get(connId);
    if (!conn) return false;

    conn.status = 'disconnected';
    this.connections.delete(connId);
    logger.debug({ connId: connId, poolSize: this.connections.size }, '[MessageBus] Connection unregistered');
    return true;
  }

  getConnection(connId: string): ConnectionPoolEntry | undefined {
    return this.connections.get(connId);
  }

  getConnections(type?: ConnectionPoolEntry['type']): ConnectionPoolEntry[] {
    const all = Array.from(this.connections.values());
    if (type) return all.filter((c) => c.type === type);
    return all;
  }

  private cleanupStaleConnections(): void {
    const now = Date.now();
    const staleThreshold = 300000; // 5分钟无活动视为过期
    let removed = 0;

    for (const [id, conn] of this.connections) {
      if (conn.status === 'disconnected' || now - conn.lastActivityAt > staleThreshold) {
        this.connections.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info({ removed, remaining: this.connections.size }, '[MessageBus] Stale connections cleaned');
    }
  }

  // ── 主题订阅（新版）────────────────────────

  subscribeTopic(
    pattern: string,
    handler: TopicHandler,
    options?: SubscriptionOptions
  ): string {
    this.ensureRunning();
    return this.topicRegistry.subscribe(pattern, handler, options);
  }

  unsubscribeTopic(subId: string): boolean {
    return this.topicRegistry.unsubscribe(subId);
  }

  // ── 发布（新版 + 旧版兼容）──────────────────

  async publishTopic(
    topic: TopicName,
    payload: Record<string, unknown>,
    options: PublishOptions = {}
  ): Promise<{ messageId: string; delivered: number; failed: number; routeResult?: RouteResult }> {
    this.ensureRunning();

    const messageId = `bus_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const meta: MessageMeta = {
      messageId,
      publishedAt: Date.now(),
      source: options.source || 'coordinator',
      correlationId: options.correlationId,
      headers: options.headers,
      attempt: 1,
      maxAttempts: 3,
    };

    // 1. 通过 TopicRegistry 广播
    const topicResult = await this.topicRegistry.publish(topic, payload, meta);

    // 2. 通过 MessageRouter 智能路由（含重试、断路器）
    const routeResult = await this.messageRouter.route(topic, payload, meta, options.strategy);

    // 3. WebSocket 推送
    if (this.options.backend === 'websocket' || this.options.backend === 'hybrid') {
      try {
        const ws = getWebSocketManager();
        const event: ServerEvent = {
          type: 'bus.message',
          topic,
          payload,
          messageId,
          source: options.source,
          correlationId: options.correlationId,
        } as any;
        ws.broadcastToRoom(`topic:${topic}`, event);
      } catch {
        // WebSocket 未初始化时静默忽略
      }
    }

    // 4. Provider/Skill 桥接钩子
    if (topic.startsWith('provider/') && this.providerPublishHook) {
      await this.providerPublishHook(topic, payload).catch((err) => {
        logger.warn({ err, topic }, '[MessageBus] Provider hook failed');
      });
    }
    if (topic.startsWith('skill/') && this.skillPublishHook) {
      await this.skillPublishHook(topic, payload).catch((err) => {
        logger.warn({ err, topic }, '[MessageBus] Skill hook failed');
      });
    }

    // 5. 记录历史
    this.recordHistory({
      id: messageId,
      type: 'custom',
      source: options.source || 'coordinator',
      target: topic,
      payload,
      timestamp: Date.now(),
      correlationId: options.correlationId,
    });

    logger.debug({
      messageId,
      topic,
      delivered: topicResult.delivered + routeResult.delivered,
      failed: topicResult.failed + routeResult.failed,
    }, '[MessageBus] Published');

    return {
      messageId,
      delivered: topicResult.delivered + routeResult.delivered,
      failed: topicResult.failed + routeResult.failed,
      routeResult,
    };
  }

  // ── 旧版兼容 API ───────────────────────────

  async publish(message: Omit<AgentMessage, 'id' | 'timestamp'>): Promise<AgentMessage> {
    const fullMessage: AgentMessage = {
      ...message,
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
    };

    // 记录历史
    this.recordHistory(fullMessage);

    // 本地分发（旧版订阅）
    await this.dispatchLegacy(fullMessage);

    // 新版主题分发（如果 target 看起来像主题）
    if (fullMessage.target && !fullMessage.target.includes('agent-') && !fullMessage.target.includes('swarm-')) {
      await this.topicRegistry.publish(
        fullMessage.target,
        fullMessage.payload,
        {
          source: fullMessage.source,
          correlationId: fullMessage.correlationId,
          attempt: 1,
          maxAttempts: 3,
        }
      );
    }

    logger.debug({
      msgId: fullMessage.id,
      type: fullMessage.type,
      source: fullMessage.source,
      target: fullMessage.target,
    }, '[MessageBus] Message published (legacy)');

    return fullMessage;
  }

  subscribe(
    handler: MessageHandler,
    options: {
      filter?: MessageType[];
      source?: string;
      target?: string;
    } = {}
  ): string {
    this.legacySubCounter += 1;
    const subId = `sub_${this.legacySubCounter}_${Date.now()}`;

    this.legacySubscriptions.set(subId, {
      id: subId,
      handler,
      filter: options.filter,
      source: options.source,
      target: options.target,
    });

    logger.debug({ subId, filter: options.filter }, '[MessageBus] Legacy subscription created');
    return subId;
  }

  unsubscribe(subId: string): boolean {
    const removed = this.legacySubscriptions.delete(subId);
    if (removed) {
      logger.debug({ subId }, '[MessageBus] Legacy subscription removed');
    }
    return removed;
  }

  async send(
    target: string,
    payload: Record<string, unknown>,
    options: {
      source?: string;
      type?: MessageType;
      correlationId?: string;
    } = {}
  ): Promise<AgentMessage> {
    return this.publish({
      type: options.type || 'custom',
      source: options.source || 'coordinator',
      target,
      payload,
      correlationId: options.correlationId,
    });
  }

  async broadcast(
    type: MessageType,
    payload: Record<string, unknown>,
    source: string = 'coordinator'
  ): Promise<AgentMessage> {
    return this.publish({
      type,
      source,
      payload,
    });
  }

  // ── 查询 ───────────────────────────────────

  getHistory(filter?: {
    source?: string;
    target?: string;
    type?: MessageType;
    since?: number;
    limit?: number;
  }): AgentMessage[] {
    let result = [...this.history];

    if (filter?.source) {
      result = result.filter((m) => m.source === filter.source);
    }
    if (filter?.target) {
      result = result.filter((m) => m.target === filter.target || !m.target);
    }
    if (filter?.type) {
      result = result.filter((m) => m.type === filter.type);
    }
    if (filter?.since) {
      result = result.filter((m) => m.timestamp >= filter.since!);
    }
    if (filter?.limit) {
      result = result.slice(-filter.limit);
    }

    return result;
  }

  getHistoryForAgent(agentId: string, limit = 50): AgentMessage[] {
    return this.history
      .filter((m) => m.source === agentId || m.target === agentId || m.target === 'broadcast')
      .slice(-limit);
  }

  getTopics(): ReturnType<TopicRegistry['getTopics']> {
    return this.topicRegistry.getTopics();
  }

  getTopicStats(topic: string): ReturnType<TopicRegistry['getTopicStats']> {
    return this.topicRegistry.getTopicStats(topic);
  }

  clearHistory(): void {
    this.history = [];
    logger.info('[MessageBus] History cleared');
  }

  // ── 桥接钩子 ───────────────────────────────

  setProviderPublishHook(hook: (topic: string, payload: Record<string, unknown>) => Promise<void>): void {
    this.providerPublishHook = hook;
    logger.info('[MessageBus] Provider publish hook registered');
  }

  setSkillPublishHook(hook: (topic: string, payload: Record<string, unknown>) => Promise<void>): void {
    this.skillPublishHook = hook;
    logger.info('[MessageBus] Skill publish hook registered');
  }

  // ── 统计 ───────────────────────────────────

  getStats(): BusStats {
    return {
      backend: this.options.backend,
      totalConnections: this.connections.size,
      activeConnections: Array.from(this.connections.values()).filter((c) => c.status === 'connected').length,
      totalMessagesPublished: this.topicRegistry.getStats().messagesPublished,
      totalMessagesDelivered: this.topicRegistry.getStats().messagesDelivered,
      totalMessagesFailed: this.topicRegistry.getStats().messagesFailed,
      topicStats: this.topicRegistry.getStats(),
      routerStats: this.messageRouter.getStats(),
      historySize: this.history.length,
      maxHistory: this.options.maxHistory,
      uptimeMs: this.started ? Date.now() - this.startTime : 0,
    };
  }

  // ── 内部方法 ───────────────────────────────

  private recordHistory(message: AgentMessage): void {
    this.history.push(message);
    if (this.history.length > this.options.maxHistory) {
      this.history = this.history.slice(-this.options.maxHistory);
    }
  }

  private async dispatchLegacy(message: AgentMessage): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const sub of this.legacySubscriptions.values()) {
      // 类型过滤
      if (sub.filter && !sub.filter.includes(message.type)) continue;
      // 来源过滤
      if (sub.source && message.source !== sub.source) continue;
      // 目标过滤
      if (sub.target && message.target && message.target !== sub.target) continue;
      // 广播消息总是送达
      if (message.target && message.target !== sub.target && sub.target !== message.source) {
        if (sub.target) continue;
      }

      promises.push(
        Promise.resolve(sub.handler(message)).catch((err) => {
          logger.error({ err, msgId: message.id, subId: sub.id }, '[MessageBus] Legacy handler error');
        })
      );
    }

    await Promise.all(promises);
  }

  private ensureRunning(): void {
    if (!this.started) {
      throw new Error('MessageBus not started. Call start() first.');
    }
  }
}

// ── 单例导出 ─────────────────────────────────

let busInstance: MessageBus | null = null;

export function getMessageBus(options?: MessageBusOptions): MessageBus {
  if (!busInstance) {
    busInstance = new MessageBus(options);
  }
  return busInstance;
}

export async function initMessageBus(agentRegistry?: AgentRegistry, options?: MessageBusOptions): Promise<MessageBus> {
  const bus = getMessageBus(options);
  await bus.start(agentRegistry);
  return bus;
}

export function resetMessageBus(): void {
  busInstance = null;
}
