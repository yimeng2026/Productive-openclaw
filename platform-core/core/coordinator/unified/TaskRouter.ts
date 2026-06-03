// TaskRouter.ts — 任务路由器
// routeTask(task) → 选择目标 Agent / Swarm
// 支持 solo / swarm 模式，约束过滤，多种路由策略

import { logger } from '../../utils/logger';
import { pushTaskStarted } from '../../websocket/push';
import type { AgentRegistry } from './AgentRegistry';
import type {
  TaskRequest,
  TaskResult,
  AgentRegistration,
  SwarmMode,
  RoutingStrategy,
} from './types';
import {
  ContextBudgetManager,
  estimateTokens,
  PRESET_MODEL_CAPABILITIES,
} from './ContextBudgetManager';

interface RouteCandidate {
  agent: AgentRegistration;
  score: number;
  reason: string;
  budgetCheck?: { ok: boolean; remaining: number; reason?: string };
}

export class TaskRouter {
  private registry: AgentRegistry;
  private roundRobinIndex = 0;
  private strategyWeights: Record<RoutingStrategy, Record<string, number>> = {
    priority: { priority: 1.0, latency: 0.0, cost: 0.0 },
    cost: { priority: 0.0, latency: 0.0, cost: 1.0 },
    latency: { priority: 0.0, latency: 1.0, cost: 0.0 },
    balanced: { priority: 0.4, latency: 0.3, cost: 0.3 },
    round_robin: { priority: 0.0, latency: 0.0, cost: 0.0 },
  };

  public budgetManager: ContextBudgetManager;

  constructor(registry: AgentRegistry) {
    this.registry = registry;
    this.budgetManager = new ContextBudgetManager();
  }

  // ── 核心路由 ───────────────────────────────

  async routeTask(task: TaskRequest): Promise<{ agentIds: string[]; mode: SwarmMode; strategy: RoutingStrategy }> {
    logger.info({ taskId: task.id, mode: task.executionMode }, '[TaskRouter] Routing task');

    const strategy = task.routingStrategy || 'balanced';
    const estimatedTokens = this.estimateTaskTokens(task);

    // 明确指定单个 Agent
    if (task.targetAgent) {
      const agent = this.registry.get(task.targetAgent);
      if (!agent) throw new Error(`Target agent not found: ${task.targetAgent}`);
      if (!this.meetsConstraints(agent, task)) {
        throw new Error(`Target agent ${task.targetAgent} does not meet task constraints`);
      }
      const budgetCheck = this.checkContextBudget(agent, estimatedTokens);
      if (!budgetCheck.ok) {
        logger.warn({ taskId: task.id, agentId: agent.id, reason: budgetCheck.reason }, '[TaskRouter] Context budget exceeded');
        throw new Error(`Agent ${agent.id} context budget exceeded: ${budgetCheck.reason}`);
      }
      pushTaskStarted(task.id, agent.id);
      return { agentIds: [agent.id], mode: 'sequential', strategy };
    }

    // 明确指定 Swarm
    if (task.targetSwarm) {
      const swarmAgents = this.registry.getBySwarm(task.targetSwarm);
      if (swarmAgents.length === 0) throw new Error(`No agents found in swarm: ${task.targetSwarm}`);
      const candidates = this.filterByConstraints(swarmAgents, task);
      const budgetFiltered = this.filterByBudget(candidates, estimatedTokens);
      if (budgetFiltered.length === 0) throw new Error(`No agents in swarm meet context budget`);
      return {
        agentIds: budgetFiltered.map((a) => a.id),
        mode: task.swarmMode || 'parallel',
        strategy,
      };
    }

    // 自动路由
    const allHealthy = this.registry.getHealthy();
    const candidates = this.filterByConstraints(allHealthy, task);
    const budgetCandidates = this.filterByBudget(candidates, estimatedTokens);

    if (budgetCandidates.length === 0) {
      throw new Error('No available agents meet task constraints and context budget');
    }

    if (task.executionMode === 'swarm') {
      const selected = this.selectSwarmAgents(budgetCandidates, task, strategy);
      for (const candidate of selected) {
        pushTaskStarted(task.id, candidate.agent.id);
      }
      return {
        agentIds: selected.map((c) => c.agent.id),
        mode: task.swarmMode || 'parallel',
        strategy,
      };
    }

    // solo 模式 —— 选择单个最优 Agent
    const best = this.selectSingleAgent(budgetCandidates, strategy);
    pushTaskStarted(task.id, best.agent.id);
    return { agentIds: [best.agent.id], mode: 'sequential', strategy };
  }

