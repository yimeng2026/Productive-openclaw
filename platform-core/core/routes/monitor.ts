import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
import { getMonitorData, getAgentStatuses, getTaskStatuses, getPlatformHealth, getSkillHealth } from '../services/monitorService';
import { runAutoConfig, rescanOllama, rescanSkills } from '../services/autoConfigService';
import { getWebSocketManager } from '../websocket';

const router: Router = Router();

/* ── 监控数据路由 ─────────────────────────────────────────────── */

// GET /monitor — 完整监控数据（Dashboard用）
router.get('/', asyncWrapper(async (_req, res) => {
  const data = await getMonitorData();
  res.json({ success: true, data });
}));

// GET /monitor/system — 系统指标
router.get('/system', asyncWrapper(async (_req, res) => {
  const data = await getMonitorData();
  res.json({ success: true, data: data.system });
}));

// GET /monitor/platforms — 平台健康状态
router.get('/platforms', asyncWrapper(async (_req, res) => {
  const platforms = await getPlatformHealth();
  res.json({ success: true, data: platforms });
}));

// GET /monitor/agents — Agent状态
router.get('/agents', asyncWrapper(async (_req, res) => {
  const agents = await getAgentStatuses();
  res.json({ success: true, data: agents, count: agents.length });
}));

// GET /monitor/tasks — 任务状态
router.get('/tasks', asyncWrapper(async (_req, res) => {
  const tasks = await getTaskStatuses();
  res.json({ success: true, data: tasks, count: tasks.length });
}));

// GET /monitor/skills — 技能健康状态
router.get('/skills', asyncWrapper(async (_req, res) => {
  const skills = await getSkillHealth();
  res.json({ success: true, data: skills, count: skills.length });
}));

// GET /monitor/alerts — 当前告警
router.get('/alerts', asyncWrapper(async (_req, res) => {
  const data = await getMonitorData();
  res.json({ success: true, data: data.alerts });
}));

/* ── SSE 实时推送 ─────────────────────────────────────────────── */

// GET /monitor/stream — Server-Sent Events 实时监控流
router.get('/stream', asyncWrapper(async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendUpdate = async () => {
    try {
      const data = await getMonitorData();
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: 'Monitor stream error' })}\n\n`);
    }
  };

  // 立即发送一次
  await sendUpdate();

  // 每5秒推送一次
  const interval = setInterval(sendUpdate, 5000);

  // 客户端断开时清理
  req.on('close', () => {
    clearInterval(interval);
  });

  req.on('error', () => {
    clearInterval(interval);
  });
}));

/* ── 自动配置 ─────────────────────────────────────────────────── */

// GET /monitor/config — 当前自动配置状态
router.get('/config', asyncWrapper(async (_req, res) => {
  const result = await runAutoConfig();
  res.json({ success: true, data: result });
}));

// POST /monitor/config/refresh — 重新执行自动配置
router.post('/config/refresh', asyncWrapper(async (_req, res) => {
  const result = await runAutoConfig();
  res.json({ success: true, data: result, message: '自动配置已刷新' });
}));

// POST /monitor/config/ollama — 重新扫描Ollama
router.post('/config/ollama', asyncWrapper(async (_req, res) => {
  const result = await rescanOllama();
  if (result.success) {
    res.json({ success: true, data: result, message: `Ollama扫描完成，发现 ${result.models.length} 个模型` });
  } else {
    res.status(500).json({ success: false, error: result.error || 'Ollama scan failed' });
  }
}));

// POST /monitor/config/skills — 重新扫描skills
router.post('/config/skills', asyncWrapper(async (_req, res) => {
  const result = await rescanSkills();
  if (result.success) {
    res.json({ success: true, data: result, message: `Skills扫描完成，发现 ${result.count} 个技能` });
  } else {
    res.status(500).json({ success: false, error: result.error || 'Skills scan failed' });
  }
}));

/* ── WebSocket 统计 ─────────────────────────────────────────── */

// GET /monitor/websocket — WebSocket连接统计
router.get('/websocket', asyncWrapper(async (_req, res) => {
  const wsManager = getWebSocketManager();
  const stats = wsManager.getStats();
  res.json({ success: true, data: stats });
}));

export default router;
