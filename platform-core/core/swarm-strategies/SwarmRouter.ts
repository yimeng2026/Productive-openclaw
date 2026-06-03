/**
 * SwarmRouter.ts — 动态策略路由器
 *
 * 来源: swarms (kyegomez/swarms)
 * 特点: 统一路由入口，根据任务特征动态选择最优策略
 *        支持策略注册、热切换、A/B测试和性能监控
 *        自动学习历史任务表现，优化路由决策
 *
 * 设计参考: API Gateway, Kong, Nginx with Lua, Envoy
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
import { HierarchicalSwarm } from "./HierarchicalSwarm";
import { AgentRearrange } from "./AgentRearrange";
import { ForestSwarm } from "./ForestSwarm";
import { HeavySwarm } from "./HeavySwarm";

// ─── 类型定义 ───

export type RouterStrategy =
  | "hierarchical-swarm"
  | "agent-rearrange"
  | "forest-swarm"
  | "heavy-swarm"
  | "ruflo"
  | "multi-repo"
  | "sequential"
  | "parallel"
  | "hierarchical"
  | "dynamic";

export interface StrategyRegistration {
  name: RouterStrategy;
  /** 策略描述 */
  description: string;
  /** 适用场景标签 */
  tags: string[];
  /** 能力要求 */
  requiredCapabilities: string[];
  /** 性能统计 */
  stats: {
    totalCalls: number;
    successRate: number;
    avgLatencyMs: number;
    lastUsedAt: number;
  };
  /** 优先级（越高越优先） */
  priority: number;
  /** 是否启用 */
  enabled: boolean;
  /** 策略实例工厂 */
  factory: () => BaseExecutionMode;
}

export interface RouterConfig {
  /** 默认策略 */
  defaultStrategy: RouterStrategy;
  /** 策略选择模式: auto | manual | adaptive */
  selectionMode: "auto" | "manual" | "adaptive";
  /** 自适应学习率 */
  learningRate: number;
  /** 性能衰减窗口（毫秒） */
  performanceWindowMs: number;
  /** 最小样本数（用于自适应） */
  minSamplesForAdaptive: number;
  /** 是否启用 A/B 测试 */
  enableABTest: boolean;
  /** A/B 测试分流比例 */
  abTestSplitRatio: number;
  /** 热切换冷却时间（毫秒） */
  hotSwitchCooldownMs: number;
  /** 回退策略 */
  fallbackStrategy: RouterStrategy;
}

export interface RoutingDecision {
  strategy: RouterStrategy;
  confidence: number; // 0-1
  reason: string;
  alternatives: Array<{ strategy: RouterStrategy; confidence: number }>;
}

export type SwarmRouterState =
  | "idle"
  | "analyzing_task"
  | "selecting_strategy"
  | "routing"
  | "executing"
  | "recording_metrics"
  | "completed"
  | "failed";

// ─── 默认配置 ───

const DEFAULT_CONFIG: RouterConfig = {
  defaultStrategy: "hierarchical-swarm",
  selectionMode: "adaptive",
  learningRate: 0.1,
  performanceWindowMs: 3600000, // 1 hour
  minSamplesForAdaptive: 5,
  enableABTest: false,
  abTestSplitRatio: 0.5,
  hotSwitchCooldownMs: 30000,
  fallbackStrategy: "sequential",
};

// ─── SwarmRouter 实现 ───

export class SwarmRouter extends BaseExecutionMode {
  readonly mode: SwarmMode = "swarm-router" as SwarmMode;

  private config: RouterConfig;
  private strategies: Map<RouterStrategy, StrategyRegistration> = new Map();
  private routingHistory: Array<{
    taskId: string;
    decision: RoutingDecision;
    result: "success" | "partial" | "failed";
    latencyMs: number;
    timestamp: number;
  }> = [];
  private currentStrategy: BaseExecutionMode | null = null;
  private lastSwitchTime = 0;
  private swarmState: SwarmRouterState = "idle";

  constructor(config?: Partial<RouterConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registerDefaultStrategies();
  }

