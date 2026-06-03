import { logger } from "../../utils/logger";
import {
  BaseExecutionMode,
  type AgentRegistration,
  type AgentResult,
  type ExecutionContext,
  type RebalancingEvent,
  type TaskRequest,
  type TaskResult,
  invokeAgent,
  isAgentAvailable,
  buildTaskResult,
  type SwarmMode,
  type AgentHealth,
} from "./types";

/**
 * DynamicMode — 动态执行模式
 *
 * 根据当前负载动态调整 Agent 数量
 * 监控 Agent 健康状态，自动替换不健康 Agent
 * 任务完成后自动平衡负载
 * 支持运行时增减 Agent
 *
 * 设计参考: Kubernetes HPA (Horizontal Pod Autoscaler), Load Balancer with health checks
 */
export class DynamicMode extends BaseExecutionMode {
  readonly mode: SwarmMode = "dynamic";

  private activeAgents: Map<string, AgentRegistration> = new Map();
  private healthChecks: Map<string, NodeJS.Timeout> = new Map();
  private rebalancingEvents: RebalancingEvent[] = [];
  private loadThreshold: number;
  private healthCheckIntervalMs: number;
  private maxAgents: number;
  private minAgents: number;

  constructor(options?: {
    loadThreshold?: number;
    healthCheckIntervalMs?: number;
    maxAgents?: number;
    minAgents?: number;
  }) {
    super();
    this.loadThreshold = options?.loadThreshold ?? 0.75;
    this.healthCheckIntervalMs = options?.healthCheckIntervalMs ?? 5000;
    this.maxAgents = options?.maxAgents ?? 10;
    this.minAgents = options?.minAgents ?? 1;
  }

  async execute(
    task: TaskRequest,
    agents: AgentRegistration[],
    context: ExecutionContext
  ): Promise<TaskResult> {
    const startTime = Date.now();
    this._state = "running";
    this.currentTaskId = task.id;
    this.activeAgents.clear();
    this.rebalancingEvents = [];

    const abortCtrl = this.createAbortController();
    const signal = abortCtrl.signal;

    // ─── 1. 初始筛选与启动 ───
    let availableAgents = agents.filter(isAgentAvailable);
    if (availableAgents.length === 0) {
      this._state = "failed";
      return buildTaskResult(
        task.id,
        [],
        "",
        "failed",
        "dynamic-no-agents",
        { startedAt: startTime }
      );
    }

    // 初始启动 minAgents 个
    const initialCount = Math.min(this.minAgents, availableAgents.length);
    const activePool = availableAgents.slice(0, initialCount);
    for (const agent of activePool) {
      this.activeAgents.set(agent.id, agent);
    }

    logger.info(
      {
        taskId: task.id,
        initialAgents: activePool.length,
        totalAvailable: availableAgents.length,
        loadThreshold: this.loadThreshold,
      },
      "Dynamic mode: initial pool started"
    );

    // ─── 2. 启动健康检查 ───
    this.startHealthChecks(agents, signal);

    // ─── 3. 主执行循环 ───
    let allResults: AgentResult[] = [];
    let completed = false;
    let iteration = 0;

    while (!completed && !this.isAborted()) {
      await this.checkPaused();
      iteration++;

      // 获取当前活跃 Agent 列表
      const currentPool = Array.from(this.activeAgents.values()).filter(isAgentAvailable);

      if (currentPool.length === 0) {
        logger.warn({ taskId: task.id }, "Dynamic mode: no healthy agents available");
        break;
      }

      logger.info(
        { taskId: task.id, iteration, activeAgents: currentPool.length },
        "Dynamic mode: executing iteration"
      );

      // 并行执行当前池中的所有 Agent
      const promises = currentPool.map((agent) =>
        this.executeWithAgent(agent, task, signal, startTime)
      );

      const results = await Promise.allSettled(promises);

      // 收集结果
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const agent = currentPool[i];

        if (result.status === "fulfilled") {
          allResults.push(result.value);

          // 如果 Agent 失败，尝试替换
          if (result.value.status === "failed") {
            logger.warn(
              { taskId: task.id, agentId: agent.id },
              "Dynamic mode: agent failed, attempting replacement"
            );
            this.replaceAgent(agent.id, agents);
          }
        } else {
          allResults.push({
            agentId: agent.id,
            agentName: agent.name,
            status: "failed",
            output: "",
            error: String(result.reason),
            latencyMs: Date.now() - startTime,
          });
          this.replaceAgent(agent.id, agents);
        }
      }

      // ─── 4. 负载评估与动态调整 ───
      const loadMetric = this.calculateLoad(allResults);
      const currentCount = this.activeAgents.size;

      if (loadMetric > this.loadThreshold && currentCount < this.maxAgents) {
        // 负载高，添加 Agent
        const spareAgents = availableAgents.filter(
          (a) => !this.activeAgents.has(a.id) && isAgentAvailable(a)
        );
        if (spareAgents.length > 0) {
          const toAdd = spareAgents[0];
          this.activeAgents.set(toAdd.id, toAdd);
          this.rebalancingEvents.push({
            timestamp: Date.now(),
            action: "add",
            agentId: toAdd.id,
            reason: `High load (${loadMetric.toFixed(2)} > ${this.loadThreshold})`,
          });
          logger.info(
            { taskId: task.id, agentId: toAdd.id, load: loadMetric },
            "Dynamic mode: added agent due to high load"
          );
        }
      } else if (loadMetric < this.loadThreshold * 0.5 && currentCount > this.minAgents) {
        // 负载低，移除 Agent（保留最新加入的）
        const agentsList = Array.from(this.activeAgents.values());
        if (agentsList.length > this.minAgents) {
          const toRemove = agentsList[agentsList.length - 1];
          this.activeAgents.delete(toRemove.id);
          this.rebalancingEvents.push({
            timestamp: Date.now(),
            action: "remove",
            agentId: toRemove.id,
            reason: `Low load (${loadMetric.toFixed(2)} < ${this.loadThreshold * 0.5})`,
          });
          logger.info(
            { taskId: task.id, agentId: toRemove.id, load: loadMetric },
            "Dynamic mode: removed agent due to low load"
          );
        }
      }

      // ─── 5. 完成条件 ───
      // 策略：如果至少有 minAgents 个成功结果，且最近一轮没有新增 Agent，则完成
      const recentSuccess = allResults
        .filter((r) => r.status === "success")
        .slice(-this.activeAgents.size);
      if (recentSuccess.length >= this.minAgents && currentCount <= this.minAgents) {
        completed = true;
      }

      // 安全阀：最多迭代 5 轮
      if (iteration >= 5) {
        completed = true;
        logger.info({ taskId: task.id, iterations: iteration }, "Dynamic mode: max iterations reached");
      }
    }

