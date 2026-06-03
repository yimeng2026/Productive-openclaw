// MessageRouter.ts — 消息路由器
// 负载均衡、失败重试、死信队列、断路器
// 对接 TopicRegistry 和 AgentRegistry 实现智能路由

import { logger } from '../../utils/logger';
import type { TopicRegistry, TopicHandler, MessageMeta } from './TopicRegistry';
import type { AgentRegistry } from './AgentRegistry';

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

export type RoutingStrategy = 'round_robin' | 'least_loaded' | 'priority' | 'broadcast' | 'sticky' | 'balanced';

export interface RouteTarget {
  type: 'agent' | 'skill' | 'provider' | 'topic' | 'custom';
  id: string;
  priority?: number;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export interface RouterOptions {
  /** 默认路由策略 */
  defaultStrategy?: RoutingStrategy;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重试延迟基数（毫秒） */
  retryBaseDelayMs?: number;
  /** 断路器: 连续失败阈值 */
  circuitBreakerThreshold?: number;
  /** 断路器: 恢复超时（毫秒） */
  circuitBreakerRecoveryMs?: number;
  /** 死信队列容量 */
  deadLetterCapacity?: number;
  /** 消息超时（毫秒） */
  messageTimeoutMs?: number;
}

export interface RouteResult {
  messageId: string;
  targets: RouteTarget[];
  strategy: RoutingStrategy;
  delivered: number;
  failed: number;
  retried: number;
  deadLettered: boolean;
  latencyMs: number;
}

export interface CircuitBreakerState {
  targetId: string;
  consecutiveFailures: number;
  open: boolean;
  lastFailureAt: number;
  lastSuccessAt: number;
}

export interface DeadLetterEntry {
  messageId: string;
  topic: string;
  payload: Record<string, unknown>;
  meta: MessageMeta;
  failedTargets: Array<{ targetId: string; error: string; timestamp: number }>;
  enqueuedAt: number;
  reason: string;
}

export interface RouterStats {
  totalRouted: number;
  totalDelivered: number;
  totalFailed: number;
  totalRetried: number;
  totalDeadLettered: number;
  activeCircuitBreakers: number;
  deadLetterQueueSize: number;
  avgLatencyMs: number;
}

// ─────────────────────────────────────────────
// MessageRouter 类
// ─────────────────────────────────────────────

export class MessageRouter {
  private options: Required<RouterOptions>;
  private topicRegistry: TopicRegistry;
  private agentRegistry?: AgentRegistry;

  // 负载均衡状态
  private roundRobinIndex = 0;
  private targetLoad = new Map<string, number>(); // 当前负载计数

  // 断路器
  private circuitBreakers = new Map<string, CircuitBreakerState>();

  // 死信队列
  private deadLetterQueue: DeadLetterEntry[] = [];

  // 统计
  private stats: RouterStats = {
    totalRouted: 0,
    totalDelivered: 0,
    totalFailed: 0,
    totalRetried: 0,
    totalDeadLettered: 0,
    activeCircuitBreakers: 0,
    deadLetterQueueSize: 0,
    avgLatencyMs: 0,
  };
  private latencySamples: number[] = [];

  constructor(topicRegistry: TopicRegistry, agentRegistry?: AgentRegistry, options: RouterOptions = {}) {
    this.topicRegistry = topicRegistry;
    this.agentRegistry = agentRegistry;
    this.options = {
      defaultStrategy: 'balanced',
      maxRetries: 3,
      retryBaseDelayMs: 500,
      circuitBreakerThreshold: 5,
      circuitBreakerRecoveryMs: 30000,
      deadLetterCapacity: 1000,
      messageTimeoutMs: 30000,
      ...options,
    };
  }

  // ── 核心路由 ───────────────────────────────

