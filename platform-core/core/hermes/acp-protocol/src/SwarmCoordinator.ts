import {
  SwarmConfig,
  SwarmState,
  CapabilityManifest,
  SubTask,
  TaskResult,
  CrossPlatformMessage,
  AgentAddress,
  Platform,
  Job,
  AgentSpec,
  CoordinationPlan,
  Metrics,
  Assignment,
  ExecutionStage,
  AgentRole,
} from './types';
import { TaskDecomposer } from './TaskDecomposer';
import { CapabilityMatcher } from './CapabilityMatcher';
import { MessageRouter } from './MessageRouter';
import { ResultMerger } from './ResultMerger';
import { ErrorRecovery } from './ErrorRecovery';
import { TimeoutDegradation } from './TimeoutDegradation';
import { BridgeFactory } from './CrossPlatformBridge';
import { MessageFactory } from './CrossPlatformMessage';

// ============================================================
// Swarm Coordinator — Core Orchestrator
// ============================================================
// Lifecycle:
//   1. DECOMPOSE   → TaskDecomposer breaks request into subtasks
//   2. PLAN        → Build dependency graph & execution stages
//   3. ASSIGN      → CapabilityMatcher finds best agent per subtask
//   4. DISPATCH    → MessageRouter sends task_request messages
//   5. POLL        → Collect results from inboxes / bridges
//   6. RECOVER     → ErrorRecovery retries / reassigns / degrades
//   7. MERGE       → ResultMerger synthesizes final output
//   8. RETURN      → Deliver merged result to user

export class SwarmCoordinator {
  private decomposer: TaskDecomposer;
  private matcher: CapabilityMatcher;
  private router: MessageRouter;
  private merger: ResultMerger;
  private recovery: ErrorRecovery;
  private degradation: TimeoutDegradation;
  private agents: Map<string, CapabilityManifest> = new Map();
  private state: SwarmState | null = null;
  private jobsCache: Map<string, Job> = new Map();

  // User-facing callbacks
  onProgress: ((msg: string) => void) | null = null;
  onDegradation: ((msg: string) => void) | null = null;

  constructor(config: SwarmConfig) {
    this.decomposer = new TaskDecomposer();
    this.matcher = new CapabilityMatcher(config.matchConfig);
    this.router = new MessageRouter(10);
    this.merger = new ResultMerger(config.mergeConfig);
    this.recovery = new ErrorRecovery(config.errorConfig);
    this.degradation = new TimeoutDegradation(config.timeoutConfig, (plan) => {
      const note = TimeoutDegradation.formatNotification(plan);
      this.onDegradation?.(note);
    });

    // Register agents
    for (const agent of config.agents) {
      this.agents.set(agent.agentId, agent);
    }

    // Setup bridges
    for (const pc of config.platforms) {
      if (pc.enabled) {
        const bridge = BridgeFactory.create(pc.platform, 'memory');
        this.router.registerBridge(bridge);
        this.router.registerInbox(pc.platform);
      }
    }
  }

  /**
   * Main entry: execute a user request end-to-end.
   */
  async execute(userRequest: string): Promise<string> {
    const taskId = `task-${Date.now()}`;

    // === Phase 1: DECOMPOSE ===
    this.emit('DECOMPOSE: breaking request into subtasks...');
    const decomposition = this.decomposer.decompose(userRequest, taskId);

    // === Phase 2: PLAN ===
    this.emit(`PLAN: ${decomposition.subtasks.length} subtasks, ${decomposition.executionPlan.length} stages`);
    this.state = {
      taskId,
      status: 'planning',
      subtasks: decomposition.subtasks,
      messages: [],
      circuitStates: new Map(),
      startTime: Date.now(),
      lastUpdate: Date.now(),
    };

    // === Phase 3-5: ASSIGN + DISPATCH + POLL per stage ===
    this.state.status = 'executing';
    for (const stage of decomposition.executionPlan) {
      this.emit(`STAGE ${stage.stage}: dispatching ${stage.subtaskIds.length} subtasks`);

      // Dispatch all subtasks in this stage
      const dispatchPromises = stage.subtaskIds.map((sid) =>
        this.dispatchSubtask(sid)
      );
      await Promise.all(dispatchPromises);

      // Wait for completion
      await this.waitForStage(stage.subtaskIds);
    }

    // === Phase 7: MERGE ===
    this.state.status = 'merging';
    this.emit('MERGE: synthesizing final result...');
    const results = this.state.subtasks
      .filter((s) => s.result !== null)
      .map((s) => s.result!);

    if (results.length === 0) {
      throw new Error('No subtasks produced results');
    }

    const merged = this.merger.merge(results);

    this.state.status = 'completed';
    this.state.lastUpdate = Date.now();
    this.emit(`COMPLETE: final score ${(merged.finalScore * 100).toFixed(1)}%`);

    return merged.mergedOutput;
  }

