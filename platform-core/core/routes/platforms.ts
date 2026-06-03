import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
import {
  getPlatformsReal,
  getPlatformDetail,
  testPlatformConnection,
  refreshOllamaModels,
  getModelsReal,
} from '../services/platformService';
import { rescanOllama } from '../services/autoConfigService';

const router: Router = Router();

/* ── 路由 ───────────────────────────────────────────────────── */

// GET /platforms — 所有平台列表（含真实数据、实时健康检查）
router.get('/', asyncWrapper(async (_req, res) => {
  const platforms = await getPlatformsReal();
  const grouped = {
    cloud: platforms.filter((p) => p.tier === 'cloud'),
    local: platforms.filter((p) => p.tier === 'local'),
    custom: platforms.filter((p) => p.tier === 'custom'),
  };
  res.json({ success: true, data: platforms, grouped });
}));

// GET /platforms/tiers — 仅返回分级结构
router.get('/tiers', asyncWrapper(async (_req, res) => {
  const platforms = await getPlatformsReal();
  const grouped = {
    cloud: platforms.filter((p) => p.tier === 'cloud'),
    local: platforms.filter((p) => p.tier === 'local'),
    custom: platforms.filter((p) => p.tier === 'custom'),
  };
  res.json({ success: true, data: grouped });
}));

// GET /platforms/:id — 指定平台（含实时健康检查）
router.get('/:id', asyncWrapper(async (req, res) => {
  const platform = await getPlatformDetail(req.params.id);
  if (!platform) {
    res.status(404).json({ success: false, error: { error: 'Platform not found', code: 'NOT_FOUND' } });
    return;
  }
  res.json({ success: true, data: platform });
}));

// GET /platforms/:id/models — 指定平台的所有模型（实时）
router.get('/:id/models', asyncWrapper(async (req, res) => {
  const platform = await getPlatformDetail(req.params.id);
  if (!platform) {
    res.status(404).json({ success: false, error: { error: 'Platform not found', code: 'NOT_FOUND' } });
    return;
  }
  res.json({ success: true, data: platform.models });
}));

// POST /platforms — 添加新平台
router.post('/', asyncWrapper(async (req, res) => {
  const { name, provider, tier, baseUri, apiKeyRequired, description, icon, tint } = req.body;

  const id = `p_${Date.now()}`;
  const newPlatform = {
    id,
    name: name || '未命名平台',
    provider: provider || 'Custom',
    tier: tier || 'custom',
    baseUri: baseUri || '',
    status: 'configuring' as const,
    modelCount: 0,
    latency: 0,
    lastUsed: '从未',
    icon: icon || 'server',
    tint: tint || '#c97b84',
    description: description || '自定义平台',
    apiKeyRequired: apiKeyRequired ?? true,
    docsUrl: '',
    models: [],
  };

  // 注意：新平台仅存在于内存，重启后需重新配置
  // 后续可保存到数据库或配置文件
  res.json({ success: true, data: newPlatform, note: 'Custom platforms are ephemeral until persisted to config' });
}));

// POST /platforms/:id/test — 测试平台连接（实际HTTP探测）
router.post('/:id/test', asyncWrapper(async (req, res) => {
  const result = await testPlatformConnection(req.params.id);
  if (result.success) {
    res.json({ success: true, data: { latency: result.latency, status: result.status } });
  } else {
    res.status(500).json({ success: false, error: { error: result.error || 'Connection failed', code: 'CONNECTION_ERROR' } });
  }
}));

// POST /platforms/ollama/refresh — 刷新Ollama模型列表
router.post('/ollama/refresh', asyncWrapper(async (_req, res) => {
  const result = await refreshOllamaModels();
  if (result.success) {
    res.json({ success: true, data: { modelCount: result.count }, message: `Ollama 模型列表已刷新，共 ${result.count} 个模型` });
  } else {
    res.status(500).json({ success: false, error: { error: result.error || 'Refresh failed', code: 'REFRESH_ERROR' } });
  }
}));

// POST /platforms/rescan — 重新扫描所有平台
router.post('/rescan', asyncWrapper(async (_req, res) => {
  const [ollamaResult, platforms] = await Promise.all([
    rescanOllama(),
    getPlatformsReal(),
  ]);

  res.json({
    success: true,
    data: {
      ollama: ollamaResult,
      platforms: platforms.map((p) => ({ id: p.id, name: p.name, status: p.status, modelCount: p.modelCount })),
    },
    message: '平台扫描完成',
  });
}));

export default router;