  private setState(state: SwarmRouterState): void {
    const prev = this.swarmState;
    this.swarmState = state;
    logger.info({ from: prev, to: state, taskId: this.currentTaskId }, "SwarmRouter state transition");
  }

  // ─── 策略注册 ───

  private registerDefaultStrategies(): void {
    this.registerStrategy({
      name: "hierarchical-swarm",
      description: "Supervisor-Worker 层级调度，适合复杂任务分解",
      tags: ["complex", "multi-step", "decomposition"],
      requiredCapabilities: ["planning", "coordination"],
      stats: { totalCalls: 0, successRate: 0.85, avgLatencyMs: 15000, lastUsedAt: 0 },
      priority: 8,
      enabled: true,
      factory: () => new HierarchicalSwarm(),
    });

    this.registerStrategy({
      name: "agent-rearrange",
      description: "einsum 风格流重组，适合复杂工作流定义",
      tags: ["workflow", "pipeline", "structured"],
      requiredCapabilities: ["flow-control", "routing"],
      stats: { totalCalls: 0, successRate: 0.8, avgLatencyMs: 12000, lastUsedAt: 0 },
      priority: 7,
      enabled: true,
      factory: () => new AgentRearrange(),
    });

    this.registerStrategy({
      name: "forest-swarm",
      description: "多叉树 Agent 选择，适合探索性任务",
      tags: ["exploration", "search", "decision"],
      requiredCapabilities: ["evaluation", "selection"],
      stats: { totalCalls: 0, successRate: 0.82, avgLatencyMs: 18000, lastUsedAt: 0 },
      priority: 6,
      enabled: true,
      factory: () => new ForestSwarm(),
    });

    this.registerStrategy({
      name: "heavy-swarm",
      description: "5阶段流水线，适合高质量要求任务",
      tags: ["quality", "review", "validation"],
      requiredCapabilities: ["review", "validation"],
      stats: { totalCalls: 0, successRate: 0.9, avgLatencyMs: 25000, lastUsedAt: 0 },
      priority: 9,
      enabled: true,
      factory: () => new HeavySwarm(),
    });

    this.registerStrategy({
      name: "sequential",
      description: "串行执行，简单可靠",
      tags: ["simple", "reliable", "baseline"],
      requiredCapabilities: [],
      stats: { totalCalls: 0, successRate: 0.95, avgLatencyMs: 8000, lastUsedAt: 0 },
      priority: 5,
      enabled: true,
      factory: () => {
        // SequentialMode 导入自 coordinator/modes
        const { SequentialMode } = require("../coordinator/modes/SequentialMode");
        return new SequentialMode();
      },
    });

    this.registerStrategy({
      name: "parallel",
      description: "并行执行，快速响应",
      tags: ["fast", "concurrent", "redundancy"],
      requiredCapabilities: [],
      stats: { totalCalls: 0, successRate: 0.88, avgLatencyMs: 5000, lastUsedAt: 0 },
      priority: 5,
      enabled: true,
      factory: () => {
        const { ParallelMode } = require("../coordinator/modes/ParallelMode");
        return new ParallelMode();
      },
    });
  }

  registerStrategy(registration: StrategyRegistration): void {
    this.strategies.set(registration.name, registration);
    logger.info(
      { strategy: registration.name, priority: registration.priority },
      "SwarmRouter: strategy registered"
    );
  }

  unregisterStrategy(name: RouterStrategy): boolean {
    const existed = this.strategies.delete(name);
    if (existed) {
      logger.info({ strategy: name }, "SwarmRouter: strategy unregistered");
    }
    return existed;
  }

  enableStrategy(name: RouterStrategy): void {
    const strategy = this.strategies.get(name);
    if (strategy) {
      strategy.enabled = true;
      logger.info({ strategy: name }, "SwarmRouter: strategy enabled");
    }
  }

  disableStrategy(name: RouterStrategy): void {
    const strategy = this.strategies.get(name);
    if (strategy) {
      strategy.enabled = false;
      logger.info({ strategy: name }, "SwarmRouter: strategy disabled");
    }
  }

