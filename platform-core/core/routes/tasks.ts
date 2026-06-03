import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
import { TaskRepository } from '../database/repositories/TaskRepository';
import { AgentRepository } from '../database/repositories/AgentRepository';
import { getTaskProgress } from '../services/monitorService';
import { logger } from '../utils/logger';

const router: Router = Router();
const taskRepo = new TaskRepository();
const agentRepo = new AgentRepository();

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

export interface TaskItem {
  id: string;
  taskNum: string;
  name: string;
  status: 'active' | 'completed' | 'pending' | 'failed' | 'cancelled';
  agentId: string;
  agentName: string;
  createdAt: string;
  completedAt?: string;
  files: TaskFile[];
  memories: TaskMemory[];
  logs: { timestamp: string; level: string; message: string }[];
}

/* ── Helper: 构建任务展示对象 ──────────────────────────── */

async function buildTaskDisplay(task: any): Promise<TaskItem> {
  const agent = await agentRepo.findById(task.agentId || task.target_agent_id || '');

  return {
    id: task.taskId || task.id,
    taskNum: `#${(task.taskId || task.id).split('_')[1] || '0000'}`,
    name: task.prompt ? task.prompt.substring(0, 50) + (task.prompt.length > 50 ? '...' : '') : '未命名任务',
    status: task.state === 'running' ? 'active' : task.state === 'completed' ? 'completed' : task.state === 'failed' ? 'failed' : task.state === 'cancelled' ? 'cancelled' : 'pending',
    agentId: task.agentId || task.target_agent_id || 'unknown',
    agentName: agent?.name || '未知Agent',
    createdAt: new Date(task.createdAt).toISOString(),
    completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : undefined,
    files: [],
    memories: [],
    logs: [
      { timestamp: new Date(task.createdAt).toISOString(), level: 'info', message: `任务 ${task.taskId || task.id} 已创建` },
      ...(task.state === 'completed' ? [{ timestamp: task.completedAt ? new Date(task.completedAt).toISOString() : new Date().toISOString(), level: 'info', message: `任务完成${task.output ? '，有输出结果' : ''}` }] : []),
      ...(task.state === 'failed' && task.error ? [{ timestamp: new Date().toISOString(), level: 'error', message: `任务失败: ${task.error}` }] : []),
    ],
  };
}

/* ── 路由 ──────────────────────────────────────────────────── */

// GET /tasks — 所有任务（真实数据）
router.get('/', asyncWrapper(async (req, res) => {
  const { status, agentId, type } = req.query;

  let tasks: any[];
  if (status) {
    tasks = await taskRepo.findByState(status as import('../coordinator/unified/types').TaskState);
  } else if (agentId) {
    tasks = await taskRepo.findByAgent(agentId as string);
  } else if (type) {
    tasks = await taskRepo.findByType(type as import('../coordinator/unified/types').TaskType);
  } else {
    tasks = await taskRepo.findAll();
  }

  const displays = await Promise.all(tasks.map(buildTaskDisplay));

  res.json({ success: true, data: displays, count: displays.length });
}));

// GET /tasks/stats — 任务统计
router.get('/stats', asyncWrapper(async (_req, res) => {
  const [
    total,
    pending,
    running,
    completed,
    failed,
  ] = await Promise.all([
    taskRepo.count(),
    taskRepo.countByState('pending'),
    taskRepo.countByState('running'),
    taskRepo.countByState('completed'),
    taskRepo.countByState('failed'),
  ]);

  res.json({
    success: true,
    data: {
      total,
      pending,
      running,
      completed,
      failed,
      cancelled: total - pending - running - completed - failed,
    },
  });
}));

// GET /tasks/:id — 单个任务详情
router.get('/:id', asyncWrapper(async (req, res) => {
  const task = await taskRepo.findById(req.params.id);
  if (!task) {
    res.status(404).json({ success: false, error: 'Task not found' });
    return;
  }

  const display = await buildTaskDisplay(task);
  res.json({ success: true, data: display });
}));

// GET /tasks/:id/progress — 任务进度
router.get('/:id/progress', asyncWrapper(async (req, res) => {
  const progress = await getTaskProgress(req.params.id);
  res.json({ success: true, data: progress });
}));

// POST /tasks — 创建任务
router.post('/', asyncWrapper(async (req, res) => {
  const { agentId, prompt, type = 'chat', context, attachments } = req.body;

  if (!prompt) {
    res.status(400).json({ success: false, error: 'Missing required field: prompt' });
    return;
  }

  const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();

  await taskRepo.create({
    taskId,
    type: type || 'chat',
    agentId: agentId || null,
    prompt,
    context,
    attachments,
    state: 'pending',
    latencyMs: 0,
    createdAt: now,
  });

  logger.info({ taskId, agentId, type }, '[TasksRoute] Task created');

  res.status(201).json({ success: true, data: { taskId, status: 'pending', createdAt: now } });
}));

// PUT /tasks/:id/status — 更新任务状态
router.put('/:id/status', asyncWrapper(async (req, res) => {
  const { id } = req.params;
  const { state, output, error, latencyMs, tokensUsed } = req.body;

  const task = await taskRepo.findById(id);
  if (!task) {
    res.status(404).json({ success: false, error: 'Task not found' });
    return;
  }

  const patch: any = {};
  if (state) patch.state = state;
  if (output !== undefined) patch.output = output;
  if (error !== undefined) patch.error = error;
  if (latencyMs !== undefined) patch.latencyMs = latencyMs;
  if (tokensUsed !== undefined) patch.tokensUsed = tokensUsed;
  if (state === 'completed' || state === 'failed' || state === 'cancelled') {
    patch.completedAt = Date.now();
  }

  const updated = await taskRepo.update(id, patch);
  if (!updated) {
    res.status(500).json({ success: false, error: 'Update failed' });
    return;
  }

  // 如果Agent完成了任务，更新Agent状态
  if (task.agentId && state === 'completed') {
    await agentRepo.update(task.agentId, { status: 'idle' });
  }

  res.json({ success: true, data: updated });
}));

// DELETE /tasks/:id — 删除任务
router.delete('/:id', asyncWrapper(async (req, res) => {
  const { id } = req.params;
  const task = await taskRepo.findById(id);
  if (!task) {
    res.status(404).json({ success: false, error: 'Task not found' });
    return;
  }

  const deleted = await taskRepo.delete(id);
  if (!deleted) {
    res.status(500).json({ success: false, error: 'Delete failed' });
    return;
  }

  res.json({ success: true, data: { taskId: id, deleted: true } });
}));

export default router;
