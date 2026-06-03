// StateManager.ts — 状态管理器
// Swarm 状态定义、任务状态追踪、共享上下文同步、持久化

import { getDb } from '../../database/sqlite';
import { logger } from '../../utils/logger';
import type {
  SwarmState,
  TaskResult,
  TaskError,
  TaskState,
  MemoryEntry,
  SwarmMode,
} from './types';

const TABLE_SWARMS = 'uc_swarms';
const TABLE_TASKS = 'uc_tasks';
const TABLE_SWARM_AGENTS = 'uc_swarm_agents';

export class StateManager {
  private swarms = new Map<string, SwarmState>();
  private initialized = false;

  // ── 初始化 ─────────────────────────────────

  async init(): Promise<void> {
    if (this.initialized) return;
    const db = await getDb();

    await db.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE_SWARMS} (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        mode TEXT DEFAULT 'parallel',
        max_depth INTEGER DEFAULT 3,
        sync_interval_ms INTEGER DEFAULT 5000,
        shared_context TEXT DEFAULT '',
        shared_memory TEXT DEFAULT '[]',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ${TABLE_TASKS} (
        id TEXT PRIMARY KEY,
        swarm_id TEXT,
        agent_id TEXT,
        state TEXT DEFAULT 'pending',
        output TEXT,
        error TEXT,
        latency_ms INTEGER DEFAULT 0,
        tokens_used INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        FOREIGN KEY (swarm_id) REFERENCES ${TABLE_SWARMS}(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ${TABLE_SWARM_AGENTS} (
        swarm_id TEXT,
        agent_id TEXT,
        role TEXT DEFAULT 'worker',
        joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (swarm_id, agent_id),
        FOREIGN KEY (swarm_id) REFERENCES ${TABLE_SWARMS}(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_swarm ON ${TABLE_TASKS}(swarm_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_state ON ${TABLE_TASKS}(state);
      CREATE INDEX IF NOT EXISTS idx_tasks_agent ON ${TABLE_TASKS}(agent_id);
    `);

    // 加载 Swarm
    const swarmRows = await db.all(`SELECT * FROM ${TABLE_SWARMS}`);
    for (const row of swarmRows) {
      const swarm = await this.loadSwarmFromRow(row);
      this.swarms.set(swarm.id, swarm);
    }

    this.initialized = true;
    logger.info(`[StateManager] Loaded ${this.swarms.size} swarms from DB`);
  }

  // ── Swarm CRUD ─────────────────────────────

  async createSwarm(
    id: string,
    name: string,
    agentIds: string[],
    options: {
      mode?: SwarmMode;
      leader?: string;
      maxDepth?: number;
      syncIntervalMs?: number;
    } = {}
  ): Promise<SwarmState> {
    await this.ensureInit();

    const now = Date.now();
    const swarm: SwarmState = {
      id,
      name,
      agents: agentIds,
      leader: options.leader,
      activeTasks: new Map(),
      completedTasks: [],
      failedTasks: [],
      sharedContext: '',
      sharedMemory: [],
      mode: options.mode || 'parallel',
      maxDepth: options.maxDepth ?? 3,
      syncIntervalMs: options.syncIntervalMs ?? 5000,
      createdAt: now,
      updatedAt: now,
    };

    const db = await getDb();
    await db.run(
      `INSERT INTO ${TABLE_SWARMS} (id, name, mode, max_depth, sync_interval_ms, shared_context, shared_memory, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        swarm.id,
        swarm.name,
        swarm.mode,
        swarm.maxDepth,
        swarm.syncIntervalMs,
        swarm.sharedContext,
        JSON.stringify(swarm.sharedMemory),
        new Date(swarm.createdAt).toISOString(),
        new Date(swarm.updatedAt).toISOString(),
      ]
    );

    for (const agentId of agentIds) {
      const role = agentId === options.leader ? 'leader' : 'worker';
      await db.run(
        `INSERT OR IGNORE INTO ${TABLE_SWARM_AGENTS} (swarm_id, agent_id, role) VALUES (?, ?, ?)`,
        [id, agentId, role]
      );
    }

    this.swarms.set(id, swarm);
    logger.info({ swarmId: id, name, agents: agentIds.length }, '[StateManager] Swarm created');
    return swarm;
  }

  async deleteSwarm(id: string): Promise<boolean> {
    await this.ensureInit();
    const db = await getDb();
    const result = await db.run(`DELETE FROM ${TABLE_SWARMS} WHERE id = ?`, [id]);
    if (result.changes && result.changes > 0) {
      this.swarms.delete(id);
      logger.info({ swarmId: id }, '[StateManager] Swarm deleted');
      return true;
    }
    return false;
  }

  getSwarm(id: string): SwarmState | undefined {
    return this.swarms.get(id);
  }

  getAllSwarms(): SwarmState[] {
    return Array.from(this.swarms.values());
  }

  // ── 成员管理 ───────────────────────────────

  async addAgentToSwarm(swarmId: string, agentId: string, role: string = 'worker'): Promise<void> {
    await this.ensureInit();
    const swarm = this.swarms.get(swarmId);
    if (!swarm) throw new Error(`Swarm not found: ${swarmId}`);
    if (swarm.agents.includes(agentId)) return;

    swarm.agents.push(agentId);
    swarm.updatedAt = Date.now();

    const db = await getDb();
    await db.run(
      `INSERT OR IGNORE INTO ${TABLE_SWARM_AGENTS} (swarm_id, agent_id, role) VALUES (?, ?, ?)`,
      [swarmId, agentId, role]
    );
    await db.run(
      `UPDATE ${TABLE_SWARMS} SET updated_at = ? WHERE id = ?`,
      [new Date(swarm.updatedAt).toISOString(), swarmId]
    );
  }

  async removeAgentFromSwarm(swarmId: string, agentId: string): Promise<void> {
    await this.ensureInit();
    const swarm = this.swarms.get(swarmId);
    if (!swarm) throw new Error(`Swarm not found: ${swarmId}`);

    swarm.agents = swarm.agents.filter((id) => id !== agentId);
    if (swarm.leader === agentId) swarm.leader = undefined;
    swarm.updatedAt = Date.now();

    const db = await getDb();
    await db.run(`DELETE FROM ${TABLE_SWARM_AGENTS} WHERE swarm_id = ? AND agent_id = ?`, [swarmId, agentId]);
    await db.run(
      `UPDATE ${TABLE_SWARMS} SET updated_at = ? WHERE id = ?`,
      [new Date(swarm.updatedAt).toISOString(), swarmId]
    );
  }

  // ── 任务状态追踪 ───────────────────────────

  async createTask(taskId: string, swarmId: string, agentId: string): Promise<TaskResult> {
    await this.ensureInit();
    const swarm = this.swarms.get(swarmId);
    if (!swarm) throw new Error(`Swarm not found: ${swarmId}`);

    const task: TaskResult = {
      taskId,
      agentId,
      state: 'pending',
      latencyMs: 0,
      createdAt: Date.now(),
    };

    swarm.activeTasks.set(taskId, task);
    swarm.updatedAt = Date.now();

    const db = await getDb();
    await db.run(
      `INSERT INTO ${TABLE_TASKS} (id, swarm_id, agent_id, state, created_at) VALUES (?, ?, ?, ?, ?)`,
      [taskId, swarmId, agentId, 'pending', new Date(task.createdAt).toISOString()]
    );

    return task;
  }

  async updateTaskState(taskId: string, state: TaskState, options: { output?: string; error?: string; latencyMs?: number; tokensUsed?: number } = {}): Promise<void> {
    await this.ensureInit();

    // 更新内存
    for (const swarm of this.swarms.values()) {
      const task = swarm.activeTasks.get(taskId);
      if (!task) continue;

      task.state = state;
      if (options.output !== undefined) task.output = options.output;
      if (options.error !== undefined) task.error = options.error;
      if (options.latencyMs !== undefined) task.latencyMs = options.latencyMs;
      if (options.tokensUsed !== undefined) task.tokensUsed = options.tokensUsed;

      if (state === 'completed' || state === 'failed' || state === 'cancelled') {
        swarm.activeTasks.delete(taskId);
        if (state === 'completed') {
          task.completedAt = Date.now();
          swarm.completedTasks.push(task);
        } else {
          swarm.failedTasks.push({
            taskId: task.taskId,
            agentId: task.agentId,
            error: options.error || 'Unknown error',
            timestamp: Date.now(),
          });
        }
      }
      swarm.updatedAt = Date.now();
      break;
    }

    // 更新数据库
    const db = await getDb();
    const completedAt = (state === 'completed') ? new Date().toISOString() : undefined;
    await db.run(
      `UPDATE ${TABLE_TASKS} SET state = ?, output = ?, error = ?, latency_ms = ?, tokens_used = ?, completed_at = ? WHERE id = ?`,
      [state, options.output ?? null, options.error ?? null, options.latencyMs ?? 0, options.tokensUsed ?? null, completedAt ?? null, taskId]
    );
  }

  getTaskState(taskId: string): TaskResult | undefined {
    for (const swarm of this.swarms.values()) {
      const active = swarm.activeTasks.get(taskId);
      if (active) return active;
      const completed = swarm.completedTasks.find((t) => t.taskId === taskId);
      if (completed) return completed;
    }
    return undefined;
  }

  getSwarmTasks(swarmId: string): { active: TaskResult[]; completed: TaskResult[]; failed: TaskError[] } {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) return { active: [], completed: [], failed: [] };
    return {
      active: Array.from(swarm.activeTasks.values()),
      completed: [...swarm.completedTasks],
      failed: [...swarm.failedTasks],
    };
  }

  // ── 共享上下文同步 ─────────────────────────

  async syncSharedContext(swarmId: string, context: string): Promise<void> {
    await this.ensureInit();
    const swarm = this.swarms.get(swarmId);
    if (!swarm) throw new Error(`Swarm not found: ${swarmId}`);

    swarm.sharedContext = context;
    swarm.updatedAt = Date.now();

    const db = await getDb();
    await db.run(
      `UPDATE ${TABLE_SWARMS} SET shared_context = ?, updated_at = ? WHERE id = ?`,
      [context, new Date(swarm.updatedAt).toISOString(), swarmId]
    );
  }

  async appendSharedMemory(swarmId: string, entry: MemoryEntry): Promise<void> {
    await this.ensureInit();
    const swarm = this.swarms.get(swarmId);
    if (!swarm) throw new Error(`Swarm not found: ${swarmId}`);

    swarm.sharedMemory.push(entry);
    swarm.updatedAt = Date.now();

    const db = await getDb();
    await db.run(
      `UPDATE ${TABLE_SWARMS} SET shared_memory = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(swarm.sharedMemory), new Date(swarm.updatedAt).toISOString(), swarmId]
    );
  }

  getSharedContext(swarmId: string): string {
    return this.swarms.get(swarmId)?.sharedContext ?? '';
  }

  getSharedMemory(swarmId: string): MemoryEntry[] {
    return [...(this.swarms.get(swarmId)?.sharedMemory ?? [])];
  }

  // ── 批量同步 ───────────────────────────────

  async syncAll(): Promise<void> {
    await this.ensureInit();
    const db = await getDb();

    for (const [id, swarm] of this.swarms) {
      await db.run(
        `UPDATE ${TABLE_SWARMS} SET shared_context = ?, shared_memory = ?, updated_at = ? WHERE id = ?`,
        [swarm.sharedContext, JSON.stringify(swarm.sharedMemory), new Date().toISOString(), id]
      );
    }
    logger.info('[StateManager] Full sync completed');
  }

  // ── 内部 ───────────────────────────────────

  private async ensureInit(): Promise<void> {
    if (!this.initialized) await this.init();
  }

  private async loadSwarmFromRow(row: any): Promise<SwarmState> {
    const db = await getDb();

    const agentRows = await db.all(
      `SELECT agent_id, role FROM ${TABLE_SWARM_AGENTS} WHERE swarm_id = ?`,
      [row.id]
    );
    const agents = agentRows.map((r: any) => r.agent_id as string);
    const leaderRow = agentRows.find((r: any) => r.role === 'leader');
    const leader = leaderRow ? leaderRow.agent_id : undefined;

    const taskRows = await db.all(
      `SELECT * FROM ${TABLE_TASKS} WHERE swarm_id = ? ORDER BY created_at DESC`,
      [row.id]
    );

    const activeTasks = new Map<string, TaskResult>();
    const completedTasks: TaskResult[] = [];
    const failedTasks: TaskError[] = [];

    for (const t of taskRows) {
      const task: TaskResult = {
        taskId: t.id,
        agentId: t.agent_id,
        state: t.state,
        output: t.output ?? undefined,
        error: t.error ?? undefined,
        latencyMs: t.latency_ms,
        tokensUsed: t.tokens_used ?? undefined,
        createdAt: new Date(t.created_at).getTime(),
        completedAt: t.completed_at ? new Date(t.completed_at).getTime() : undefined,
      };

      if (t.state === 'pending' || t.state === 'running') {
        activeTasks.set(task.taskId, task);
      } else if (t.state === 'completed') {
        completedTasks.push(task);
      } else {
        failedTasks.push({
          taskId: task.taskId,
          agentId: task.agentId,
          error: task.error || 'Unknown error',
          timestamp: task.completedAt || Date.now(),
        });
      }
    }

    return {
      id: row.id,
      name: row.name,
      agents,
      leader,
      activeTasks,
      completedTasks,
      failedTasks,
      sharedContext: row.shared_context || '',
      sharedMemory: JSON.parse(row.shared_memory || '[]'),
      mode: row.mode,
      maxDepth: row.max_depth,
      syncIntervalMs: row.sync_interval_ms,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }
}