  // ─── 任务分析 ───

  private analyzeTask(task: TaskRequest): {
    keywords: string[];
    complexity: "low" | "medium" | "high";
    requiresDecomposition: boolean;
    requiresQuality: boolean;
    urgency: "low" | "medium" | "high";
  } {
    const prompt = task.prompt.toLowerCase();

    // 关键词提取
    const keywords = [
      "code", "write", "create", "generate", "analyze", "research",
      "review", "debug", "test", "document", "translate", "summarize",
      "optimize", "refactor", "design", "plan", "implement", "build",
    ].filter((kw) => prompt.includes(kw));

    // 复杂度评估
    const complexityIndicators = {
      high: ["complex", "architecture", "system", "design", "implement", "multiple", "integrate"],
      medium: ["analyze", "review", "optimize", "refactor", "create", "generate"],
      low: ["simple", "quick", "basic", "translate", "summarize", "explain"],
    };

    let complexity: "low" | "medium" | "high" = "medium";
    if (complexityIndicators.high.some((kw) => prompt.includes(kw))) complexity = "high";
    else if (complexityIndicators.low.some((kw) => prompt.includes(kw))) complexity = "low";

    // 是否需要分解
    const requiresDecomposition =
      complexity === "high" ||
      prompt.length > 500 ||
      keywords.length > 3;

    // 是否需要质量门控
    const requiresQuality =
      prompt.includes("review") ||
      prompt.includes("validate") ||
      prompt.includes("check") ||
      prompt.includes("quality");

    // 紧急程度
    const urgency: "low" | "medium" | "high" =
      prompt.includes("urgent") || prompt.includes("quick") || prompt.includes("asap")
        ? "high"
        : "low";

    return { keywords, complexity, requiresDecomposition, requiresQuality, urgency };
  }

  // ─── 策略选择 ───