  /**
   * Dispatch a single subtask: match agent, send message, register timeout.
   */
  private async dispatchSubtask(subtaskId: string): Promise<void> {
    if (!this.state) throw new Error('No active state');
    const subtask = this.state.subtasks.find((s) => s.id === subtaskId)!;

    // Find best agent
    const agentList = Array.from(this.agents.values());
    const match = this.matcher.bestMatch(agentList, subtask);

    if (!match) {
      this.emit(`WARN: no agent matched for ${subtaskId}, degrading`);
      this.degradation.degrade(subtask, 'no_agent_match');
      return;
    }

    const agent = this.agents.get(match.agentId)!;
    subtask.assignedAgentId = agent.agentId;
    subtask.status = 'assigned';

    // Check circuit breaker
    if (!this.recovery.isPlatformAvailable(agent.platform)) {
      this.emit(`WARN: platform ${agent.platform} circuit open, trying fallback`);
      const fallback = this.findFallbackAgent(subtask, agent.platform);
      if (fallback) {
        subtask.assignedAgentId = fallback.agentId;
      } else {
        this.degradation.degrade(subtask, 'platform_unavailable');
        return;
      }
    }

    // Build message
    const from: AgentAddress = { agentId: 'coordinator', platform: 'openclaw' };
    const to: AgentAddress = {
      agentId: subtask.assignedAgentId,
      platform: agent.platform,
    };

    // Gather dependency results
    const deps: Record<string, TaskResult> = {};
    for (const depId of subtask.inputDependencies) {
      const dep = this.state.subtasks.find((s) => s.id === depId);
      if (dep?.result) {
        deps[depId] = dep.result;
      }
    }

    const msg = MessageFactory.taskRequest(
      this.state.taskId,
      from,
      to,
      {
        subtask,
        context: subtask.description,
        dependencies: deps,
      },
      subtask.timeoutMs
    );

    // Register timeout
    this.degradation.register(subtask);

    // Send
    await this.router.route(msg);
    this.state.messages.push(msg);

    subtask.status = 'running';
    subtask.startedAt = Date.now();
  }

  /**
   * Wait for all subtasks in a stage to complete (or fail/timeout).
   */
  private async waitForStage(subtaskIds: string[]): Promise<void> {
    if (!this.state) return;

    const pollInterval = 500;
    const maxWait = Math.max(
      ...subtaskIds.map((sid) => {
        const s = this.state!.subtasks.find((x) => x.id === sid);
        return s?.timeoutMs ?? 30000;
      })
    );

    const deadline = Date.now() + maxWait + 5000;

    while (Date.now() < deadline) {
      // Poll all inboxes
      const batches = this.router.pollAll();
      for (const [_platform, messages] of batches.entries()) {
        for (const msg of messages) {
          await this.handleMessage(msg);
        }
      }

      // Check if stage done
      const allDone = subtaskIds.every((sid) => {
        const s = this.state!.subtasks.find((x) => x.id === sid)!;
        return (
          s.status === 'completed' ||
          s.status === 'failed' ||
          s.status === 'degraded'
        );
      });

      if (allDone) break;
      await this.sleep(pollInterval);
    }
  }

