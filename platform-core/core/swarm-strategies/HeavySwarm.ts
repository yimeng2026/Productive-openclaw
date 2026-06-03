/**
 * HeavySwarm.ts — 5阶段流水线策略
 *
 * 来源: swarms (kyegomez/swarns)
 * 特点: 研究→分析→草稿→审查→验证 的严格流水线
 *        每个阶段有独立的质量门控，失败可回退到上一阶段
 *        支持阶段间的数据转换和上下文传递
 *
 * 设计参考: CI/CD Pipeline, Airflow DAG, Lean Manufacturing
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
} from "../coordinator/modes/types";

// ─── 类型定义 ───

export type HeavyPhase =
  | "research"
  | "analysis"
  | "draft"
  | "review"
  | "validate";

export type HeavyPhaseStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "rollback";

export interface HeavyPhaseConfig {
  phase: HeavyPhase;
  /** 阶段 Agent 选择策略 */
  agentSelector: "capability" | "round_robin" | "load_balanced";
  /** 阶段专用提示词模板 */
  promptTemplate: string;
  /** 质量门控：输出最低评分（0-1） */
  qualityGateThreshold: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 超时（毫秒） */
  timeoutMs: number;
  /** 失败策略: stop | retry | rollback | skip */
  onFailure: "stop" | "retry" | "rollback" | "skip";
  /** 是否允许并行执行（某些阶段可并行化） */
  allowParallel: boolean;
  /** 并行 Agent 数量 */
  parallelAgents: number;
}

export interface HeavySwarmConfig {
  /** 各阶段配置 */
  phases: Partial<Record<HeavyPhase, Partial<HeavyPhaseConfig>>>;
  /** 是否启用阶段间自动回退 */
  enableAutoRollback: boolean;
  /** 最大回退次数 */
  maxRollbacks: number;
  /** 是否保存阶段中间产物 */
  saveArtifacts: boolean;
  /** 流水线超时（总时间） */
  totalTimeoutMs: number;
  /** 阶段间传递的数据转换 */
  transformers: Partial<
    Record<
      `${HeavyPhase}-${HeavyPhase}`,
      (output: string, context: Record<string, unknown>) => string
    >
  >;
}

export interface PhaseResult {
  phase: HeavyPhase;
  status: HeavyPhaseStatus;
  agentResults: AgentResult[];
  output: string;
  qualityScore: number;
  startTime: number;
  endTime: number;
  retryCount: number;
  artifactId?: string;
}

export type HeavySwarmState =
  | "idle"
  | "pipeline_initializing"
  | "phase_research"
  | "phase_analysis"
  | "phase_draft"
  | "phase_review"
  | "phase_validate"
  | "rollback"
  | "completed"
  | "failed";

// ─── 默认阶段配置 ───

const DEFAULT_PHASE_CONFIGS: Record<HeavyPhase, HeavyPhaseConfig> = {
  research: {
    phase: "research",
    agentSelector: "capability",
    promptTemplate:
      "You are in the RESEARCH phase. Your task is to gather comprehensive information about the following topic. Be thorough and cite key facts.\n\nTopic: {input}\n\nProvide a structured research summary with key findings, sources, and data points.",
    qualityGateThreshold: 0.6,
    maxRetries: 2,
    timeoutMs: 60000,
    onFailure: "retry",
    allowParallel: false,
    parallelAgents: 1,
  },
  analysis: {
    phase: "analysis",
    agentSelector: "capability",
    promptTemplate:
      "You are in the ANALYSIS phase. Based on the research findings below, perform deep analysis. Identify patterns, implications, and actionable insights.\n\nResearch Findings:\n{input}\n\nProvide a structured analysis with clear reasoning.",
    qualityGateThreshold: 0.65,
    maxRetries: 2,
    timeoutMs: 60000,
    onFailure: "rollback",
    allowParallel: false,
    parallelAgents: 1,
  },
  draft: {
    phase: "draft",
    agentSelector: "capability",
    promptTemplate:
      "You are in the DRAFT phase. Based on the analysis below, create a complete draft output. This should be a production-ready deliverable.\n\nAnalysis:\n{input}\n\nProvide the complete draft.",
    qualityGateThreshold: 0.7,
    maxRetries: 2,
    timeoutMs: 90000,
    onFailure: "rollback",
    allowParallel: false,
    parallelAgents: 1,
  },
  review: {
    phase: "review",
    agentSelector: "capability",
    promptTemplate:
      "You are in the REVIEW phase. Review the draft below for quality, accuracy, completeness, and style. Provide specific feedback and a quality score (0-1).\n\nDraft:\n{input}\n\nRespond in this format:\nQuality Score: [0.0-1.0]\nFeedback: [detailed feedback]\nApproved: [yes/no]",
    qualityGateThreshold: 0.75,
    maxRetries: 2,
    timeoutMs: 60000,
    onFailure: "rollback",
    allowParallel: true,
    parallelAgents: 2,
  },
  validate: {
    phase: "validate",
    agentSelector: "capability",
    promptTemplate:
      "You are in the VALIDATE phase. Validate the final output against the original requirements. Ensure correctness, consistency, and completeness.\n\nFinal Output:\n{input}\n\nOriginal Requirements: {originalTask}\n\nProvide a validation report with PASS/FAIL status.",
    qualityGateThreshold: 0.8,
    maxRetries: 1,
    timeoutMs: 30000,
    onFailure: "rollback",
    allowParallel: false,
    parallelAgents: 1,
  },
};

