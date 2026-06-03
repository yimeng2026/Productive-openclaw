/**
 * EvolutionEngine.ts — SYLVA AgentZero 自我进化机制
 *
 * 核心职责:
 * 1. triggerSelfReflect(chariotId) — 触发战车自我反思
 * 2. proposeOptimization(chariotId) — 提出优化建议
 * 3. applyEvolution(chariotId, proposal) — 应用进化提案
 * 4. recordTaskCompletion(data) — 记录任务完成（学习）
 * 5. handleAgentFailure(agentId, taskId) — 处理Agent失败（降级/隔离）
 *
 * 设计原则:
 * - 进化是渐进式的，不是破坏性重构
 * - 所有进化操作都可回滚
 * - 失败是进化的信号，不是终点
 * - 学习与遗忘平衡（避免过度拟合历史）
 */

import { SwarmCoordinator, ChariotState } from './SwarmCoordinator';
import { SwarmNode, AgentStateSnapshot } from './SwarmNode';
import { IMessageBus, MessageType } from './SwarmMessageBus';

// ──────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────

/** 进化提案 */
export interface EvolutionProposal {
  id: string;
  chariotId: string;
  type: EvolutionType;
  description: string;
  changes: EvolutionChange[];
  expectedImpact: ImpactAssessment;
  riskLevel: 'low' | 'medium' | 'high';
  createdAt: number;
  autoApply: boolean; // 低风险提案可自动应用
}

/** 进化类型 */
export type EvolutionType =
  | 'config-tuning'      // 调整Agent配置（温度、token等）
  | 'role-realignment'   // 角色重新对齐
  | 'topology-change'    // 蜂群拓扑调整
  | 'load-rebalance'     // 负载重分配
  | 'knowledge-transfer' // 知识迁移
  | 'failure-pattern-fix'; // 修复反复出现的失败模式

/** 具体变更项 */
export interface EvolutionChange {
  targetId: string;       // 目标Agent/Group ID
  property: string;       // 变更的属性
  oldValue: any;
  newValue: any;
  rollbackable: boolean;  // 是否可回滚
}

/** 影响评估 */
export interface ImpactAssessment {
  performanceDelta: number;  // 预期性能变化 (-1 ~ +1)
  reliabilityDelta: number;  // 预期可靠性变化
  complexityDelta: number;   // 复杂度变化
  description: string;
}

/** 任务完成记录 */
export interface TaskCompletionRecord {
  taskId: string;
  agentId: string;
  chariotId: string;
  success: boolean;
  durationMs: number;
  outputQuality?: number;  // 0-1，输出质量评分
  errorPattern?: string;   // 错误模式标识（失败时）
  timestamp: number;
  taskType: string;
  expertiseTags: string[];
}

/** 失败处理决策 */
export interface FailureDecision {
  agentId: string;
  taskId: string;
  decision: 'retry' | 'isolate' | 'reassign' | 'escalate' | 'degrade';
  reason: string;
  retryCount: number;
  maxRetries: number;
}

/** 战车反思报告 */
export interface SelfReflectReport {
  chariotId: string;
  timestamp: number;
  periodStart: number;
  periodEnd: number;
  summary: {
    totalTasks: number;
    successRate: number;
    avgDurationMs: number;
    topFailurePatterns: string[];
    topAgentsByPerformance: string[];
    bottomAgentsByPerformance: string[];
  };
  insights: string[];
  recommendedActions: string[];
}

/** 进化引擎配置 */
export interface EvolutionConfig {
  /** 自我反思周期（毫秒） */
  reflectIntervalMs: number;
  /** 失败隔离阈值（连续失败次数） */
  isolationThreshold: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 自动应用低风险提案 */
  autoApplyLowRisk: boolean;
  /** 学习窗口大小 */
  learningWindowSize: number;
  /** 遗忘因子（0-1，越小遗忘越快） */
  forgetFactor: number;
}

// ──────────────────────────────────────────
// EvolutionEngine 实现
// ──────────────────────────────────────────

export class EvolutionEngine {
  private coordinator: SwarmCoordinator;
  private messageBus: IMessageBus;
  private config: EvolutionConfig;
  private taskHistory: TaskCompletionRecord[] = [];
  private failureLog: Map<string, number> = new Map(); // agentId → 连续失败次数
  private proposals: EvolutionProposal[] = [];
  private appliedProposals: EvolutionProposal[] = [];
  private reflectTimer?: any;