  async route(
    topic: string,
    payload: Record<string, unknown>,
    meta: MessageMeta,
    strategy?: RoutingStrategy
  ): Promise<RouteResult> {
    const start = Date.now();
    const effectiveStrategy = strategy ?? this.options.defaultStrategy;
    this.stats.totalRouted++;

    // 1. 解析目标
    const targets = this.resolveTargets(topic, payload, effectiveStrategy);

    // 2. 过滤断路器打开的目标
    const availableTargets = targets.filter((t) => !this.isCircuitBreakerOpen(t.id));

    if (availableTargets.length === 0 && targets.length > 0) {
      logger.warn({ topic, messageId: meta.messageId }, '[MessageRouter] All targets circuit-open');
    }

    let delivered = 0;
    let failed = 0;
    let retried = 0;
    const failedTargets: Array<{ targetId: string; error: string; timestamp: number }> = [];

    // 3. 分发到可用目标
    for (const target of availableTargets) {
      const result = await this.deliverWithRetry(topic, payload, meta, target);
      delivered += result.delivered ? 1 : 0;
      failed += result.delivered ? 0 : 1;
      retried += result.retries;
      if (!result.delivered) {
        failedTargets.push({ targetId: target.id, error: result.error!, timestamp: Date.now() });
      }
    }

    // 4. 全部失败 -> 死信队列
    let deadLettered = false;
    if (availableTargets.length > 0 && delivered === 0) {
      this.enqueueDeadLetter(topic, payload, meta, failedTargets, 'all_targets_failed');
      deadLettered = true;
      this.stats.totalDeadLettered++;
    }

    const latency = Date.now() - start;
    this.recordLatency(latency);
    this.stats.totalDelivered += delivered;
    this.stats.totalFailed += failed;
    this.stats.totalRetried += retried;

    return {
      messageId: meta.messageId,
      targets,
      strategy: effectiveStrategy,
      delivered,
      failed,
      retried,
      deadLettered,
      latencyMs: latency,
    };
  }

  // ── 目标解析 ───────────────────────────────

  private resolveTargets(
    topic: string,
    payload: Record<string, unknown>,
    strategy: RoutingStrategy
  ): RouteTarget[] {
    const explicitTargets = payload.targets as RouteTarget[] | undefined;
    if (explicitTargets && explicitTargets.length > 0) {
      return this.sortTargets(explicitTargets, strategy);
    }

    // 从 TopicRegistry 获取订阅者作为目标
    const subs = this.topicRegistry.getSubscriptionsForTopic(topic);
    const targets: RouteTarget[] = subs.map((sub) => ({
      type: 'custom' as const,
      id: sub.id,
      priority: sub.options.priority ?? 5,
      metadata: sub.options.metadata,
    }));

    // 如果与 AgentRegistry 集成，尝试解析 Agent 目标
    if (this.agentRegistry && (topic.startsWith('agent/') || topic.startsWith('task/'))) {
      const agentTargets = this.resolveAgentTargets(topic, strategy);
      targets.push(...agentTargets);
    }

    return this.sortTargets(targets, strategy);
  }

  private resolveAgentTargets(topic: string, strategy: RoutingStrategy): RouteTarget[] {
    if (!this.agentRegistry) return [];

    const parts = topic.split('/');
    const targets: RouteTarget[] = [];

    // agent/:id/... 格式
    if (parts[0] === 'agent' && parts[1] && parts[1] !== '+' && parts[1] !== '#') {
      const agent = this.agentRegistry.get(parts[1]);
      if (agent) {
        targets.push({
          type: 'agent',
          id: agent.id,
          priority: agent.priority,
          metadata: { status: agent.status, health: agent.health },
        });
      }
    }

    // task/:id/... 格式
    if (parts[0] === 'task' && parts[1] && parts[1] !== '+' && parts[1] !== '#') {
      // 查找执行该任务的 agent
      const healthy = this.agentRegistry.getHealthy();
      for (const agent of healthy) {
        targets.push({
          type: 'agent',
          id: agent.id,
          priority: agent.priority,
          metadata: { status: agent.status },
        });
      }
    }

    return this.sortTargets(targets, strategy);
  }

  private sortTargets(targets: RouteTarget[], strategy: RoutingStrategy): RouteTarget[] {
    switch (strategy) {
      case 'round_robin':
        this.roundRobinIndex = (this.roundRobinIndex + 1) % Math.max(targets.length, 1);
        return [
          ...targets.slice(this.roundRobinIndex),
          ...targets.slice(0, this.roundRobinIndex),
        ];

      case 'least_loaded': {
        return [...targets].sort((a, b) => {
          const loadA = this.targetLoad.get(a.id) ?? 0;
          const loadB = this.targetLoad.get(b.id) ?? 0;
          return loadA - loadB;
        });
      }

      case 'priority':
        return [...targets].sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5));