    // ─── 6. 停止健康检查 ───
    this.stopHealthChecks();

    if (this.isAborted()) {
      this._state = "stopped";
    }

    // ─── 7. 构建结果 ───
    const successResults = allResults.filter((r) => r.status === "success");
    const failedResults = allResults.filter((r) => r.status === "failed");

    const finalOutput = this.buildConsensusOutput(successResults);

    const finalStatus: "success" | "partial" | "failed" =
      failedResults.length === 0
        ? "success"
        : successResults.length > 0
          ? "partial"
          : "failed";

    this._state = finalStatus === "success" ? "completed" : finalStatus;

    const taskResult = buildTaskResult(
      task.id,
      allResults,
      finalOutput,
      finalStatus,
      "dynamic",
      {
        startedAt: startTime,
        rebalancingEvents: this.rebalancingEvents,
      }
    );

    // ─── 8. 任务完成后负载平衡 ───
    if (this.activeAgents.size > this.minAgents) {
      logger.info(
        { taskId: task.id, currentSize: this.activeAgents.size, target: this.minAgents },
        "Dynamic mode: rebalancing after task completion"
      );
      const toRelease = Array.from(this.activeAgents.values()).slice(this.minAgents);
      for (const agent of toRelease) {
        this.activeAgents.delete(agent.id);
        this.rebalancingEvents.push({
          timestamp: Date.now(),
          action: "remove",
          agentId: agent.id,
          reason: "Post-task rebalancing",
        });
      }
    }