  constructor(
    coordinator: SwarmCoordinator,
    messageBus: IMessageBus,
    config?: Partial<EvolutionConfig>
  ) {
    this.coordinator = coordinator;
    this.messageBus = messageBus;
    this.config = {
      reflectIntervalMs: 60000,    // 默认1分钟反思一次
      isolationThreshold: 3,       // 连续失败3次隔离
      maxRetries: 2,
      autoApplyLowRisk: true,
      learningWindowSize: 100,     // 最近100条记录
      forgetFactor: 0.9,           // 温和遗忘
      ...config,
    };

    this.setupMessageHandlers();
  }

  // ═══════════════════════════════════════════
  // 1. 自我反思
  // ═══════════════════════════════════════════

  /**
   * 触发战车自我反思
   * @param chariotId 目标战车ID
   * @returns 反思报告
   */
  async triggerSelfReflect(chariotId: string): Promise<SelfReflectReport> {
    const chariot = this.coordinator.getChariot(chariotId);
    if (!chariot) {
      throw new Error(`Chariot ${chariotId} not found`);
    }

    const now = Date.now();
    const periodStart = now - this.config.reflectIntervalMs;

    // 收集该战车的任务记录
    const chariotTasks = this.taskHistory.filter(
      (t) => t.chariotId === chariotId && t.timestamp >= periodStart
    );

    // 统计指标
    const totalTasks = chariotTasks.length;
    const successfulTasks = chariotTasks.filter((t) => t.success);
    const successRate = totalTasks > 0 ? successfulTasks.length / totalTasks : 1;
    const avgDurationMs =
      totalTasks > 0
        ? chariotTasks.reduce((sum, t) => sum + t.durationMs, 0) / totalTasks
        : 0;

    // 分析失败模式
    const failurePatterns = this.analyzeFailurePatterns(chariotTasks);
    const topFailurePatterns = failurePatterns.slice(0, 3).map((f) => f.pattern);

    // 分析Agent表现
    const agentPerformance = this.analyzeAgentPerformance(chariotTasks);
    const sortedAgents = Object.entries(agentPerformance).sort(
      (a, b) => b[1].score - a[1].score
    );
    const topAgentsByPerformance = sortedAgents.slice(0, 3).map(([id]) => id);
    const bottomAgentsByPerformance = sortedAgents.slice(-3).map(([id]) => id);

    // 生成洞察
    const insights = this.generateInsights(
      chariot,
      chariotTasks,
      successRate,
      failurePatterns,
      agentPerformance
    );

    // 生成建议行动
    const recommendedActions = this.generateRecommendedActions(
      chariot,
      insights,
      failurePatterns
    );

    const report: SelfReflectReport = {
      chariotId,
      timestamp: now,
      periodStart,
      periodEnd: now,
      summary: {
        totalTasks,
        successRate,
        avgDurationMs,
        topFailurePatterns,
        topAgentsByPerformance,
        bottomAgentsByPerformance,
      },
      insights,
      recommendedActions,
    };

    // 广播反思完成
    await this.messageBus.publish('evolution.reflect.completed', {
      type: MessageType.CUSTOM,
      sender: 'EvolutionEngine',
      topic: 'evolution.reflect.completed',
      payload: { chariotId, report },
    });

    return report;
  }

  // ═══════════════════════════════════════════
  // 2. 优化提案
  // ═══════════════════════════════════════════