  /**
   * Handle an inbound message (result, error, heartbeat).
   */
  private async handleMessage(msg: CrossPlatformMessage): Promise<void> {
    if (!this.state) return;

    switch (msg.type) {
      case 'task_result': {
        const payload = msg.payload as { result: TaskResult };
        const subtask = this.state.subtasks.find(
          (s) => s.id === payload.result.taskId
        );
        if (subtask) {
          subtask.result = payload.result;
          subtask.status = payload.result.status;
          subtask.completedAt = Date.now();
          this.degradation.complete(subtask.id);

          // Agent health update
          const agent = this.agents.get(payload.result.agentId);
          if (agent) {
            agent.performanceMetrics.tasksCompleted++;
          }
        }
        break;
      }

      case 'error': {
        const payload = msg.payload as {
          code: string;
          message: string;
          recoverable: boolean;
          suggestedAction: string;
        };
        const subtask = this.state.subtasks.find(
          (s) => s.assignedAgentId === msg.from.agentId
        );
        if (subtask) {
          const decision = this.recovery.handleFailure(
            msg,
            msg.from.platform,
            payload.code
          );
          this.emit(`RECOVERY: ${decision.reason}`);

          if (decision.action === 'retry' && decision.retryMessage) {
            await this.router.route(decision.retryMessage);
          } else if (decision.action === 'reassign') {
            subtask.assignedAgentId = null;
            subtask.status = 'pending';
            await this.dispatchSubtask(subtask.id);
          } else if (decision.action === 'degrade') {
            this.degradation.degrade(subtask, decision.reason);
          }
        }
        break;
      }

      case 'heartbeat': {
        // Update load metrics if needed
        break;
      }

      default:
        break;
    }

    this.state.messages.push(msg);
    this.state.lastUpdate = Date.now();
  }

  /**
   * Find a fallback agent when primary platform is unavailable.
   */
  private findFallbackAgent(
    subtask: SubTask,
    blockedPlatform: Platform
  ): CapabilityManifest | null {
    const candidates = Array.from(this.agents.values()).filter(
      (a) =>
        a.platform !== blockedPlatform &&
        this.recovery.isPlatformAvailable(a.platform)
    );
    const match = this.matcher.bestMatch(candidates, subtask);
    return match ? this.agents.get(match.agentId) ?? null : null;
  }

