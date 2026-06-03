import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
import { getCoordinator, UnifiedCoordinator } from '../coordinator/unified';
import { getMegaProviderBridge } from '../coordinator/bridges/MegaProviderBridge';
import { getSkillBridge } from '../coordinator/bridges/SkillBridge';
import { getWebSocketManager } from '../websocket';
import { logger } from '../utils/logger';

const router: Router = Router();

// 懒加载协调器（避免循环依赖）
function coordinator(): UnifiedCoordinator {
  return getCoordinator();
}

/* ═══════════════════════════════════════════════════════════════
   消息总线 API (v2.1 新增)
   ═══════════════════════════════════════════════════════════════ */

/* ── 主题管理 ───────────────────────────────── */

// GET /api/coordinator/bus/topics — 列出所有主题
router.get('/bus/topics', asyncWrapper(async (_req, res) => {
  const bus = coordinator().bus;
  const topics = bus.getTopics();
  const stats = bus.getTopicStats;

  res.json({
    success: true,
    data: {
      topics: topics.map((t) => ({
        name: t.name,
        subscriberCount: t.subscriberCount,
        messageCount: t.messageCount,
        isPattern: t.isPattern,
        lastPublishedAt: t.lastPublishedAt ? new Date(t.lastPublishedAt).toISOString() : null,
        createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : null,
      })),
      total: topics.length,
    },
  });
}));

// GET /api/coordinator/bus/topics/:topic — 获取特定主题统计
router.get('/bus/topics/:topic', asyncWrapper(async (req, res) => {
  const { topic } = req.params;
  const stats = coordinator().bus.getTopicStats(topic);

  if (!stats) {
    return res.status(404).json({ success: false, error: `Topic not found: ${topic}` });
  }

  const subs = coordinator().topics.getSubscriptionsForTopic(topic);

  res.json({
    success: true,
    data: {
      topic,
      subscriberCount: stats.subscriberCount,
      messageCount: stats.messageCount,
      lastPublishedAt: stats.lastPublishedAt ? new Date(stats.lastPublishedAt).toISOString() : null,
      subscriptions: subs.map((s) => ({
        id: s.id,
        pattern: s.pattern,
        priority: s.options.priority,
        durable: s.options.durable,
        messageCount: s.messageCount,
        createdAt: new Date(s.createdAt).toISOString(),
      })),
    },
  });
}));

/* ── 消息发布 ───────────────────────────────── */

// POST /api/coordinator/bus/publish — 发布消息到主题
router.post('/bus/publish', asyncWrapper(async (req, res) => {
  const { topic, payload, options = {} } = req.body;

  if (!topic || typeof payload !== 'object') {
    return res.status(400).json({ success: false, error: 'Missing topic or payload' });
  }

  const result = await coordinator().publish(topic, payload, {
    source: options.source || req.headers['x-agent-id'] as string || 'api',
    correlationId: options.correlationId,
    headers: options.headers,
    strategy: options.strategy,
    requireAck: options.requireAck ?? false,
  });

  res.json({
    success: true,
    data: {
      messageId: result.messageId,
      delivered: result.delivered,
      failed: result.failed,
      routeResult: result.routeResult ? {
        strategy: result.routeResult.strategy,
        targets: result.routeResult.targets.map((t) => ({ type: t.type, id: t.id })),
        latencyMs: result.routeResult.latencyMs,
      } : undefined,
      timestamp: new Date().toISOString(),
    },
  });
}));

/* ── 消息历史 ───────────────────────────────── */

