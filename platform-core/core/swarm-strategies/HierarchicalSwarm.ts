/**
 * HierarchicalSwarm.ts — Supervisor-Worker 层级调度策略
 *
 * 来源: swarms (kyegomez/swarms)
 * 特点: Supervisor 管理 Worker 队列，动态任务分发与结果聚合
 *        支持 Worker 池动态扩容/缩容，任务优先级队列
 *
 * 设计参考: Kubernetes Deployment + HPA, Celery Worker Pool
 */

import { logger } from "../utils/logger";
import {
  BaseExecutionMode,
  type AgentRegistration,
  type AgentResult,
  type ExecutionContext,
  type TaskRequest,
  type TaskResult,
  type SwarmMode,
  invokeAgent,
  isAgentAvailable,
  buildTaskResult,
  saveCheckpoint,
  type CheckpointData,
} from "../coordinator/modes/types";

// ─── 类型定义 ───

export type HierarchicalSwarmState =
  | "idle"
  | "supervisor_electing"
  | "queue_building"
  | "dispatching"
  | "workers_executing"
  | "supervisor_aggregating"
  | "completed"
  | "failed"
  | "paused"
  | "stopped";

export interface WorkerQueueItem {
  id: string;
  taskDescription: string;
  priority: number; // 1-10, 越大越优先
  assignedWorkerId?: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
  retryCount: number;
  maxRetries: number;
}

export interface HierarchicalSwarmConfig {
  /** Supervisor 选举策略 */
  supervisorStrategy: "static" | "round_robin" | "capability_based" | "health_based";
  /** Worker 池大小限制 */
  maxWorkers: number;
  /** 任务队列最大长度 */
  maxQueueSize: number;
  /** 自动重试次数 */
  maxRetries: number;
  /** 聚合策略 */
  aggregationStrategy: "concat" | "summarize" | "vote" | "merge";
  /** 是否允许 Worker 失败后替换 */
  enableWorkerReplacement: boolean;
  /** 检查点间隔（毫秒） */
  checkpointIntervalMs: number;
}

// ─── 状态机 ───

interface StateMachine {
  current: HierarchicalSwarmState;
  transitions: Map<HierarchicalSwarmState, HierarchicalSwarmState[]>;
}

const hierarchicalSwarmStateMachine: StateMachine = {
  current: "idle",
  transitions: new Map([
    ["idle", ["supervisor_electing"]],
    ["supervisor_electing", ["queue_building", "failed"]],
    ["queue_building", ["dispatching", "failed"]],
    ["dispatching", ["workers_executing", "supervisor_aggregating", "failed"]],
    ["workers_executing", ["supervisor_aggregating", "dispatching", "failed", "paused"]],
    ["supervisor_aggregating", ["completed", "failed", "dispatching"]],
    ["completed", []],
    ["failed", ["idle"]],
    ["paused", ["workers_executing", "stopped"]],
    ["stopped", ["idle"]],
  ]),
};

function canTransition(
  from: HierarchicalSwarmState,
  to: HierarchicalSwarmState
): boolean {
  const allowed = hierarchicalSwarmStateMachine.transitions.get(from);
  return allowed?.includes(to) ?? false;
}

// ─── 默认配置 ───

const DEFAULT_CONFIG: HierarchicalSwarmConfig = {
  supervisorStrategy: "capability_based",
  maxWorkers: 10,
  maxQueueSize: 100,
  maxRetries: 2,
  aggregationStrategy: "summarize",
  enableWorkerReplacement: true,
  checkpointIntervalMs: 30000,
};

// ─── HierarchicalSwarm 策略实现 ───

export class HierarchicalSwarm extends BaseExecutionMode {
  readonly mode: SwarmMode = "hierarchical-swarm" as SwarmMode;

