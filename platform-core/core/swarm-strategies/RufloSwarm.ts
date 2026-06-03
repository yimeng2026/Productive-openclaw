/**
 * RufloSwarm.ts — Queen/Worker 自学习架构
 *
 * 来源: GitHub (ruflo — Queen/Worker pattern)
 * 特点: Queen Agent 全局记忆管理，Worker Agent 无状态执行
 *        自学习机制：从每次执行中提取经验，更新 Queen 的全局记忆
 *        防遗忘：定期回顾历史任务，保持知识连续性
 *
 * 设计参考: Bee Colony, Ant Colony Optimization, Neural Memory Networks
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

export interface ExperienceEntry {
  id: string;
  taskId: string;
  taskSummary: string;
  approach: string;      // 采用的策略
  outcome: "success" | "partial" | "failed";
  lessons: string[];     // 学到的经验
  keywords: string[];    // 关联关键词
  timestamp: number;
  agentId: string;       // 执行 Agent
}

export interface QueenMemory {
  experiences: ExperienceEntry[];
  /** 全局知识库 */
  knowledgeBase: Map<string, string>;
  /** 技能评分 */
  skillScores: Map<string, number>;
  /** Agent 表现记录 */
  agentPerformance: Map<string, {
    totalTasks: number;
    successRate: number;
    avgLatency: number;
    specialties: string[];
  }>;
  /** 遗忘队列（用于定期回顾） */
  forgetQueue: string[];
  /** 上次回顾时间 */
  lastReviewTime: number;
}

export interface RufloSwarmConfig {
  /** Queen 选举策略 */
  queenElection: "static" | "capability" | "experience" | "health";
  /** Worker 池大小 */
  workerPoolSize: number;
  /** 最大经验条目数 */
  maxExperiences: number;
  /** 经验保留时间（毫秒） */
  experienceRetentionMs: number;
  /** 回顾间隔（毫秒） */
  reviewIntervalMs: number;
  /** 遗忘阈值（低于此分数的经验被遗忘） */
  forgetThreshold: number;
  /** 学习率 */
  learningRate: number;
  /** 是否启用经验复用 */
  enableExperienceReuse: boolean;
  /** 经验相似度阈值 */
  experienceSimilarityThreshold: number;
}

export type RufloSwarmState =
  | "idle"
  | "queen_electing"
  | "memory_loading"
  | "workers_recruiting"
  | "planning"
  | "dispatching"
  | "workers_executing"
  | "collecting"
  | "learning"
  | "memory_updating"
  | "completed"
  | "failed";

// ─── 默认配置 ───

const DEFAULT_CONFIG: RufloSwarmConfig = {
  queenElection: "experience",
  workerPoolSize: 5,
  maxExperiences: 100,
  experienceRetentionMs: 86400000 * 7, // 7 days
  reviewIntervalMs: 3600000, // 1 hour
  forgetThreshold: 0.3,
  learningRate: 0.2,
  enableExperienceReuse: true,
  experienceSimilarityThreshold: 0.6,
};

// ─── RufloSwarm 实现 ───

export class RufloSwarm extends BaseExecutionMode {
  readonly mode: SwarmMode = "ruflo" as SwarmMode;

  private config: RufloSwarmConfig;
  private queen: AgentRegistration | null = null;
  private workers: AgentRegistration[] = [];
  private memory: QueenMemory;
  private swarmState: RufloSwarmState = "idle";
  private reviewTimer: NodeJS.Timeout | null = null;
  private executionStartTime = 0;

  constructor(config?: Partial<RufloSwarmConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.memory = {
      experiences: [],
      knowledgeBase: new Map(),
      skillScores: new Map(),
      agentPerformance: new Map(),
      forgetQueue: [],
      lastReviewTime: Date.now(),
    };
  }

  private setState(state: RufloSwarmState): void {
    const prev = this.swarmState;
    this.swarmState = state;
    logger.info({ from: prev, to: state, taskId: this.currentTaskId }, "RufloSwarm state transition");
  }

  // ─── 选举 Queen ───