// GET /api/coordinator/bus/messages — 查询消息历史
router.get('/bus/messages', asyncWrapper(async (req, res) => {
  const { source, target, type, since, limit = '100' } = req.query;

  const filter: any = {};
  if (source) filter.source = source as string;
  if (target) filter.target = target as string;
  if (type) filter.type = type as any;
  if (since) filter.since = parseInt(since as string, 10);
  filter.limit = parseInt(limit as string, 10);

  const history = coordinator().bus.getHistory(filter);

  res.json({
    success: true,
    data: {
      messages: history.map((m) => ({
        id: m.id,
        type: m.type,
        source: m.source,
        target: m.target,
        payload: m.payload,
        timestamp: m.timestamp,
        correlationId: m.correlationId,
      })),
      total: history.length,
    },
  });
}));

/* ── 消息订阅（HTTP 轮询）─────────────────────── */

// POST /api/coordinator/bus/subscribe — 创建订阅并获取消息
router.post('/bus/subscribe', asyncWrapper(async (req, res) => {
  const { pattern, timeoutMs = 30000, since, maxMessages = 100 } = req.body;

  if (!pattern) {
    return res.status(400).json({ success: false, error: 'Missing pattern' });
  }

  const bus = coordinator().bus;
  const messages: any[] = [];

  // 收集历史消息
  const history = bus.getHistory({ limit: maxMessages });
  for (const msg of history) {
    const topicName = msg.target || msg.type;
    if (bus['topicRegistry'].topicMatchesPattern(topicName, pattern)) {
      messages.push({
        id: msg.id,
        topic: topicName,
        payload: msg.payload,
        source: msg.source,
        timestamp: msg.timestamp,
        correlationId: msg.correlationId,
      });
    }
  }

  // 创建持久订阅（用于后续 WebSocket 推送）
  const subId = bus.subscribeTopic(
    pattern,
    (_topic, payload, meta) => {
      logger.debug({ pattern, messageId: meta.messageId }, '[Bus] Subscription handler invoked');
    },
    { durable: false, ttlMs: timeoutMs, queueCapacity: maxMessages }
  );

  res.json({
    success: true,
    data: {
      subscriptionId: subId,
      pattern,
      messages: messages.slice(-maxMessages),
      timeoutMs,
      timestamp: new Date().toISOString(),
    },
  });
}));

// DELETE /api/coordinator/bus/subscribe/:subId — 取消订阅
router.delete('/bus/subscribe/:subId', asyncWrapper(async (req, res) => {
  const { subId } = req.params;
  const removed = coordinator().bus.unsubscribeTopic(subId);

  res.json({
    success: true,
    data: { subId, removed },
  });
}));

/* ── 路由器状态 ─────────────────────────────── */

// GET /api/coordinator/bus/router — 路由器统计
router.get('/bus/router', asyncWrapper(async (_req, res) => {
  const router = coordinator().messageRouter;

  res.json({
    success: true,
    data: {
      stats: router.getStats(),
      circuitBreakers: router.getAllCircuitBreakers().map((cb) => ({
        targetId: cb.targetId,
        open: cb.open,
        consecutiveFailures: cb.consecutiveFailures,
        lastFailureAt: cb.lastFailureAt ? new Date(cb.lastFailureAt).toISOString() : null,
        lastSuccessAt: cb.lastSuccessAt ? new Date(cb.lastSuccessAt).toISOString() : null,
      })),
    },
  });
}));

// GET /api/coordinator/bus/dead-letters — 死信队列
router.get('/bus/dead-letters', asyncWrapper(async (req, res) => {
  const { limit = '50' } = req.query;
  const router = coordinator().messageRouter;
  const deadLetters = router.getDeadLetterQueue(parseInt(limit as string, 10));

  res.json({
    success: true,
    data: {
      deadLetters: deadLetters.map((dl) => ({
        messageId: dl.messageId,
        topic: dl.topic,
        reason: dl.reason,
        enqueuedAt: new Date(dl.enqueuedAt).toISOString(),
        failedTargets: dl.failedTargets.map((ft) => ({
          targetId: ft.targetId,
          error: ft.error,
          timestamp: new Date(ft.timestamp).toISOString(),
        })),
      })),
      total: deadLetters.length,
    },
  });
}));

