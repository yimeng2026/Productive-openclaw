// AgentSwarm — Hermes Mind 内部多 Agent 协作调度器
// 突破 OpenClaw 5-slot 限制：1 个 Hermes 引擎 slot = N 个逻辑 Agent

import { EventBus, EngineEvent } from '@sylva/orchestrator';

export type EventListener = (event: EngineEvent) => void | Promise<void>;

export interface SwarmAgent {
  id: string;
  name: string;
  role: AgentRole;
  status: AgentStatus;
  priority: number; // 0-100
  taskQueue: SwarmTask[];
  capabilities: string[];
  memoryBuffer: unknown[];
  maxConcurrentTasks: number;
}

export type AgentRole =
  | 'scanner'      // MemoryScanner 型：扫描/提取模式
  | 'prover'       // Lean 证明型：形式化推导
  | 'writer'       // 论文撰写型：内容生成
  | 'reviewer'     // 审稿型：质量检查
  | 'optimizer'    // 优化型：代码/架构改进
  | 'researcher'   // 研究型：信息检索/分析
  | 'coordinator'  // 协调型：任务分配/同步
  | 'specialist';  // 专家型：特定领域深度任务

export type AgentStatus =
  | 'idle'
  | 'working'
  | 'paused'
  | 'error'
  | 'garbage_collected';

export interface SwarmTask {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  priority: number;
  assignedAgent?: string;
  createdAt: Date;
  deadline?: Date;
  dependencies: string[]; // 依赖的其他任务 ID
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
  result?: unknown;
  error?: string;
}

export interface SwarmConfig {
  maxAgents: number;
  maxTasksPerAgent: number;
  autoScale: boolean;
  gcIntervalMs: number;
  taskTimeoutMs: number;
  enableInterAgentMessaging: boolean;
}

export const DEFAULT_SWARM_CONFIG: SwarmConfig = {
  maxAgents: 20,         // 默认 20 个逻辑 Agent
  maxTasksPerAgent: 5,   // 每个 Agent 最多 5 个并发任务
  autoScale: true,       // 自动扩缩容
  gcIntervalMs: 60000,   // 60 秒 GC 一次
  taskTimeoutMs: 300000, // 5 分钟超时
  enableInterAgentMessaging: true,
};

/**
 * AgentSwarm — 内部多 Agent 协作调度器
 *
 * 设计理念：
 *   - 1 个 Hermes Mind 引擎 = 1 个 OpenClaw slot
 *   - 但内部可以孵化 N 个逻辑 Agent（默认 20，可配）
 *   - 这些逻辑 Agent 通过 EventBus 通信，不依赖外部 sessions_spawn
 *   - 自动扩缩容：忙时新增，闲时回收
 *   - 任务依赖图：自动处理任务间的依赖关系
 */
export class AgentSwarm {
  private agents: Map<string, SwarmAgent> = new Map();
  private tasks: Map<string, SwarmTask> = new Map();
  private config: SwarmConfig;
  private eventBus: EventBus;
  private gcTimer?: ReturnType<typeof setInterval>;
  private taskCounter = 0;
  private agentCounter = 0;

  constructor(eventBus: EventBus, config?: Partial<SwarmConfig>) {
    this.eventBus = eventBus;
    this.config = { ...DEFAULT_SWARM_CONFIG, ...config };
    this.startGC();
  }

  // ─────────────────────────────────────────────
  // Agent 生命周期
  // ─────────────────────────────────────────────

  /**
   * 孵化新 Agent
   */
  spawnAgent(role: AgentRole, name?: string, capabilities?: string[]): SwarmAgent {
    if (this.agents.size >= this.config.maxAgents) {
      // 自动回收 idle Agent 腾出位置
      this.gcIdleAgents(1);
    }

    this.agentCounter++;
    const agent: SwarmAgent = {
      id: `agent-${role}-${this.agentCounter}-${Date.now()}`,
      name: name ?? `${role}-${this.agentCounter}`,
      role,
      status: 'idle',
      priority: 50,
      taskQueue: [],
      capabilities: capabilities ?? this.defaultCapabilities(role),
      memoryBuffer: [],
      maxConcurrentTasks: this.config.maxTasksPerAgent,
    };

    this.agents.set(agent.id, agent);

    this.eventBus.emit({
      type: 'swarm:agent:spawned',
      engine: 'hermes-mind',
      timestamp: new Date(),
      payload: { agentId: agent.id, role, name: agent.name },
    });

    return agent;
  }

  /**
   * 销毁 Agent
   */
  killAgent(agentId: string, force = false): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    if (agent.status === 'working' && !force) {
      return false; // 工作中的 Agent 不强制杀
    }

    // 将未完成任务放回待分配队列
    for (const task of agent.taskQueue) {
      if (task.status === 'running') {
        task.status = 'pending';
        task.assignedAgent = undefined;
      }
    }

    agent.status = 'garbage_collected';
    this.agents.delete(agentId);

