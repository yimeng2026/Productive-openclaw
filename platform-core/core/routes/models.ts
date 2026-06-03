import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
import { getModelsReal } from '../services/platformService';
import { getMegaProviderBridge } from '../coordinator/bridges';
import { getModelRouter } from '../services/modelRouter';

const router: Router = Router();

/* ── 路由 ──────────────────────────────────────────────────── */

// GET /models — 所有模型（真实数据，按平台分组）
router.get('/', asyncWrapper(async (_req, res) => {
  const models = await getModelsReal();

  const grouped: Record<string, typeof models> = {};
  const providerSet = new Set(models.map((m) => m.platformId));
  for (const pid of providerSet) {
    grouped[pid] = models.filter((m) => m.platformId === pid);
  }

  res.json({ success: true, data: models, grouped, count: models.length });
}));

// GET /models/all — 跨平台汇总（所有可连接模型）
router.get('/all', asyncWrapper(async (_req, res) => {
  const models = await getModelsReal();
  res.json({ success: true, count: models.length, data: models });
}));

// GET /models/:id — 指定模型
router.get('/:id', asyncWrapper(async (req, res) => {
  const models = await getModelsReal();
  const model = models.find((m) => m.id === req.params.id);
  if (!model) {
    res.status(404).json({ success: false, error: 'Model not found' });
    return;
  }

  // 获取Provider信息补充
  const bridge = getMegaProviderBridge();
  const provider = bridge.getProvider(model.platformId);

  res.json({
    success: true,
    data: {
      ...model,
      providerFeatures: provider?.features,
      providerStatus: provider ? 'active' : 'unknown',
    },
  });
}));

// GET /models/platforms/:platformId — 按平台筛选
router.get('/platforms/:platformId', asyncWrapper(async (req, res) => {
  const models = await getModelsReal();
  const filtered = models.filter((m) => m.platformId === req.params.platformId);
  res.json({ success: true, data: filtered, count: filtered.length });
}));

/* ── 路由决策 API ──────────────────────────────────────────── */

// POST /models/route — 执行路由决策
router.post('/route', asyncWrapper(async (req, res) => {
  const router = getModelRouter();
  const decision = await router.route({
    capabilities: req.body.capabilities,
    sessionId: req.body.sessionId,
    minContextWindow: req.body.minContextWindow,
    requestType: req.body.requestType,
    streaming: req.body.streaming,
    forceProvider: req.body.forceProvider,
    forceModel: req.body.forceModel,
    strategy: req.body.strategy,
    prompt: req.body.prompt,
  });

  res.json({ success: true, data: decision });
}));

// POST /models/route/chat — 聊天路由快捷接口
router.post('/route/chat', asyncWrapper(async (req, res) => {
  const { messages, sessionId, streaming, strategy, capabilities } = req.body;

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ success: false, error: 'messages array required' });
    return;
  }

  const router = getModelRouter();
  const decision = await router.route({
    requestType: 'chat',
    sessionId,
    streaming,
    strategy,
    capabilities,
    prompt: messages[messages.length - 1]?.content ?? '',
  });

  res.json({
    success: true,
    data: {
      ...decision,
      requestId: `req_${Date.now()}`,
    },
  });
}));

// GET /models/routing/strategies — 可用路由策略
router.get('/routing/strategies', asyncWrapper(async (_req, res) => {
  const router = getModelRouter();
  res.json({ success: true, data: router.getStrategies() });
}));

// GET /models/routing/stats — 路由统计
router.get('/routing/stats', asyncWrapper(async (_req, res) => {
  const router = getModelRouter();
  res.json({ success: true, data: router.getStats() });
}));

// GET /models/routing/weights — 权重分布
router.get('/routing/weights', asyncWrapper(async (_req, res) => {
  const router = getModelRouter();
  const weights = await router.getWeightDistribution();
  res.json({ success: true, data: weights });
}));

// GET /models/routing/fallback-chains — 故障转移链
router.get('/routing/fallback-chains', asyncWrapper(async (_req, res) => {
  const router = getModelRouter();
  const chains = await router.getFallbackChains();
  res.json({ success: true, data: chains });
}));

// GET /models/routing/health — Provider健康状态
router.get('/routing/health', asyncWrapper(async (_req, res) => {
  const router = getModelRouter();
  const health = await router.getProviderHealth();
  res.json({ success: true, data: health });
}));

// POST /models/routing/health-check — 手动刷新健康检查
router.post('/routing/health-check', asyncWrapper(async (_req, res) => {
  const router = getModelRouter();
  const health = await router.getProviderHealth();
  res.json({
    success: true,
    data: {
      checked: health.length,
      healthy: health.filter((h) => h.healthy).length,
      providers: health,
      refreshedAt: new Date().toISOString(),
    },
  });
}));

// GET /models/routing/config — 路由配置
router.get('/routing/config', asyncWrapper(async (_req, res) => {
  const router = getModelRouter();
  res.json({
    success: true,
    data: {
      defaultStrategy: router.getDefaultStrategy(),
      strategies: router.getStrategies(),
      stickySessionEnabled: true,
      healthCheckInterval: 30000,
      latencyThreshold: 2000,
      errorRateThreshold: 5,
    },
  });
}));

// POST /models/routing/config — 更新路由配置
router.post('/routing/config', asyncWrapper(async (req, res) => {
  const { defaultStrategy } = req.body;
  const router = getModelRouter();

  if (defaultStrategy) {
    router.setDefaultStrategy(defaultStrategy);
  }

  res.json({
    success: true,
    data: {
      defaultStrategy: router.getDefaultStrategy(),
      message: 'Routing config updated',
    },
  });
}));

/* ── 实际调用层：路由决策 + API 执行 ────────────────────── */

// POST /models/chat — 非流式聊天
router.post('/chat', asyncWrapper(async (req, res) => {
  const { messages, model, temperature, maxTokens, strategy, capabilities } = req.body;

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ success: false, error: 'messages array required' });
    return;
  }

  const router = getModelRouter();
  const result = await router.execute({
    model,
    messages,
    temperature,
    maxTokens,
    routingRequest: {
      requestType: 'chat',
      strategy,
      capabilities,
    },
  });

  if (!result.success) {
    res.status(502).json({
      success: false,
      error: result.error || 'Model execution failed',
      data: { providerId: result.providerId, modelId: result.modelId, latencyMs: result.latencyMs },
    });
    return;
  }

  res.json({
    success: true,
    data: {
      content: result.content,
      providerId: result.providerId,
      modelId: result.modelId,
      usage: result.usage,
      latencyMs: result.latencyMs,
    },
  });
}));

// POST /models/chat/stream — 流式聊天 (SSE)
router.post('/chat/stream', asyncWrapper(async (req, res) => {
  const { messages, model, temperature, maxTokens, strategy, capabilities } = req.body;

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ success: false, error: 'messages array required' });
    return;
  }

  // 设置 SSE 头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const router = getModelRouter();
  const generator = await router.executeStream({
    model,
    messages,
    temperature,
    maxTokens,
    routingRequest: {
      requestType: 'chat',
      strategy,
      capabilities,
    },
  });

  try {
    for await (const chunk of generator) {
      res.write(`data: ${JSON.stringify({
        id: chunk.id,
        model: chunk.model,
        provider: chunk.provider,
        delta: chunk.delta,
        finishReason: chunk.finishReason,
      })}\n\n`);

      if (chunk.finishReason) {
        res.write(`data: [DONE]\n\n`);
        break;
      }
    }
  } catch (err: any) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
}));

export default router;