  // ── 上下文预算检查（新增）──────────────────

  private estimateTaskTokens(task: TaskRequest): number {
    let total = estimateTokens(task.prompt, 'qwen');
    if (task.context) total += estimateTokens(JSON.stringify(task.context), 'qwen');
    if (task.attachments) for (const att of task.attachments) total += estimateTokens(att, 'qwen');
    return Math.ceil(total * 1.2);
  }

  private checkContextBudget(agent: AgentRegistration, estimatedTokens: number): {
    ok: boolean;
    remaining: number;
    reason?: string;
  } {
    if (!agent.modelCapability || !agent.contextBudget) {
      const defaultWindow = 32768;
      if (estimatedTokens > defaultWindow * 0.8) {
        return { ok: false, remaining: defaultWindow, reason: `Estimated ${estimatedTokens} > 80% of default ${defaultWindow}` };
      }
      return { ok: true, remaining: defaultWindow };
    }
    const result = this.budgetManager.canAcceptTask(agent.id, estimatedTokens);
    return { ok: result.ok, remaining: result.remaining, reason: result.reason };
  }

  private filterByBudget(agents: AgentRegistration[], estimatedTokens: number): AgentRegistration[] {
    return agents.filter((agent) => {
      const check = this.checkContextBudget(agent, estimatedTokens);
      if (!check.ok) logger.debug({ agentId: agent.id, reason: check.reason }, '[TaskRouter] Budget filter');
      return check.ok;
    });
  }

  // ── 约束过滤 ───────────────────────────────

  private filterByConstraints(agents: AgentRegistration[], task: TaskRequest): AgentRegistration[] {
    return agents.filter((agent) => this.meetsConstraints(agent, task));
  }

  private meetsConstraints(agent: AgentRegistration, task: TaskRequest): boolean {
    // 流式输出
    if (task.requireStreaming && !agent.capabilities.includes('streaming')) {
      return false;
    }
    // 视觉能力
    if (task.requireVision && !agent.capabilities.includes('vision')) {
      return false;
    }
    // 工具调用
    if (task.requireToolUse && !agent.capabilities.includes('toolUse')) {
      return false;
    }
    // 并发上限
    const active = agent.status === 'running' ? 1 : 0; // 简化计数
    if (active >= agent.maxConcurrentTasks) {
      return false;
    }
    // 延迟要求（简化：高优先级 Agent 通常延迟更低）
    if (task.maxLatencyMs && agent.priority < 3) {
      // 低优先级 Agent 可能不满足严格延迟要求
      return false;
    }
    return true;
  }

  // ── 单 Agent 选择策略 ─────────────────────