// POST /api/coordinator/bus/dead-letters/retry — 重试死信
router.post('/bus/dead-letters/retry', asyncWrapper(async (req, res) => {
  const { messageId } = req.body;
  const router = coordinator().messageRouter;
  const result = router.reprocessDeadLetter(messageId);

  res.json({
    success: true,
    data: {
      reprocessed: result.reprocessed,
      succeeded: result.succeeded,
      failed: result.failed,
    },
  });
}));

// DELETE /api/coordinator/bus/dead-letters — 清空死信队列
router.delete('/bus/dead-letters', asyncWrapper(async (_req, res) => {
  coordinator().messageRouter.clearDeadLetterQueue();
  res.json({ success: true, data: { cleared: true } });
}));

/* ── 总线状态 ───────────────────────────────── */

// GET /api/coordinator/bus/stats — 总线统计
router.get('/bus/stats', asyncWrapper(async (_req, res) => {
  const bus = coordinator().bus;
  const stats = bus.getStats();

  res.json({
    success: true,
    data: {
      backend: stats.backend,
      uptimeMs: stats.uptimeMs,
      connections: {
        total: stats.totalConnections,
        active: stats.activeConnections,
      },
      messages: {
        published: stats.totalMessagesPublished,
        delivered: stats.totalMessagesDelivered,
        failed: stats.totalMessagesFailed,
      },
      topics: stats.topicStats,
      router: stats.routerStats,
      history: {
        size: stats.historySize,
        max: stats.maxHistory,
      },
    },
  });
}));

// GET /api/coordinator/bus/connections — 连接池
router.get('/bus/connections', asyncWrapper(async (_req, res) => {
  const bus = coordinator().bus;
  const connections = bus.getConnections();

  res.json({
    success: true,
    data: {
      connections: connections.map((c) => ({
        id: c.id,
        type: c.type,
        status: c.status,
        messageCount: c.messageCount,
        connectedAt: new Date(c.connectedAt).toISOString(),
        lastActivityAt: new Date(c.lastActivityAt).toISOString(),
        metadata: c.metadata,
      })),
      total: connections.length,
    },
  });
}));

// POST /api/coordinator/bus/connections — 注册连接
router.post('/bus/connections', asyncWrapper(async (req, res) => {
  const { type, metadata } = req.body;
  const bus = coordinator().bus;
  const connId = bus.registerConnection(type, metadata);

  res.status(201).json({
    success: true,
    data: { connectionId: connId, type, status: 'connected' },
  });
}));

// DELETE /api/coordinator/bus/connections/:connId — 注销连接
router.delete('/bus/connections/:connId', asyncWrapper(async (req, res) => {
  const { connId } = req.params;
  const bus = coordinator().bus;
  const removed = bus.unregisterConnection(connId);

  res.json({
    success: true,
    data: { connectionId: connId, removed },
  });
}));

/* ═══════════════════════════════════════════════════════════════
   Provider / Skill 桥接 API (v2.1 新增)
   ═══════════════════════════════════════════════════════════════ */

// GET /api/coordinator/bridge/providers — Provider 桥接状态
router.get('/bridge/providers', asyncWrapper(async (_req, res) => {
  const bridge = getMegaProviderBridge();
  const providers = bridge.listProviders();
  const health = await bridge.checkAllHealth();

  res.json({
    success: true,
    data: {
      providers: providers.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        status: p.status,
        models: p.models.length,
        features: p.features,
      })),
      health: health.map((h) => ({
        providerId: h.providerId,
        healthy: h.healthy,
        latencyMs: h.latencyMs,
        modelsAvailable: h.modelsAvailable,
        error: h.error,
      })),
      total: providers.length,
    },
  });
}));

