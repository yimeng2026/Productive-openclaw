import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';

const router: Router = Router();

/* ── 内存存储 ─────────────────────────────────────────────── */

interface Integration {
  id: string;
  name: string;
  type: 'webhook' | 'api' | 'database' | 'messaging' | 'storage' | 'custom';
  config: Record<string, any>;
  status: 'active' | 'inactive' | 'error';
  lastTestedAt?: string;
  createdAt: string;
  updatedAt: string;
}

const integrationsMap = new Map<string, Integration>();

// 预置种子数据
const seedIntegrations: Integration[] = [
  { id: 'int-1', name: 'Slack通知', type: 'messaging', config: { webhookUrl: 'https://hooks.slack.com/xxx' }, status: 'active', lastTestedAt: '2026-05-20T10:00:00Z', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-05-20T10:00:00Z' },
  { id: 'int-2', name: 'GitHub API', type: 'api', config: { token: 'ghp_xxx' }, status: 'active', lastTestedAt: '2026-05-21T08:00:00Z', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-05-21T08:00:00Z' },
  { id: 'int-3', name: 'PostgreSQL', type: 'database', config: { host: 'localhost', port: 5432 }, status: 'inactive', createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
];

seedIntegrations.forEach((i) => integrationsMap.set(i.id, i));

/* ── 路由（6端点）───────────────────────────────────────────── */

// GET /integrations — 列出所有集成
router.get('/', asyncWrapper(async (_req, res) => {
  const all = Array.from(integrationsMap.values());
  res.json({ success: true, data: all, count: all.length });
}));

// POST /integrations — 创建集成
router.post('/', asyncWrapper(async (req, res) => {
  const { name, type, config } = req.body;

  if (!name || !type) {
    return res.status(400).json({ success: false, error: 'name and type required' });
  }

  const validTypes: Integration['type'][] = ['webhook', 'api', 'database', 'messaging', 'storage', 'custom'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ success: false, error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
  }

  const id = `int-${Date.now()}`;
  const now = new Date().toISOString();
  const integration: Integration = {
    id,
    name,
    type,
    config: config || {},
    status: 'inactive',
    createdAt: now,
    updatedAt: now,
  };

  integrationsMap.set(id, integration);
  res.status(201).json({ success: true, data: integration });
}));

// PUT /integrations/:id — 更新集成
router.put('/:id', asyncWrapper(async (req, res) => {
  const integration = integrationsMap.get(req.params.id);
  if (!integration) {
    return res.status(404).json({ success: false, error: 'Integration not found' });
  }

  const { name, type, config, status } = req.body;
  if (name) integration.name = name;
  if (type) integration.type = type;
  if (config && typeof config === 'object') integration.config = { ...integration.config, ...config };
  if (status && ['active', 'inactive', 'error'].includes(status)) integration.status = status;
  integration.updatedAt = new Date().toISOString();

  res.json({ success: true, data: integration });
}));

// DELETE /integrations/:id — 删除集成
router.delete('/:id', asyncWrapper(async (req, res) => {
  const integration = integrationsMap.get(req.params.id);
  if (!integration) {
    return res.status(404).json({ success: false, error: 'Integration not found' });
  }

  integrationsMap.delete(req.params.id);
  res.json({ success: true, data: { id: req.params.id, deleted: true } });
}));

// POST /integrations/:id/test — 测试连通性
router.post('/:id/test', asyncWrapper(async (req, res) => {
  const integration = integrationsMap.get(req.params.id);
  if (!integration) {
    return res.status(404).json({ success: false, error: 'Integration not found' });
  }

  // 根据类型模拟连通性测试
  const testResults: Record<string, { success: boolean; latencyMs: number; message: string }> = {
    webhook: { success: true, latencyMs: 120, message: 'Webhook ping successful' },
    api: { success: true, latencyMs: 245, message: 'API key validated' },
    database: { success: false, latencyMs: 3000, message: 'Connection timeout' },
    messaging: { success: true, latencyMs: 89, message: 'Message sent and acknowledged' },
    storage: { success: true, latencyMs: 156, message: 'Bucket accessible' },
    custom: { success: true, latencyMs: 200, message: 'Custom endpoint responded' },
  };

  const result = testResults[integration.type] || testResults.custom;
  integration.status = result.success ? 'active' : 'error';
  integration.lastTestedAt = new Date().toISOString();
  integration.updatedAt = integration.lastTestedAt;

  res.json({
    success: true,
    data: {
      id: req.params.id,
      tested: true,
      result,
      status: integration.status,
      testedAt: integration.lastTestedAt,
    },
  });
}));

// GET /integrations/types — 支持的集成类型
router.get('/types', asyncWrapper(async (_req, res) => {
  const types = [
    { id: 'webhook', name: 'Webhook', description: 'HTTP回调接口', icon: 'link', fields: [{ name: 'webhookUrl', type: 'string', required: true }] },
    { id: 'api', name: 'API', description: 'RESTful API连接', icon: 'plug', fields: [{ name: 'token', type: 'string', required: true }, { name: 'baseUrl', type: 'string', required: false }] },
    { id: 'database', name: 'Database', description: '数据库连接', icon: 'database', fields: [{ name: 'host', type: 'string', required: true }, { name: 'port', type: 'number', required: true }, { name: 'username', type: 'string', required: true }, { name: 'password', type: 'string', required: true }] },
    { id: 'messaging', name: 'Messaging', description: '消息通知服务', icon: 'message-circle', fields: [{ name: 'channelId', type: 'string', required: true }] },
    { id: 'storage', name: 'Storage', description: '文件存储服务', icon: 'hard-drive', fields: [{ name: 'bucket', type: 'string', required: true }] },
    { id: 'custom', name: 'Custom', description: '自定义集成', icon: 'settings', fields: [] },
  ];

  res.json({ success: true, data: types, count: types.length });
}));

export default router;