  private selectSingleAgent(candidates: AgentRegistration[], strategy: RoutingStrategy): RouteCandidate {
    if (strategy === 'round_robin') {
      const pool = candidates.filter((a) => a.status === 'idle');
      if (pool.length === 0) {
        // 回退到任意可用
        return { agent: candidates[0], score: 0, reason: 'round_robin_fallback' };
      }
      this.roundRobinIndex = (this.roundRobinIndex + 1) % pool.length;
      return {
        agent: pool[this.roundRobinIndex],
        score: 0,
        reason: 'round_robin',
      };
    }

    const weights = this.strategyWeights[strategy];
    const scored = candidates.map((agent) => {
      const score = this.scoreAgent(agent, weights);
      return { agent, score, reason: strategy };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0];
  }

  // ── Swarm Agent 选择 ──────────────────────

  private selectSwarmAgents(
    candidates: AgentRegistration[],
    task: TaskRequest,
    strategy: RoutingStrategy
  ): RouteCandidate[] {
    // 根据 swarm 模式选择 Agent 组合
    const mode = task.swarmMode || 'parallel';

    switch (mode) {
      case 'sequential':
        // 串行：选择 2-3 个互补 Agent
        return this.pickSequentialChain(candidates, strategy);
      case 'parallel':
        // 并行：选择多个同质的 idle Agent
        return this.pickParallelPool(candidates, strategy);
      case 'hierarchical':
        // 层级：1 个 leader + N 个 worker
        return this.pickHierarchicalTeam(candidates, strategy);
      case 'dynamic':
        // 动态：选择最优的 idle Agent，运行时动态扩缩
        return this.pickDynamicStart(candidates, strategy);
      default:
        return this.pickParallelPool(candidates, strategy);
    }
  }

  private pickSequentialChain(candidates: AgentRegistration[], strategy: RoutingStrategy): RouteCandidate[] {
    // 按技能互补性排序，形成链式处理
    const weights = this.strategyWeights[strategy];
    const scored = candidates.map((agent) => ({
      agent,
      score: this.scoreAgent(agent, weights),
      reason: 'sequential',
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.min(3, scored.length));
  }

  private pickParallelPool(candidates: AgentRegistration[], strategy: RoutingStrategy): RouteCandidate[] {
    const idle = candidates.filter((a) => a.status === 'idle');
    const pool = idle.length > 0 ? idle : candidates;
    const weights = this.strategyWeights[strategy];
    const scored = pool.map((agent) => ({
      agent,
      score: this.scoreAgent(agent, weights),
      reason: 'parallel',
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.min(pool.length, 5)); // 最多 5 个并行
  }

  private pickHierarchicalTeam(candidates: AgentRegistration[], strategy: RoutingStrategy): RouteCandidate[] {
    const weights = this.strategyWeights[strategy];

    // 找 leader：优先选 role=leader 或 priority 最高的
    const leaders = candidates.filter((a) => a.role === 'leader');
    const leaderPool = leaders.length > 0 ? leaders : candidates;
    const leaderScored = leaderPool.map((agent) => ({
      agent,
      score: this.scoreAgent(agent, weights),
      reason: 'hierarchical_leader',
    }));
    leaderScored.sort((a, b) => b.score - a.score);
    const leader = leaderScored[0];

    // 找 worker：排除 leader，选 idle 的 worker
    const workers = candidates.filter((a) => a.id !== leader.agent.id && (a.role === 'worker' || a.role === 'solo'));
    const workerPool = workers.length > 0 ? workers : candidates.filter((a) => a.id !== leader.agent.id);
    const workerScored = workerPool.map((agent) => ({
      agent,
      score: this.scoreAgent(agent, { ...weights, priority: (weights.priority ?? 0) * 0.5 }),
      reason: 'hierarchical_worker',
    }));
    workerScored.sort((a, b) => b.score - a.score);

    return [leader, ...workerScored.slice(0, Math.min(4, workerScored.length))];
  }

  private pickDynamicStart(candidates: AgentRegistration[], strategy: RoutingStrategy): RouteCandidate[] {
    // 动态模式：先启动 1 个最优 Agent，后续根据负载动态加入
    const best = this.selectSingleAgent(candidates, strategy);
    return [best];
  }

  // ── 评分算法 ───────────────────────────────

  private scoreAgent(agent: AgentRegistration, weights: Record<string, number>): number {
    let score = 0;

    // 优先级分数 (0-10)
    const priorityScore = (agent.priority / 10) * 10;
    score += (weights.priority || 0) * priorityScore;

    // 延迟分数：health 越好分数越高 (0-10)
    const healthScore = agent.health === 'healthy' ? 10 : agent.health === 'degraded' ? 5 : 0;
    score += (weights.latency || 0) * healthScore;

    // 成本分数：并发能力越高越"便宜" (0-10)
    const costScore = Math.min(agent.maxConcurrentTasks / 5, 2) * 5;
    score += (weights.cost || 0) * costScore;

    // 状态加成：idle 有额外加分
    if (agent.status === 'idle') score += 1.5;

    // 健康惩罚
    if (agent.health === 'unhealthy') score -= 5;

    return score;
  }

  // ── 工具方法 ───────────────────────────────

  setStrategyWeights(strategy: RoutingStrategy, weights: Record<string, number>): void {
    this.strategyWeights[strategy] = weights;
  }

  getRoundRobinIndex(): number {
    return this.roundRobinIndex;
  }
}
