import { logger } from "../../utils/logger";
import {
  BaseExecutionMode,
  type AgentRegistration,
  type AgentResult,
  type ExecutionContext,
  type SubTaskResult,
  type TaskRequest,
  type TaskResult,
  invokeAgent,
  isAgentAvailable,
  buildTaskResult,
  type SwarmMode,
} from "./types";

/**
 * HierarchicalMode — 层级执行模式
 *
 * Leader Agent 接收任务 → 分解为子任务
 * 分发子任务给 Worker Agents
 * Workers 并行执行
 * Leader 聚合结果并输出
 * 支持递归嵌套（Leader 可以是另一个 Swarm）
 *
 * 设计参考: Master-Worker pattern, Kubernetes Job controller
 */
export class HierarchicalMode extends BaseExecutionMode {
  readonly mode: SwarmMode = "hierarchical";

  private subTaskResults: SubTaskResult[] = [];
  private currentDepth = 0;

  async execute(
    task: TaskRequest,
    agents: AgentRegistration[],
    context: ExecutionContext
  ): Promise<TaskResult> {
    const startTime = Date.now();
    this._state = "running";
    this.currentTaskId = task.id;
    this.subTaskResults = [];
    this.currentDepth = 0;

    const abortCtrl = this.createAbortController();
    const signal = abortCtrl.signal;
    const maxDepth = task.maxDepth ?? 3;

    // ─── 1. 识别 Leader 和 Workers ───
    const leader = agents.find((a) => a.role === "leader" && isAgentAvailable(a));
    const workers = agents.filter((a) => a.role === "worker" && isAgentAvailable(a));

    if (!leader) {
      logger.warn({ taskId: task.id }, "Hierarchical mode: no leader agent found");
      // 降级：选择第一个可用 Agent 作为临时 Leader
      const fallbackLeader = agents.find(isAgentAvailable);
      if (!fallbackLeader) {
        this._state = "failed";
        return buildTaskResult(
          task.id,
          [],
          "",
          "failed",
          "hierarchical-no-leader",
          { startedAt: startTime }
        );
      }
      logger.info(
        { taskId: task.id, fallbackLeader: fallbackLeader.id },
        "Hierarchical mode: using fallback leader"
      );
      return this.executeWithLeader(
        fallbackLeader,
        workers.length > 0 ? workers : [fallbackLeader],
        task,
        context,
        signal,
        startTime,
        maxDepth
      );
    }

    return this.executeWithLeader(
      leader,
      workers,
      task,
      context,
      signal,
      startTime,
      maxDepth
    );
  }

  /**
   * 使用 Leader 执行层级任务
   */
  private async executeWithLeader(
    leader: AgentRegistration,
    workers: AgentRegistration[],
    task: TaskRequest,
    context: ExecutionContext,
    signal: AbortSignal,
    startTime: number,
    maxDepth: number
  ): Promise<TaskResult> {
    // ─── 2. Leader 分解任务 ───
    await this.checkPaused();
    if (this.isAborted()) {
      this._state = "stopped";
      return buildTaskResult(task.id, [], "", "failed", "hierarchical-stopped", { startedAt: startTime });
    }

    logger.info(
      { taskId: task.id, leader: leader.id, workerCount: workers.length },
      "Hierarchical mode: leader decomposing task"
    );

    const decompositionPrompt = `You are the leader of a swarm. Decompose the following task into ${workers.length || 1} sub-tasks for your workers.

Original Task: ${task.prompt}

Available Workers: ${workers.map((w) => w.name).join(", ") || "self"}

Please respond with a JSON array of sub-tasks in this format:
[
  { "id": "sub-1", "description": "description of sub-task 1", "assignedTo": "worker-name-or-id" },
  ...
]

Make sure each sub-task is clear, independent, and can be executed in parallel.`;

    const decompositionResult = await invokeAgent(
      leader,
      task,
      decompositionPrompt,
      signal,
      task.maxLatencyMs
    );

    let subTasks: SubTaskResult[] = [];
    try {
      // 尝试从 Leader 输出中提取 JSON
      const jsonMatch = decompositionResult.output.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        subTasks = JSON.parse(jsonMatch[0]).map((st: any) => ({
          subTaskId: st.id || `sub-${Date.now()}`,
          description: st.description,
          assignedAgentId: st.assignedTo || "",
          status: "pending" as const,
          output: "",
        }));
      }
    } catch (e) {
      logger.warn(
        { taskId: task.id, error: (e as Error).message },
        "Hierarchical mode: failed to parse sub-tasks, using fallback"
      );
    }

