import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
import { UnifiedAPIClient, AutoConfigEngine, ProviderConfig, ProviderType } from '../services/UnifiedAPIClient';
import { logger } from '../utils/logger';

const router: Router = Router();

// 存储API配置的内存缓存（生产环境应使用加密存储）
const apiConfigCache = new Map<string, ProviderConfig>();

/* ═══════════════════════════════════════════════════════════════
   自动检测与配置
   ═══════════════════════════════════════════════════════════════ */

// POST /api/unified-api/detect — 自动检测provider
router.post('/detect', asyncWrapper(async (req, res) => {
  const { apiKey, hint } = req.body;

  if (!apiKey) {
    return res.status(400).json({ success: false, error: 'apiKey required' });
  }

  try {
    const detected = await AutoConfigEngine.detectProvider(apiKey, hint as ProviderType);
    res.json({
      success: true,
      data: {
        detectedProvider: detected.type,
        baseUrl: detected.baseUrl,
        defaultModel: detected.defaultModel,
        availableModels: detected.availableModels,
        detectedBy: detected.detectedBy,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Provider detection failed');
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}));

// POST /api/unified-api/config — 配置统一API
router.post('/config', asyncWrapper(async (req, res) => {
  const { apiKey, type, baseUrl, defaultModel, organization } = req.body;

  if (!apiKey || !type) {
    return res.status(400).json({ success: false, error: 'apiKey and type required' });
  }

  const config: ProviderConfig = {
    type: type as ProviderType,
    apiKey,
    baseUrl,
    defaultModel,
    organization,
    timeoutMs: 30000,
  };

  // 验证配置
  const client = new UnifiedAPIClient(config);
  const validation = await client.validateKey();

  if (!validation.valid) {
    return res.status(400).json({ success: false, error: validation.error || 'Invalid API key' });
  }

  // 缓存配置
  const configId = `cfg-${Date.now()}`;
  apiConfigCache.set(configId, config);

  res.json({
    success: true,
    data: {
      configId,
      type: config.type,
      baseUrl: config.baseUrl,
      defaultModel: config.defaultModel,
      validated: true,
    },
  });
}));

// GET /api/unified-api/config — 获取当前配置
router.get('/config', asyncWrapper(async (req, res) => {
  const { configId } = req.query;

  if (!configId) {
    return res.status(400).json({ success: false, error: 'configId required' });
  }

  const config = apiConfigCache.get(configId as string);
  if (!config) {
    return res.status(404).json({ success: false, error: 'Config not found' });
  }

  res.json({
    success: true,
    data: {
      configId,
      type: config.type,
      baseUrl: config.baseUrl,
      defaultModel: config.defaultModel,
      // 不返回apiKey
    },
  });
}));

// DELETE /api/unified-api/config — 清除配置
router.delete('/config', asyncWrapper(async (req, res) => {
  const { configId } = req.body;

  if (!configId) {
    return res.status(400).json({ success: false, error: 'configId required' });
  }

  const removed = apiConfigCache.delete(configId);
  res.json({ success: removed, data: { configId, removed } });
}));

/* ═══════════════════════════════════════════════════════════════
   三层级平台选择
   ═══════════════════════════════════════════════════════════════ */

// GET /api/unified-api/platforms — 获取三级平台列表
router.get('/platforms', asyncWrapper(async (_req, res) => {
  res.json({
    success: true,
    data: {
      level1: [
        { id: 'openclaw', name: 'OpenClaw', description: '本地Agent集群协调引擎', features: ['exec', 'process', 'browser', 'file'] },
        { id: 'hermes', name: 'Hermes', description: 'MCP协议+记忆宫殿', features: ['mcp', 'memory-palace', 'skills'] },
        { id: 'custom', name: 'Custom', description: '自定义API端点', features: ['generic-openai'] },
      ],
      level2: [
        { id: 'kimi', name: 'Kimi', description: 'Moonshot AI', models: ['kimi-k2.6', 'kimi-moonshot-v1-8k', 'kimi-moonshot-v1-32k'] },
        { id: 'claude', name: 'Claude', description: 'Anthropic', models: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'] },
        { id: 'openai', name: 'OpenAI', description: 'OpenAI GPT', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
        { id: 'ollama', name: 'Ollama', description: '本地模型', models: ['llama3', 'llama3.1', 'mistral', 'qwen2'] },
      ],
      level3: [
        { id: 'k2.6', name: 'K2.6', provider: 'kimi', contextWindow: 128000 },
        { id: 'opus', name: 'Claude 3 Opus', provider: 'claude', contextWindow: 200000 },
        { id: 'sonnet', name: 'Claude 3 Sonnet', provider: 'claude', contextWindow: 200000 },
        { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextWindow: 128000 },
        { id: 'llama3', name: 'Llama 3', provider: 'ollama', contextWindow: 8192 },
      ],
    },
  });
}));

/* ═══════════════════════════════════════════════════════════════
   Agent创建三步流程
   ═══════════════════════════════════════════════════════════════ */

// POST /api/unified-api/agents/create/step2 — 输入key自动配置
router.post('/agents/create/step2', asyncWrapper(async (req, res) => {
  const { level1, level2, apiKey } = req.body;

  if (!level1 || !apiKey) {
    return res.status(400).json({ success: false, error: 'level1 and apiKey required' });
  }

  try {
    const config = await AutoConfigEngine.autoConfig(apiKey, level1, level2);
    const client = new UnifiedAPIClient(config);
    const validation = await client.validateKey();
    const models = validation.valid ? await client.listModels() : [];

    res.json({
      success: true,
      data: {
        autoDetected: {
          type: config.type,
          baseUrl: config.baseUrl,
          defaultModel: config.defaultModel,
        },
        availableModels: models,
        validated: validation.valid,
        config: {
          type: config.type,
          baseUrl: config.baseUrl,
          defaultModel: config.defaultModel,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}));

/* ═══════════════════════════════════════════════════════════════
   统一聊天接口
   ═══════════════════════════════════════════════════════════════ */

// POST /api/unified-api/chat — 非流式聊天
router.post('/chat', asyncWrapper(async (req, res) => {
  const { configId, messages, model, temperature, maxTokens, tools } = req.body;

  if (!configId || !messages) {
    return res.status(400).json({ success: false, error: 'configId and messages required' });
  }

  const config = apiConfigCache.get(configId);
  if (!config) {
    return res.status(404).json({ success: false, error: 'Config not found' });
  }

  try {
    const client = new UnifiedAPIClient(config);
    const response = await client.chat({
      messages,
      model,
      temperature,
      maxTokens,
      tools,
      stream: false,
    });

    res.json({
      success: true,
      data: {
        id: response.id,
        model: response.model,
        content: response.content,
        toolCalls: response.toolCalls,
        usage: response.usage,
        finishReason: response.finishReason,
      },
    });
  } catch (err) {
    logger.error({ configId, err }, 'Chat failed');
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}));

// POST /api/unified-api/chat/stream — 流式聊天（SSE）
router.post('/chat/stream', asyncWrapper(async (req, res) => {
  const { configId, messages, model, temperature, maxTokens } = req.body;

  if (!configId || !messages) {
    return res.status(400).json({ success: false, error: 'configId and messages required' });
  }

  const config = apiConfigCache.get(configId);
  if (!config) {
    return res.status(404).json({ success: false, error: 'Config not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const client = new UnifiedAPIClient(config);
    const stream = client.chatStream({
      messages,
      model,
      temperature,
      maxTokens,
      stream: true,
    });

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify({
        id: chunk.id,
        model: chunk.model,
        content: chunk.content,
        finishReason: chunk.finishReason,
      })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
    res.end();
  }
}));

// GET /api/unified-api/models — 列出可用模型
router.get('/models', asyncWrapper(async (req, res) => {
  const { configId } = req.query;

  if (!configId) {
    return res.status(400).json({ success: false, error: 'configId required' });
  }

  const config = apiConfigCache.get(configId as string);
  if (!config) {
    return res.status(404).json({ success: false, error: 'Config not found' });
  }

  try {
    const client = new UnifiedAPIClient(config);
    const models = await client.listModels();
    res.json({ success: true, data: { models, count: models.length } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}));

// POST /api/unified-api/validate — 验证API key
router.post('/validate', asyncWrapper(async (req, res) => {
  const { configId } = req.body;

  if (!configId) {
    return res.status(400).json({ success: false, error: 'configId required' });
  }

  const config = apiConfigCache.get(configId);
  if (!config) {
    return res.status(404).json({ success: false, error: 'Config not found' });
  }

  try {
    const client = new UnifiedAPIClient(config);
    const result = await client.validateKey();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}));

export default router;