const PHASE_ORDER: HeavyPhase[] = [
  "research",
  "analysis",
  "draft",
  "review",
  "validate",
];

const DEFAULT_CONFIG: HeavySwarmConfig = {
  phases: {},
  enableAutoRollback: true,
  maxRollbacks: 3,
  saveArtifacts: true,
  totalTimeoutMs: 300000,
  transformers: {},
};

// ─── HeavySwarm 实现 ───

export class HeavySwarm extends BaseExecutionMode {
  readonly mode: SwarmMode = "heavy-swarm" as SwarmMode;

  private config: HeavySwarmConfig;
  private phaseResults: Map<HeavyPhase, PhaseResult> = new Map();
  private currentPhaseIndex = 0;
  private rollbackCount = 0;
  private swarmState: HeavySwarmState = "idle";
  private artifacts: Map<string, string> = new Map();

  constructor(config?: Partial<HeavySwarmConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private setState(state: HeavySwarmState): void {
    const prev = this.swarmState;
    this.swarmState = state;
    logger.info({ from: prev, to: state, taskId: this.currentTaskId }, "HeavySwarm state transition");
  }

  private getPhaseConfig(phase: HeavyPhase): HeavyPhaseConfig {
    const custom = this.config.phases[phase];
    return { ...DEFAULT_PHASE_CONFIGS[phase], ...custom };
  }

  async execute(
    task: TaskRequest,
    agents: AgentRegistration[],
    context: ExecutionContext
  ): Promise<TaskResult> {
    const pipelineStartTime = Date.now();
    this._state = "running";
    this.currentTaskId = task.id;
    this.phaseResults.clear();
    this.currentPhaseIndex = 0;
    this.rollbackCount = 0;
    this.artifacts.clear();

    const abortCtrl = this.createAbortController();
    const signal = abortCtrl.signal;

    const availableAgents = agents.filter(isAgentAvailable);
    if (availableAgents.length === 0) {
      this.setState("failed");
      this._state = "failed";
      return buildTaskResult(
        task.id,
        [],
        "",
        "failed",
        "heavy-swarm-no-agents",
        { startedAt: pipelineStartTime }
      );
    }

    this.setState("pipeline_initializing");
    logger.info(
      { taskId: task.id, agentCount: availableAgents.length, totalTimeout: this.config.totalTimeoutMs },
      "HeavySwarm: pipeline initialized"
    );

    // ─── 流水线主循环 ───
    while (this.currentPhaseIndex < PHASE_ORDER.length) {
      if (this.isAborted()) {
        this.setState("failed");
        this._state = "stopped";
        return this.buildFinalResult(task, pipelineStartTime, "stopped");
      }

      // 检查总超时
      if (Date.now() - pipelineStartTime > this.config.totalTimeoutMs) {
        logger.warn({ taskId: task.id }, "HeavySwarm: total timeout exceeded");
        this.setState("failed");
        this._state = "failed";
        return this.buildFinalResult(task, pipelineStartTime, "timeout");
      }

      await this.checkPaused();

      const currentPhase = PHASE_ORDER[this.currentPhaseIndex];
      const phaseConfig = this.getPhaseConfig(currentPhase);

      this.setState(`phase_${currentPhase}` as HeavySwarmState);

      logger.info(
        { taskId: task.id, phase: currentPhase, phaseIndex: this.currentPhaseIndex },
        "HeavySwarm: executing phase"
      );

      // 准备阶段输入
      const phaseInput = this.buildPhaseInput(currentPhase, task);

      // 执行阶段
      const phaseResult = await this.executePhase(
        currentPhase,
        phaseConfig,
        phaseInput,
        task,
        availableAgents,
        signal,
        pipelineStartTime
      );

      this.phaseResults.set(currentPhase, phaseResult);

      // 质量门控检查
      const passedGate = phaseResult.qualityScore >= phaseConfig.qualityGateThreshold;

      logger.info(
        {
          taskId: task.id,
          phase: currentPhase,
          qualityScore: phaseResult.qualityScore,
          threshold: phaseConfig.qualityGateThreshold,
          passed: passedGate,
        },
        "HeavySwarm: phase quality gate check"
      );

      if (phaseResult.status === "completed" && passedGate) {
        // 阶段通过，保存产物，进入下一阶段
        if (this.config.saveArtifacts) {
          this.artifacts.set(currentPhase, phaseResult.output);
        }

        task.onProgress?.(
          `[HeavySwarm] Phase ${currentPhase}: PASSED (score: ${phaseResult.qualityScore.toFixed(2)})`
        );

        this.currentPhaseIndex++;
      } else {
        // 阶段失败或未通过门控
        logger.warn(
          {
            taskId: task.id,
            phase: currentPhase,
            status: phaseResult.status,
            qualityScore: phaseResult.qualityScore,
          },
          "HeavySwarm: phase failed quality gate"
        );

        task.onProgress?.(
          `[HeavySwarm] Phase ${currentPhase}: FAILED (score: ${phaseResult.qualityScore.toFixed(2)})`
        );

        switch (phaseConfig.onFailure) {
          case "stop":
            this.setState("failed");
            this._state = "failed";
            return this.buildFinalResult(task, pipelineStartTime, "phase-failed");

          case "retry": {
            // 在当前阶段重试
            if (phaseResult.retryCount < phaseConfig.maxRetries) {
              logger.info(
                { taskId: task.id, phase: currentPhase, retry: phaseResult.retryCount + 1 },
                "HeavySwarm: retrying phase"
              );
              continue; // 重新执行同一阶段
            }
            // 重试耗尽，失败
            this.setState("failed");
            this._state = "failed";
            return this.buildFinalResult(task, pipelineStartTime, "retry-exhausted");
          }

          case "rollback": {
            // 回退到上一阶段
            if (
              this.config.enableAutoRollback &&
              this.rollbackCount < this.config.maxRollbacks &&
              this.currentPhaseIndex > 0
            ) {
              this.setState("rollback");
              this.currentPhaseIndex--;
              this.rollbackCount++;

              // 清除回退阶段及之后的产物
              for (let i = this.currentPhaseIndex; i < PHASE_ORDER.length; i++) {
                this.phaseResults.delete(PHASE_ORDER[i]);
                this.artifacts.delete(PHASE_ORDER[i]);
              }

              logger.info(
                {
                  taskId: task.id,
                  rollbackTo: PHASE_ORDER[this.currentPhaseIndex],
                  rollbackCount: this.rollbackCount,
                },
                "HeavySwarm: rolling back to previous phase"
              );

              task.onProgress?.(
                `[HeavySwarm] Rolling back to ${PHASE_ORDER[this.currentPhaseIndex]} (rollback #${this.rollbackCount})`
              );

              continue; // 重新执行上一阶段
            }

            // 回退耗尽或无法回退
            this.setState("failed");
            this._state = "failed";
            return this.buildFinalResult(task, pipelineStartTime, "rollback-exhausted");
          }

          case "skip":
            // 跳过当前阶段，进入下一阶段
            logger.info(
              { taskId: task.id, phase: currentPhase },
              "HeavySwarm: skipping failed phase"
            );
            this.currentPhaseIndex++;
            break;
        }
      }
    }

    // ─── 所有阶段完成 ───
    this.setState("completed");
    this._state = "completed";

    const finalResult = this.buildFinalResult(
      task,
      pipelineStartTime,
      "pipeline-complete"
    );

    task.onComplete?.(finalResult);
    return finalResult;
  }

  // ─── 执行单个阶段 ───

  private async executePhase(
    phase: HeavyPhase,
    config: HeavyPhaseConfig,
    input: string,
    task: TaskRequest,
    agents: AgentRegistration[],
    signal: AbortSignal,
    pipelineStartTime: number
  ): Promise<PhaseResult> {
    const phaseStartTime = Date.now();
    const agentResults: AgentResult[] = [];
    let combinedOutput = "";
    let qualityScore = 0;
    let retryCount = 0;
    let phaseStatus: HeavyPhaseStatus = "running";

    // 格式化阶段提示词
    const phasePrompt = config.promptTemplate
      .replace("{input}", input)
      .replace("{originalTask}", task.prompt);

    // 选择 Agent(s)
    const selectedAgents = this.selectAgentsForPhase(
      config,
      agents,
      task.prompt
    );

    if (config.allowParallel && selectedAgents.length > 1) {
      // ─── 并行执行 ───
      const promises = selectedAgents.slice(0, config.parallelAgents).map((agent) =>
        invokeAgent(agent, task, phasePrompt, signal, config.timeoutMs)
      );

      const results = await Promise.allSettled(promises);

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const agent = selectedAgents[i];

        if (result.status === "fulfilled") {
          agentResults.push(result.value);
        } else {
          agentResults.push({
            agentId: agent.id,
            agentName: agent.name,
            status: "failed",
            output: "",
            error: String(result.reason),
            latencyMs: Date.now() - phaseStartTime,
          });
        }
      }

      // 并行结果聚合
      combinedOutput = this.aggregateParallelResults(agentResults, phase);
    } else {
      // ─── 串行执行 ───
      const agent = selectedAgents[0] || agents[0];
      const result = await invokeAgent(
        agent,
        task,
        phasePrompt,
        signal,
        config.timeoutMs
      );
      agentResults.push(result);
      combinedOutput = result.output;
    }

    // 评估质量分数
    qualityScore = this.evaluateQuality(combinedOutput, phase);

    // 确定阶段状态
    const successCount = agentResults.filter((r) => r.status === "success").length;
    phaseStatus = successCount > 0 ? "completed" : "failed";

    return {
      phase,
      status: phaseStatus,
      agentResults,
      output: combinedOutput,
      qualityScore,
      startTime: phaseStartTime,
      endTime: Date.now(),
      retryCount,
    };
  }

