import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';

const router: Router = Router();

export interface ApiKey {
  id: string;
  name: string;
  provider: string;
  endpoint: string;
  keyMask: string;
  modelCount: number;
  status: 'connected' | 'disconnected' | 'error';
  latency: number | string;
}

const apiKeys: ApiKey[] = [
  { id: 'ak1', name: 'OpenAI-生产', provider: 'OpenAI', endpoint: 'https://api.openai.com/v1', keyMask: 'sk-...4A2B', modelCount: 3, status: 'connected', latency: 23 },
  { id: 'ak2', name: 'OpenAI-开发', provider: 'OpenAI', endpoint: 'https://api.openai.com/v1', keyMask: 'sk-...9C1D', modelCount: 2, status: 'connected', latency: 31 },
  { id: 'ak3', name: 'Ollama-本地', provider: 'Ollama', endpoint: 'http://localhost:11434', keyMask: 'http://localhost:11434', modelCount: 5, status: 'connected', latency: 0 },
  { id: 'ak4', name: 'Kimi-主账号', provider: 'Kimi', endpoint: 'https://api.moonshot.cn/v1', keyMask: 'sk-...7E3F', modelCount: 2, status: 'connected', latency: 156 },
  { id: 'ak5', name: 'Claude-备用', provider: 'Claude', endpoint: 'https://api.anthropic.com/v1', keyMask: 'sk-...2B5A', modelCount: 1, status: 'error', latency: '超时' },
  { id: 'ak6', name: 'Gemini-Pro', provider: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com', keyMask: 'AIza...8F2D', modelCount: 3, status: 'connected', latency: 67 },
  { id: 'ak7', name: 'DeepSeek-V3', provider: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1', keyMask: 'sk-...6G4H', modelCount: 2, status: 'connected', latency: 45 },
  { id: 'ak8', name: '通义千问', provider: 'Qwen', endpoint: 'https://dashscope.aliyuncs.com/v1', keyMask: 'sk-...1J3K', modelCount: 4, status: 'connected', latency: 78 },
];

router.get('/', asyncWrapper(async (_req, res) => {
  res.json({ success: true, data: apiKeys });
}));

router.post('/', asyncWrapper(async (req, res) => {
  const newKey: ApiKey = {
    id: `ak${Date.now()}`,
    ...req.body,
    status: 'connected',
    latency: 0,
  };
  apiKeys.push(newKey);
  res.status(201).json({ success: true, data: newKey });
}));

router.delete('/:id', asyncWrapper(async (req, res) => {
  const idx = apiKeys.findIndex((k) => k.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ success: false, error: { error: 'API key not found', code: 'NOT_FOUND' } });
    return;
  }
  apiKeys.splice(idx, 1);
  res.json({ success: true });
}));

export default router;