    // 如果解析失败，使用简单均分
    if (subTasks.length === 0) {
      const targetWorkers = workers.length > 0 ? workers : [leader];
      subTasks = targetWorkers.map((w, i) => ({
        subTaskId: `sub-${i + 1}`,
        description: `Part ${i + 1} of: ${task.prompt}`,
        assignedAgentId: w.id,
        status: "pending" as const,
        output: "",
      }));
    }

    // ─── 3. 分发子任务给 Workers 并行执行 ───
    logger.info(
      { taskId: task.id, subTaskCount: subTasks.length },
      "Hierarchical mode: dispatching sub-tasks to workers"
    );

    const workerPromises = subTasks.map(async (subTask) => {
      await this.checkPaused();
      if (this.isAborted()) {
        return { ...subTask, status: "failed" as const, output: "Aborted" };
      }

      const worker = workers.find((w) => w.id === subTask.assignedAgentId) || workers[0] || leader;

      logger.info(
        { taskId: task.id, subTaskId: subTask.subTaskId, workerId: worker.id },
        "Hierarchical mode: worker executing sub-task"
      );

      const result = await invokeAgent(worker, task, subTask.description, signal, task.maxLatencyMs);

      return {
        ...subTask,
        status: result.status === "success" ? ("success" as const) : ("failed" as const),
        output: result.output,
      };
    });

    this.subTaskResults = await Promise.all(workerPromises);

    if (this.isAborted()) {
      this._state = "stopped";
      return buildTaskResult(task.id, [], "", "failed", "hierarchical-stopped", { startedAt: startTime });
    }

    // ─── 4. Leader 聚合结果 ───
    await this.checkPaused();
    const successfulSubTasks = this.subTaskResults.filter((st) => st.status === "success");
    const failedSubTasks = this.subTaskResults.filter((st) => st.status === "failed");

    logger.info(
      {
        taskId: task.id,
        successCount: successfulSubTasks.length,
        failCount: failedSubTasks.length,
      },
      "Hierarchical mode: all sub-tasks completed, leader aggregating"
    );

    const aggregationPrompt = `You are the leader. Your workers have completed their sub-tasks.
Please synthesize their results into a coherent final output.

Original Task: ${task.prompt}

Sub-task Results:
${this.subTaskResults
  .map(
    (st) =>
      `[${st.subTaskId}] ${st.status.toUpperCase()}:\n${st.output}`
  )
  .join("\n\n")}

Provide a comprehensive final answer that integrates all successful sub-task results.
Note any gaps if some sub-tasks failed.`;

    const finalResult = await invokeAgent(leader, task, aggregationPrompt, signal, task.maxLatencyMs);

    // ─── 5. 递归嵌套检查 ───
    this.currentDepth++;
    if (this.currentDepth < maxDepth && finalResult.output.includes("DELEGATE_TO_SWARM")) {
      logger.info(
        { taskId: task.id, currentDepth: this.currentDepth },
        "Hierarchical mode: leader requests recursive delegation"
      );
      // 递归调用自身处理嵌套 Swarm
      // 这里可以创建一个新的 HierarchicalMode 实例并执行
      // 简化处理：在当前层级继续
    }

    // ─── 6. 构建结果 ───
    const agentResults: AgentResult[] = [
      {
        agentId: leader.id,
        agentName: leader.name,
        status: finalResult.status,
        output: finalResult.output,
        latencyMs: finalResult.latencyMs,
      },
      ...this.subTaskResults.map((st) => {
        const worker = workers.find((w) => w.id === st.assignedAgentId) || leader;
        return {
          agentId: worker.id,
          agentName: worker.name,
          status: st.status,
          output: st.output,
          latencyMs: 0, // 子任务未单独计时
        };
      }),
    ];

    const allSuccess = failedSubTasks.length === 0 && finalResult.status === "success";
    const someSuccess = successfulSubTasks.length > 0 || finalResult.status === "success";

    const finalStatus: "success" | "partial" | "failed" = allSuccess
      ? "success"
      : someSuccess
        ? "partial"
        : "failed";

    this._state = finalStatus === "success" ? "completed" : finalStatus;

    const taskResult = buildTaskResult(
      task.id,
      agentResults,
      finalResult.output,
      finalStatus,
      "hierarchical",
      {
        startedAt: startTime,
        subTasks: this.subTaskResults,
      }
    );

    task.onComplete?.(taskResult);
    return taskResult;
  }

  override async pause(): Promise<void> {
    await super.pause();
    logger.info(
      { taskId: this.currentTaskId, depth: this.currentDepth },
      "Hierarchical execution paused"
    );
  }

  override async resume(): Promise<void> {
    await super.resume();
    logger.info(
      { taskId: this.currentTaskId, depth: this.currentDepth },
      "Hierarchical execution resuming"
    );
  }

  override async stop(): Promise<void> {
    await super.stop();
    this.subTaskResults = [];
    this.currentDepth = 0;
  }
}