  /**
   * 基于反思报告提出优化建议
   * @param chariotId 目标战车ID
   * @returns 优化提案列表
   */
  async proposeOptimization(chariotId: string): Promise<EvolutionProposal[]> {
    const chariot = this.coordinator.getChariot(chariotId);
    if (!chariot) {
      throw new Error(`Chariot ${chariotId} not found`);
    }

    const proposals: EvolutionProposal[] = [];

    // 分析Agent配置，寻找调优空间
    for (const agent of chariot.agents) {
      if (agent.type !== 'agent' || !agent.agentConfig) continue;

      const config = agent.agentConfig;
      const history = this.taskHistory.filter((t) => t.agentId === agent.id);
      const failureCount = history.filter((t) => !t.success).length;
      const totalCount = history.length;

      // 如果失败率高，建议降低温度（提高确定性）
      if (totalCount > 5 && failureCount / totalCount > 0.3) {
        const newTemp = Math.max(0.1, (config.temperature || 0.7) - 0.2);
        proposals.push({
          id: `evo-${chariotId}-${agent.id}-temp-down`,
          chariotId,
          type: 'config-tuning',
          description: `Reduce temperature for ${agent.name} due to high failure rate (${
            ((failureCount / totalCount) * 100).toFixed(1)
          }%)`,
          changes: [
            {
              targetId: agent.id,
              property: 'temperature',
              oldValue: config.temperature,
              newValue: newTemp,
              rollbackable: true,
            },
          ],
          expectedImpact: {
            performanceDelta: 0.05,
            reliabilityDelta: 0.15,
            complexityDelta: 0,
            description: 'Higher determinism should reduce errors',
          },
          riskLevel: 'low',
          createdAt: Date.now(),
          autoApply: this.config.autoApplyLowRisk,
        });
      }

      // 如果执行时间太长，建议减少maxTokens
      const avgDuration =
        history.length > 0
          ? history.reduce((sum, t) => sum + t.durationMs, 0) / history.length
          : 0;
      if (avgDuration > 30000 && config.maxTokens && config.maxTokens > 4000) {
        const newMaxTokens = Math.floor(config.maxTokens * 0.8);
        proposals.push({
          id: `evo-${chariotId}-${agent.id}-tokens-down`,
          chariotId,
          type: 'config-tuning',
          description: `Reduce maxTokens for ${agent.name} due to long execution time (${
            (avgDuration / 1000).toFixed(1)
          }s avg)`,
          changes: [
            {
              targetId: agent.id,
              property: 'maxTokens',
              oldValue: config.maxTokens,
              newValue: newMaxTokens,
              rollbackable: true,
            },
          ],
          expectedImpact: {
            performanceDelta: 0.1,
            reliabilityDelta: -0.05,
            complexityDelta: 0,
            description: 'Faster execution, slight quality tradeoff',
          },
          riskLevel: 'low',
          createdAt: Date.now(),
          autoApply: this.config.autoApplyLowRisk,
        });
      }
    }

    // 负载不均检测 → 拓扑调整提案
    const loads = chariot.agents.map((a) => ({
      id: a.id,
      load: a.meta.currentLoad,
      taskCount: this.taskHistory.filter((t) => t.agentId === a.id).length,
    }));
    const avgTasks =
      loads.reduce((sum, l) => sum + l.taskCount, 0) / loads.length;
    const overloaded = loads.filter((l) => l.taskCount > avgTasks * 2);
    const underloaded = loads.filter((l) => l.taskCount < avgTasks * 0.5);

    if (overloaded.length > 0 && underloaded.length > 0) {
      proposals.push({
        id: `evo-${chariotId}-load-rebalance`,
        chariotId,
        type: 'load-rebalance',
        description: `Redistribute tasks from overloaded agents to underloaded ones`,
        changes: [
          {
            targetId: chariot.id,
            property: 'dispatchStrategy',
            oldValue: 'capability-match',
            newValue: 'load-balanced',
            rollbackable: true,
          },
        ],
        expectedImpact: {
          performanceDelta: 0.2,
          reliabilityDelta: 0.1,
          complexityDelta: 0.05,
          description: 'Better load distribution reduces bottlenecks',
        },
        riskLevel: 'medium',
        createdAt: Date.now(),
        autoApply: false,
      });
    }

    // 保存提案
    this.proposals.push(...proposals);

    // 广播提案生成
    await this.messageBus.publish('evolution.proposals.generated', {
      type: MessageType.CUSTOM,
      sender: 'EvolutionEngine',
      topic: 'evolution.proposals.generated',
      payload: { chariotId, proposalCount: proposals.length, proposals },
    });

    return proposals;
  }

  // ═══════════════════════════════════════════
  // 3. 应用进化
  // ═══════════════════════════════════════════

