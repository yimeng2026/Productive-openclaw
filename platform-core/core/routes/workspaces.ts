import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';

const router: Router = Router();

/* ── Types ─────────────────────────────────────────────── */

export interface TaskFile {
  id: string;
  name: string;
  type: string;
  size: string;
  modifiedAt: string;
}

export interface TaskMemory {
  id: string;
  name: string;
  type: 'conversation' | 'working' | 'system' | 'knowledge';
  description: string;
  fileCount: number;
  size: string;
  lastUsed: string;
}

export interface TaskKnowledgeRef {
  kbId: string;
  kbName: string;
}

export interface TaskItem {
  id: string;
  taskNum: string;
  name: string;
  status: 'active' | 'completed' | 'pending' | 'failed';
  agentId: string;
  agentName: string;
  agentAvatar: string;
  createdAt: string;
  completedAt?: string;
  files: TaskFile[];
  memories: TaskMemory[];
  knowledgeRefs: TaskKnowledgeRef[];
  logs: { timestamp: string; level: string; message: string }[];
}

export interface KnowledgeBaseItem {
  id: string;
  name: string;
  description: string;
  docCount: number;
  fileCount: number;
  lastUpdated: string;
  files: { id: string; name: string; type: string; size: string; modifiedAt: string }[];
}

/* ── Mock Data ─────────────────────────────────────────── */

const tasks: TaskItem[] = [
  {
    id: 'task-2845',
    taskNum: '#2845',
    name: '代码审查与优化',
    status: 'completed',
    agentId: 'agent-1',
    agentName: '代码助手-01',
    agentAvatar: 'leaf',
    createdAt: '2026-01-15 13:00',
    completedAt: '2026-01-15 13:45',
    files: [
      { id: 'f1', name: 'review-notes.md', type: 'markdown', size: '24 KB', modifiedAt: '2小时前' },
      { id: 'f2', name: 'code-changes.py', type: 'python', size: '156 KB', modifiedAt: '3小时前' },
      { id: 'f3', name: 'analysis.json', type: 'json', size: '12 KB', modifiedAt: '1小时前' },
      { id: 'f4', name: 'summary.md', type: 'markdown', size: '8 KB', modifiedAt: '30分钟前' },
    ],
    memories: [
      { id: 'm1', name: '代码审查对话', type: 'conversation', description: '记录了与用户的代码审查对话，包含Python最佳实践的讨论', fileCount: 12, size: '45 KB', lastUsed: '10分钟前' },
      { id: 'm2', name: '优化建议工作记忆', type: 'working', description: '代码优化过程中的中间分析结果', fileCount: 5, size: '18 KB', lastUsed: '1小时前' },
    ],
    knowledgeRefs: [
      { kbId: 'kb-1', kbName: '技术文档库' },
      { kbId: 'kb-6', kbName: 'AI研究文献' },
    ],
    logs: [
      { timestamp: '2026-01-15 13:00:05', level: 'info', message: '任务 #2845 已创建，分配给 代码助手-01' },
      { timestamp: '2026-01-15 13:05:22', level: 'info', message: '代码审查开始：扫描 42 个文件' },
      { timestamp: '2026-01-15 13:20:15', level: 'warn', message: '发现 3 处潜在性能问题' },
      { timestamp: '2026-01-15 13:45:00', level: 'info', message: '任务完成，生成报告 review-notes.md' },
    ],
  },
  {
    id: 'task-2830',
    taskNum: '#2830',
    name: '数据清洗与预处理',
    status: 'completed',
    agentId: 'agent-2',
    agentName: '数据分析-A',
    agentAvatar: 'flower',
    createdAt: '2026-01-14 09:00',
    completedAt: '2026-01-14 09:30',
    files: [
      { id: 'f5', name: 'raw-data.csv', type: 'csv', size: '2.1 MB', modifiedAt: '5小时前' },
      { id: 'f6', name: 'cleaning-script.py', type: 'python', size: '18 KB', modifiedAt: '4小时前' },
      { id: 'f7', name: 'data-profile.json', type: 'json', size: '34 KB', modifiedAt: '3小时前' },
      { id: 'f8', name: 'null-report.md', type: 'markdown', size: '12 KB', modifiedAt: '2小时前' },
      { id: 'f9', name: 'outliers.xlsx', type: 'xlsx', size: '890 KB', modifiedAt: '1小时前' },
    ],
    memories: [
      { id: 'm3', name: '销售数据分析记忆', type: 'working', description: '销售数据分析的中间结果和SQL查询记录', fileCount: 8, size: '23 KB', lastUsed: '1小时前' },
    ],
    knowledgeRefs: [
      { kbId: 'kb-2', kbName: '产品知识库' },
    ],
    logs: [
      { timestamp: '2026-01-14 09:00:05', level: 'info', message: '任务 #2830 已创建，分配给 数据分析-A' },
      { timestamp: '2026-01-14 09:15:30', level: 'info', message: '数据清洗完成：处理了 15,234 条记录' },
      { timestamp: '2026-01-14 09:30:00', level: 'info', message: '任务完成，输出文件已保存' },
    ],
  },
  {
    id: 'task-2856',
    taskNum: '#2856',
    name: 'API文档翻译',
    status: 'active',
    agentId: 'agent-4',
    agentName: '翻译专员',
    agentAvatar: 'fern',
    createdAt: '2026-01-16 10:00',
    files: [
      { id: 'f10', name: 'api-ref-en.md', type: 'markdown', size: '156 KB', modifiedAt: '30分钟前' },
      { id: 'f11', name: 'api-ref-ja.po', type: 'po', size: '89 KB', modifiedAt: '15分钟前' },
    ],
    memories: [
      { id: 'm4', name: '中日术语对照', type: 'knowledge', description: '中日技术术语对照表和翻译风格指南', fileCount: 5, size: '12 KB', lastUsed: '昨天' },
    ],
    knowledgeRefs: [
      { kbId: 'kb-3', kbName: '通用知识' },
    ],
    logs: [
      { timestamp: '2026-01-16 10:00:05', level: 'info', message: '任务 #2856 已创建，分配给 翻译专员' },
      { timestamp: '2026-01-16 10:05:12', level: 'info', message: '开始翻译：api-ref-en.md → 日语' },
    ],
  },
  {
    id: 'task-2857',
    taskNum: '#2857',
    name: '性能测试与报告',
    status: 'pending',
    agentId: 'agent-5',
    agentName: '测试工程师',
    agentAvatar: 'mushroom',
    createdAt: '2026-01-16 14:00',
    files: [],
    memories: [
      { id: 'm5', name: '测试环境配置', type: 'system', description: '系统配置和全局变量定义，包含测试环境参数', fileCount: 3, size: '8 KB', lastUsed: '2天前' },
    ],
    knowledgeRefs: [
      { kbId: 'kb-1', kbName: '技术文档库' },
    ],
    logs: [
      { timestamp: '2026-01-16 14:00:05', level: 'info', message: '任务 #2857 已创建，分配给 测试工程师' },
    ],
  },
];

