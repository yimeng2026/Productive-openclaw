/**
 * WorkspaceManager.ts — 工作空间统一管理器
 *
 * 核心原则：
 * - 每个 AgentGroup 有一个 WorkspaceRoot
 * - WorkspaceRoot 下按 tasks/{taskId}/ 组织
 * - 群组合并 = 父 workspace 挂载子群组的 task 文件夹（软链接/挂载）
 * - 记忆库 = .memory/ 隐藏文件夹，存在于每个 task 文件夹内
 * - 用户只能看到 tasks/ 下的内容，看不到 .memory/
 */

import { existsSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, statSync, unlinkSync } from 'fs';
import { join, basename, dirname, relative } from 'path';

// ── 类型定义 ───────────────────────────────────────────────────

export interface WorkspaceRoot {
  groupId: string;
  basePath: string;
  tasks: Map<string, TaskWorkspace>;
  sharedPath: string;
}

export interface TaskWorkspace {
  taskId: string;
  groupId: string;
  path: string;
  files: TaskFile[];
  memory: TaskMemory;
  handoffState: any;
  createdAt: number;
  updatedAt: number;
  isInherited?: boolean;
  inheritedFrom?: string;
}

export interface TaskFile {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
  createdAt: number;
  modifiedAt: number;
}

export interface TaskMemory {
  entries: MemoryEntry[];
  embeddingStore?: string;
}

export interface MemoryEntry {
  id: string;
  type: 'conversation' | 'context' | 'skill' | 'preference';
  content: string;
  timestamp: number;
  sourceAgentId?: string;
  taskId?: string;
}

export interface FileUpload {
  name: string;
  content: Buffer;
  mimeType?: string;
}

export interface InheritResult {
  inheritedTasks: string[];
  errors: string[];
}

export interface UnifiedWorkspaceView {
  ownTasks: TaskWorkspace[];
  inheritedTasks: Array<{ fromGroupId: string; tasks: TaskWorkspace[] }>;
}

// ── WorkspaceManager ───────────────────────────────────────────

export class WorkspaceManager {
  private workspaces = new Map<string, WorkspaceRoot>();
  private baseDir: string;

  constructor(baseDir: string = './workspace') {
    this.baseDir = baseDir;
    if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
  }

  // ═══════════════════════════════════════════════════════
  // 1. 创建与销毁
  // ═══════════════════════════════════════════════════════

  /** 为 AgentGroup 创建工作空间 */
  createWorkspace(groupId: string, templateTaskIds?: string[]): WorkspaceRoot {
    const basePath = join(this.baseDir, 'groups', groupId);
    if (!existsSync(basePath)) {
      mkdirSync(basePath, { recursive: true });
      mkdirSync(join(basePath, 'tasks'), { recursive: true });
      mkdirSync(join(basePath, 'shared'), { recursive: true });
    }

    const root: WorkspaceRoot = {
      groupId,
      basePath,
      tasks: new Map(),
      sharedPath: join(basePath, 'shared'),
    };

    this.workspaces.set(groupId, root);

    // 如果有模板任务，创建
    if (templateTaskIds) {
      for (const taskId of templateTaskIds) {
        this.createTaskWorkspace(groupId, taskId);
      }
    }

    return root;
  }