  // ─── 选择阶段 Agent ───

  private selectAgentsForPhase(
    config: HeavyPhaseConfig,
    agents: AgentRegistration[],
    taskPrompt: string
  ): AgentRegistration[] {
    const keywords = this.extractKeywordsForPhase(config.phase, taskPrompt);

    switch (config.agentSelector) {
      case "capability": {
        // 按能力匹配度排序
        const scored = agents.map((agent) => {
          const matches = agent.capabilities.filter((cap) =>
            keywords.some((kw) => cap.toLowerCase().includes(kw))
          ).length;
          const score = matches / Math.max(agent.capabilities.length, 1);
          return { agent, score };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, config.parallelAgents).map((s) => s.agent);
      }

      case "round_robin":
        return agents.slice(0, config.parallelAgents);

      case "load_balanced":
        // 选择当前负载最低的
        return agents
          .sort((a, b) => a.maxConcurrentTasks - b.maxConcurrentTasks)
          .slice(0, config.parallelAgents);

      default:
        return agents.slice(0, config.parallelAgents);
    }
  }

  // ─── 提取阶段关键词 ───

  private extractKeywordsForPhase(phase: HeavyPhase, prompt: string): string[] {
    const phaseKeywords: Record<HeavyPhase, string[]> = {
      research: ["research", "gather", "find", "collect", "explore", "investigate"],
      analysis: ["analyze", "examine", "evaluate", "assess", "study", "interpret"],
      draft: ["draft", "create", "write", "generate", "produce", "compose"],
      review: ["review", "check", "inspect", "audit", "verify", "examine"],
      validate: ["validate", "confirm", "test", "verify", "ensure", "prove"],
    };

    const lowerPrompt = prompt.toLowerCase();
    return [
      ...phaseKeywords[phase],
      ...lowerPrompt.split(/\s+/).filter((w) => w.length > 3),
    ];
  }

  // ─── 构建阶段输入 ───

  private buildPhaseInput(phase: HeavyPhase, task: TaskRequest): string {
    const currentIndex = PHASE_ORDER.indexOf(phase);

    if (currentIndex === 0) {
      // 第一阶段：原始任务
      return task.prompt;
    }

    // 获取上一阶段的输出
    const prevPhase = PHASE_ORDER[currentIndex - 1];
    const prevResult = this.phaseResults.get(prevPhase);

    if (!prevResult) {
      return task.prompt;
    }

    // 应用数据转换器
    const transformerKey = `${prevPhase}-${phase}` as `${HeavyPhase}-${HeavyPhase}`;
    const transformer = this.config.transformers[transformerKey];

    if (transformer) {
      return transformer(prevResult.output, task.context || {});
    }

    return prevResult.output;
  }

  // ─── 聚合并行结果 ───

  private aggregateParallelResults(
    results: AgentResult[],
    phase: HeavyPhase
  ): string {
    const successful = results.filter((r) => r.status === "success");

    if (successful.length === 0) {
      return `All agents failed in ${phase} phase. Errors: ${results
        .map((r) => r.error)
        .join("; ")}`;
    }

    if (successful.length === 1) {
      return successful[0].output;
    }

    // 合并多个输出
    return `[${phase.toUpperCase()} Phase - ${successful.length} Agents]\n\n${successful
      .map((r, i) => `--- Agent ${i + 1} (${r.agentName}) ---\n${r.output}`)
      .join("\n\n")}`;
  }

  // ─── 评估质量分数 ───

  private evaluateQuality(output: string, phase: HeavyPhase): number {
    let score = 0.5;

    // 长度评估
    const length = output.length;
    if (length > 200) score += 0.1;
    if (length > 1000) score += 0.1;

    // 结构评估
    const hasStructure =
      /[#\*\-\d]/.test(output) || output.includes("\n\n") || output.includes("---");
    if (hasStructure) score += 0.1;

    // 关键词丰富度
    const lowerOutput = output.toLowerCase();
    const phaseIndicators: Record<HeavyPhase, string[]> = {
      research: ["finding", "source", "data", "information", "result"],
      analysis: ["analysis", "insight", "conclusion", "pattern", "implication"],
      draft: ["draft", "output", "solution", "implementation", "code"],
      review: ["review", "feedback", "score", "approved", "issue"],
      validate: ["validation", "pass", "fail", "correct", "verified"],
    };

    const indicators = phaseIndicators[phase];
    const indicatorMatches = indicators.filter((ind) =>
      lowerOutput.includes(ind)
    ).length;
    score += (indicatorMatches / indicators.length) * 0.2;

    return Math.min(1, Math.max(0, score));
  }

  // ─── 构建最终结果 ───

  private buildFinalResult(
    task: TaskRequest,
    startTime: number,
    strategy: string
  ): TaskResult {
    const validateResult = this.phaseResults.get("validate");
    const draftResult = this.phaseResults.get("draft");
    const reviewResult = this.phaseResults.get("review");

    // 优先使用验证阶段的输出，其次是草稿
    const finalOutput =
      validateResult?.output ||
      reviewResult?.output ||
      draftResult?.output ||
      "";

    // 收集所有 Agent 结果
    const allAgentResults: AgentResult[] = [];
    for (const result of this.phaseResults.values()) {
      allAgentResults.push(...result.agentResults);
    }

    // 确定状态
    const completedPhases = Array.from(this.phaseResults.values()).filter(
      (r) => r.status === "completed"
    ).length;
    const totalPhases = PHASE_ORDER.length;

    const finalStatus: "success" | "partial" | "failed" =
      completedPhases === totalPhases
        ? "success"
        : completedPhases > 0
          ? "partial"
          : "failed";

    this._state = finalStatus === "success" ? "completed" : finalStatus;

    return buildTaskResult(
      task.id,
      allAgentResults,
      finalOutput,
      finalStatus,
      `heavy-swarm-${strategy}`,
      {
        startedAt: startTime,
        subTasks: Array.from(this.phaseResults.values()).map((r) => ({
          subTaskId: r.phase,
          description: `${r.phase} phase`,
          assignedAgentId: r.agentResults[0]?.agentId || "",
          status: r.status === "completed" ? "success" : "failed",
          output: r.output,
        })),
      }
    );
  }

  // ─── 生命周期 ───

  override async pause(): Promise<void> {
    await super.pause();
  }

  override async resume(): Promise<void> {
    await super.resume();
  }

  override async stop(): Promise<void> {
    this.setState("idle");
    this.phaseResults.clear();
    this.artifacts.clear();
    await super.stop();
  }

  /** 获取流水线状态 */
  getPipelineStatus(): {
    currentPhase: HeavyPhase | null;
    phases: Array<{
      phase: HeavyPhase;
      status: HeavyPhaseStatus;
      qualityScore: number;
      durationMs: number;
    }>;
    rollbackCount: number;
    artifacts: Record<string, string>;
  } {
    return {
      currentPhase: PHASE_ORDER[this.currentPhaseIndex] || null,
      phases: PHASE_ORDER.map((phase) => {
        const result = this.phaseResults.get(phase);
        return {
          phase,
          status: result?.status || "pending",
          qualityScore: result?.qualityScore || 0,
          durationMs: result ? result.endTime - result.startTime : 0,
        };
      }),
      rollbackCount: this.rollbackCount,
      artifacts: Object.fromEntries(this.artifacts.entries()),
    };
  }
}
