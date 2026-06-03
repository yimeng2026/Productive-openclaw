import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
import WorkspaceManager from '../services/WorkspaceManager';
import { logger } from '../utils/logger';

const router: Router = Router();

// 懒加载 WorkspaceManager
let workspaceManager: WorkspaceManager | null = null;
function getManager(): WorkspaceManager {
  if (!workspaceManager) {
    workspaceManager = new WorkspaceManager('./workspace/sylva');
  }
  return workspaceManager;
}

/* ═══════════════════════════════════════════════════════════════
   Workspace 管理 API
   ═══════════════════════════════════════════════════════════════ */

// POST /api/workspace/:groupId — 创建工作空间
router.post('/:groupId', asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const { templateTaskIds } = req.body;

  try {
    const root = getManager().createWorkspace(groupId, templateTaskIds);
    res.status(201).json({
      success: true,
      data: {
        groupId: root.groupId,
        basePath: root.basePath,
        taskCount: root.tasks.size,
      },
    });
  } catch (err) {
    logger.error({ groupId, err }, 'Failed to create workspace');
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}));

// DELETE /api/workspace/:groupId — 销毁工作空间
router.delete('/:groupId', asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const { preserveFiles = true } = req.body;

  const ok = getManager().destroyWorkspace(groupId, preserveFiles);
  res.json({ success: ok, data: { groupId, preserved: preserveFiles } });
}));

/* ═══════════════════════════════════════════════════════════════
   任务文件夹管理
   ═══════════════════════════════════════════════════════════════ */

// GET /api/workspace/:groupId/tasks — 列出所有任务文件夹
router.get('/:groupId/tasks', asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const tasks = getManager().listTaskWorkspaces(groupId);

  res.json({
    success: true,
    data: tasks.map(t => ({
      taskId: t.taskId,
      groupId: t.groupId,
      fileCount: t.files.length,
      memoryEntryCount: t.memory.entries.length,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      isInherited: t.isInherited,
      inheritedFrom: t.inheritedFrom,
    })),
  });
}));

// POST /api/workspace/:groupId/tasks — 创建任务文件夹
router.post('/:groupId/tasks', asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const { taskId, initialFiles } = req.body;

  const task = getManager().createTaskWorkspace(groupId, taskId, initialFiles);
  res.status(201).json({
    success: true,
    data: {
      taskId: task.taskId,
      path: task.path,
      fileCount: task.files.length,
    },
  });
}));

// GET /api/workspace/:groupId/tasks/:taskId — 任务详情
router.get('/:groupId/tasks/:taskId', asyncWrapper(async (req, res) => {
  const { groupId, taskId } = req.params;
  const view = getManager().getUnifiedWorkspaceView(groupId);

  const allTasks = [...view.ownTasks, ...view.inheritedTasks.flatMap(i => i.tasks)];
  const task = allTasks.find(t => t.taskId === taskId || t.taskId.startsWith(`${taskId}_`));

  if (!task) {
    return res.status(404).json({ success: false, error: `Task ${taskId} not found` });
  }

  res.json({
    success: true,
    data: {
      taskId: task.taskId,
      groupId: task.groupId,
      path: task.path,
      files: task.files,
      memoryEntries: task.memory.entries.length,
      handoffState: task.handoffState,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      isInherited: task.isInherited,
      inheritedFrom: task.inheritedFrom,
    },
  });
}));

/* ═══════════════════════════════════════════════════════════════
   文件操作
   ═══════════════════════════════════════════════════════════════ */

// GET /api/workspace/:groupId/tasks/:taskId/files/* — 读取文件
router.get('/:groupId/tasks/:taskId/files/*', asyncWrapper(async (req, res) => {
  const { groupId, taskId } = req.params;
  const filePath = req.params[0] || '';

  try {
    const content = getManager().readTaskFile(groupId, taskId, filePath);
    const task = getManager().listTaskWorkspaces(groupId).find(t => t.taskId === taskId);
    const file = task?.files.find(f => f.relativePath === filePath);

    if (file?.mimeType?.startsWith('image/')) {
      res.setHeader('Content-Type', file.mimeType);
      res.send(content);
    } else {
      res.setHeader('Content-Type', file?.mimeType || 'text/plain');
      res.send(content);
    }
  } catch (err) {
    res.status(404).json({ success: false, error: (err as Error).message });
  }
}));

