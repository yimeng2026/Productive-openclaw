import { logger } from "../../utils/logger";
import {
  BaseExecutionMode,
  type AgentRegistration,
  type AgentResult,
  type ExecutionContext,
  type TaskRequest,
  type TaskResult,
  invokeAgent,
  isAgentAvailable,
  buildTaskResult,
  type SwarmMode,
} from "./types";

/**
 * ParallelMode — 并行执行模式
 *
 * 所有 Agent 同时接收相同任务输入
 * 结果聚合（投票 / 汇总 / 去重 / 最佳）
 * 超时控制（最慢 Agent 决定总时间）
 * 错误隔离（单个 Agent 失败不影响其他）
 *
 * 设计参考: MapReduce pattern, Promise.allSettled
 */
export class ParallelMode extends BaseExecutionMode {
  readonly mode: SwarmMode = "parallel";

  private activePromises: Promise<AgentResult>[] = [];

  async execute(
    task: TaskRequest,
    agents: AgentRegistration[],
    context: ExecutionContext
  ): Promise<TaskResult> {
    const startTime = Date.now();
    this._state = "running";
    this.currentTaskId = task.id;
    this.activePromises = [];

    const abortCtrl = this.createAbortController();
    const signal = abortCtrl.signal;

    // ─── 1. 过滤可用 Agent ───
    const availableAgents = agents.filter(isAgentAvailable);
    if (availableAgents.length === 0) {
      this._state = "failed";
      return buildTaskResult(
        task.id,
        [],
        "",
        "failed",
        "parallel",
        { startedAt: startTime }
      );
    }

    logger.info(
      { taskId: task.id, agentCount: availableAgents.length },
      "Parallel mode executing with agents"
    );

    // ─── 2. 并行启动所有 Agent ───
    const promises = availableAgents.map((agent) =>
      this.wrapAgentExecution(agent, task, context, signal, startTime)
    );
    this.activePromises = promises;

    // ─── 3. 等待所有 Agent 完成（最慢的决定总时间）───
    const results = await Promise.allSettled(promises);

    if (this.isAborted()) {
      this._state = "stopped";
    }

    // ─── 4. 收集结果 ───
    const agentResults: AgentResult[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const agent = availableAgents[i];

      if (result.status === "fulfilled") {
        agentResults.push(result.value);
      } else {
        // 处理未捕获的异常（错误隔离）
        const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        agentResults.push({
          agentId: agent.id,
          agentName: agent.name,
          status: "failed",
          output: "",
          error: errorMsg,
          latencyMs: Date.now() - startTime,
        });
      }
    }

    // ─── 5. 结果聚合 ───
    const strategy = task.aggregationStrategy || "all";
    const aggregatedOutput = this.aggregateResults(agentResults, strategy);

    // ─── 6. 确定状态 ───
    const successCount = agentResults.filter((r) => r.status === "success").length;
    const failedCount = agentResults.filter((r) => r.status === "failed").length;

    const finalStatus: "success" | "partial" | "failed" =
      failedCount === 0 ? "success" : successCount > 0 ? "partial" : "failed";

    this._state = finalStatus === "success" ? "completed" : finalStatus;

    const taskResult = buildTaskResult(
      task.id,
      agentResults,
      aggregatedOutput,
      finalStatus,
      `parallel-${strategy}`,
      { startedAt: startTime }
    );

    task.onComplete?.(taskResult);
    return taskResult;
  }

  /**
   * 包装单个 Agent 的并行执行
   * 包含暂停检查、错误隔离
   */
  private async wrapAgentExecution(
    agent: AgentRegistration,
    task: TaskRequest,
    context: ExecutionContext,
    signal: AbortSignal,
    startTime: number
  ): Promise<AgentResult> {
    // 等待暂停恢复
    await this.checkPaused();

    if (this.isAborted()) {
      return {
        agentId: agent.id,
        agentName: agent.name,
        status: "failed",
        output: "",
        error: "Execution aborted",
        latencyMs: Date.now() - startTime,
      };
    }

    logger.info({ taskId: task.id, agentId: agent.id }, "Parallel agent starting");

    const result = await invokeAgent(agent, task, task.prompt, signal, task.maxLatencyMs);

    logger.info(
      { taskId: task.id, agentId: agent.id, status: result.status },
      "Parallel agent completed"
    );

    task.onProgress?.(`[Parallel] ${agent.name}: ${result.status}`);
    return result;
  }

  /**
   * 结果聚合策略
   */
  private aggregateResults(results: AgentResult[], strategy: string): string {
    const successfulResults = results.filter((r) => r.status === "success");

    if (successfulResults.length === 0) {
      return `All ${results.length} agents failed. Errors: ${results.map((r) => r.error).join("; ")}`;
    }

    switch (strategy) {
      case "vote": {
        // 简单多数投票：统计各输出的出现频率
        const frequency = new Map<string, number>();
        for (const r of successfulResults) {
          const key = r.output.trim();
          frequency.set(key, (frequency.get(key) || 0) + 1);
        }

        let bestOutput = "";
        let bestCount = 0;
        for (const [output, count] of frequency.entries()) {
          if (count > bestCount) {
            bestCount = count;
            bestOutput = output;
          }
        }

        return `[Vote Result] ${bestCount}/${successfulResults.length} agents agree:\n${bestOutput}`;
      }

      case "merge": {
        // 汇总所有输出，去重合并
        const uniqueOutputs = [...new Set(successfulResults.map((r) => r.output.trim()))];
        return `[Merged Result] (${successfulResults.length} agents):\n${uniqueOutputs.join("\n---\n")}`;
      }

      case "best": {
        // 选择最完整的输出（按长度和结构判断）
        let bestResult = successfulResults[0];
        let bestScore = 0;

        for (const r of successfulResults) {
          // 简单启发式：输出越长、结构越完整（有段落、有列表）得分越高
          const hasStructure = /[\n\r]/.test(r.output) || /^\s*[-*\d]/.test(r.output);
          const lengthScore = Math.min(r.output.length / 1000, 5);
          const structureScore = hasStructure ? 2 : 0;
          const score = lengthScore + structureScore;

          if (score > bestScore) {
            bestScore = score;
            bestResult = r;
          }
        }

        return `[Best Result] from ${bestResult.agentName}:\n${bestResult.output}`;
      }

      case "all":
      default: {
        // 返回所有结果
        const outputs = successfulResults.map(
          (r, i) => `[${i + 1}] ${r.agentName} (${r.latencyMs}ms):\n${r.output}`
        );
        return `[All Results] (${successfulResults.length}/${results.length} succeeded):\n\n${outputs.join("\n\n")}`;
      }
    }
  }

  override async pause(): Promise<void> {
    await super.pause();
    logger.info(
      { taskId: this.currentTaskId, activeAgents: this.activePromises.length },
      "Parallel execution paused — ongoing agents will complete but no new ones start"
    );
  }

  override async resume(): Promise<void> {
    await super.resume();
    logger.info({ taskId: this.currentTaskId }, "Parallel execution resuming");
  }

  override async stop(): Promise<void> {
    await super.stop();
    this.activePromises = [];
  }
}