const knowledgeBases: KnowledgeBaseItem[] = [
  {
    id: 'kb-1',
    name: '技术文档库',
    description: 'API文档、开发规范、代码库说明和架构设计文档',
    docCount: 156,
    fileCount: 156,
    lastUpdated: '2小时前',
    files: [
      { id: 'kf1', name: 'authentication.md', type: 'md', size: '24 KB', modifiedAt: '2小时前' },
      { id: 'kf2', name: 'deployment-guide.pdf', type: 'pdf', size: '3.4 MB', modifiedAt: '1天前' },
    ],
  },
  {
    id: 'kb-2',
    name: '产品知识库',
    description: '产品功能说明、用户手册、FAQ和竞品分析',
    docCount: 89,
    fileCount: 89,
    lastUpdated: '1天前',
    files: [
      { id: 'kf3', name: 'user-manual-v2.pdf', type: 'pdf', size: '5.6 MB', modifiedAt: '1天前' },
    ],
  },
  {
    id: 'kb-3',
    name: '通用知识',
    description: '通用常识、百科知识和多语言翻译参考',
    docCount: 234,
    fileCount: 229,
    lastUpdated: '3小时前',
    files: [
      { id: 'kf4', name: 'translation-guide.md', type: 'md', size: '45 KB', modifiedAt: '5小时前' },
    ],
  },
  {
    id: 'kb-4',
    name: '内部数据',
    description: '公司内部文档、会议记录和项目资料',
    docCount: 45,
    fileCount: 45,
    lastUpdated: '1周前',
    files: [
      { id: 'kf5', name: 'meeting-notes-2026-01-15.md', type: 'md', size: '12 KB', modifiedAt: '3小时前' },
    ],
  },
];

/* ── Helpers ─────────────────────────────────────────────── */

function getTaskListSummary() {
  return tasks.map((t) => ({
    id: t.id,
    taskNum: t.taskNum,
    name: t.name,
    status: t.status,
    agentId: t.agentId,
    agentName: t.agentName,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
    fileCount: t.files.length,
    memoryCount: t.memories.length,
  }));
}