  private config: HierarchicalSwarmConfig;
  private taskQueue: WorkerQueueItem[] = [];
  private supervisor: AgentRegistration | null = null;
  private workers: AgentRegistration[] = [];
  private stateMachine: StateMachine;
  private lastCheckpoint: CheckpointData | null = null;
  private checkpointTimer: NodeJS.Timeout | null = null;
  private swarmState: HierarchicalSwarmState = "idle";

  constructor(config?: Partial<HierarchicalSwarmConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stateMachine = { ...hierarchicalSwarmStateMachine, current: "idle" };
  }

  get swarmStateInternal(): HierarchicalSwarmState {
    return this.swarmState;
  }

  private transitionState(to: HierarchicalSwarmState): void {
    if (canTransition(this.swarmState, to)) {
      const from = this.swarmState;
      this.swarmState = to;
      this.stateMachine.current = to;
      logger.info(
        { from, to, taskId: this.currentTaskId },
        "HierarchicalSwarm state transition"
      );
    } else {
      logger.warn(
        { from: this.swarmState, to },
        "HierarchicalSwarm: illegal state transition attempted"
      );
    }
  }

  async execute(
    task: TaskRequest,
    agents: AgentRegistration[],
    context: ExecutionContext
  ): Promise<TaskResult> {
    const startTime = Date.now();
    this._state = "running";
    this.currentTaskId = task.id;
    this.taskQueue = [];
    this.workers = [];

    const abortCtrl = this.createAbortController();
    const signal = abortCtrl.signal;

    // ─── 1. Supervisor 选举 ───
    this.transitionState("supervisor_electing");
    this.supervisor = this.electSupervisor(agents);
    if (!this.supervisor) {
      this.transitionState("failed");
      this._state = "failed";
      return buildTaskResult(
        task.id,
        [],
        "",
        "failed",
        "hierarchical-swarm-no-supervisor",
        { startedAt: startTime }
      );
    }

    // ─── 2. 组建 Worker 池 ───
    this.workers = agents.filter(
      (a) => a.id !== this.supervisor!.id && isAgentAvailable(a)
    );
    if (this.workers.length === 0) {
      // 降级：Supervisor 自己作为唯一 Worker
      logger.warn(
        { taskId: task.id },
        "HierarchicalSwarm: no workers available, supervisor will handle alone"
      );
      this.workers = [this.supervisor];
    }

    // 限制 Worker 数量
    if (this.workers.length > this.config.maxWorkers) {
      this.workers = this.workers.slice(0, this.config.maxWorkers);
    }

    // ─── 3. Supervisor 分解任务并构建队列 ───
    this.transitionState("queue_building");

    const queueItems = await this.buildTaskQueue(
      this.supervisor,
      task,
      this.workers,
      signal
    );
    this.taskQueue = queueItems;

    if (this.taskQueue.length === 0) {
      logger.warn({ taskId: task.id }, "HierarchicalSwarm: empty task queue");
      this.transitionState("failed");
      this._state = "failed";
      return buildTaskResult(task.id, [], "", "failed", "hierarchical-swarm-empty-queue", {
        startedAt: startTime,
      });
    }

    // ─── 4. 启动检查点定时器 ───
    this.startCheckpointTimer(context);

    // ─── 5. 主调度循环 ───
    this.transitionState("dispatching");
    const allAgentResults: AgentResult[] = [];
    let iteration = 0;
    const maxIterations = this.taskQueue.length * (this.config.maxRetries + 1);

    while (
      this.hasPendingTasks() &&
      !this.isAborted() &&
      iteration < maxIterations
    ) {
      await this.checkPaused();
      iteration++;

      // 获取下一个待处理任务
      const queueItem = this.getNextPendingTask();
      if (!queueItem) break;

      // 分发给 Worker
      this.transitionState("workers_executing");
      const worker = this.selectWorker(queueItem, this.workers);
      queueItem.assignedWorkerId = worker.id;
      queueItem.status = "running";

      logger.info(
        {
          taskId: task.id,
          queueItemId: queueItem.id,
          workerId: worker.id,
          iteration,
        },
        "HierarchicalSwarm: dispatching task to worker"
      );

      const result = await invokeAgent(
        worker,
        task,
        queueItem.taskDescription,
        signal,
        task.maxLatencyMs
      );

      // 记录 Agent 结果
      allAgentResults.push(result);

      if (result.status === "success") {
        queueItem.status = "completed";
        queueItem.result = result.output;
        logger.info(
          { taskId: task.id, queueItemId: queueItem.id },
          "HierarchicalSwarm: task completed"
        );
      } else {
        queueItem.status = "failed";
        queueItem.error = result.error;
        queueItem.retryCount++;

        if (queueItem.retryCount <= queueItem.maxRetries) {
          // 重试：重新放入队列
          queueItem.status = "pending";
          queueItem.assignedWorkerId = undefined;
          logger.info(
            {
              taskId: task.id,
              queueItemId: queueItem.id,
              retryCount: queueItem.retryCount,
            },
            "HierarchicalSwarm: retrying failed task"
          );

          // Worker 替换
          if (this.config.enableWorkerReplacement) {
            this.replaceWorker(worker);
          }
        } else {
          logger.warn(
            {
              taskId: task.id,
              queueItemId: queueItem.id,
              retries: queueItem.maxRetries,
            },
            "HierarchicalSwarm: task exhausted all retries"
          );
        }
      }

      task.onProgress?.(
        `[HierarchicalSwarm] ${queueItem.id} → ${worker.name}: ${result.status}`
      );
    }

    // 停止检查点定时器
    this.stopCheckpointTimer();

    if (this.isAborted()) {
      this.transitionState("stopped");
      this._state = "stopped";
      return buildTaskResult(
        task.id,
        allAgentResults,
        "",
        "failed",
        "hierarchical-swarm-stopped",
        { startedAt: startTime }
      );
    }

    // ─── 6. Supervisor 聚合结果 ───
    this.transitionState("supervisor_aggregating");

    const successfulTasks = this.taskQueue.filter((q) => q.status === "completed");
    const failedTasks = this.taskQueue.filter((q) => q.status === "failed");

    logger.info(
      {
        taskId: task.id,
        successCount: successfulTasks.length,
        failCount: failedTasks.length,
      },
      "HierarchicalSwarm: supervisor aggregating results"
    );

    const finalOutput = await this.aggregateResults(
      this.supervisor,
      task,
      successfulTasks,
      failedTasks,
      signal
    );

    // ─── 7. 构建最终结果 ───
    const finalStatus: "success" | "partial" | "failed" =
      failedTasks.length === 0
        ? "success"
        : successfulTasks.length > 0
          ? "partial"
          : "failed";

    this.transitionState(finalStatus === "success" ? "completed" : "failed");
    this._state = finalStatus === "success" ? "completed" : finalStatus;

    const taskResult = buildTaskResult(
      task.id,
      allAgentResults,
      finalOutput,
      finalStatus,
      "hierarchical-swarm",
      {
        startedAt: startTime,
        subTasks: successfulTasks.map((t) => ({
          subTaskId: t.id,
          description: t.taskDescription,
          assignedAgentId: t.assignedWorkerId || "",
          status: "success" as const,
          output: t.result || "",
        })),
      }
    );

    task.onComplete?.(taskResult);
    return taskResult;
  }