  /** 销毁工作空间 */
  destroyWorkspace(groupId: string, preserveFiles: boolean = true): boolean {
    const root = this.workspaces.get(groupId);
    if (!root) return false;

    if (!preserveFiles) {
      try {
        rmSync(root.basePath, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }

    this.workspaces.delete(groupId);
    return true;
  }

  // ═══════════════════════════════════════════════════════
  // 2. 任务级文件操作（用户可见层）
  // ═══════════════════════════════════════════════════════

  /** 创建任务工作文件夹 */
  createTaskWorkspace(groupId: string, taskId: string, initialFiles?: FileUpload[]): TaskWorkspace {
    const root = this.workspaces.get(groupId);
    if (!root) throw new Error(`Workspace for group ${groupId} not found`);

    const taskPath = join(root.basePath, 'tasks', taskId);
    if (!existsSync(taskPath)) {
      mkdirSync(taskPath, { recursive: true });
      mkdirSync(join(taskPath, 'files'), { recursive: true });
    }

    // .memory 文件夹（隐藏，不单独列出）
    const memoryPath = join(taskPath, '.memory');
    if (!existsSync(memoryPath)) mkdirSync(memoryPath, { recursive: true });

    const now = Date.now();
    const taskWorkspace: TaskWorkspace = {
      taskId,
      groupId,
      path: taskPath,
      files: [],
      memory: { entries: [] },
      handoffState: null,
      createdAt: now,
      updatedAt: now,
    };

    root.tasks.set(taskId, taskWorkspace);

    // 初始文件
    if (initialFiles) {
      for (const file of initialFiles) {
        this.writeTaskFile(groupId, taskId, join('files', file.name), file.content);
      }
    }

    return taskWorkspace;
  }

  /** 列出某群组的所有任务文件夹 */
  listTaskWorkspaces(groupId: string): TaskWorkspace[] {
    const root = this.workspaces.get(groupId);
    if (!root) return [];
    return Array.from(root.tasks.values());
  }

  /** 读取任务文件夹内文件 */
  readTaskFile(groupId: string, taskId: string, relativePath: string): Buffer {
    const root = this.workspaces.get(groupId);
    if (!root) throw new Error(`Workspace not found: ${groupId}`);

    const task = root.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found in group ${groupId}`);

    const filePath = join(task.path, relativePath);
    if (!existsSync(filePath)) throw new Error(`File not found: ${relativePath}`);

    return readFileSync(filePath);
  }

  /** 写入文件到任务文件夹 */
  writeTaskFile(groupId: string, taskId: string, relativePath: string, content: Buffer): TaskFile {
    const root = this.workspaces.get(groupId);
    if (!root) throw new Error(`Workspace not found: ${groupId}`);

    const task = root.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const filePath = join(task.path, relativePath);
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    writeFileSync(filePath, content);

    const stats = statSync(filePath);
    const now = Date.now();

    const taskFile: TaskFile = {
      id: `${taskId}-${relativePath}`,
      name: basename(relativePath),
      relativePath,
      size: stats.size,
      mimeType: this.inferMimeType(relativePath),
      createdAt: now,
      modifiedAt: now,
    };

    // 更新或添加
    const existingIdx = task.files.findIndex((f) => f.relativePath === relativePath);
    if (existingIdx >= 0) {
      task.files[existingIdx] = taskFile;
    } else {
      task.files.push(taskFile);
    }

    task.updatedAt = now;

    return taskFile;
  }

  /** 删除任务文件夹内文件 */
  deleteTaskFile(groupId: string, taskId: string, relativePath: string): boolean {
    const root = this.workspaces.get(groupId);
    if (!root) return false;

    const task = root.tasks.get(taskId);
    if (!task) return false;

    const filePath = join(task.path, relativePath);
    if (!existsSync(filePath)) return false;

    unlinkSync(filePath);

    const idx = task.files.findIndex((f) => f.relativePath === relativePath);
    if (idx >= 0) task.files.splice(idx, 1);

    task.updatedAt = Date.now();
    return true;
  }

  // ═══════════════════════════════════════════════════════
  // 3. 群组合并 = 工作空间挂载继承（核心）
  // ═══════════════════════════════════════════════════════

  /**
   * 继承子群组的任务工作空间
   *
   * 实现：在父 workspace 的 tasks 下创建指向子群组 task 文件夹的软链接/挂载
   */
  inheritTasksFromChild(
    parentGroupId: string,
    childGroupId: string,
    taskIds?: string[]
  ): InheritResult {
    const parentRoot = this.workspaces.get(parentGroupId);
    const childRoot = this.workspaces.get(childGroupId);

    if (!parentRoot || !childRoot) {
      return { inheritedTasks: [], errors: ['Parent or child workspace not found'] };
    }

    const inherited: string[] = [];
    const errors: string[] = [];

    const tasksToInherit = taskIds
      ? taskIds.filter((id) => childRoot.tasks.has(id))
      : Array.from(childRoot.tasks.keys());

    for (const taskId of tasksToInherit) {
      const childTask = childRoot.tasks.get(taskId);
      if (!childTask) continue;

      try {
        // 创建挂载：在父 workspace tasks/ 下创建软链接或记录
        const mountPath = join(parentRoot.basePath, 'tasks', `${taskId}__from_${childGroupId}`);
        if (!existsSync(mountPath)) {
          // 使用 junction/符号链接（Windows兼容）
          try {
            const { symlinkSync } = require('fs');
            symlinkSync(childTask.path, mountPath, 'junction');
          } catch {
            // fallback: 复制记录
            mkdirSync(mountPath, { recursive: true });
          }
        }

        // 注册到父 workspace
        const inheritedTask: TaskWorkspace = {
          ...childTask,
          groupId: parentGroupId,
          path: mountPath,
          isInherited: true,
          inheritedFrom: childGroupId,
        };
        parentRoot.tasks.set(`${taskId}__from_${childGroupId}`, inheritedTask);
        inherited.push(taskId);
      } catch (err) {
        errors.push(`Failed to inherit task ${taskId}: ${err}`);
      }
    }

    return { inheritedTasks: inherited, errors };
  }

  /**
   * 从总 workspace 导入特定任务
   */
  importTaskFromGroup(
    targetGroupId: string,
    sourceGroupId: string,
    taskId: string,
    mode: 'copy' | 'mount' = 'mount'
  ): TaskWorkspace {
    const targetRoot = this.workspaces.get(targetGroupId);
    const sourceRoot = this.workspaces.get(sourceGroupId);

    if (!targetRoot) throw new Error(`Target workspace not found: ${targetGroupId}`);
    if (!sourceRoot) throw new Error(`Source workspace not found: ${sourceGroupId}`);

    const sourceTask = sourceRoot.tasks.get(taskId);
    if (!sourceTask) throw new Error(`Task ${taskId} not found in source group`);

    const newTaskId = mode === 'copy' ? `${taskId}_copy_${Date.now()}` : `${taskId}_from_${sourceGroupId}`;
    const targetPath = join(targetRoot.basePath, 'tasks', newTaskId);

    if (mode === 'mount') {
      // 软链接挂载
      try {
        const { symlinkSync } = require('fs');
        symlinkSync(sourceTask.path, targetPath, 'junction');
      } catch {
        // fallback: 复制
        this.copyDirectory(sourceTask.path, targetPath);
      }
    } else {
      // 复制
      this.copyDirectory(sourceTask.path, targetPath);
    }

    const taskWorkspace: TaskWorkspace = {
      taskId: newTaskId,
      groupId: targetGroupId,
      path: targetPath,
      files: [...sourceTask.files],
      memory: { entries: [...sourceTask.memory.entries] },
      handoffState: sourceTask.handoffState,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isInherited: mode === 'mount',
      inheritedFrom: sourceGroupId,
    };

    targetRoot.tasks.set(newTaskId, taskWorkspace);
    return taskWorkspace;
  }

  /** 获取群组的完整 workspace 视图（含继承的挂载点） */
  getUnifiedWorkspaceView(groupId: string): UnifiedWorkspaceView {
    const root = this.workspaces.get(groupId);
    if (!root) return { ownTasks: [], inheritedTasks: [] };

    const ownTasks: TaskWorkspace[] = [];
    const inheritedMap = new Map<string, TaskWorkspace[]>();

    for (const task of root.tasks.values()) {
      if (task.isInherited && task.inheritedFrom) {
        const list = inheritedMap.get(task.inheritedFrom) || [];
        list.push(task);
        inheritedMap.set(task.inheritedFrom, list);
      } else {
        ownTasks.push(task);
      }
    }

    const inheritedTasks = Array.from(inheritedMap.entries()).map(([fromGroupId, tasks]) => ({
      fromGroupId,
      tasks,
    }));

    return { ownTasks, inheritedTasks };
  }

  // ═══════════════════════════════════════════════════════
  // 4. 记忆库（不单独列出，与工作文件一致）
  // ═══════════════════════════════════════════════════════

  /** 读取任务的记忆库 */
  readTaskMemory(groupId: string, taskId: string): TaskMemory {
    const root = this.workspaces.get(groupId);
    if (!root) return { entries: [] };

    const task = root.tasks.get(taskId);
    if (!task) return { entries: [] };

    const memoryPath = join(task.path, '.memory', 'entries.json');
    if (existsSync(memoryPath)) {
      try {
        const data = JSON.parse(readFileSync(memoryPath, 'utf-8'));
        return { entries: data.entries || [], embeddingStore: data.embeddingStore };
      } catch {
        return { entries: [] };
      }
    }

    return { entries: [] };
  }

  /** 追加记忆条目 */
  appendMemory(
    groupId: string,
    taskId: string,
    entry: Omit<MemoryEntry, 'id'>
  ): MemoryEntry {
    const root = this.workspaces.get(groupId);
    if (!root) throw new Error(`Workspace not found: ${groupId}`);

    const task = root.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const memoryPath = join(task.path, '.memory');
    if (!existsSync(memoryPath)) mkdirSync(memoryPath, { recursive: true });

    const entriesFile = join(memoryPath, 'entries.json');
    let memory: TaskMemory = { entries: [] };

    if (existsSync(entriesFile)) {
      try {
        memory = JSON.parse(readFileSync(entriesFile, 'utf-8'));
      } catch {
        memory = { entries: [] };
      }
    }

    const newEntry: MemoryEntry = {
      ...entry,
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    };

    memory.entries.push(newEntry);

    writeFileSync(entriesFile, JSON.stringify(memory, null, 2));

    task.memory = memory;
    task.updatedAt = Date.now();

    return newEntry;
  }

  /** 记忆搜索（简单文本搜索） */
  searchMemory(groupId: string, taskId: string, query: string): MemoryEntry[] {
    const memory = this.readTaskMemory(groupId, taskId);
    const lowerQuery = query.toLowerCase();
    return memory.entries.filter(
      (e) =>
        e.content.toLowerCase().includes(lowerQuery) ||
        e.type.toLowerCase().includes(lowerQuery)
    );
  }

  // ═══════════════════════════════════════════════════════
  // 5. 交接状态持久化
  // ═══════════════════════════════════════════════════════

  /** 保存交接状态到任务文件夹 */
  saveHandoffState(groupId: string, taskId: string, state: any): void {
    const root = this.workspaces.get(groupId);
    if (!root) return;

    const task = root.tasks.get(taskId);
    if (!task) return;

    const handoffPath = join(task.path, 'handoff.json');
    writeFileSync(handoffPath, JSON.stringify(state, null, 2));
    task.handoffState = state;
    task.updatedAt = Date.now();
  }

  /** 读取交接状态 */
  loadHandoffState(groupId: string, taskId: string): any | null {
    const root = this.workspaces.get(groupId);
    if (!root) return null;

    const task = root.tasks.get(taskId);
    if (!task) return null;

    const handoffPath = join(task.path, 'handoff.json');
    if (existsSync(handoffPath)) {
      try {
        return JSON.parse(readFileSync(handoffPath, 'utf-8'));
      } catch {
        return null;
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════
  // 工具方法
  // ═══════════════════════════════════════════════════════

  private inferMimeType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const map: Record<string, string> = {
      ts: 'text/typescript', js: 'text/javascript', json: 'application/json',
      md: 'text/markdown', html: 'text/html', css: 'text/css',
      py: 'text/x-python', lean: 'text/x-lean', txt: 'text/plain',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf',
      csv: 'text/csv', xml: 'application/xml', yaml: 'text/yaml',
      yml: 'text/yaml', zip: 'application/zip', tar: 'application/x-tar',
      gz: 'application/gzip',
    };
    return map[ext || ''] || 'application/octet-stream';
  }

  private copyDirectory(src: string, dest: string): void {
    if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
    const entries = readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirectory(srcPath, destPath);
      } else {
        writeFileSync(destPath, readFileSync(srcPath));
      }
    }
  }
}

export default WorkspaceManager;
