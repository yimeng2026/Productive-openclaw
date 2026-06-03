// TopicRegistry.ts — 主题注册中心
// 支持分层主题（MQTT风格）、通配符订阅、持久化/临时主题
// 对应架构: Mega Coordinator 消息总线 v2.1

import { logger } from '../../utils/logger';

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

export type TopicPattern = string; // 例如 "agent/+/heartbeat" 或 "task/#"
export type TopicName = string;    // 例如 "agent/dev-1/heartbeat"

export interface TopicSubscription {
  id: string;
  pattern: TopicPattern;
  handler: TopicHandler;
  options: SubscriptionOptions;
  createdAt: number;
  lastActivityAt: number;
  messageCount: number;
}

export interface SubscriptionOptions {
  /** 最大并发处理数 */
  maxConcurrency?: number;
  /** 消息队列容量 */
  queueCapacity?: number;
  /** 是否持久化订阅 */
  durable?: boolean;
  /** 订阅过期时间（毫秒，0=不过期） */
  ttlMs?: number;
  /** 优先级（0-10，越高越优先） */
  priority?: number;
  /** 订阅者元数据 */
  metadata?: Record<string, unknown>;
}

export type TopicHandler = (topic: TopicName, payload: Record<string, unknown>, meta: MessageMeta) => void | Promise<void>;

export interface MessageMeta {
  messageId: string;
  publishedAt: number;
  source?: string;
  correlationId?: string;
  headers?: Record<string, unknown>;
  attempt: number;
  maxAttempts: number;
}

export interface TopicInfo {
  name: TopicName;
  subscriberCount: number;
  messageCount: number;
  lastPublishedAt: number;
  createdAt: number;
  isPattern: boolean;
}

export interface TopicStats {
  totalTopics: number;
  totalSubscriptions: number;
  patternSubscriptions: number;
  exactSubscriptions: number;
  messagesPublished: number;
  messagesDelivered: number;
  messagesFailed: number;
}

// ─────────────────────────────────────────────
// TopicRegistry 类
// ─────────────────────────────────────────────

export class TopicRegistry {
  // 精确主题订阅: 主题名 -> 订阅列表
  private exactSubs = new Map<TopicName, Map<string, TopicSubscription>>();
  // 模式订阅: 模式 -> 订阅列表
  private patternSubs = new Map<TopicPattern, Map<string, TopicSubscription>>();
  // 主题统计
  private topicStats = new Map<TopicName, { messageCount: number; lastPublishedAt: number; createdAt: number }>();
  // 全局计数器
  private subCounter = 0;
  private msgCounter = 0;
  private totalPublished = 0;
  private totalDelivered = 0;
  private totalFailed = 0;

  // ── 订阅 ───────────────────────────────────

  subscribe(
    pattern: TopicPattern,
    handler: TopicHandler,
    options: SubscriptionOptions = {}
  ): string {
    this.subCounter += 1;
    const subId = `tsub_${this.subCounter}_${Date.now()}`;
    const now = Date.now();

    const subscription: TopicSubscription = {
      id: subId,
      pattern,
      handler,
      options: {
        maxConcurrency: 1,
        queueCapacity: 100,
        durable: false,
        ttlMs: 0,
        priority: 5,
        ...options,
      },
      createdAt: now,
      lastActivityAt: now,
      messageCount: 0,
    };

    if (this.isPattern(pattern)) {
      if (!this.patternSubs.has(pattern)) {
        this.patternSubs.set(pattern, new Map());
      }
      this.patternSubs.get(pattern)!.set(subId, subscription);
    } else {
      if (!this.exactSubs.has(pattern)) {
        this.exactSubs.set(pattern, new Map());
        this.topicStats.set(pattern, { messageCount: 0, lastPublishedAt: 0, createdAt: now });
      }
      this.exactSubs.get(pattern)!.set(subId, subscription);
    }

    logger.debug({ subId, pattern, durable: subscription.options.durable }, '[TopicRegistry] Subscribed');
    return subId;
  }

  unsubscribe(subId: string): boolean {
    // 从精确订阅中查找
    for (const [topic, subs] of this.exactSubs) {
      if (subs.has(subId)) {
        subs.delete(subId);
        if (subs.size === 0) {
          this.exactSubs.delete(topic);
        }
        logger.debug({ subId, topic }, '[TopicRegistry] Unsubscribed (exact)');
        return true;
      }
    }

    // 从模式订阅中查找
    for (const [pattern, subs] of this.patternSubs) {
      if (subs.has(subId)) {
        subs.delete(subId);
        if (subs.size === 0) {
          this.patternSubs.delete(pattern);
        }
        logger.debug({ subId, pattern }, '[TopicRegistry] Unsubscribed (pattern)');
        return true;
      }
    }

    return false;
  }