    this.eventBus.emit({
      type: 'swarm:agent:killed',
      engine: 'hermes-mind',
      timestamp: new Date(),
      payload: { agentId, force, reassignedTasks: agent.taskQueue.length },
    });

    return true;
  }

  // ─────────────────────────────────────────────
  // 任务调度
  // ─────────────────────────────────────────────

  /**
   * 提交任务到 Swarm
   */
  submitTask(
    type: string,
    payload: Record<string, unknown>,
    options?: {
      priority?: number;
      deadline?: Date;
      dependencies?: string[];
      preferredRole?: AgentRole;
    }
  ): SwarmTask {
    this.taskCounter++;
    const task: SwarmTask = {
      id: `task-${this.taskCounter}-${Date.now()}`,
      type,
      payload,
      priority: options?.priority ?? 50,
      createdAt: new Date(),
      deadline: options?.deadline,
      dependencies: options?.dependencies ?? [],
      status: 'pending',
    };

    this.tasks.set(task.id, task);

    // 检查依赖是否已满足
    if (task.dependencies.length > 0) {
      const allDepsDone = task.dependencies.every((depId) => {
        const dep = this.tasks.get(depId);
        return dep?.status === 'completed';
      });
      if (!allDepsDone) {
        task.status = 'blocked';
      }
    }

    // 自动分配或排队
    if (task.status !== 'blocked') {
      this.scheduleTask(task);
    }

    return task;
  }

  /**
   * 任务调度算法：最优 Agent 匹配
   */
  private scheduleTask(task: SwarmTask): boolean {
    const candidates = Array.from(this.agents.values()).filter((agent) => {
      // 状态可用
      if (agent.status === 'error' || agent.status === 'garbage_collected') return false;
      // 未达并发上限
      const runningCount = agent.taskQueue.filter((t) => t.status === 'running').length;
      if (runningCount >= agent.maxConcurrentTasks) return false;
      // 能力匹配（如果有要求）
      if (task.payload.requiredCapabilities) {
        const reqs = task.payload.requiredCapabilities as string[];
        return reqs.every((cap) => agent.capabilities.includes(cap));
      }
      return true;
    });

    if (candidates.length === 0) {
      // 无可用 Agent：自动扩容
      if (this.config.autoScale && this.agents.size < this.config.maxAgents) {
        const newAgent = this.spawnAgent(
          (task.payload.preferredRole as AgentRole) ?? 'specialist',
          `auto-${task.type}`,
          (task.payload.requiredCapabilities as string[]) ?? []
        );
        return this.assignTaskToAgent(task, newAgent);
      }
      return false; // 保持 pending，等待 GC 或手动扩容
    }

    // 评分选最优：负载低 + 优先级匹配 + 能力重叠度高
    candidates.sort((a, b) => {
      const aLoad = a.taskQueue.filter((t) => t.status === 'running').length;
      const bLoad = b.taskQueue.filter((t) => t.status === 'running').length;
      if (aLoad !== bLoad) return aLoad - bLoad; // 负载轻优先

      // 角色匹配度
      const aRoleMatch = a.role === (task.payload.preferredRole as AgentRole) ? 1 : 0;
      const bRoleMatch = b.role === (task.payload.preferredRole as AgentRole) ? 1 : 0;
      return bRoleMatch - aRoleMatch;
    });

    return this.assignTaskToAgent(task, candidates[0]);
  }

  private assignTaskToAgent(task: SwarmTask, agent: SwarmAgent): boolean {
    task.assignedAgent = agent.id;
    task.status = 'running';
    agent.taskQueue.push(task);
    agent.status = 'working';

    this.eventBus.emit({
      type: 'swarm:task:assigned',
      engine: 'hermes-mind',
      timestamp: new Date(),
      payload: { taskId: task.id, agentId: agent.id, agentRole: agent.role },
    });

    return true;
  }

  /**
   * 报告任务完成
   */
  completeTask(taskId: string, result: unknown, error?: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.result = result;
    task.error = error;
    task.status = error ? 'failed' : 'completed';

    // 释放 Agent
    if (task.assignedAgent) {
      const agent = this.agents.get(task.assignedAgent);
      if (agent) {
        agent.taskQueue = agent.taskQueue.filter((t) => t.id !== taskId);
        if (agent.taskQueue.length === 0) {
          agent.status = 'idle';
        }
      }
    }

    this.eventBus.emit({
      type: 'swarm:task:completed',
      engine: 'hermes-mind',
      timestamp: new Date(),
      payload: { taskId, success: !error, error },
    });

    // 检查是否有被阻塞的任务现在可以运行
    this.unblockTasks();
  }

  /**
   * 检查依赖完成，解阻塞任务
   */
  private unblockTasks(): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'blocked') {
        const allDepsDone = task.dependencies.every((depId) => {
          const dep = this.tasks.get(depId);
          return dep?.status === 'completed';
        });
        if (allDepsDone) {
          task.status = 'pending';
          this.scheduleTask(task);
        }
      }
    }
  }

  // ─────────────────────────────────────────────
  // Agent 间通信
  // ─────────────────────────────────────────────

  /**
   * Agent 间消息传递
   */
  sendMessage(fromAgentId: string, toAgentId: string, message: unknown): void {
    if (!this.config.enableInterAgentMessaging) return;

    const from = this.agents.get(fromAgentId);
    const to = this.agents.get(toAgentId);
    if (!from || !to) return;

    // 目标 Agent 放入 memory buffer
    to.memoryBuffer.push({
      from: fromAgentId,
      role: from.role,
      timestamp: new Date(),
      content: message,
    });

    this.eventBus.emit({
      type: 'swarm:agent:message',
      engine: 'hermes-mind',
      timestamp: new Date(),
      payload: { from: fromAgentId, to: toAgentId, message },
    });
  }

  /**
   * 广播消息到所有同角色 Agent
   */
  broadcastToRole(role: AgentRole, fromAgentId: string, message: unknown): void {
    for (const agent of this.agents.values()) {
      if (agent.role === role && agent.id !== fromAgentId) {
        this.sendMessage(fromAgentId, agent.id, message);
      }
    }
  }

  // ─────────────────────────────────────────────
  // 自动扩缩容 & GC
  // ─────────────────────────────────────────────

  private startGC(): void {
    if (this.gcTimer) return;
    this.gcTimer = setInterval(() => {
      this.gcIdleAgents();
      this.gcCompletedTasks();
    }, this.config.gcIntervalMs);
  }

  /**
   * 回收 idle Agent
   */
  private gcIdleAgents(targetCount = 0): number {
    const idleAgents = Array.from(this.agents.values()).filter(
      (a) => a.status === 'idle' && a.taskQueue.length === 0
    );

    let killed = 0;
    // 保留至少 2 个 idle Agent 作为缓冲
    const toKill = idleAgents.slice(0, Math.max(0, idleAgents.length - 2));
    for (const agent of toKill) {
      if (targetCount > 0 && killed >= targetCount) break;
      this.killAgent(agent.id);
      killed++;
    }

    return killed;
  }

  /**
   * 清理已完成/失败的任务
   */
  private gcCompletedTasks(): number {
    let cleaned = 0;
    for (const [id, task] of this.tasks) {
      if (task.status === 'completed' || task.status === 'failed') {
        // 保留 10 分钟内的结果，之后清理
        const ageMs = Date.now() - task.createdAt.getTime();
        if (ageMs > 600000) {
          this.tasks.delete(id);
          cleaned++;
        }
      }
    }
    return cleaned;
  }

  // ─────────────────────────────────────────────
  // 查询 & 统计
  // ─────────────────────────────────────────────

  getStats(): {
    agentCount: number;
    idleAgents: number;
    workingAgents: number;
    totalTasks: number;
    pendingTasks: number;
    runningTasks: number;
    completedTasks: number;
    failedTasks: number;
  } {
    const allAgents = Array.from(this.agents.values());
    const allTasks = Array.from(this.tasks.values());

    return {
      agentCount: allAgents.length,
      idleAgents: allAgents.filter((a) => a.status === 'idle').length,
      workingAgents: allAgents.filter((a) => a.status === 'working').length,
      totalTasks: allTasks.length,
      pendingTasks: allTasks.filter((t) => t.status === 'pending').length,
      runningTasks: allTasks.filter((t) => t.status === 'running').length,
      completedTasks: allTasks.filter((t) => t.status === 'completed').length,
      failedTasks: allTasks.filter((t) => t.status === 'failed').length,
    };
  }

  getAgentStatus(agentId: string): SwarmAgent | undefined {
    return this.agents.get(agentId);
  }

  getTaskStatus(taskId: string): SwarmTask | undefined {
    return this.tasks.get(taskId);
  }

  getAllAgents(): SwarmAgent[] {
    return Array.from(this.agents.values());
  }

  getAllTasks(): SwarmTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 销毁整个 Swarm
   */
  destroy(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
    }
    // 强制清理所有 Agent
    for (const agentId of this.agents.keys()) {
      this.killAgent(agentId, true);
    }
    this.agents.clear();
    this.tasks.clear();
  }

  // ─────────────────────────────────────────────
  // 内部工具
  // ─────────────────────────────────────────────

  private defaultCapabilities(role: AgentRole): string[] {
    const map: Record<AgentRole, string[]> = {
      scanner: ['memory:scan', 'pattern:extract', 'text:analyze'],
      prover: ['lean:prove', 'math:verify', 'logic:deduce'],
      writer: ['content:generate', 'doc:write', 'markdown:render'],
      reviewer: ['quality:check', 'bug:detect', 'style:lint'],
      optimizer: ['code:optimize', 'perf:benchmark', 'arch:improve'],
      researcher: ['web:search', 'data:analyze', 'paper:read'],
      coordinator: ['task:schedule', 'agent:sync', 'conflict:resolve'],
      specialist: ['domain:expert', 'deep:dive', 'custom:solve'],
    };
    return map[role] ?? ['general:task'];
  }
}