// GET /api/coordinator/bridge/skills — Skill 桥接状态
router.get('/bridge/skills', asyncWrapper(async (_req, res) => {
  const bridge = getSkillBridge();
  const skills = bridge.listSkills();
  const health = await bridge.checkAllHealth();

  res.json({
    success: true,
    data: {
      skills: skills.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        runtime: s.runtime,
        capabilities: s.capabilities,
      })),
      health: health.map((h) => ({
        skillId: h.skillId,
        healthy: h.healthy,
        error: h.error,
      })),
      total: skills.length,
    },
  });
}));

// POST /api/coordinator/bridge/skills/:skillId/call — 调用技能
router.post('/bridge/skills/:skillId/call', asyncWrapper(async (req, res) => {
  const { skillId } = req.params;
  const { params, context } = req.body;
  const bridge = getSkillBridge();

  const result = await bridge.callSkill({ skillId, params: params || {}, context });

  res.json({
    success: result.success,
    data: {
      skillId,
      result: result.data,
      executionTimeMs: result.executionTimeMs,
      logs: result.logs,
    },
    error: result.error,
  });
}));

/* ═══════════════════════════════════════════════════════════════
   原有协调器 API (保持向后兼容)
   ═══════════════════════════════════════════════════════════════ */

/* ── 完整层级树 ── */
router.get('/hierarchy', asyncWrapper(async (_req, res) => {
  res.json({
    success: true,
    data: {
      meta: {
        id: 'meta-1',
        name: 'Meta-Conductor',
        level: 3,
        role: '顶级协调员',
        accuracy: 0.98,
        load: 12,
        electedAt: '2026-05-22T10:00:00Z',
      },
      domains: [
        {
          id: 'domain-dev',
          name: 'Domain-开发',
          level: 2,
          role: '二级协调员',
          accuracy: 0.95,
          load: 45,
          electedAt: '2026-05-22T09:30:00Z',
          children: [
            { id: 'swarm-frontend', name: 'Swarm-前端', level: 1, role: '子群组协调员', accuracy: 0.92, load: 78, agents: 4 },
            { id: 'swarm-backend', name: 'Swarm-后端', level: 1, role: '子群组协调员', accuracy: 0.89, load: 65, agents: 5 },
          ],
        },
        {
          id: 'domain-data',
          name: 'Domain-数据',
          level: 2,
          role: '二级协调员',
          accuracy: 0.94,
          load: 38,
          electedAt: '2026-05-22T09:45:00Z',
          children: [
            { id: 'swarm-etl', name: 'Swarm-ETL', level: 1, role: '子群组协调员', accuracy: 0.91, load: 82, agents: 3 },
            { id: 'swarm-ml', name: 'Swarm-ML', level: 1, role: '子群组协调员', accuracy: 0.93, load: 71, agents: 6 },
          ],
        },
        {
          id: 'domain-ops',
          name: 'Domain-运维',
          level: 2,
          role: '二级协调员',
          accuracy: 0.96,
          load: 28,
          electedAt: '2026-05-22T10:15:00Z',
          children: [
            { id: 'swarm-monitor', name: 'Swarm-监控', level: 1, role: '子群组协调员', accuracy: 0.88, load: 55, agents: 3 },
          ],
        },
      ],
    },
  });
}));

/* ── 指定协调员状态 ── */
router.get('/status/:id', asyncWrapper(async (req, res) => {
  const { id } = req.params;
  res.json({
    success: true,
    data: {
      id,
      name: `Coordinator-${id}`,
      level: Math.floor(Math.random() * 3) + 1,
      role: '协调员',
      accuracy: 0.85 + Math.random() * 0.13,
      load: Math.floor(Math.random() * 80) + 10,
      electedAt: new Date(Date.now() - Math.random() * 86400000).toISOString(),
      children: [],
    },
  });
}));