  /** 批量取消订阅 */
  unsubscribeMany(subIds: string[]): number {
    let count = 0;
    for (const subId of subIds) {
      if (this.unsubscribe(subId)) count++;
    }
    return count;
  }

  // ── 发布 ───────────────────────────────────

  async publish(
    topic: TopicName,
    payload: Record<string, unknown>,
    meta: Partial<Omit<MessageMeta, 'messageId' | 'publishedAt'>> = {}
  ): Promise<{ messageId: string; delivered: number; failed: number }> {
    this.msgCounter += 1;
    const messageId = `tmsg_${this.msgCounter}_${Date.now()}`;
    const publishedAt = Date.now();

    const fullMeta: MessageMeta = {
      messageId,
      publishedAt,
      source: meta.source,
      correlationId: meta.correlationId,
      headers: meta.headers,
      attempt: meta.attempt ?? 1,
      maxAttempts: meta.maxAttempts ?? 3,
    };

    // 更新主题统计
    const stats = this.topicStats.get(topic);
    if (stats) {
      stats.messageCount++;
      stats.lastPublishedAt = publishedAt;
    } else {
      this.topicStats.set(topic, { messageCount: 1, lastPublishedAt: publishedAt, createdAt: publishedAt });
    }

    this.totalPublished++;

    // 收集所有匹配的订阅
    const matches = this.findMatchingSubscriptions(topic);

    // 按优先级排序
    matches.sort((a, b) => (b.options.priority ?? 5) - (a.options.priority ?? 5));

    let delivered = 0;
    let failed = 0;

    const promises: Promise<void>[] = [];
    for (const sub of matches) {
      sub.lastActivityAt = publishedAt;
      sub.messageCount++;

      promises.push(
        Promise.resolve(sub.handler(topic, payload, fullMeta))
          .then(() => {
            delivered++;
            this.totalDelivered++;
          })
          .catch((err) => {
            failed++;
            this.totalFailed++;
            logger.error({ err, messageId, subId: sub.id, topic }, '[TopicRegistry] Handler error');
          })
      );
    }

    await Promise.all(promises);

    logger.debug({ messageId, topic, delivered, failed }, '[TopicRegistry] Published');
    return { messageId, delivered, failed };
  }

  // ── 匹配逻辑 ───────────────────────────────

  /** 查找匹配给定主题的所有订阅 */
  findMatchingSubscriptions(topic: TopicName): TopicSubscription[] {
    const matches: TopicSubscription[] = [];
    const seen = new Set<string>();

    // 1. 精确匹配
    const exact = this.exactSubs.get(topic);
    if (exact) {
      for (const sub of exact.values()) {
        if (!seen.has(sub.id)) {
          matches.push(sub);
          seen.add(sub.id);
        }
      }
    }

    // 2. 模式匹配
    for (const [pattern, subs] of this.patternSubs) {
      if (this.topicMatchesPattern(topic, pattern)) {
        for (const sub of subs.values()) {
          if (!seen.has(sub.id)) {
            matches.push(sub);
            seen.add(sub.id);
          }
        }
      }
    }

    return matches;
  }

  /** 判断主题名是否匹配模式（MQTT风格） */
  topicMatchesPattern(topic: TopicName, pattern: TopicPattern): boolean {
    const topicParts = topic.split('/');
    const patternParts = pattern.split('/');

    let ti = 0;
    let pi = 0;

    while (ti < topicParts.length && pi < patternParts.length) {
      const pPart = patternParts[pi];

      if (pPart === '#') {
        // # 必须作为最后一个组件才有效
        if (pi === patternParts.length - 1) {
          return true;
        }
        // # 出现在 pattern 中间: 视为字面量，不匹配
        return false;
      }

      if (pPart === '+') {
        // + 匹配单个层级
        ti++;
        pi++;
        continue;
      }

      if (pPart !== topicParts[ti]) {
        return false;
      }

      ti++;
      pi++;
    }

    // 所有 pattern 组件已消费完
    if (pi === patternParts.length) {
      return ti === topicParts.length;
    }

    // topic 已消费完但 pattern 还有剩余
    // 只有剩余部分是末尾的 # 时才匹配
    if (ti === topicParts.length) {
      if (pi < patternParts.length && patternParts[pi] === '#' && pi === patternParts.length - 1) {
        return true;
      }
      return false;
    }

    return true;
  }

