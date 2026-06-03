import { logger } from "../../utils/logger";
import {
  BaseExecutionMode,
  type AgentRegistration,
  type AgentResult,
  type CheckpointData,
  type ExecutionContext,
  type TaskRequest,
  type TaskResult,
  invokeAgent,
  isAgentAvailable,
  buildTaskResult,
  saveCheckpoint,
  type SwarmMode,
} from "./types";

/**
 * SequentialMode — 串行执行模式
 *
 * Agent A 完成 → Agent B 开始 → Agent C 开始
 * 前一 Agent 的输出作为后一 Agent 的输入
 * 支持断点续传、错误时停止或跳转
 *
 * 设计参考: Pipeline pattern (Unix pipes, TensorFlow data pipeline)
 */
export class SequentialMode extends BaseExecutionMode {
  readonly mode: SwarmMode = "sequential";

  private agentResults: AgentResult[] = [];
  private currentAgentIndex = 0;
  private currentInput = "";
  private checkpoint: CheckpointData | null = null;

  async execute(
    task: TaskRequest,
    agents: AgentRegistration[],
    context: ExecutionContext
  ): Promise<TaskResult> {
    const startTime = Date.now();
    this._state = "running";
    this.currentTaskId = task.id;
    this.agentResults = [];

    const abortCtrl = this.createAbortController();
    const signal = abortCtrl.signal;

    // ─── 1. 恢复断点 ───
    if (context.checkpoint) {
      this.checkpoint = context.checkpoint;
      this.currentAgentIndex = this.checkpoint.lastAgentIndex ?? 0;
      this.currentInput = this.checkpoint.lastOutput ?? task.prompt;
      logger.info(
        { taskId: task.id, resumeFrom: this.currentAgentIndex },
        "Sequential mode resuming from checkpoint"
      );
    } else {
      this.currentInput = task.prompt;
    }

    // ─── 2. 过滤可用 Agent ───
    const availableAgents = agents.filter(isAgentAvailable);
    if (availableAgents.length === 0) {
      this._state = "failed";
      return buildTaskResult(
        task.id,
        [],
        "",
        "failed",
        "sequential",
        { startedAt: startTime }
      );
    }

    // ─── 3. 串行执行 ───
    for (let i = this.currentAgentIndex; i < availableAgents.length; i++) {
      if (this.isAborted()) {
        this._state = "stopped";
        break;
      }

      // 等待暂停恢复
      await this.checkPaused();

      const agent = availableAgents[i];
      this.currentAgentIndex = i;

      logger.info(
        { taskId: task.id, agentId: agent.id, step: i + 1, total: availableAgents.length },
        "Sequential step executing"
      );

      const result = await invokeAgent(
        agent,
        task,
        this.currentInput,
        signal,
        task.maxLatencyMs
      );

      this.agentResults.push(result);

      // ─── 错误处理 ───
      if (result.status === "failed") {
        const onError = task.onError || "stop";

        if (onError === "stop") {
          logger.warn(
            { taskId: task.id, agentId: agent.id },
            "Sequential execution stopped on error"
          );
          this._state = "failed";
          return buildTaskResult(
            task.id,
            this.agentResults,
            this.currentInput,
            "failed",
            "sequential-stop-on-error",
            { startedAt: startTime }
          );
        } else if (onError === "skip") {
          logger.info(
            { taskId: task.id, agentId: agent.id },
            "Sequential step skipped on error, continuing with next"
          );
          continue;
        } else if (onError === "retry") {
          const retryCount = context.retryCount ?? 1;
          const retryDelay = context.retryDelayMs ?? 1000;

          for (let attempt = 1; attempt <= retryCount; attempt++) {
            logger.info(
              { taskId: task.id, agentId: agent.id, attempt },
              "Retrying failed sequential step"
            );
            await new Promise((resolve) => setTimeout(resolve, retryDelay));

            const retryResult = await invokeAgent(
              agent,
              task,
              this.currentInput,
              signal,
              task.maxLatencyMs
            );

            if (retryResult.status === "success") {
              this.agentResults[this.agentResults.length - 1] = retryResult;
              this.currentInput = retryResult.output;
              break;
            }

            if (attempt === retryCount) {
              logger.warn(
                { taskId: task.id, agentId: agent.id, retries: retryCount },
                "Sequential step exhausted all retries"
              );
              this._state = "failed";
              return buildTaskResult(
                task.id,
                this.agentResults,
                this.currentInput,
                "failed",
                "sequential-retry-exhausted",
                { startedAt: startTime }
              );
            }
          }
          continue;
        }
      }

      // ─── 传递输出到下一步 ───
      this.currentInput = result.output;

      // ─── 保存检查点 ───
      this.checkpoint = saveCheckpoint(context, {
        taskId: task.id,
        completedAgentIds: this.agentResults.map((r) => r.agentId),
        lastOutput: this.currentInput,
        lastAgentIndex: i + 1,
      });

      task.onProgress?.(
        `[Step ${i + 1}/${availableAgents.length}] ${agent.name}: ${result.output.slice(0, 200)}`
      );
    }

    // ─── 4. 构建最终结果 ───
    const allSuccess = this.agentResults.every((r) => r.status === "success");
    const someSuccess = this.agentResults.some((r) => r.status === "success");

    const finalStatus: "success" | "partial" | "failed" = allSuccess
      ? "success"
      : someSuccess
        ? "partial"
        : "failed";

    this._state = finalStatus === "success" ? "completed" : finalStatus;

    const taskResult = buildTaskResult(
      task.id,
      this.agentResults,
      this.currentInput,
      finalStatus,
      "sequential",
      { startedAt: startTime }
    );

    task.onComplete?.(taskResult);
    return taskResult;
  }

  override async pause(): Promise<void> {
    await super.pause();
    logger.info(
      { taskId: this.currentTaskId, pausedAtStep: this.currentAgentIndex },
      "Sequential execution paused"
    );
  }

  override async resume(): Promise<void> {
    logger.info(
      { taskId: this.currentTaskId, resumeAtStep: this.currentAgentIndex },
      "Sequential execution resuming"
    );
    await super.resume();
  }

  override async stop(): Promise<void> {
    await super.stop();
    this.agentResults = [];
    this.currentAgentIndex = 0;
    this.currentInput = "";
    this.checkpoint = null;
  }

  /** 获取当前检查点（用于断点续传） */
  getCheckpoint(): CheckpointData | null {
    return this.checkpoint;
  }
}
