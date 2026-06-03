import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
const router: Router = Router();

import { pushLog } from '../websocket/push';

interface LogEntry {
  id: string;
  timestamp: string;
  agent: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  source?: string;
  metadata?: Record<string, any>;
}

// In-memory log store (would be backed by file/DB in production)
const logStore: LogEntry[] = [
  { id: 'l1', timestamp: new Date(Date.now() - 120000).toISOString(), agent: 'SYSTEM', level: 'INFO', message: '服务启动完成', source: 'main' },
  { id: 'l2', timestamp: new Date(Date.now() - 110000).toISOString(), agent: 'SYSTEM', level: 'INFO', message: 'WebSocket 服务器已就绪', source: 'ws' },
  { id: 'l3', timestamp: new Date(Date.now() - 90000).toISOString(), agent: 'SYSTEM', level: 'WARN', message: '内存使用率达到 78%', source: 'monitor' },
  { id: 'l4', timestamp: new Date(Date.now() - 60000).toISOString(), agent: 'AgentZero', level: 'INFO', message: '自动批准手递手: ag-2 → ag-5 (置信度 0.94)', source: 'agentZero' },
  { id: 'l5', timestamp: new Date(Date.now() - 50000).toISOString(), agent: '总调度器', level: 'DEBUG', message: 'Swarm 拓扑更新: 8 活跃节点, 2 等待, 1 暂停', source: 'coordinator' },
  { id: 'l6', timestamp: new Date(Date.now() - 40000).toISOString(), agent: 'SYSTEM', level: 'INFO', message: '知识库同步完成: 技术文档 +12 条目', source: 'knowledge' },
  { id: 'l7', timestamp: new Date(Date.now() - 30000).toISOString(), agent: 'SYSTEM', level: 'WARN', message: '磁盘空间警告: /tmp 分区使用 87%', source: 'monitor' },
  { id: 'l8', timestamp: new Date(Date.now() - 20000).toISOString(), agent: 'SYSTEM', level: 'ERROR', message: '平台 Gemini Pro 连接超时，已标记为降级', source: 'platform' },
  { id: 'l9', timestamp: new Date(Date.now() - 10000).toISOString(), agent: 'SYSTEM', level: 'INFO', message: 'AgentZero 干预就绪，当前自主级别: 3', source: 'agentZero' },
  { id: 'l10', timestamp: new Date(Date.now() - 5000).toISOString(), agent: 'SYSTEM', level: 'DEBUG', message: 'WebSocket 心跳正常，延迟 23ms', source: 'ws' },
];

function addLog(entry: Omit<LogEntry, 'id' | 'timestamp'>) {
  const id = `l${logStore.length + 1}`;
  const timestamp = new Date().toISOString();
  const fullEntry = { id, timestamp, ...entry };
  logStore.push(fullEntry);
  if (logStore.length > 5000) logStore.shift();

  // 实时推送到前端
  pushLog(id, timestamp, entry.agent, entry.level, entry.message, entry.source, entry.metadata);
}

// Log aggregation endpoint
router.get('/', asyncWrapper(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const level = req.query.level as string;
  const agent = req.query.agent as string;
  const search = req.query.search as string;

  let filtered = [...logStore].reverse();

  if (level && level !== 'ALL') {
    filtered = filtered.filter((l) => l.level === level);
  }
  if (agent && agent !== 'ALL') {
    filtered = filtered.filter((l) => l.agent === agent);
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((l) =>
      l.message.toLowerCase().includes(q) ||
      l.agent.toLowerCase().includes(q)
    );
  }

  res.json({ success: true, data: filtered.slice(0, limit) });
}));

// Log stats / aggregation
router.get('/stats', asyncWrapper(async (_req, res) => {
  const total = logStore.length;
  const byLevel = {
    DEBUG: logStore.filter((l) => l.level === 'DEBUG').length,
    INFO: logStore.filter((l) => l.level === 'INFO').length,
    WARN: logStore.filter((l) => l.level === 'WARN').length,
    ERROR: logStore.filter((l) => l.level === 'ERROR').length,
  };
  const bySource = logStore.reduce((acc, l) => {
    acc[l.source || 'unknown'] = (acc[l.source || 'unknown'] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Recent errors (last 24h window from in-memory)
  const recentErrors = logStore.filter((l) => l.level === 'ERROR').slice(-10);

  res.json({
    success: true,
    data: {
      total,
      byLevel,
      bySource,
      recentErrors,
      errorRate: total > 0 ? Math.round((byLevel.ERROR / total) * 100) : 0,
    },
  });
}));

// Single log entry
router.get('/:id', asyncWrapper(async (req, res) => {
  const l = logStore.find((x) => x.id === req.params.id);
  if (!l) {
    res.status(404).json({ success: false, error: 'Not found' });
    return;
  }
  res.json({ success: true, data: l });
}));

// Export logs
router.post('/export', asyncWrapper(async (req, res) => {
  const { format = 'json', startDate, endDate } = req.body;
  let exportLogs = [...logStore];
  if (startDate) {
    exportLogs = exportLogs.filter((l) => new Date(l.timestamp) >= new Date(startDate));
  }
  if (endDate) {
    exportLogs = exportLogs.filter((l) => new Date(l.timestamp) <= new Date(endDate));
  }
  res.json({
    success: true,
    data: {
      format,
      count: exportLogs.length,
      logs: exportLogs,
      exportedAt: new Date().toISOString(),
    },
  });
}));

// Ingest a log (for internal use)
router.post('/', asyncWrapper(async (req, res) => {
  const { agent, level, message, source, metadata } = req.body;
  if (!message) {
    res.status(400).json({ success: false, error: 'message required' });
    return;
  }
  addLog({ agent: agent || 'SYSTEM', level: level || 'INFO', message, source, metadata });
  res.json({ success: true });
}));

export default router;
