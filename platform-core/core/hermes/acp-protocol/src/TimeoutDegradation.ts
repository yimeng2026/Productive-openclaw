import {
  SubTask,
  DegradationLevel,
  DegradationPlan,
  TimeoutConfig,
  TaskStatus,
} from './types';

// ============================================================
// Timeout & Degradation Handler
// ============================================================
// Default timeouts:
//   - Simple task  : 30 s
//   - Complex task : 5 min
//   - Research task: 10 min
//
// Degradation chain: full → simplified → placeholder → skip
// User notification on every level drop.

export class TimeoutDegradation {
  private config: TimeoutConfig;
  private activeTimers = new Map<string, NodeJS.Timeout>();
  private onDegrade: ((plan: DegradationPlan) => void) | null = null;

  constructor(config: TimeoutConfig, onDegrade?: (plan: DegradationPlan) => void) {
    this.config = config;
    this.onDegrade = onDegrade ?? null;
  }

  /**
   * Register a subtask with its computed timeout.
   */
  register(subtask: SubTask): void {
    const timeoutMs = this.resolveTimeout(subtask);
    subtask.timeoutMs = timeoutMs;

    const timer = setTimeout(() => {
      this.handleTimeout(subtask);
    }, timeoutMs);

    this.activeTimers.set(subtask.id, timer);
  }

  /**
   * Mark a subtask as completed — cancel its timeout.
   */
  complete(subtaskId: string): void {
    const timer = this.activeTimers.get(subtaskId);
    if (timer) {
      clearTimeout(timer);
      this.activeTimers.delete(subtaskId);
    }
  }

  /**
   * Manually trigger degradation for a subtask.
   */
  degrade(subtask: SubTask, reason: string): DegradationPlan {
    const nextLevelIdx = this.findNextDegradationIndex(subtask);

    if (nextLevelIdx >= subtask.degradationChain.length) {
      // Exhausted chain → skip
      return this.createSkipPlan(subtask, reason);
    }

    const newLevel = subtask.degradationChain[nextLevelIdx]!;
    const degraded = this.buildDegradedTask(subtask, newLevel);
    const plan: DegradationPlan = {
      original: subtask,
      degraded,
      level: newLevel,
      reason: `${reason} → degraded to ${newLevel}`,
    };

    subtask.status = 'degraded' as TaskStatus;
    this.onDegrade?.(plan);

    // Re-register with shorter timeout if still active
    this.activeTimers.delete(subtask.id);
    this.register(degraded);

    return plan;
  }

  /**
   * Resolve timeout based on task characteristics.
   */
  resolveTimeout(subtask: SubTask): number {
    const role = subtask.role;
    const complexity = subtask.estimatedComplexity;

    // Classify by role + complexity
    if (role === 'researcher' || complexity >= 8) {
      return this.config.researchTaskMs;
    }
    if (complexity >= 5) {
      return this.config.complexTaskMs;
    }
    return this.config.simpleTaskMs;
  }

  /**
   * Build a user-facing progress notification string.
   */
  static formatNotification(plan: DegradationPlan): string {
    const { degraded, level, reason } = plan;
    const agent = degraded.assignedAgentId ?? 'unassigned';
    return `[Degradation] Agent ${agent} for "${degraded.description.slice(0, 60)}..." ` +
      `→ ${level}. Reason: ${reason}`;
  }

  // ---- Internal ----

  private handleTimeout(subtask: SubTask): void {
    this.activeTimers.delete(subtask.id);
    const plan = this.degrade(subtask, 'timeout');

    // If degraded to skip and user callback not fired, fire now
    if (plan.level === 'skip') {
      this.onDegrade?.(plan);
    }
  }

  private findNextDegradationIndex(subtask: SubTask): number {
    const current = subtask.degradationChain.findIndex(
      (l) => l === this.getCurrentLevel(subtask)
    );
    return current + 1;
  }

  private getCurrentLevel(subtask: SubTask): DegradationLevel {
    if (subtask.status === 'degraded') {
      // Infer from description marker
      if (subtask.description.includes('[SIMPLIFIED]')) return 'simplified';
      if (subtask.description.includes('[PLACEHOLDER]')) return 'placeholder';
    }
    return 'full';
  }

  private buildDegradedTask(original: SubTask, level: DegradationLevel): SubTask {
    const degraded: SubTask = {
      ...original,
      id: `${original.id}-deg-${level}`,
      status: 'pending' as TaskStatus,
      assignedAgentId: null,
      result: null,
      startedAt: null,
      completedAt: null,
    };

    switch (level) {
      case 'simplified':
        degraded.description = `[SIMPLIFIED] ${original.description}`;
        degraded.estimatedComplexity = Math.max(1, original.estimatedComplexity - 3);
        degraded.timeoutMs = Math.round(original.timeoutMs * 0.6);
        break;
      case 'placeholder':
        degraded.description = `[PLACEHOLDER] ${original.description}`;
        degraded.estimatedComplexity = 1;
        degraded.timeoutMs = this.config.simpleTaskMs;
        degraded.outputFormat = { type: 'text', constraints: ['placeholder_only'] };
        break;
      case 'skip':
        degraded.description = `[SKIP] ${original.description}`;
        degraded.estimatedComplexity = 0;
        degraded.timeoutMs = 1000;
        break;
      default:
        break;
    }

    return degraded;
  }

  private createSkipPlan(subtask: SubTask, reason: string): DegradationPlan {
    const skipped: SubTask = {
      ...subtask,
      id: `${subtask.id}-deg-skip`,
      status: 'degraded' as TaskStatus,
      result: {
        taskId: subtask.id,
        agentId: 'none',
        status: 'degraded' as TaskStatus,
        output: `[SKIPPED] ${reason}`,
        metadata: { tokensUsed: 0, latencyMs: 0, toolCalls: [] },
        qualityScore: 0,
        timestamp: Date.now(),
      },
      completedAt: Date.now(),
    };

    return {
      original: subtask,
      degraded: skipped,
      level: 'skip',
      reason: `${reason} → degradation chain exhausted, task skipped`,
    };
  }

  clearAll(): void {
    for (const timer of this.activeTimers.values()) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
  }
}