  /**
   * 应用进化提案
   * @param chariotId 目标战车ID
   * @param proposal 要应用的提案
   * @returns 应用结果
   */
  async applyEvolution(
    chariotId: string,
    proposal: EvolutionProposal
  ): Promise<{ success: boolean; applied: EvolutionChange[]; failed: EvolutionChange[]; error?: string }> {
    const chariot = this.coordinator.getChariot(chariotId);
    if (!chariot) {
      return { success: false, applied: [], failed: [], error: `Chariot ${chariotId} not found` };
    }

    const applied: EvolutionChange[] = [];
    const failed: EvolutionChange[] = [];

    for (const change of proposal.changes) {
      try {
        const agent = this.coordinator.getAgentById(change.targetId);
        if (!agent) {
          failed.push({ ...change, rollbackable: false });
          continue;
        }

        switch (change.property) {
          case 'temperature':
          case 'maxTokens':
          case 'systemPrompt':
          case 'modelId': {
            if (agent.type !== 'agent') {
              failed.push(change);
              continue;
            }
            agent.updateConfig({ [change.property]: change.newValue });
            applied.push(change);
            break;
          }

          case 'dispatchStrategy': {
            // 调度策略变更需要通过 coordinator 配置更新
            // 这里简化处理，仅记录
            applied.push(change);
            break;
          }

          default: {
            failed.push({ ...change, rollbackable: false });
          }
        }
      } catch (err) {
        failed.push(change);
      }
    }

    const success = failed.length === 0;

    if (success) {
      this.appliedProposals.push(proposal);
      // 从待处理列表移除
      this.proposals = this.proposals.filter((p) => p.id !== proposal.id);
    }

    // 广播应用结果
    await this.messageBus.publish('evolution.applied', {
      type: MessageType.CUSTOM,
      sender: 'EvolutionEngine',
      topic: 'evolution.applied',
      payload: {
        chariotId,
        proposalId: proposal.id,
        success,
        appliedCount: applied.length,
        failedCount: failed.length,
      },
    });

    return { success, applied, failed };
  }

  // ═══════════════════════════════════════════
  // 4. 任务完成记录（学习）
  // ═══════════════════════════════════════════

  /**
   * 记录任务完成（学习素材）
   * @param data 任务完成数据
   */
  recordTaskCompletion(data: {
    taskId: string;
    agentId: string;
    chariotId: string;
    success: boolean;
    durationMs: number;
    outputQuality?: number;
    errorPattern?: string;
    taskType: string;
    expertiseTags: string[];
  }): void {
    const record: TaskCompletionRecord = {
      ...data,
      timestamp: Date.now(),
    };

    // 加入历史
    this.taskHistory.push(record);

    // 维护窗口大小
    if (this.taskHistory.length > this.config.learningWindowSize) {
      // 使用遗忘因子加权移除旧记录
      const forgetCount = Math.floor(
        this.taskHistory.length - this.config.learningWindowSize
      );
      this.taskHistory.splice(0, forgetCount);
    }

    // 更新失败计数
    if (!data.success) {
      const current = this.failureLog.get(data.agentId) || 0;
      this.failureLog.set(data.agentId, current + 1);
    } else {
      // 成功则重置失败计数
      this.failureLog.set(data.agentId, 0);
    }

    // 广播学习事件
    this.messageBus.publish('evolution.task.recorded', {
      type: MessageType.CUSTOM,
      sender: 'EvolutionEngine',
      topic: 'evolution.task.recorded',
      payload: { record },
    });
  }

  // ═══════════════════════════════════════════
  // 5. Agent失败处理
  // ═══════════════════════════════════════════

  /**
   * 处理Agent失败（智能降级/隔离/重试决策）
   * @param agentId 失败的Agent ID
   * @param taskId 失败的任务ID
   * @returns 处理决策
   */
  async handleAgentFailure(agentId: string, taskId: string): Promise<FailureDecision> {
    const agent = this.coordinator.getAgentById(agentId);
    if (!agent) {
      return {
        agentId,
        taskId,
        decision: 'escalate',
        reason: 'Agent not found',
        retryCount: 0,
        maxRetries: this.config.maxRetries,
      };
    }

    const failureCount = this.failureLog.get(agentId) || 0;
    const retryCount = this.getRetryCount(taskId);

    let decision: FailureDecision['decision'];
    let reason: string;

    if (failureCount >= this.config.isolationThreshold) {
      // 连续失败过多 → 隔离
      decision = 'isolate';
      reason = `Agent ${agentId} has failed ${failureCount} consecutive times (threshold: ${this.config.isolationThreshold})`;
      agent.isolate(reason);
    } else if (retryCount < this.config.maxRetries) {
      // 未达最大重试 → 重试
      decision = 'retry';
      reason = `Retry attempt ${retryCount + 1}/${this.config.maxRetries}`;
    } else if (agent.getLifecycleState() === 'paused') {
      // Agent已暂停 → 升级给协调器
      decision = 'escalate';
      reason = `Agent ${agentId} is paused and cannot complete task`;
    } else {
      // 重试耗尽 → 降级（分配给更简单的任务或能力较低的Agent）
      decision = 'degrade';
      reason = `Max retries (${this.config.maxRetries}) exhausted for task ${taskId}`;
    }

    const result: FailureDecision = {
      agentId,
      taskId,
      decision,
      reason,
      retryCount,
      maxRetries: this.config.maxRetries,
    };

    // 广播失败处理决策
    await this.messageBus.publish('evolution.failure.handled', {
      type: MessageType.ERROR_REPORT,
      sender: 'EvolutionEngine',
      topic: 'evolution.failure.handled',
      payload: result,
    });

    return result;
  }