    task.onComplete?.(taskResult);
    return taskResult;
  }

  /**
   * 单个 Agent 执行包装
   */
  private async executeWithAgent(
    agent: AgentRegistration,
    task: TaskRequest,
    signal: AbortSignal,
    startTime: number
  ): Promise<AgentResult> {
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

    return invokeAgent(agent, task, task.prompt, signal, task.maxLatencyMs);
  }

  /**
   * 计算负载指标
   * 基于失败率 + 延迟偏差
   */
  private calculateLoad(results: AgentResult[]): number {
    if (results.length === 0) return 1.0;

    const recent = results.slice(-Math.min(results.length, 5));
    const failRate = recent.filter((r) => r.status === "failed").length / recent.length;

    const latencies = recent.filter((r) => r.status === "success").map((r) => r.latencyMs);
    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;
    const latencyLoad = Math.min(avgLatency / 10000, 1); // 10s 为满负载

    // 综合负载 = 失败率 * 0.6 + 延迟负载 * 0.4
    return failRate * 0.6 + latencyLoad * 0.4;
  }

  /**
   * 替换不健康 Agent
   */
  private replaceAgent(failedAgentId: string, allAgents: AgentRegistration[]): void {
    this.activeAgents.delete(failedAgentId);

    const replacement = allAgents.find(
      (a) => a.id !== failedAgentId && !this.activeAgents.has(a.id) && isAgentAvailable(a)
    );

    if (replacement) {
      this.activeAgents.set(replacement.id, replacement);
      this.rebalancingEvents.push({
        timestamp: Date.now(),
        action: "replace",
        agentId: replacement.id,
        reason: `Replaced failed agent ${failedAgentId}`,
      });
      logger.info(
        { failedAgentId, replacementId: replacement.id },
        "Dynamic mode: replaced unhealthy agent"
      );
    } else {
      logger.warn(
        { failedAgentId },
        "Dynamic mode: no replacement agent available"
      );
    }
  }

  /**
   * 启动健康检查定时器
   */
  private startHealthChecks(agents: AgentRegistration[], signal: AbortSignal): void {
    for (const agent of agents) {
      const timer = setInterval(() => {
        if (signal.aborted) {
          clearInterval(timer);
          return;
        }

        const health = this.checkAgentHealth(agent);
        if (health === "unhealthy" && this.activeAgents.has(agent.id)) {
          logger.warn(
            { agentId: agent.id },
            "Dynamic mode: health check failed, removing agent"
          );
          this.activeAgents.delete(agent.id);
          this.rebalancingEvents.push({
            timestamp: Date.now(),
            action: "remove",
            agentId: agent.id,
            reason: "Health check failed",
          });
          // 尝试找替代
          this.replaceAgent(agent.id, agents);
        }
      }, this.healthCheckIntervalMs);

      this.healthChecks.set(agent.id, timer);
    }
  }

  /**
   * 停止健康检查
   */
  private stopHealthChecks(): void {
    for (const [agentId, timer] of this.healthChecks.entries()) {
      clearInterval(timer);
      logger.debug({ agentId }, "Dynamic mode: stopped health check");
    }
    this.healthChecks.clear();
  }

  /**
   * 模拟健康检查
   */
  private checkAgentHealth(agent: AgentRegistration): AgentHealth {
    // TODO: 替换为真实的健康检查（HTTP ping、Provider API 检查等）
    // 当前为随机模拟
    const random = Math.random();
    if (random < 0.9) return "healthy";
    if (random < 0.95) return "degraded";
    return "unhealthy";
  }

  /**
   * 构建共识输出（多数投票）
   */
  private buildConsensusOutput(successResults: AgentResult[]): string {
    if (successResults.length === 0) {
      return "No successful results from any agent.";
    }

    if (successResults.length === 1) {
      return successResults[0].output;
    }

    // 简单多数投票
    const frequency = new Map<string, number>();
    for (const r of successResults) {
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

    if (bestCount > 1) {
      return `[Consensus: ${bestCount}/${successResults.length} agents agree]\n${bestOutput}`;
    }

    // 无共识，返回所有结果
    return `[No consensus] All ${successResults.length} results:\n${successResults
      .map((r, i) => `[${i + 1}] ${r.agentName}:\n${r.output}`)
      .join("\n\n---\n\n")}`;
  }

  // ─── 运行时增减 Agent ───

  /** 运行时添加 Agent 到活跃池 */
  addAgent(agent: AgentRegistration): boolean {
    if (this.activeAgents.size >= this.maxAgents) {
      logger.warn(
        { agentId: agent.id, currentSize: this.activeAgents.size, max: this.maxAgents },
        "Dynamic mode: cannot add agent, pool at max capacity"
      );
      return false;
    }

    if (!isAgentAvailable(agent)) {
      logger.warn({ agentId: agent.id }, "Dynamic mode: cannot add unhealthy agent");
      return false;
    }

    this.activeAgents.set(agent.id, agent);
    this.rebalancingEvents.push({
      timestamp: Date.now(),
      action: "add",
      agentId: agent.id,
      reason: "Runtime manual addition",
    });

    logger.info(
      { agentId: agent.id, poolSize: this.activeAgents.size },
      "Dynamic mode: agent added at runtime"
    );
    return true;
  }

  /** 运行时从活跃池移除 Agent */
  removeAgent(agentId: string): boolean {
    if (!this.activeAgents.has(agentId)) {
      return false;
    }

    this.activeAgents.delete(agentId);
    this.rebalancingEvents.push({
      timestamp: Date.now(),
      action: "remove",
      agentId,
      reason: "Runtime manual removal",
    });

    logger.info(
      { agentId, poolSize: this.activeAgents.size },
      "Dynamic mode: agent removed at runtime"
    );
    return true;
  }

  /** 获取当前活跃 Agent 列表 */
  getActiveAgents(): AgentRegistration[] {
    return Array.from(this.activeAgents.values());
  }

  /** 获取重新平衡事件日志 */
  getRebalancingEvents(): RebalancingEvent[] {
    return [...this.rebalancingEvents];
  }

  override async stop(): Promise<void> {
    await super.stop();
    this.stopHealthChecks();
    this.activeAgents.clear();
    this.rebalancingEvents = [];
  }
}