/* ── 触发重新选举 ── */
router.post('/election', asyncWrapper(async (_req, res) => {
  const candidates = [
    { id: 'cand-1', name: 'Candidate-A', accuracy: 0.95, recency: 0.88, load: 45, diversity: 0.72, score: 0.912 },
    { id: 'cand-2', name: 'Candidate-B', accuracy: 0.93, recency: 0.95, load: 62, diversity: 0.85, score: 0.887 },
    { id: 'cand-3', name: 'Candidate-C', accuracy: 0.97, recency: 0.72, load: 38, diversity: 0.60, score: 0.905 },
  ];
  const winner = candidates.reduce((a, b) => a.score > b.score ? a : b);
  res.json({
    success: true,
    data: {
      electionId: `elec-${Date.now()}`,
      timestamp: new Date().toISOString(),
      candidates,
      winner,
      formula: 'Score = 0.40×Accuracy + 0.25×Recency + 0.20×(1-Load/100) + 0.15×Diversity',
    },
  });
}));

/* ── 跨域任务路由决策 ── */
router.post('/route', asyncWrapper(async (req, res) => {
  const { taskType, priority, embedding } = req.body;
  const domains = [
    { id: 'domain-dev', matchScore: 0.92, load: 45, lastSuccess: '2026-05-22T15:00:00Z' },
    { id: 'domain-data', matchScore: 0.78, load: 38, lastSuccess: '2026-05-22T14:30:00Z' },
    { id: 'domain-ops', matchScore: 0.65, load: 28, lastSuccess: '2026-05-22T16:00:00Z' },
  ];

  const bestMatch = domains.reduce((a, b) => a.matchScore > b.matchScore ? a : b);

  res.json({
    success: true,
    data: {
      strategy: 'capability_match',
      selectedDomain: bestMatch.id,
      confidence: bestMatch.matchScore,
      alternatives: domains.filter(d => d.id !== bestMatch.id),
      routingFactors: {
        capabilityMatch: bestMatch.matchScore,
        loadBalance: 1 - bestMatch.load / 100,
        recency: 0.85,
      },
    },
  });
}));

/* ── 策略配置 ── */
router.get('/strategies', asyncWrapper(async (_req, res) => {
  res.json({
    success: true,
    data: {
      strategies: [
        { name: 'auto_aggregate', label: '自动聚合', active: true, threshold: 0.7 },
        { name: 'weighted_vote', label: '加权投票', active: false, threshold: 0.6 },
        { name: 'lead_arbitrate', label: 'Lead裁决', active: false, threshold: 0.8 },
        { name: 'jury_trial', label: '陪审团仲裁', active: false, jurySize: 5 },
      ],
      electionInterval: 1800,
      accuracyThreshold: 0.85,
      loadThreshold: 85,
    },
  });
}));

/* ── 更新策略配置 ── */
router.put('/strategies', asyncWrapper(async (req, res) => {
  const { strategies, electionInterval, accuracyThreshold, loadThreshold } = req.body;
  res.json({
    success: true,
    data: {
      strategies: strategies || [],
      electionInterval,
      accuracyThreshold,
      loadThreshold,
      updatedAt: new Date().toISOString(),
    },
  });
}));

/* ── WebSocket 推送（服务端主动推送消息）── */
router.post('/ws/push', asyncWrapper(async (req, res) => {
  const { room, event } = req.body;

  try {
    const ws = getWebSocketManager();
    ws.broadcastToRoom(room || 'system', event);

    res.json({
      success: true,
      data: { room, eventType: event?.type, timestamp: new Date().toISOString() },
    });
  } catch (err: any) {
    logger.warn({ err: err.message }, '[Coordinator] WebSocket push failed');
    res.status(503).json({ success: false, error: 'WebSocket not available' });
  }
}));

/* ── 保留旧接口兼容 ── */
router.get('/swarm', asyncWrapper(async (_req, res) => {
  res.json({ success: true, data: { swarms: [] } });
}));

router.get('/swarm/:id', asyncWrapper(async (req, res) => {
  res.json({ success: true, data: { id: req.params.id, agents: [] } });
}));

export default router;