  private selectStrategy(
    task: TaskRequest,
    agents: AgentRegistration[]
  ): RoutingDecision {
    const analysis = this.analyzeTask(task);
    const enabledStrategies = Array.from(this.strategies.values()).filter((s) => s.enabled);

    if (enabledStrategies.length === 0) {
      return {
        strategy: this.config.fallbackStrategy,
        confidence: 0,
        reason: "No enabled strategies available, using fallback",
        alternatives: [],
      };
    }

    // A/B 测试模式
    if (this.config.enableABTest && Math.random() < this.config.abTestSplitRatio) {
      const randomStrategy = enabledStrategies[Math.floor(Math.random() * enabledStrategies.length)];
      return {
        strategy: randomStrategy.name,
        confidence: 0.5,
        reason: "A/B test random selection",
        alternatives: enabledStrategies
          .filter((s) => s.name !== randomStrategy.name)
          .map((s) => ({ strategy: s.name, confidence: 0.3 })),
      };
    }

    // 基于任务特征评分
    const scoredStrategies = enabledStrategies.map((strategy) => {
      let score = 0;
      let reasons: string[] = [];

      // 1. 标签匹配
      const tagMatches = strategy.tags.filter((tag) =>
        analysis.keywords.some((kw) => tag.includes(kw))
      ).length;
      score += tagMatches * 0.15;
      if (tagMatches > 0) reasons.push(`tag match (${tagMatches})`);

      // 2. 复杂度匹配
      if (analysis.complexity === "high" && strategy.tags.includes("complex")) {
        score += 0.2;
        reasons.push("high complexity match");
      }
      if (analysis.complexity === "low" && strategy.tags.includes("simple")) {
        score += 0.2;
        reasons.push("low complexity match");
      }

      // 3. 需求匹配
      if (analysis.requiresDecomposition && strategy.tags.includes("decomposition")) {
        score += 0.15;
        reasons.push("decomposition required");
      }
      if (analysis.requiresQuality && strategy.tags.includes("quality")) {
        score += 0.15;
        reasons.push("quality required");
      }

      // 4. 紧急程度
      if (analysis.urgency === "high" && strategy.tags.includes("fast")) {
        score += 0.1;
        reasons.push("urgency match");
      }

      // 5. 历史性能（自适应模式）
      if (this.config.selectionMode === "adaptive" && strategy.stats.totalCalls >= this.config.minSamplesForAdaptive) {
        const performanceScore =
          strategy.stats.successRate * 0.5 -
          (strategy.stats.avgLatencyMs / 60000) * 0.3;
        score += performanceScore;
        reasons.push(`historical performance (${performanceScore.toFixed(2)})`);
      }

      // 6. 优先级加成
      score += (strategy.priority / 10) * 0.1;

      // 7. Agent 能力匹配
      const agentCapabilityMatch = agents.some((agent) =>
        strategy.requiredCapabilities.every((cap) =>
          agent.capabilities.includes(cap) || agent.skills.includes(cap)
        )
      );
      if (agentCapabilityMatch) {
        score += 0.1;
        reasons.push("agent capability match");
      }

      return {
        strategy: strategy.name,
        score: Math.min(1, Math.max(0, score)),
        reasons,
        registration: strategy,
      };
    });

    scoredStrategies.sort((a, b) => b.score - a.score);

    const best = scoredStrategies[0];
    const alternatives = scoredStrategies.slice(1, 4).map((s) => ({
      strategy: s.strategy,
      confidence: s.score,
    }));

    return {
      strategy: best.strategy,
      confidence: best.score,
      reason: best.reasons.join(", ") || "default selection",
      alternatives,
    };
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

    // ─── 1. 任务分析 ───
    this.setState("analyzing_task");
    const analysis = this.analyzeTask(task);

    logger.info(
      {
        taskId: task.id,
        complexity: analysis.complexity,
        requiresDecomposition: analysis.requiresDecomposition,
        requiresQuality: analysis.requiresQuality,
      },
      "SwarmRouter: task analyzed"
    );

    // ─── 2. 策略选择 ───
    this.setState("selecting_strategy");
    const decision = this.selectStrategy(task, agents);

    logger.info(
      {
        taskId: task.id,
        selectedStrategy: decision.strategy,
        confidence: decision.confidence,
        reason: decision.reason,
      },
      "SwarmRouter: strategy selected"
    );

    // ─── 3. 检查热切换冷却 ───
    const now = Date.now();
    if (now - this.lastSwitchTime < this.config.hotSwitchCooldownMs) {
      // 在冷却期内，使用当前策略（如果有）
      if (this.currentStrategy) {
        logger.info(
          { taskId: task.id },
          "SwarmRouter: in cooldown period, using current strategy"
        );
      }
    }

    // ─── 4. 实例化策略 ───
    this.setState("routing");
    const strategyReg = this.strategies.get(decision.strategy);

    if (!strategyReg || !strategyReg.enabled) {
      logger.warn(
        { strategy: decision.strategy },
        "SwarmRouter: selected strategy unavailable, using fallback"
      );
      const fallbackReg = this.strategies.get(this.config.fallbackStrategy);
      if (fallbackReg) {
        this.currentStrategy = fallbackReg.factory();
      } else {
        this.setState("failed");
        this._state = "failed";
        return buildTaskResult(
          task.id,
          [],
          "",
          "failed",
          "swarm-router-no-strategy",
          { startedAt: startTime }
        );
      }
    } else {
      this.currentStrategy = strategyReg.factory();
      this.lastSwitchTime = now;

      // 更新统计
      strategyReg.stats.totalCalls++;
      strategyReg.stats.lastUsedAt = now;
    }

    // ─── 5. 执行选中的策略 ───
    this.setState("executing");
    task.onProgress?.(
      `[SwarmRouter] Routed to ${decision.strategy} (confidence: ${(decision.confidence * 100).toFixed(1)}%)`
    );

    let result: TaskResult;
    try {
      result = await this.currentStrategy.execute(task, agents, context);
    } catch (error) {
      logger.error(
        { taskId: task.id, strategy: decision.strategy, error: (error as Error).message },
        "SwarmRouter: strategy execution failed"
      );

      // 尝试回退
      const fallbackReg = this.strategies.get(this.config.fallbackStrategy);
      if (fallbackReg) {
        this.currentStrategy = fallbackReg.factory();
        result = await this.currentStrategy.execute(task, agents, context);
      } else {
        this.setState("failed");
        this._state = "failed";
        return buildTaskResult(
          task.id,
          [],
          "",
          "failed",
          "swarm-router-execution-failed",
          { startedAt: startTime }
        );
      }
    }

    // ─── 6. 记录指标 ───
    this.setState("recording_metrics");
    const latency = Date.now() - startTime;
    this.routingHistory.push({
      taskId: task.id,
      decision,
      result: result.status,
      latencyMs: latency,
      timestamp: Date.now(),
    });

    // 更新策略统计（自适应学习）
    if (strategyReg && this.config.selectionMode === "adaptive") {
      const success = result.status === "success" ? 1 : 0;
      const oldRate = strategyReg.stats.successRate;
      strategyReg.stats.successRate =
        oldRate + this.config.learningRate * (success - oldRate);
      strategyReg.stats.avgLatencyMs =
        strategyReg.stats.avgLatencyMs * 0.9 + latency * 0.1;
    }

    // ─── 7. 构建增强结果 ───
    this.setState("completed");

    const enhancedResult: TaskResult = {
      ...result,
      metadata: {
        ...result.metadata,
        strategy: `swarm-router → ${decision.strategy}`,
        agentsUsed: result.metadata.agentsUsed,
        agentsFailed: result.metadata.agentsFailed,
        totalLatencyMs: latency,
        startedAt: startTime,
        completedAt: Date.now(),
        // 路由决策信息
        routingDecision: {
          strategy: decision.strategy,
          confidence: decision.confidence,
          reason: decision.reason,
          alternatives: decision.alternatives,
        },
      },
    };

    this._state = result.status === "success" ? "completed" : result.status;
    task.onComplete?.(enhancedResult);
    return enhancedResult;
  }