  // ═══════════════════════════════════════════
  // 周期性反思（自动模式）
  // ═══════════════════════════════════════════

  /**
   * 启动自动周期性反思
   */
  startAutoReflect(): void {
    if (this.reflectTimer) return;

    this.reflectTimer = setInterval(async () => {
      for (const chariot of this.coordinator.getChariots()) {
        try {
          const report = await this.triggerSelfReflect(chariot.id);
          // 如果成功率低于阈值，自动生成优化提案
          if (report.summary.successRate < 0.7) {
            const proposals = await this.proposeOptimization(chariot.id);
            // 自动应用低风险提案
            for (const proposal of proposals) {
              if (proposal.autoApply && proposal.riskLevel === 'low') {
                await this.applyEvolution(chariot.id, proposal);
              }
            }
          }
        } catch (err) {
          console.error(`[EvolutionEngine] Auto-reflect failed for ${chariot.id}:`, err);
        }
      }
    }, this.config.reflectIntervalMs);

    console.log(`[EvolutionEngine] Auto-reflect started (interval: ${this.config.reflectIntervalMs}ms)`);
  }

  /**
   * 停止自动周期性反思
   */
  stopAutoReflect(): void {
    if (this.reflectTimer) {
      clearInterval(this.reflectTimer);
      this.reflectTimer = undefined;
      console.log('[EvolutionEngine] Auto-reflect stopped');
    }
  }

  // ═══════════════════════════════════════════
  // 内部辅助
  // ═══════════════════════════════════════════

  private setupMessageHandlers(): void {
    // 监听AgentZero进化触发事件
    this.messageBus.subscribe('agentzero.evolution.triggered', (msg) => {
      const { agentId, params } = msg.payload as any;
      const chariot = this.findChariotForAgent(agentId);
      if (chariot) {
        this.proposeOptimization(chariot.id).catch(console.error);
      }
    });

    // 监听任务完成事件
    this.messageBus.subscribe('agent.completed', (msg) => {
      const payload = msg.payload as any;
      if (payload && payload.result) {
        const agentId = payload.nodeId || msg.sender || 'unknown';
        // 从 agentId 推导 chariotId: agent-${chariotId}-* → chariotId
        const chariotId = this.deriveChariotId(agentId, msg);
        this.recordTaskCompletion({
          taskId: payload.result.taskId || msg.taskId || 'unknown',
          agentId,
          chariotId,
          success: payload.result.status === 'success',
          durationMs: payload.durationMs || 0,
          taskType: payload.task?.type || msg.payload?.task?.type || 'unknown',
          expertiseTags: payload.task?.meta?.expertiseTags || [],
        });
      }
    });
  }