  // ─── Supervisor 选举 ───

  private electSupervisor(agents: AgentRegistration[]): AgentRegistration | null {
    const available = agents.filter(isAgentAvailable);
    if (available.length === 0) return null;

    switch (this.config.supervisorStrategy) {
      case "static":
        // 优先选择 role=leader 的 Agent
        return available.find((a) => a.role === "leader") || available[0];

      case "round_robin":
        // 轮询选择（基于时间戳的简单实现）
        const index = Math.floor(Date.now() / 60000) % available.length;
        return available[index];

      case "capability_based":
        // 选择能力评分最高的 Agent
        return available.reduce((best, current) => {
          const bestScore = best.capabilities.length + best.skills.length;
          const currentScore = current.capabilities.length + current.skills.length;
          return currentScore > bestScore ? current : best;
        });

      case "health_based":
        // 选择最健康的 Agent
        return available.reduce((best, current) => {
          const healthOrder = { healthy: 0, degraded: 1, unhealthy: 2 };
          return healthOrder[current.health] < healthOrder[best.health]
            ? current
            : best;
        });

      default:
        return available[0];
    }
  }

  // ─── 构建任务队列 ───

  private async buildTaskQueue(
    supervisor: AgentRegistration,
    task: TaskRequest,
    workers: AgentRegistration[],
    signal: AbortSignal
  ): Promise<WorkerQueueItem[]> {
    const decompositionPrompt = `You are a swarm supervisor. Decompose the following task into independent sub-tasks for ${workers.length} workers.

Original Task: ${task.prompt}

Available Workers: ${workers.map((w) => `${w.name} (skills: ${w.skills.join(", ")})`).join("\n")}

Please respond with a JSON array in this exact format:
[
  { "id": "task-1", "description": "detailed sub-task description", "priority": 5 },
  ...
]

Priority range: 1-10 (10 = highest). Each sub-task should be self-contained and executable in parallel.`;

    const result = await invokeAgent(
      supervisor,
      task,
      decompositionPrompt,
      signal,
      task.maxLatencyMs
    );

    let items: WorkerQueueItem[] = [];
    try {
      const jsonMatch = result.output.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        items = parsed.map((item: any) => ({
          id: item.id || `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          taskDescription: item.description,
          priority: Math.min(Math.max(item.priority || 5, 1), 10),
          status: "pending" as const,
          retryCount: 0,
          maxRetries: this.config.maxRetries,
        }));
      }
    } catch (e) {
      logger.warn(
        { taskId: task.id, error: (e as Error).message },
        "HierarchicalSwarm: failed to parse task decomposition, using fallback"
      );
    }

    // Fallback: 简单均分
    if (items.length === 0) {
      items = workers.map((w, i) => ({
        id: `task-${i + 1}`,
        taskDescription: `Part ${i + 1} of: ${task.prompt}`,
        priority: 5,
        status: "pending" as const,
        retryCount: 0,
        maxRetries: this.config.maxRetries,
      }));
    }

    // 按优先级排序（高优先级在前）
    items.sort((a, b) => b.priority - a.priority);

    // 限制队列大小
    if (items.length > this.config.maxQueueSize) {
      items = items.slice(0, this.config.maxQueueSize);
    }

    return items;
  }

  // ─── Worker 选择 ───

  private selectWorker(
    queueItem: WorkerQueueItem,
    workers: AgentRegistration[]
  ): AgentRegistration {
    // 选择负载最低的 Worker
    return workers.reduce((best, current) => {
      const bestLoad = this.getWorkerLoad(best.id);
      const currentLoad = this.getWorkerLoad(current.id);
      return currentLoad < bestLoad ? current : best;
    });
  }

  private getWorkerLoad(workerId: string): number {
    const runningTasks = this.taskQueue.filter(
      (q) => q.assignedWorkerId === workerId && q.status === "running"
    ).length;
    const completedTasks = this.taskQueue.filter(
      (q) => q.assignedWorkerId === workerId && q.status === "completed"
    ).length;
    const failedTasks = this.taskQueue.filter(
      (q) => q.assignedWorkerId === workerId && q.status === "failed"
    ).length;
    // 负载 = 运行中 * 2 + 失败 * 1 - 完成 * 0.5
    return runningTasks * 2 + failedTasks * 1 - completedTasks * 0.5;
  }

  // ─── Worker 替换 ───

  private replaceWorker(failedWorker: AgentRegistration): void {
    // 从 workers 池中移除失败的 Worker
    this.workers = this.workers.filter((w) => w.id !== failedWorker.id);
    logger.info(
      { failedWorkerId: failedWorker.id, remainingWorkers: this.workers.length },
      "HierarchicalSwarm: removed failed worker"
    );
  }

  // ─── 结果聚合 ───

  private async aggregateResults(
    supervisor: AgentRegistration,
    task: TaskRequest,
    successfulTasks: WorkerQueueItem[],
    failedTasks: WorkerQueueItem[],
    signal: AbortSignal
  ): Promise<string> {
    if (successfulTasks.length === 0) {
      return `All tasks failed. Errors:\n${failedTasks.map((t) => `[${t.id}] ${t.error}`).join("\n")}`;
    }

    const aggregationPrompt = `You are the swarm supervisor. Your workers have completed their sub-tasks.
Please synthesize the results into a coherent final output.

Original Task: ${task.prompt}

Completed Sub-tasks (${successfulTasks.length}):
${successfulTasks
  .map((t) => `[${t.id}] Priority ${t.priority}:\n${t.result}`)
  .join("\n\n")}

${
  failedTasks.length > 0
    ? `Failed Sub-tasks (${failedTasks.length}):\n${failedTasks
        .map((t) => `[${t.id}] Error: ${t.error}`)
        .join("\n")}`
    : ""
}

Provide a comprehensive final answer. Note any gaps if some sub-tasks failed.`;

    const result = await invokeAgent(
      supervisor,
      task,
      aggregationPrompt,
      signal,
      task.maxLatencyMs
    );

    return result.output;
  }

  // ─── 检查点管理 ───

  private startCheckpointTimer(context: ExecutionContext): void {
    if (this.checkpointTimer) return;
    this.checkpointTimer = setInterval(() => {
      this.lastCheckpoint = saveCheckpoint(context, {
        taskId: this.currentTaskId || "",
        completedAgentIds: this.taskQueue
          .filter((q) => q.status === "completed")
          .map((q) => q.assignedWorkerId || ""),
        lastOutput: JSON.stringify(this.taskQueue),
        stateSnapshot: {
          queue: this.taskQueue,
          supervisorId: this.supervisor?.id,
          swarmState: this.swarmState,
        },
      });
    }, this.config.checkpointIntervalMs);
  }

  private stopCheckpointTimer(): void {
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer);
      this.checkpointTimer = null;
    }
  }

  // ─── 队列操作 ───

  private hasPendingTasks(): boolean {
    return this.taskQueue.some((q) => q.status === "pending" || q.status === "running");
  }

  private getNextPendingTask(): WorkerQueueItem | undefined {
    return this.taskQueue.find((q) => q.status === "pending");
  }

  // ─── 生命周期管理 ───

  override async pause(): Promise<void> {
    if (this.swarmState === "workers_executing") {
      this.transitionState("paused");
    }
    await super.pause();
  }

  override async resume(): Promise<void> {
    if (this.swarmState === "paused") {
      this.transitionState("workers_executing");
    }
    await super.resume();
  }

  override async stop(): Promise<void> {
    this.transitionState("stopped");
    this.stopCheckpointTimer();
    this.taskQueue = [];
    this.supervisor = null;
    this.workers = [];
    await super.stop();
  }

  /** 获取当前队列状态（用于监控） */
  getQueueStatus(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
  } {
    return {
      total: this.taskQueue.length,
      pending: this.taskQueue.filter((q) => q.status === "pending").length,
      running: this.taskQueue.filter((q) => q.status === "running").length,
      completed: this.taskQueue.filter((q) => q.status === "completed").length,
      failed: this.taskQueue.filter((q) => q.status === "failed").length,
    };
  }

  /** 获取当前 Supervisor */
  getSupervisor(): AgentRegistration | null {
    return this.supervisor;
  }

  /** 获取活跃 Worker 列表 */
  getActiveWorkers(): AgentRegistration[] {
    return [...this.workers];
  }
}