/* ── Routes ─────────────────────────────────────────────── */

/**
 * GET /workspaces/tasks
 * 任务列表（摘要信息）
 */
router.get('/tasks', asyncWrapper(async (_req, res) => {
  res.json({ success: true, data: getTaskListSummary() });
}));

/**
 * GET /workspaces/tasks/:id
 * 单个任务详情（含完整文件、记忆、日志）
 */
router.get('/tasks/:id', asyncWrapper(async (req, res) => {
  const task = tasks.find((t) => t.id === req.params.id);
  if (!task) {
    res.status(404).json({ success: false, error: 'Task not found' });
    return;
  }
  res.json({ success: true, data: task });
}));

/**
 * POST /workspaces/tasks/:id/import
 * 导入文件到指定任务
 */
router.post('/tasks/:id/import', asyncWrapper(async (req, res) => {
  const task = tasks.find((t) => t.id === req.params.id);
  if (!task) {
    res.status(404).json({ success: false, error: 'Task not found' });
    return;
  }

  const { files } = req.body as { files?: Array<{ name: string; type: string; size: string }> };
  if (!files || !Array.isArray(files) || files.length === 0) {
    res.status(400).json({ success: false, error: 'No files provided' });
    return;
  }

  const now = new Date().toISOString();
  const imported = files.map((f, i) => ({
    id: `imported-${Date.now()}-${i}`,
    name: f.name,
    type: f.type,
    size: f.size || 'Unknown',
    modifiedAt: '刚刚',
  }));

  task.files.push(...imported);

  task.logs.push({
    timestamp: now,
    level: 'info',
    message: `导入了 ${imported.length} 个文件: ${imported.map((f) => f.name).join(', ')}`,
  });

  res.json({
    success: true,
    data: {
      taskId: task.id,
      importedCount: imported.length,
      files: imported,
    },
  });
}));

/**
 * GET /workspaces/knowledge
 * 独立知识库列表
 */
router.get('/knowledge', asyncWrapper(async (_req, res) => {
  res.json({
    success: true,
    data: knowledgeBases.map((kb) => ({
      id: kb.id,
      name: kb.name,
      description: kb.description,
      docCount: kb.docCount,
      fileCount: kb.fileCount,
      lastUpdated: kb.lastUpdated,
    })),
  });
}));

/**
 * GET /workspaces/knowledge/:id
 * 单个知识库详情（含文件列表）
 */
router.get('/knowledge/:id', asyncWrapper(async (req, res) => {
  const kb = knowledgeBases.find((k) => k.id === req.params.id);
  if (!kb) {
    res.status(404).json({ success: false, error: 'Knowledge base not found' });
    return;
  }
  res.json({ success: true, data: kb });
}));

/**
 * POST /workspaces/knowledge/import
 * 导入知识库文件
 */
router.post('/knowledge/import', asyncWrapper(async (req, res) => {
  const { kbId, files } = req.body as {
    kbId?: string;
    files?: Array<{ name: string; type: string; size: string }>;
  };

  if (!files || !Array.isArray(files) || files.length === 0) {
    res.status(400).json({ success: false, error: 'No files provided' });
    return;
  }

  const targetKb = kbId ? knowledgeBases.find((k) => k.id === kbId) : undefined;

  const imported = files.map((f, i) => ({
    id: `kb-imported-${Date.now()}-${i}`,
    name: f.name,
    type: f.type,
    size: f.size || 'Unknown',
    modifiedAt: '刚刚',
  }));

  if (targetKb) {
    targetKb.files.push(...imported);
    targetKb.fileCount += imported.length;
    targetKb.lastUpdated = '刚刚';
  }

  res.json({
    success: true,
    data: {
      kbId: targetKb?.id || null,
      importedCount: imported.length,
      files: imported,
    },
  });
}));

/**
 * GET /workspaces/stats
 * 工作空间统计
 */
router.get('/stats', asyncWrapper(async (_req, res) => {
  const totalFiles = tasks.reduce((sum, t) => sum + t.files.length, 0);
  const totalMemories = tasks.reduce((sum, t) => sum + t.memories.length, 0);
  const activeTasks = tasks.filter((t) => t.status === 'active').length;
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;

  res.json({
    success: true,
    data: {
      taskCount: tasks.length,
      activeTasks,
      completedTasks,
      totalFiles,
      totalMemories,
      knowledgeBaseCount: knowledgeBases.length,
    },
  });
}));

export default router;