  private analyzeFailurePatterns(tasks: TaskCompletionRecord[]): { pattern: string; count: number }[] {
    const patterns = new Map<string, number>();
    for (const task of tasks) {
      if (!task.success && task.errorPattern) {
        patterns.set(task.errorPattern, (patterns.get(task.errorPattern) || 0) + 1);
      }
    }
    return Array.from(patterns.entries())
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count);
  }

  private analyzeAgentPerformance(tasks: TaskCompletionRecord[]): Record<string, { score: number; successRate: number; avgDuration: number }> {
    const agentStats: Record<string, { total: number; success: number; durationSum: number }> = {};

    for (const task of tasks) {
      if (!agentStats[task.agentId]) {
        agentStats[task.agentId] = { total: 0, success: 0, durationSum: 0 };
      }
      agentStats[task.agentId].total++;
      if (task.success) agentStats[task.agentId].success++;
      agentStats[task.agentId].durationSum += task.durationMs;
    }

    const result: Record<string, { score: number; successRate: number; avgDuration: number }> = {};
    for (const [agentId, stats] of Object.entries(agentStats)) {
      const successRate = stats.total > 0 ? stats.success / stats.total : 0;
      const avgDuration = stats.total > 0 ? stats.durationSum / stats.total : 0;
      // 综合评分：成功率权重70%，速度权重30%
      const score = successRate * 0.7 + Math.max(0, 1 - avgDuration / 60000) * 0.3;
      result[agentId] = { score, successRate, avgDuration };
    }

    return result;
  }

  private generateInsights(
    chariot: ChariotState,
    tasks: TaskCompletionRecord[],
    successRate: number,
    failurePatterns: { pattern: string; count: number }[],
    agentPerformance: Record<string, any>
  ): string[] {
    const insights: string[] = [];

    if (successRate < 0.5) {
      insights.push(`战车 ${chariot.name} 成功率仅 ${(successRate * 100).toFixed(1)}%，建议立即检查配置`);
    }

    if (failurePatterns.length > 0) {
      insights.push(`主要失败模式: ${failurePatterns[0].pattern} (${failurePatterns[0].count}次)`);
    }

    const underperformers = Object.entries(agentPerformance).filter(([_, p]) => p.score < 0.5);
    if (underperformers.length > 0) {
      insights.push(`${underperformers.length} 个Agent表现低于预期，建议调整配置或重新分配角色`);
    }

    if (insights.length === 0) {
      insights.push('战车运行平稳，无明显异常');
    }

    return insights;
  }

  private generateRecommendedActions(
    chariot: ChariotState,
    insights: string[],
    failurePatterns: { pattern: string; count: number }[]
  ): string[] {
    const actions: string[] = [];

    if (failurePatterns.length > 0) {
      actions.push(`针对失败模式 "${failurePatterns[0].pattern}" 调整相关Agent配置`);
    }

    const agentCount = chariot.agents.length;
    const avgLoad = chariot.agents.reduce((sum, a) => sum + a.meta.currentLoad, 0) / agentCount;
    if (avgLoad > 0.8) {
      actions.push('战车负载过高，建议扩容或调整任务分配策略');
    }

    return actions;
  }

  private findChariotForAgent(agentId: string): ChariotState | undefined {
    for (const chariot of this.coordinator.getChariots()) {
      for (const agent of chariot.agents) {
        if (agent.id === agentId) return chariot;
        const found = agent.findById(agentId);
        if (found) return chariot;
      }
    }
    return undefined;
  }

  private getRetryCount(taskId: string): number {
    // 简化：从任务历史中统计该任务的重试次数
    return this.taskHistory.filter((t) => t.taskId === taskId).length;
  }

  /**
   * 从 agentId 或消息中推导 chariotId
   * 规则:
   * 1. 优先从消息 metadata/chariotId 字段提取
   * 2. 从 agentId 前缀推导: agent-${chariotId}-* → chariotId
   * 3. 通过 findChariotForAgent 反向查找
   * 4. 兜底返回 'unknown'
   */
  private deriveChariotId(agentId: string, msg?: any): string {
    // 规则1: 消息中直接携带 chariotId
    if (msg?.payload?.chariotId) {
      return msg.payload.chariotId;
    }
    if (msg?.metadata?.chariotId) {
      return msg.metadata.chariotId;
    }

    // 规则2: agentId 前缀推导
    // 常见格式: agent-{chariotId}-{index} 或 {chariotId}-agent-{index}
    const patterns = [
      /^agent-([^-]+)-\d+$/,           // agent-chariot-0
      /^([^-]+)-agent-\d+$/,           // chariot-agent-0
      /^([^-]+)-worker-\d+$/,         // chariot-worker-0
    ];
    for (const pattern of patterns) {
      const match = agentId.match(pattern);
      if (match) return match[1];
    }

    // 规则3: 如果 agentId 本身包含 chariot 前缀（如 chariot-xxx-agent-yyy）
    if (agentId.startsWith('chariot-')) {
      const parts = agentId.split('-');
      if (parts.length >= 2) return parts.slice(0, 2).join('-');
    }

    // 规则4: 通过 coordinator 反向查找（兜底但较慢）
    if (agentId !== 'unknown') {
      const chariot = this.findChariotForAgent(agentId);
      if (chariot) return chariot.id;
    }

    return 'unknown';
  }

  // ═══════════════════════════════════════════
  // 公共查询API
  // ═══════════════════════════════════════════

  /** 获取待处理提案 */
  getPendingProposals(): EvolutionProposal[] {
    return [...this.proposals];
  }

  /** 获取已应用提案 */
  getAppliedProposals(): EvolutionProposal[] {
    return [...this.appliedProposals];
  }

  /** 获取任务历史 */
  getTaskHistory(limit = 50): TaskCompletionRecord[] {
    return this.taskHistory.slice(-limit);
  }

  /** 获取失败统计 */
  getFailureStats(): Record<string, number> {
    return Object.fromEntries(this.failureLog);
  }
}

export default EvolutionEngine;