// POST /api/workspace/:groupId/tasks/:taskId/files/* — 写入文件
router.post('/:groupId/tasks/:taskId/files/*', asyncWrapper(async (req, res) => {
  const { groupId, taskId } = req.params;
  const filePath = req.params[0] || '';
  const content = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

  try {
    const file = getManager().writeTaskFile(groupId, taskId, filePath, content);
    res.status(201).json({ success: true, data: file });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}));

// DELETE /api/workspace/:groupId/tasks/:taskId/files/* — 删除文件
router.delete('/:groupId/tasks/:taskId/files/*', asyncWrapper(async (req, res) => {
  const { groupId, taskId } = req.params;
  const filePath = req.params[0] || '';

  const ok = getManager().deleteTaskFile(groupId, taskId, filePath);
  res.json({ success: ok, data: { deleted: ok, path: filePath } });
}));

/* ═══════════════════════════════════════════════════════════════
   群组合并 = 工作空间继承
   ═══════════════════════════════════════════════════════════════ */

// POST /api/workspace/:groupId/inherit — 继承子群组任务
router.post('/:groupId/inherit', asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const { sourceGroupId, taskIds } = req.body;

  if (!sourceGroupId) {
    return res.status(400).json({ success: false, error: 'sourceGroupId required' });
  }

  const result = getManager().inheritTasksFromChild(groupId, sourceGroupId, taskIds);
  res.json({ success: true, data: result });
}));

// POST /api/workspace/:groupId/import — 从总workspace导入
router.post('/:groupId/import', asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const { sourceGroupId, taskId, mode = 'mount' } = req.body;

  if (!sourceGroupId || !taskId) {
    return res.status(400).json({ success: false, error: 'sourceGroupId and taskId required' });
  }

  try {
    const task = getManager().importTaskFromGroup(groupId, sourceGroupId, taskId, mode);
    res.status(201).json({
      success: true,
      data: {
        taskId: task.taskId,
        path: task.path,
        mode,
        isInherited: task.isInherited,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}));

// GET /api/workspace/:groupId/view — 完整workspace视图
router.get('/:groupId/view', asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const view = getManager().getUnifiedWorkspaceView(groupId);

  res.json({
    success: true,
    data: {
      ownTasks: view.ownTasks.map(t => ({
        taskId: t.taskId,
        fileCount: t.files.length,
        memoryEntries: t.memory.entries.length,
      })),
      inheritedTasks: view.inheritedTasks.map(i => ({
        fromGroupId: i.fromGroupId,
        tasks: i.tasks.map(t => ({
          taskId: t.taskId,
          fileCount: t.files.length,
        })),
      })),
    },
  });
}));

/* ═══════════════════════════════════════════════════════════════
   记忆库（与文件一致，不单独列出）
   ═══════════════════════════════════════════════════════════════ */

// GET /api/workspace/:groupId/tasks/:taskId/memory — 读取记忆
router.get('/:groupId/tasks/:taskId/memory', asyncWrapper(async (req, res) => {
  const { groupId, taskId } = req.params;
  const memory = getManager().readTaskMemory(groupId, taskId);
  res.json({ success: true, data: memory });
}));

// POST /api/workspace/:groupId/tasks/:taskId/memory — 追加记忆
router.post('/:groupId/tasks/:taskId/memory', asyncWrapper(async (req, res) => {
  const { groupId, taskId } = req.params;
  const { type, content, sourceAgentId } = req.body;

  try {
    const entry = getManager().appendMemory(groupId, taskId, {
      type: type || 'conversation',
      content,
      timestamp: Date.now(),
      sourceAgentId,
    });
    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
}));

// GET /api/workspace/:groupId/tasks/:taskId/memory/search — 搜索记忆
router.get('/:groupId/tasks/:taskId/memory/search', asyncWrapper(async (req, res) => {
  const { groupId, taskId } = req.params;
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({ success: false, error: 'Query parameter "q" required' });
  }

  const results = getManager().searchMemory(groupId, taskId, q as string);
  res.json({ success: true, data: { query: q, results, count: results.length } });
}));

export default router;