      case 'sticky':
        // sticky 策略：优先选择之前选过的目标（简化版：与 round_robin 相同）
        return [...targets]; // 保持原始顺序

      case 'broadcast':
      default:
        return targets;
    }
  }

  // ── 投递与重试 ─────────────────────────────

  private async deliverWithRetry(
    topic: string,
    payload: Record<string, unknown>,
    meta: MessageMeta,
    target: RouteTarget
  ): Promise<{ delivered: boolean; retries: number; error?: string }> {
    const maxRetries = this.options.maxRetries;
    const baseDelay = this.options.retryBaseDelayMs;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // 增加负载计数
        this.targetLoad.set(target.id, (this.targetLoad.get(target.id) ?? 0) + 1);

        const timeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error('Delivery timeout')), this.options.messageTimeoutMs);
        });

        const deliveryPromise = this.deliverToTarget(topic, payload, meta, target);
        await Promise.race([deliveryPromise, timeoutPromise]);

        // 减少负载计数
        this.targetLoad.set(target.id, Math.max(0, (this.targetLoad.get(target.id) ?? 1) - 1));

        // 记录成功，重置断路器
        this.recordSuccess(target.id);
        return { delivered: true, retries: attempt };
      } catch (err: any) {
        // 减少负载计数
        this.targetLoad.set(target.id, Math.max(0, (this.targetLoad.get(target.id) ?? 1) - 1));

        this.recordFailure(target.id);

        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt); // 指数退避
          logger.warn(
            { targetId: target.id, messageId: meta.messageId, attempt, delay },
            '[MessageRouter] Delivery failed, retrying'
          );
          await this.sleep(delay);
        } else {
          return { delivered: false, retries: maxRetries, error: err.message };
        }
      }
    }

    return { delivered: false, retries: maxRetries, error: 'Max retries exceeded' };
  }

  private async deliverToTarget(
    _topic: string,
    _payload: Record<string, unknown>,
    _meta: MessageMeta,
    target: RouteTarget
  ): Promise<void> {
    // 实际投递由调用方通过 TopicRegistry 的 handler 完成
    // 这里执行目标健康检查
    if (target.type === 'agent' && this.agentRegistry) {
      const agent = this.agentRegistry.get(target.id);
      if (!agent) throw new Error(`Agent not found: ${target.id}`);
      if (agent.health === 'unhealthy') throw new Error(`Agent unhealthy: ${target.id}`);
      if (agent.status === 'error') throw new Error(`Agent in error state: ${target.id}`);
    }
  }

  // ── 断路器 ─────────────────────────────────

  private isCircuitBreakerOpen(targetId: string): boolean {
    const state = this.circuitBreakers.get(targetId);
    if (!state) return false;

    if (state.open) {
      // 检查是否可以半开
      const now = Date.now();
      if (now - state.lastFailureAt > this.options.circuitBreakerRecoveryMs) {
        state.open = false;
        state.consecutiveFailures = 0;
        logger.info({ targetId }, '[MessageRouter] Circuit breaker half-open');
        return false;
      }
      return true;
    }

    return false;
  }

  private recordFailure(targetId: string): void {
    let state = this.circuitBreakers.get(targetId);
    if (!state) {
      state = {
        targetId,
        consecutiveFailures: 0,
        open: false,
        lastFailureAt: 0,
        lastSuccessAt: 0,
      };
      this.circuitBreakers.set(targetId, state);
    }

    state.consecutiveFailures++;
    state.lastFailureAt = Date.now();

    if (state.consecutiveFailures >= this.options.circuitBreakerThreshold) {
      state.open = true;
      logger.warn({ targetId, failures: state.consecutiveFailures }, '[MessageRouter] Circuit breaker opened');
    }
  }

  private recordSuccess(targetId: string): void {
    let state = this.circuitBreakers.get(targetId);
    if (!state) {
      state = {
        targetId,
        consecutiveFailures: 0,
        open: false,
        lastFailureAt: 0,
        lastSuccessAt: Date.now(),
      };
      this.circuitBreakers.set(targetId, state);
      return;
    }

    state.consecutiveFailures = 0;
    state.lastSuccessAt = Date.now();
    if (state.open) {
      state.open = false;
      logger.info({ targetId }, '[MessageRouter] Circuit breaker closed');
    }
  }

  getCircuitBreakerState(targetId: string): CircuitBreakerState | undefined {
    return this.circuitBreakers.get(targetId);
  }

  getAllCircuitBreakers(): CircuitBreakerState[] {
    return Array.from(this.circuitBreakers.values());
  }

  // ── 死信队列 ───────────────────────────────

  private enqueueDeadLetter(
    topic: string,
    payload: Record<string, unknown>,
    meta: MessageMeta,
    failedTargets: Array<{ targetId: string; error: string; timestamp: number }>,
    reason: string
  ): void {
    const entry: DeadLetterEntry = {
      messageId: meta.messageId,
      topic,
      payload,
      meta,
      failedTargets,
      enqueuedAt: Date.now(),
      reason,
    };

    this.deadLetterQueue.push(entry);
    if (this.deadLetterQueue.length > this.options.deadLetterCapacity) {
      this.deadLetterQueue = this.deadLetterQueue.slice(-this.options.deadLetterCapacity);
    }

    logger.warn({ messageId: meta.messageId, reason, queueSize: this.deadLetterQueue.length }, '[MessageRouter] Dead letter enqueued');
  }

  getDeadLetterQueue(limit = 100): DeadLetterEntry[] {
    return this.deadLetterQueue.slice(-limit);
  }

  peekDeadLetter(): DeadLetterEntry | undefined {
    return this.deadLetterQueue[0];
  }

  reprocessDeadLetter(messageId?: string): { reprocessed: number; succeeded: number; failed: number } {
    const toReprocess = messageId
      ? this.deadLetterQueue.filter((e) => e.messageId === messageId)
      : [...this.deadLetterQueue];

    // 从队列中移除要重处理的
    if (messageId) {
      this.deadLetterQueue = this.deadLetterQueue.filter((e) => e.messageId !== messageId);
    } else {
      this.deadLetterQueue = [];
    }

    let succeeded = 0;
    let failed = 0;

    for (const entry of toReprocess) {
      this.route(entry.topic, entry.payload, { ...entry.meta, attempt: (entry.meta.attempt ?? 0) + 1 })
        .then((result) => {
          if (result.delivered > 0) succeeded++;
          else failed++;
        })
        .catch(() => {
          failed++;
        });
    }

    return { reprocessed: toReprocess.length, succeeded, failed };
  }

  clearDeadLetterQueue(): void {
    const count = this.deadLetterQueue.length;
    this.deadLetterQueue = [];
    logger.info({ cleared: count }, '[MessageRouter] Dead letter queue cleared');
  }

  // ── 统计 ───────────────────────────────────

  private recordLatency(latencyMs: number): void {
    this.latencySamples.push(latencyMs);
    if (this.latencySamples.length > 1000) {
      this.latencySamples = this.latencySamples.slice(-1000);
    }
    this.stats.avgLatencyMs =
      this.latencySamples.length > 0
        ? Math.round(this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length)
        : 0;
  }

  getStats(): RouterStats {
    this.stats.activeCircuitBreakers = Array.from(this.circuitBreakers.values()).filter((c) => c.open).length;
    this.stats.deadLetterQueueSize = this.deadLetterQueue.length;
    return { ...this.stats };
  }

  // ── 工具 ───────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  reset(): void {
    this.circuitBreakers.clear();
    this.deadLetterQueue = [];
    this.targetLoad.clear();
    this.latencySamples = [];
    this.stats = {
      totalRouted: 0,
      totalDelivered: 0,
      totalFailed: 0,
      totalRetried: 0,
      totalDeadLettered: 0,
      activeCircuitBreakers: 0,
      deadLetterQueueSize: 0,
      avgLatencyMs: 0,
    };
    this.roundRobinIndex = 0;
    logger.info('[MessageRouter] Reset');
  }
}

// ── 单例 ───────────────────────────────────

let routerInstance: MessageRouter | null = null;

export function getMessageRouter(topicRegistry?: TopicRegistry, agentRegistry?: AgentRegistry, options?: RouterOptions): MessageRouter {
  if (!routerInstance && topicRegistry) {
    routerInstance = new MessageRouter(topicRegistry, agentRegistry, options);
  }
  return routerInstance!;
}

export function resetMessageRouter(): void {
  routerInstance = null;
}