  private electQueen(agents: AgentRegistration[]): AgentRegistration | null {
    const available = agents.filter(isAgentAvailable);
    if (available.length === 0) return null;

    switch (this.config.queenElection) {
      case "static":
        return available.find((a) => a.role === "leader") || available[0];

      case "capability":
        return available.reduce((best, current) => {
          const bestScore = best.capabilities.length + best.skills.length;
          const currentScore = current.capabilities.length + current.skills.length;
          return currentScore > bestScore ? current : best;
        });

      case "experience": {
        // 选择历史表现最好的
        const scored = available.map((agent) => {
          const perf = this.memory.agentPerformance.get(agent.id);
          const score = perf
            ? perf.successRate * 0.6 + (1 / (perf.avgLatency / 1000 + 1)) * 0.4
            : 0.5;
          return { agent, score };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored[0].agent;
      }

      case "health":
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

  // ─── 招募 Workers ───

  private recruitWorkers(
    agents: AgentRegistration[],
    queen: AgentRegistration
  ): AgentRegistration[] {
    const candidates = agents.filter(
      (a) => a.id !== queen.id && isAgentAvailable(a)
    );

    // 按能力互补性排序
    const queenSkills = new Set(queen.skills);
    const scored = candidates.map((agent) => {
      const complementary = agent.skills.filter(
        (s) => !queenSkills.has(s)
      ).length;
      return { agent, score: complementary };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, this.config.workerPoolSize).map((s) => s.agent);
  }

  // ─── 查找相似经验 ───

  private findSimilarExperiences(
    taskPrompt: string,
    limit: number = 3
  ): ExperienceEntry[] {
    const keywords = taskPrompt.toLowerCase().split(/\s+/).filter((w) => w.length > 3);

    const scored = this.memory.experiences.map((exp) => {
      const matches = exp.keywords.filter((kw) =>
        keywords.some((taskKw) => taskKw.includes(kw) || kw.includes(taskKw))
      ).length;
      const similarity = matches / Math.max(keywords.length, exp.keywords.length, 1);
      return { exp, similarity };
    });

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored
      .filter((s) => s.similarity >= this.config.experienceSimilarityThreshold)
      .slice(0, limit)
      .map((s) => s.exp);
  }

  // ─── 主执行 ───

  async execute(
    task: TaskRequest,
    agents: AgentRegistration[],
    context: ExecutionContext
  ): Promise<TaskResult> {
    const startTime = Date.now();
    this._state = "running";
    this.currentTaskId = task.id;
    this.executionStartTime = startTime;

    const abortCtrl = this.createAbortController();
    const signal = abortCtrl.signal;

    // ─── 1. 选举 Queen ───
    this.setState("queen_electing");
    this.queen = this.electQueen(agents);

    if (!this.queen) {
      this.setState("failed");
      this._state = "failed";
      return buildTaskResult(
        task.id,
        [],
        "",
        "failed",
        "ruflo-no-queen",
        { startedAt: startTime }
      );
    }

    logger.info(
      { taskId: task.id, queenId: this.queen.id, queenName: this.queen.name },
      "RufloSwarm: queen elected"
    );

    // ─── 2. 加载 Queen 记忆 ───
    this.setState("memory_loading");
    const similarExperiences = this.config.enableExperienceReuse
      ? this.findSimilarExperiences(task.prompt)
      : [];

    logger.info(
      {
        taskId: task.id,
        similarExperiences: similarExperiences.length,
        totalMemory: this.memory.experiences.length,
      },
      "RufloSwarm: memory loaded"
    );

    // ─── 3. 招募 Workers ───
    this.setState("workers_recruiting");
    this.workers = this.recruitWorkers(agents, this.queen);

    if (this.workers.length === 0) {
      logger.warn(
        { taskId: task.id },
        "RufloSwarm: no workers available, queen will work alone"
      );
      this.workers = [this.queen];
    }

    logger.info(
      { taskId: task.id, workerCount: this.workers.length },
      "RufloSwarm: workers recruited"
    );

    // ─── 4. Queen 制定计划 ───
    this.setState("planning");
    const plan = await this.queenPlan(
      this.queen,
      task,
      this.workers,
      similarExperiences,
      signal
    );

    logger.info(
      { taskId: task.id, planSteps: plan.length },
      "RufloSwarm: queen plan created"
    );

    // ─── 5. 分发给 Workers 执行 ───
    this.setState("dispatching");
    const allAgentResults: AgentResult[] = [];
    const executionResults: Array<{
      stepId: string;
      workerId: string;
      result: AgentResult;
      taskDescription: string;
    }> = [];

    this.setState("workers_executing");
    for (const step of plan) {
      if (this.isAborted()) {
        this.setState("failed");
        this._state = "stopped";
        return buildTaskResult(
          task.id,
          allAgentResults,
          "",
          "failed",
          "ruflo-stopped",
          { startedAt: startTime }
        );
      }

      await this.checkPaused();

      const worker = this.selectWorkerForStep(step, this.workers);

      logger.info(
        { taskId: task.id, stepId: step.id, workerId: worker.id },
        "RufloSwarm: dispatching step"
      );

      const result = await invokeAgent(
        worker,
        task,
        step.description,
        signal,
        task.maxLatencyMs
      );

      allAgentResults.push(result);
      executionResults.push({
        stepId: step.id,
        workerId: worker.id,
        result,
        taskDescription: step.description,
      });

      task.onProgress?.(
        `[Ruflo] Step ${step.id} → ${worker.name}: ${result.status}`
      );
    }

    // ─── 6. Queen 收集结果 ───
    this.setState("collecting");
    const collectedOutput = await this.queenCollect(
      this.queen,
      task,
      executionResults,
      signal
    );

    // ─── 7. 学习（提取经验） ───
    this.setState("learning");
    const experience = this.extractExperience(
      task,
      plan,
      executionResults,
      collectedOutput
    );

    // ─── 8. 更新记忆 ───
    this.setState("memory_updating");
    this.updateMemory(experience, executionResults);

    // 检查是否需要回顾
    if (Date.now() - this.memory.lastReviewTime > this.config.reviewIntervalMs) {
      this.performReview();
    }

    // ─── 9. 构建结果 ───
    const successCount = allAgentResults.filter((r) => r.status === "success").length;
    const finalStatus: "success" | "partial" | "failed" =
      successCount === allAgentResults.length
        ? "success"
        : successCount > 0
          ? "partial"
          : "failed";

    this.setState(finalStatus === "success" ? "completed" : "failed");
    this._state = finalStatus === "success" ? "completed" : finalStatus;

    // 增强输出，包含 Queen 的思考
    const enhancedOutput = `[Queen: ${this.queen.name}]\n\n${collectedOutput}\n\n---\n\n[Experience Recorded] ${this.memory.experiences.length} total memories`;

    const taskResult = buildTaskResult(
      task.id,
      allAgentResults,
      enhancedOutput,
      finalStatus,
      "ruflo",
      {
        startedAt: startTime,
        subTasks: executionResults.map((er) => ({
          subTaskId: er.stepId,
          description: er.taskDescription,
          assignedAgentId: er.workerId,
          status: er.result.status === "success" ? "success" : "failed",
          output: er.result.output,
        })),
      }
    );

    task.onComplete?.(taskResult);
    return taskResult;
  }

  // ─── Queen 制定计划 ───

  private async queenPlan(
    queen: AgentRegistration,
    task: TaskRequest,
    workers: AgentRegistration[],
    experiences: ExperienceEntry[],
    signal: AbortSignal
  ): Promise<Array<{ id: string; description: string; suggestedWorker?: string }>> {
    const experienceContext = experiences.length > 0
      ? `Similar past experiences:\n${experiences
          .map(
            (exp) =>
              `- ${exp.taskSummary} (approach: ${exp.approach}, outcome: ${exp.outcome})`
          )
          .join("\n")}`
      : "No similar past experiences.";

    const planPrompt = `You are the Queen of a swarm. Create a detailed execution plan for the following task.

Task: ${task.prompt}

Available Workers: ${workers.map((w) => `${w.name} (skills: ${w.skills.join(", ")})`).join("\n")}

${experienceContext}

Please respond with a JSON array of execution steps:
[
  { "id": "step-1", "description": "detailed step description", "suggestedWorker": "worker-name-optional" },
  ...
]

Each step should be clear, self-contained, and assignable to a worker.`;

    const result = await invokeAgent(queen, task, planPrompt, signal, task.maxLatencyMs);

    let plan: Array<{ id: string; description: string; suggestedWorker?: string }> = [];
    try {
      const jsonMatch = result.output.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        plan = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      logger.warn(
        { taskId: task.id, error: (e as Error).message },
        "RufloSwarm: failed to parse queen plan, using fallback"
      );
    }

    // Fallback
    if (plan.length === 0) {
      plan = workers.map((w, i) => ({
        id: `step-${i + 1}`,
        description: `Part ${i + 1} of: ${task.prompt}`,
        suggestedWorker: w.name,
      }));
    }

    return plan;
  }

  // ─── 为步骤选择 Worker ───

  private selectWorkerForStep(
    step: { id: string; description: string; suggestedWorker?: string },
    workers: AgentRegistration[]
  ): AgentRegistration {
    // 1. 尝试匹配 suggestedWorker
    if (step.suggestedWorker) {
      const suggested = workers.find(
        (w) =>
          w.name.toLowerCase() === step.suggestedWorker!.toLowerCase() ||
          w.id.toLowerCase() === step.suggestedWorker!.toLowerCase()
      );
      if (suggested) return suggested;
    }

    // 2. 按描述关键词匹配能力
    const lowerDesc = step.description.toLowerCase();
    const scored = workers.map((w) => {
      const skillMatches = w.skills.filter((s) =>
        lowerDesc.includes(s.toLowerCase())
      ).length;
      const capMatches = w.capabilities.filter((c) =>
        lowerDesc.includes(c.toLowerCase())
      ).length;
      return { worker: w, score: skillMatches + capMatches };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.worker || workers[0];
  }

  // ─── Queen 收集结果 ───

  private async queenCollect(
    queen: AgentRegistration,
    task: TaskRequest,
    results: Array<{
      stepId: string;
      workerId: string;
      result: AgentResult;
      taskDescription: string;
    }>,
    signal: AbortSignal
  ): Promise<string> {
    const collectPrompt = `You are the Queen. Your workers have completed their tasks.
Synthesize their results into a final output.

Original Task: ${task.prompt}

Worker Results:
${results
  .map(
    (r) =>
      `[${r.stepId}] ${r.result.agentName} (${r.result.status}):\n${r.result.output}`
  )
  .join("\n\n")}

Provide a comprehensive final answer that integrates all worker results. Note any gaps if some workers failed.`;

    const result = await invokeAgent(queen, task, collectPrompt, signal, task.maxLatencyMs);
    return result.output;
  }

  // ─── 提取经验 ───

  private extractExperience(
    task: TaskRequest,
    plan: Array<{ id: string; description: string }>,
    results: Array<{
      stepId: string;
      workerId: string;
      result: AgentResult;
    }>,
    finalOutput: string
  ): ExperienceEntry {
    const successCount = results.filter((r) => r.result.status === "success").length;
    const outcome: "success" | "partial" | "failed" =
      successCount === results.length
        ? "success"
        : successCount > 0
          ? "partial"
          : "failed";

    const keywords = task.prompt
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 10);

    // 提取教训
    const lessons: string[] = [];
    if (outcome === "failed") {
      lessons.push("Task failed — review approach needed");
    }
    if (successCount < results.length) {
      lessons.push(`${results.length - successCount} workers failed — consider redundancy`);
    }
    if (finalOutput.length < 100) {
      lessons.push("Output too short — may need more detailed planning");
    }

    return {
      id: `exp-${Date.now()}`,
      taskId: task.id,
      taskSummary: task.prompt.slice(0, 200),
      approach: `Plan with ${plan.length} steps, ${results.length} workers`,
      outcome,
      lessons,
      keywords,
      timestamp: Date.now(),
      agentId: this.queen?.id || "",
    };
  }

  // ─── 更新记忆 ───

  private updateMemory(
    experience: ExperienceEntry,
    results: Array<{
      stepId: string;
      workerId: string;
      result: AgentResult;
    }>
  ): void {
    // 添加经验
    this.memory.experiences.push(experience);

    // 限制经验数量
    if (this.memory.experiences.length > this.config.maxExperiences) {
      // 移除最旧的低质量经验
      const sorted = this.memory.experiences
        .map((exp, idx) => ({
          exp,
          idx,
          score: exp.outcome === "success" ? 1 : exp.outcome === "partial" ? 0.5 : 0,
          age: Date.now() - exp.timestamp,
        }))
        .sort((a, b) => {
          if (a.score !== b.score) return a.score - b.score;
          return b.age - a.age;
        });

      const toRemove = sorted.slice(0, this.memory.experiences.length - this.config.maxExperiences);
      const removeIndices = new Set(toRemove.map((t) => t.idx));
      this.memory.experiences = this.memory.experiences.filter(
        (_, idx) => !removeIndices.has(idx)
      );
    }

    // 更新 Agent 表现
    for (const r of results) {
      const perf = this.memory.agentPerformance.get(r.workerId) || {
        totalTasks: 0,
        successRate: 0.5,
        avgLatency: 0,
        specialties: [],
      };

      perf.totalTasks++;
      const success = r.result.status === "success" ? 1 : 0;
      perf.successRate =
        perf.successRate * (1 - this.config.learningRate) +
        success * this.config.learningRate;
      perf.avgLatency =
        perf.avgLatency * 0.9 + r.result.latencyMs * 0.1;

      this.memory.agentPerformance.set(r.workerId, perf);
    }

    // 更新 Queen 表现
    if (this.queen) {
      const queenPerf = this.memory.agentPerformance.get(this.queen.id) || {
        totalTasks: 0,
        successRate: 0.5,
        avgLatency: 0,
        specialties: [],
      };
      queenPerf.totalTasks++;
      const queenSuccess = experience.outcome === "success" ? 1 : 0;
      queenPerf.successRate =
        queenPerf.successRate * (1 - this.config.learningRate) +
        queenSuccess * this.config.learningRate;
      this.memory.agentPerformance.set(this.queen.id, queenPerf);
    }

    logger.info(
      {
        taskId: this.currentTaskId,
        memorySize: this.memory.experiences.length,
        experienceOutcome: experience.outcome,
      },
      "RufloSwarm: memory updated"
    );
  }

  // ─── 定期回顾 ───

  private performReview(): void {
    logger.info(
      { memorySize: this.memory.experiences.length },
      "RufloSwarm: performing memory review"
    );

    const now = Date.now();
    const retentionLimit = now - this.config.experienceRetentionMs;

    // 1. 清理过期经验
    const beforeCount = this.memory.experiences.length;
    this.memory.experiences = this.memory.experiences.filter(
      (exp) => exp.timestamp > retentionLimit
    );
    const removed = beforeCount - this.memory.experiences.length;

    // 2. 遗忘低质量经验
    const forgetBefore = this.memory.experiences.length;
    this.memory.experiences = this.memory.experiences.filter((exp) => {
      const score = exp.outcome === "success" ? 1 : exp.outcome === "partial" ? 0.5 : 0;
      return score >= this.config.forgetThreshold;
    });
    const forgotten = forgetBefore - this.memory.experiences.length;

    this.memory.lastReviewTime = now;

    logger.info(
      { removed, forgotten, remaining: this.memory.experiences.length },
      "RufloSwarm: memory review completed"
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
    if (this.reviewTimer) {
      clearInterval(this.reviewTimer);
      this.reviewTimer = null;
    }
    this.queen = null;
    this.workers = [];
    await super.stop();
  }

  /** 获取记忆状态 */
  getMemoryStatus(): {
    experienceCount: number;
    agentPerformance: Array<{
      agentId: string;
      totalTasks: number;
      successRate: number;
      avgLatency: number;
    }>;
    lastReviewTime: number;
  } {
    return {
      experienceCount: this.memory.experiences.length,
      agentPerformance: Array.from(this.memory.agentPerformance.entries()).map(
        ([agentId, perf]) => ({
          agentId,
          totalTasks: perf.totalTasks,
          successRate: perf.successRate,
          avgLatency: perf.avgLatency,
        })
      ),
      lastReviewTime: this.memory.lastReviewTime,
    };
  }

  /** 获取经验列表 */
  getExperiences(limit: number = 10): ExperienceEntry[] {
    return this.memory.experiences.slice(-limit);
  }

  /** 手动添加经验 */
  addExperience(experience: ExperienceEntry): void {
    this.memory.experiences.push(experience);
    if (this.memory.experiences.length > this.config.maxExperiences) {
      this.memory.experiences.shift();
    }
  }
}