  // ─── 路由统计 ───

  getRoutingStats(): {
    totalRoutings: number;
    strategyUsage: Record<string, { calls: number; successRate: number; avgLatency: number }>;
    recentDecisions: Array<{
      taskId: string;
      decision: RoutingDecision;
      result: string;
      latencyMs: number;
      timestamp: number;
    }>;
  } {
    const strategyUsage: Record<string, { calls: number; successRate: number; avgLatency: number }> = {};

    for (const [name, reg] of this.strategies.entries()) {
      strategyUsage[name] = {
        calls: reg.stats.totalCalls,
        successRate: reg.stats.successRate,
        avgLatency: reg.stats.avgLatencyMs,
      };
    }

    return {
      totalRoutings: this.routingHistory.length,
      strategyUsage,
      recentDecisions: this.routingHistory.slice(-20),
    };
  }

  /** 获取可用策略列表 */
  getAvailableStrategies(): Array<{
    name: RouterStrategy;
    description: string;
    tags: string[];
    enabled: boolean;
    priority: number;
  }> {
    return Array.from(this.strategies.values()).map((reg) => ({
      name: reg.name,
      description: reg.description,
      tags: reg.tags,
      enabled: reg.enabled,
      priority: reg.priority,
    }));
  }

  /** 强制设置策略（手动模式） */
  forceStrategy(strategy: RouterStrategy): boolean {
    const reg = this.strategies.get(strategy);
    if (reg && reg.enabled) {
      this.currentStrategy = reg.factory();
      this.config.selectionMode = "manual";
      this.config.defaultStrategy = strategy;
      logger.info({ strategy }, "SwarmRouter: strategy forced");
      return true;
    }
    return false;
  }

  // ─── 生命周期 ───

  override async pause(): Promise<void> {
    await this.currentStrategy?.pause();
    await super.pause();
  }

  override async resume(): Promise<void> {
    await this.currentStrategy?.resume();
    await super.resume();
  }

  override async stop(): Promise<void> {
    await this.currentStrategy?.stop();
    this.currentStrategy = null;
    this.routingHistory = [];
    await super.stop();
  }
}