  private emit(msg: string): void {
    this.onProgress?.(`[Swarm] ${msg}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  getState(): SwarmState | null {
    return this.state;
  }

  getAgentStats(): Array<{ agentId: string; tasksCompleted: number }> {
    return Array.from(this.agents.values()).map((a) => ({
      agentId: a.agentId,
      tasksCompleted: a.performanceMetrics.tasksCompleted,
    }));
  }

  // ============================================================
  // Core Algorithm: coordinate — static planning without execution
  // ============================================================

  /**
   * Produce a coordination plan for a batch of jobs without executing them.
   * Considers: priority ordering, capability matching, and load balancing.
   */
  coordinate(jobs: Job[], availableAgents: AgentSpec[]): CoordinationPlan {
    const planId = `plan-${Date.now()}`;

    // 1. Sort jobs by priority (descending), then by dependency depth
    const sortedJobs = this.sortJobsByPriorityAndDependencies(jobs);

    // 2. Compute dependency-aware execution stages
    const stages = this.computeJobStages(sortedJobs);

    // Cache jobs for later lookup (rebalance, etc.)
    this.jobsCache.clear();
    for (const job of sortedJobs) {
      this.jobsCache.set(job.id, job);
    }

    // 3. Assign agents to jobs stage-by-stage with load balancing
    const assignments: Assignment[] = [];
    const loadDistribution: Record<string, number> = {};
    const unassignedJobs: string[] = [];

    for (const agent of availableAgents) {
      loadDistribution[agent.agentId] = agent.loadFactor;
    }

    for (const stage of stages) {
      const stageJobs = sortedJobs.filter((j) => stage.subtaskIds.includes(j.id));

      for (const job of stageJobs) {
        // Find best agent considering current load
        const bestAgent = this.findBestAgentForJob(job, availableAgents, loadDistribution);

        if (bestAgent) {
          const expectedDuration = this.estimateJobDuration(job, bestAgent);
          assignments.push({
            jobId: job.id,
            agentId: bestAgent.agentId,
            priority: job.priority,
            expectedStartTime: 0, // relative to plan start
            expectedDuration,
          });

          // Update load projection
          loadDistribution[bestAgent.agentId] = Math.min(
            1.0,
            loadDistribution[bestAgent.agentId] + 0.2
          );
        } else {
          unassignedJobs.push(job.id);
        }
      }
    }

    // 4. Compute estimated completion based on critical path
    const estimatedCompletion = this.computeCriticalPathDuration(sortedJobs, stages, assignments);

    return {
      planId,
      assignments,
      stages,
      estimatedCompletion,
      loadDistribution,
      unassignedJobs,
    };
  }

  /**
   * Rebalance an existing coordination plan based on real-time metrics.
   * Moves jobs from overloaded agents to underutilized ones using
   * capability-aware reassignment with load-proportional redistribution.
   */
  rebalance(currentPlan: CoordinationPlan, metrics: Metrics, availableAgents?: AgentSpec[]): CoordinationPlan {
    const planId = `rebalanced-${Date.now()}`;
    const assignments: Assignment[] = [];
    const loadDistribution: Record<string, number> = { ...currentPlan.loadDistribution };
    const unassignedJobs: string[] = [...currentPlan.unassignedJobs];

    // Get agent specs if not provided (attempt to reconstruct from cache context)
    const agents = availableAgents ?? this.reconstructAgentSpecs(currentPlan, metrics);

    // Classify agents by utilization tier
    const utilizationEntries = Object.entries(metrics.agentUtilization);
    const overloadedAgents = utilizationEntries
      .filter(([, load]) => load > 0.80)
      .map(([id]) => id)
      .sort((a, b) => (metrics.agentUtilization[b] ?? 0) - (metrics.agentUtilization[a] ?? 0));

    const underutilizedAgents = utilizationEntries
      .filter(([, load]) => load < 0.50)
      .map(([id]) => id)
      .sort((a, b) => (metrics.agentUtilization[a] ?? 0) - (metrics.agentUtilization[b] ?? 0));

    const balancedAgents = utilizationEntries
      .filter(([, load]) => load >= 0.50 && load <= 0.80)
      .map(([id]) => id);

    // Track which agents have received new assignments (to avoid double-counting)
    const assignmentDelta: Record<string, number> = {};
    for (const a of agents) assignmentDelta[a.agentId] = 0;

    // Build capability-compatible reassignment pool
    for (const assignment of currentPlan.assignments) {
      const job = this.findJobById(assignment.jobId);
      if (!job) {
        assignments.push(assignment);
        continue;
      }

      const currentAgent = agents.find((a) => a.agentId === assignment.agentId);
      const currentUtil = metrics.agentUtilization[assignment.agentId] ?? 0;

      // If agent is overloaded, attempt to offload
      if (overloadedAgents.includes(assignment.agentId) && underutilizedAgents.length > 0) {
        // Find best underutilized agent that can handle this job
        const candidates = underutilizedAgents.map((id) => agents.find((a) => a.agentId === id))
          .filter((a): a is AgentSpec => !!a);

        const scored = candidates
          .map((agent) => ({
            agent,
            score: this.computeAgentJobScore(agent, job, metrics),
          }))
          .filter((s) => s.score > 0.3) // minimum capability threshold
          .sort((a, b) => {
            // Prefer least loaded, then highest capability score
            const loadDiff = (metrics.agentUtilization[a.agent.agentId] ?? 0) - (metrics.agentUtilization[b.agent.agentId] ?? 0);
            if (Math.abs(loadDiff) > 0.15) return loadDiff;
            return b.score - a.score;
          });

        if (scored.length > 0) {
          const target = scored[0]!.agent;

          assignments.push({
            ...assignment,
            agentId: target.agentId,
            expectedStartTime: 0,
          });

          // Update load projections: transfer load proportionally
          const transferredLoad = Math.min(0.25, currentUtil * 0.3);
          loadDistribution[target.agentId] = Math.min(
            1.0,
            (loadDistribution[target.agentId] ?? 0) + transferredLoad
          );
          loadDistribution[assignment.agentId] = Math.max(
            0,
            (loadDistribution[assignment.agentId] ?? 0) - transferredLoad
          );
          assignmentDelta[target.agentId] += 1;
          assignmentDelta[assignment.agentId] -= 1;
          continue;
        }
      }

      // If balanced but near threshold, and there's a much better agent, consider move
      if (balancedAgents.includes(assignment.agentId) && underutilizedAgents.length > 0) {
        const bestUnderutilized = underutilizedAgents
          .map((id) => agents.find((a) => a.agentId === id))
          .filter((a): a is AgentSpec => !!a)
          .sort((a, b) => {
            const scoreA = this.computeAgentJobScore(a, job, metrics);
            const scoreB = this.computeAgentJobScore(b, job, metrics);
            return scoreB - scoreA;
          })[0];

        if (bestUnderutilized) {
          const currentScore = currentAgent ? this.computeAgentJobScore(currentAgent, job, metrics) : 0;
          const targetScore = this.computeAgentJobScore(bestUnderutilized, job, metrics);

          // Only move if target is significantly better (30%+ score delta) AND underutilized
          if (targetScore > currentScore * 1.3) {
            assignments.push({
              ...assignment,
              agentId: bestUnderutilized.agentId,
            });
            loadDistribution[bestUnderutilized.agentId] = Math.min(
              1.0,
              (loadDistribution[bestUnderutilized.agentId] ?? 0) + 0.15
            );
            loadDistribution[assignment.agentId] = Math.max(
              0,
              (loadDistribution[assignment.agentId] ?? 0) - 0.15
            );
            continue;
          }
        }
      }

      // Keep original assignment
      assignments.push(assignment);
    }

    // Attempt to assign previously unassigned jobs
    if (unassignedJobs.length > 0 && agents.length > 0) {
      const newlyAssigned: string[] = [];
      for (const jobId of unassignedJobs) {
        const job = this.findJobById(jobId);
        if (!job) continue;

        const bestAgent = this.findBestAgentForJob(job, agents, loadDistribution);
        if (bestAgent) {
          const expectedDuration = this.estimateJobDuration(job, bestAgent);
          assignments.push({
            jobId: job.id,
            agentId: bestAgent.agentId,
            priority: job.priority,
            expectedStartTime: 0,
            expectedDuration,
          });
          loadDistribution[bestAgent.agentId] = Math.min(1.0, (loadDistribution[bestAgent.agentId] ?? 0) + 0.2);
          newlyAssigned.push(jobId);
        }
      }
      // Remove newly assigned from unassigned list
      const remaining = unassignedJobs.filter((id) => !newlyAssigned.includes(id));
      unassignedJobs.length = 0;
      unassignedJobs.push(...remaining);
    }

    // Recompute estimated completion based on critical path through updated assignments
    const estimatedCompletion = this.estimateCompletionFromAssignments(assignments);

    return {
      planId,
      assignments,
      stages: currentPlan.stages,
      estimatedCompletion,
      loadDistribution,
      unassignedJobs,
    };
  }

  // ---- coordinate / rebalance helpers ----

  private sortJobsByPriorityAndDependencies(jobs: Job[]): Job[] {
    // Compute dependency depth for each job
    const depthMap = new Map<string, number>();

    const getDepth = (jobId: string, visited: Set<string>): number => {
      if (visited.has(jobId)) return 0; // circular guard
      if (depthMap.has(jobId)) return depthMap.get(jobId)!;

      visited.add(jobId);
      const job = jobs.find((j) => j.id === jobId);
      if (!job || job.dependencies.length === 0) {
        depthMap.set(jobId, 0);
        return 0;
      }

      const maxDepDepth = Math.max(
        ...job.dependencies.map((depId) => getDepth(depId, new Set(visited)))
      );
      depthMap.set(jobId, maxDepDepth + 1);
      return maxDepDepth + 1;
    };

    for (const job of jobs) {
      getDepth(job.id, new Set());
    }

    return [...jobs].sort((a, b) => {
      const depthDiff = (depthMap.get(a.id) ?? 0) - (depthMap.get(b.id) ?? 0);
      if (depthDiff !== 0) return depthDiff;
      return b.priority - a.priority;
    });
  }

  private computeJobStages(jobs: Job[]): ExecutionStage[] {
    const edges: [string, string][] = [];
    for (const job of jobs) {
      for (const dep of job.dependencies) {
        if (jobs.some((j) => j.id === dep)) {
          edges.push([dep, job.id]);
        }
      }
    }

    const nodeIds = jobs.map((j) => j.id);
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const id of nodeIds) {
      inDegree.set(id, 0);
      adjacency.set(id, []);
    }

    for (const [from, to] of edges) {
      adjacency.get(from)!.push(to);
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    }

    const levels: string[][] = [];
    let current = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0);
    const visited = new Set<string>();

    while (current.length > 0) {
      levels.push([...current]);
      for (const id of current) visited.add(id);

      const next: string[] = [];
      for (const id of current) {
        for (const neighbor of adjacency.get(id) ?? []) {
          if (!visited.has(neighbor)) {
            const remaining = (inDegree.get(neighbor) ?? 0) -
              [...adjacency.entries()]
                .filter(([_, v]) => v.includes(neighbor))
                .filter(([k]) => visited.has(k)).length;
            if (remaining <= 0 && !next.includes(neighbor)) {
              next.push(neighbor);
            }
          }
        }
      }
      current = next;
    }

    return levels.map((group, idx) => ({
      stage: idx + 1,
      subtaskIds: group,
      canParallel: group.length > 1,
    }));
  }

  private findBestAgentForJob(
    job: Job,
    agents: AgentSpec[],
    loadDistribution: Record<string, number>
  ): AgentSpec | null {
    // Score each agent: role match + platform match + (1 - load) penalty
    const scored = agents
      .map((agent) => {
        let score = 0;

        // Role match (0-1)
        if (agent.role === job.requiredRole) score += 1.0;
        else if (this.isNearRole(agent.role, job.requiredRole)) score += 0.5;

        // Platform match (0-1)
        if (agent.platform === job.platformPreference) score += 1.0;
        else score += 0.3;

        // Skill overlap (0-1)
        const skillOverlap = job.tags.filter((t) =>
          agent.skills.some((s) => s.toLowerCase().includes(t.toLowerCase()))
        ).length / Math.max(1, job.tags.length);
        score += skillOverlap;

        // Performance score (0-1)
        score += agent.performanceScore * 0.5;

        // Latency penalty (lower is better)
        const latencyScore = Math.max(0, 1 - agent.avgLatencyMs / 20000);
        score += latencyScore * 0.3;

        // Load penalty: heavily penalize overloaded agents
        const load = loadDistribution[agent.agentId] ?? agent.loadFactor;
        const loadPenalty = load > 0.8 ? 2.0 : load * 0.5;
        score -= loadPenalty;

        return { agent, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.length > 0 ? scored[0].agent : null;
  }

  private isNearRole(actual: AgentRole, required: AgentRole): boolean {
    const adjacency: Record<AgentRole, AgentRole[]> = {
      researcher: ['analyst', 'writer'],
      writer: ['researcher', 'reviewer'],
      reviewer: ['writer', 'analyst'],
      coder: ['tester', 'security_scanner'],
      tester: ['coder', 'security_scanner'],
      analyst: ['researcher', 'visualizer'],
      coordinator: [],
      visualizer: ['analyst'],
      security_scanner: ['coder', 'tester'],
    };
    return (adjacency[required] ?? []).includes(actual);
  }

  private estimateJobDuration(job: Job, agent: AgentSpec): number {
    const baseMs = 30000; // 30s base
    const complexityMultiplier = 1 + (job.complexity - 5) * 0.2;
    const latencyMultiplier = 1 + agent.avgLatencyMs / 10000;
    return Math.round(baseMs * complexityMultiplier * latencyMultiplier);
  }

  private computeCriticalPathDuration(
    jobs: Job[],
    stages: ExecutionStage[],
    assignments: Assignment[]
  ): number {
    let total = 0;
    for (const stage of stages) {
      const stageAssignments = assignments.filter((a) =>
        stage.subtaskIds.includes(a.jobId)
      );
      const stageDuration = stageAssignments.length > 0
        ? Math.max(...stageAssignments.map((a) => a.expectedDuration))
        : 0;
      total += stageDuration;
    }
    return total;
  }

  private findJobById(jobId: string): Job | null {
    return this.jobsCache.get(jobId) ?? null;
  }

  private computeAgentJobScore(agent: AgentSpec, job: Job, metrics: Metrics): number {
    let score = 0;

    // Role fit (0-1)
    if (agent.role === job.requiredRole) score += 1.0;
    else if (this.isNearRole(agent.role, job.requiredRole)) score += 0.5;

    // Skill overlap (0-1)
    const skillOverlap = job.tags.filter((t) =>
      agent.skills.some((s) => s.toLowerCase().includes(t.toLowerCase()))
    ).length / Math.max(1, job.tags.length);
    score += skillOverlap;

    // Performance score (0-1)
    score += agent.performanceScore * 0.5;

    // Latency penalty
    const latencyScore = Math.max(0, 1 - agent.avgLatencyMs / 20000);
    score += latencyScore * 0.3;

    // Platform match
    if (agent.platform === job.platformPreference) score += 0.5;

    // Current utilization penalty (prefer less loaded)
    const util = metrics.agentUtilization[agent.agentId] ?? 0;
    score += Math.max(0, 1 - util) * 0.3;

    // Success rate
    score += agent.successRate * 0.3;

    return score;
  }

  private reconstructAgentSpecs(plan: CoordinationPlan, metrics: Metrics): AgentSpec[] {
    // Reconstruct minimal AgentSpec from assignments + metrics
    const agentIds = new Set<string>();
    for (const a of plan.assignments) agentIds.add(a.agentId);
    for (const id of Object.keys(metrics.agentUtilization)) agentIds.add(id);

    return Array.from(agentIds).map((id) => ({
      agentId: id,
      role: 'researcher' as AgentRole,
      platform: 'generic' as Platform,
      skills: [],
      loadFactor: metrics.agentUtilization[id] ?? 0,
      maxConcurrent: 3,
      performanceScore: 0.5,
      avgLatencyMs: metrics.averageLatencyMs ?? 5000,
      successRate: 0.9,
    }));
  }

  private estimateCompletionFromAssignments(assignments: Assignment[]): number {
    // Critical-path heuristic: group by agent and estimate parallel waves
    if (assignments.length === 0) return 0;
    const agentDurations: Record<string, number[]> = {};
    for (const a of assignments) {
      if (!agentDurations[a.agentId]) agentDurations[a.agentId] = [];
      agentDurations[a.agentId]!.push(a.expectedDuration);
    }
    // Sum durations per agent, take max as critical path (all agents work in parallel)
    const perAgentTotals = Object.values(agentDurations).map((ds) =>
      ds.reduce((s, d) => s + d, 0)
    );
    return Math.max(...perAgentTotals);
  }
}