  /** 判断模式字符串是否包含通配符 */
  isPattern(pattern: string): boolean {
    return pattern.includes('+') || pattern.includes('#');
  }

  // ── 查询 ───────────────────────────────────

  getSubscription(subId: string): TopicSubscription | undefined {
    for (const subs of this.exactSubs.values()) {
      const sub = subs.get(subId);
      if (sub) return sub;
    }
    for (const subs of this.patternSubs.values()) {
      const sub = subs.get(subId);
      if (sub) return sub;
    }
    return undefined;
  }

  getSubscriptionsForTopic(topic: TopicName): TopicSubscription[] {
    return this.findMatchingSubscriptions(topic);
  }

  getAllSubscriptions(): TopicSubscription[] {
    const result: TopicSubscription[] = [];
    for (const subs of this.exactSubs.values()) {
      result.push(...subs.values());
    }
    for (const subs of this.patternSubs.values()) {
      result.push(...subs.values());
    }
    return result;
  }

  getTopics(): TopicInfo[] {
    const result: TopicInfo[] = [];

    // 精确主题
    for (const [name, subs] of this.exactSubs) {
      const stats = this.topicStats.get(name);
      result.push({
        name,
        subscriberCount: subs.size,
        messageCount: stats?.messageCount ?? 0,
        lastPublishedAt: stats?.lastPublishedAt ?? 0,
        createdAt: stats?.createdAt ?? 0,
        isPattern: false,
      });
    }

    // 模式主题
    for (const [pattern, subs] of this.patternSubs) {
      result.push({
        name: pattern,
        subscriberCount: subs.size,
        messageCount: 0,
        lastPublishedAt: 0,
        createdAt: 0,
        isPattern: true,
      });
    }

    return result;
  }

  getTopicStats(topic: TopicName): { subscriberCount: number; messageCount: number; lastPublishedAt: number } | undefined {
    const subs = this.exactSubs.get(topic);
    const stats = this.topicStats.get(topic);
    if (!subs && !stats) return undefined;
    return {
      subscriberCount: subs?.size ?? 0,
      messageCount: stats?.messageCount ?? 0,
      lastPublishedAt: stats?.lastPublishedAt ?? 0,
    };
  }

  // ── 清理 ───────────────────────────────────

  /** 清理过期订阅 */
  cleanupExpired(): number {
    const now = Date.now();
    let removed = 0;

    for (const [topic, subs] of this.exactSubs) {
      for (const [subId, sub] of subs) {
        const ttl = sub.options.ttlMs ?? 0;
        if (ttl > 0 && now - sub.createdAt > ttl) {
          subs.delete(subId);
          removed++;
        }
      }
      if (subs.size === 0) {
        this.exactSubs.delete(topic);
        this.topicStats.delete(topic);
      }
    }

    for (const [pattern, subs] of this.patternSubs) {
      for (const [subId, sub] of subs) {
        const ttl = sub.options.ttlMs ?? 0;
        if (ttl > 0 && now - sub.createdAt > ttl) {
          subs.delete(subId);
          removed++;
        }
      }
      if (subs.size === 0) {
        this.patternSubs.delete(pattern);
      }
    }

    if (removed > 0) {
      logger.info({ removed }, '[TopicRegistry] Expired subscriptions cleaned up');
    }
    return removed;
  }

  // ── 统计 ───────────────────────────────────

  getStats(): TopicStats {
    let exactCount = 0;
    let patternCount = 0;
    for (const subs of this.exactSubs.values()) exactCount += subs.size;
    for (const subs of this.patternSubs.values()) patternCount += subs.size;

    return {
      totalTopics: this.exactSubs.size + this.patternSubs.size,
      totalSubscriptions: exactCount + patternCount,
      patternSubscriptions: patternCount,
      exactSubscriptions: exactCount,
      messagesPublished: this.totalPublished,
      messagesDelivered: this.totalDelivered,
      messagesFailed: this.totalFailed,
    };
  }

  reset(): void {
    this.exactSubs.clear();
    this.patternSubs.clear();
    this.topicStats.clear();
    this.subCounter = 0;
    this.msgCounter = 0;
    this.totalPublished = 0;
    this.totalDelivered = 0;
    this.totalFailed = 0;
    logger.info('[TopicRegistry] Reset');
  }
}

// ── 单例 ───────────────────────────────────

let registryInstance: TopicRegistry | null = null;

export function getTopicRegistry(): TopicRegistry {
  if (!registryInstance) {
    registryInstance = new TopicRegistry();
  }
  return registryInstance;
}

export function resetTopicRegistry(): void {
  registryInstance = null;
}
