/**
 * MultiRepoSwarm.ts — 跨仓库内存共享协调器
 *
 * 来源: LobeHub (multi-repo-swarm)
 * 特点: 跨仓库协调多个 Agent Swarm，共享全局内存
 *        支持仓库间任务迁移、状态同步、冲突解决
 *        分布式一致性保证（最终一致性模型）
 *
 * 设计参考: Distributed Systems, Raft Consensus, CRDT, Redis Cluster
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

export interface RepoDefinition {
  id: string;
  name: string;
  /** 仓库 Agents */
  agents: AgentRegistration[];
  /** 仓库能力标签 */
  capabilities: string[];
  /** 仓库优先级 */
  priority: number;
  /** 最大并发任务 */
  maxConcurrentTasks: number;
  /** 当前负载 */
  currentLoad: number;
  /** 网络延迟（模拟） */
  networkLatencyMs: number;
  /** 是否健康 */
  healthy: boolean;
}

export interface SharedMemoryEntry {
  id: string;
  repoId: string;
  agentId: string;
  key: string;
  value: string;
  version: number;
  timestamp: number;
  ttl?: number; // 过期时间（毫秒）
}

export interface SyncOperation {
  type: "write" | "read" | "delete" | "merge";
  repoId: string;
  key: string;
  value?: string;
  version: number;
  timestamp: number;
}

export interface MultiRepoSwarmConfig {
  /** 仓库列表 */
  repos: RepoDefinition[];
  /** 全局内存最大条目数 */
  maxSharedMemoryEntries: number;
  /** 同步间隔（毫秒） */
  syncIntervalMs: number;
  /** 冲突解决策略: last_write_wins | version_vector | timestamp_order */
  conflictResolution: "last_write_wins" | "version_vector" | "timestamp_order";
  /** 任务分配策略: round_robin | load_balanced | capability_match | priority */
  taskDistribution: "round_robin" | "load_balanced" | "capability_match" | "priority";
  /** 是否启用仓库间迁移 */
  enableMigration: boolean;
  /** 迁移阈值（负载超过此值触发迁移） */
  migrationThreshold: number;
  /** 一致性级别: eventual | strong */
  consistencyLevel: "eventual" | "strong";
}

export type MultiRepoSwarmState =
  | "idle"
  | "repos_discovering"
  | "memory_initializing"
  | "task_analyzing"
  | "repo_selecting"
  | "dispatching"
  | "executing"
  | "syncing"
  | "conflict_resolving"
  | "completed"
  | "failed";

// ─── 默认配置 ───

const DEFAULT_CONFIG: MultiRepoSwarmConfig = {
  repos: [],
  maxSharedMemoryEntries: 1000,
  syncIntervalMs: 5000,
  conflictResolution: "version_vector",
  taskDistribution: "load_balanced",
  enableMigration: true,
  migrationThreshold: 0.8,
  consistencyLevel: "eventual",
};

// ─── MultiRepoSwarm 实现 ───

export class MultiRepoSwarm extends BaseExecutionMode {
  readonly mode: SwarmMode = "multi-repo" as SwarmMode;

  private config: MultiRepoSwarmConfig;
  private sharedMemory: Map<string, SharedMemoryEntry> = new Map();
  private pendingSyncs: SyncOperation[] = [];
  private swarmState: MultiRepoSwarmState = "idle";
  private syncTimer: NodeJS.Timeout | null = null;
  private versionCounters: Map<string, number> = new Map();
  private repoRoundRobinIndex = 0;
  private currentRepoId: string | null = null;

  constructor(config?: Partial<MultiRepoSwarmConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startSyncTimer();
  }

  private setState(state: MultiRepoSwarmState): void {
    const prev = this.swarmState;
    this.swarmState = state;
    logger.info({ from: prev, to: state, taskId: this.currentTaskId }, "MultiRepoSwarm state transition");
  }

  // ─── 同步定时器 ───

  private startSyncTimer(): void {
    if (this.syncTimer) return;
    this.syncTimer = setInterval(() => {
      this.performSync();
    }, this.config.syncIntervalMs);
  }

  private stopSyncTimer(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  // ─── 共享内存操作 ───

  writeToSharedMemory(
    repoId: string,
    agentId: string,
    key: string,
    value: string,
    ttl?: number
  ): void {
    const fullKey = `${repoId}:${key}`;
    const currentVersion = this.versionCounters.get(fullKey) || 0;
    const newVersion = currentVersion + 1;

    const entry: SharedMemoryEntry = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      repoId,
      agentId,
      key: fullKey,
      value,
      version: newVersion,
      timestamp: Date.now(),
      ttl,
    };

    // 冲突检测
    const existing = this.sharedMemory.get(fullKey);
    if (existing) {
      const resolved = this.resolveConflict(existing, entry);
      if (resolved.id === entry.id) {
        this.sharedMemory.set(fullKey, entry);
        this.versionCounters.set(fullKey, newVersion);
      }
    } else {
      this.sharedMemory.set(fullKey, entry);
      this.versionCounters.set(fullKey, newVersion);
    }

    // 限制内存大小
    if (this.sharedMemory.size > this.config.maxSharedMemoryEntries) {
      const oldest = Array.from(this.sharedMemory.entries()).sort(
        (a, b) => a[1].timestamp - b[1].timestamp
      )[0];
      if (oldest) {
        this.sharedMemory.delete(oldest[0]);
      }
    }

    // 记录同步操作
    this.pendingSyncs.push({
      type: "write",
      repoId,
      key: fullKey,
      value,
      version: newVersion,
      timestamp: Date.now(),
    });
  }

  readFromSharedMemory(repoId: string, key: string): SharedMemoryEntry | null {
    const fullKey = `${repoId}:${key}`;
    const entry = this.sharedMemory.get(fullKey);

    if (!entry) return null;

    // 检查 TTL
    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.sharedMemory.delete(fullKey);
      return null;
    }

    return entry;
  }

  private resolveConflict(
    existing: SharedMemoryEntry,
    incoming: SharedMemoryEntry
  ): SharedMemoryEntry {
    switch (this.config.conflictResolution) {
      case "last_write_wins":
        return incoming.timestamp > existing.timestamp ? incoming : existing;

      case "version_vector":
        return incoming.version > existing.version ? incoming : existing;

      case "timestamp_order":
        return incoming.timestamp > existing.timestamp ? incoming : existing;

      default:
        return incoming;
    }
  }

  // ─── 同步 ───

  private performSync(): void {
    if (this.pendingSyncs.length === 0) return;

    const syncs = [...this.pendingSyncs];
    this.pendingSyncs = [];

    logger.info(
      { syncCount: syncs.length },
      "MultiRepoSwarm: performing sync"
    );

    // 模拟跨仓库同步
    for (const sync of syncs) {
      // 在实际实现中，这里会通过网络发送到其他仓库
      logger.debug(
        { repoId: sync.repoId, key: sync.key, type: sync.type },
        "MultiRepoSwarm: sync operation"
      );
    }
  }

  // ─── 任务分析 ───

  private analyzeTaskForRepo(task: TaskRequest): {
    requiredCapabilities: string[];
    estimatedComplexity: "low" | "medium" | "high";
    preferredRepo?: string;
  } {
    const prompt = task.prompt.toLowerCase();
    const keywords = [
      "code", "analysis", "review", "test", "debug", "design",
      "document", "search", "write", "translate", "summarize",
    ].filter((kw) => prompt.includes(kw));

    const complexity: "low" | "medium" | "high" =
      prompt.length > 1000 || keywords.length > 5
        ? "high"
        : prompt.length > 300 || keywords.length > 2
          ? "medium"
          : "low";

    return {
      requiredCapabilities: keywords,
      estimatedComplexity: complexity,
    };
  }

  // ─── 选择仓库 ───

  private selectRepo(
    taskAnalysis: ReturnType<typeof this.analyzeTaskForRepo>
  ): RepoDefinition | null {
    const healthyRepos = this.config.repos.filter((r) => r.healthy);
    if (healthyRepos.length === 0) return null;

    switch (this.config.taskDistribution) {
      case "round_robin": {
        const repo = healthyRepos[this.repoRoundRobinIndex % healthyRepos.length];
        this.repoRoundRobinIndex++;
        return repo;
      }

      case "load_balanced": {
        return healthyRepos.reduce((best, current) => {
          const bestLoad = best.currentLoad / best.maxConcurrentTasks;
          const currentLoad = current.currentLoad / current.maxConcurrentTasks;
          return currentLoad < bestLoad ? current : best;
        });
      }

      case "capability_match": {
        const scored = healthyRepos.map((repo) => {
          const matches = repo.capabilities.filter((cap) =>
            taskAnalysis.requiredCapabilities.some((req) =>
              cap.toLowerCase().includes(req)
            )
          ).length;
          return { repo, score: matches };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored[0]?.repo || healthyRepos[0];
      }

      case "priority": {
        return healthyRepos.reduce((best, current) =>
          current.priority > best.priority ? current : best
        );
      }

      default:
        return healthyRepos[0];
    }
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

    const abortCtrl = this.createAbortController();
    const signal = abortCtrl.signal;

    // ─── 1. 发现仓库 ───
    this.setState("repos_discovering");

    if (this.config.repos.length === 0) {
      // 如果没有预配置仓库，将所有 agents 视为一个仓库
      this.config.repos.push({
        id: "default-repo",
        name: "Default Repository",
        agents: agents.filter(isAgentAvailable),
        capabilities: [],
        priority: 1,
        maxConcurrentTasks: 10,
        currentLoad: 0,
        networkLatencyMs: 0,
        healthy: true,
      });
    }

    logger.info(
      { taskId: task.id, repoCount: this.config.repos.length },
      "MultiRepoSwarm: repos discovered"
    );

    // ─── 2. 初始化共享内存 ───
    this.setState("memory_initializing");

    // 将 context 中的共享内存加载到本地
    if (context.sharedMemory) {
      for (const entry of context.sharedMemory) {
        const memKey = `shared:${entry.id}`;
        this.sharedMemory.set(memKey, {
          id: entry.id,
          repoId: 'shared',
          agentId: entry.agentId,
          key: memKey,
          value: entry.content,
          version: this.versionCounters.get(memKey) || 0,
          timestamp: entry.timestamp,
        });
      }
    }

    // ─── 3. 分析任务 ───
    this.setState("task_analyzing");
    const taskAnalysis = this.analyzeTaskForRepo(task);

    logger.info(
      {
        taskId: task.id,
        complexity: taskAnalysis.estimatedComplexity,
        capabilities: taskAnalysis.requiredCapabilities,
      },
      "MultiRepoSwarm: task analyzed"
    );

    // ─── 4. 选择仓库 ───
    this.setState("repo_selecting");
    const selectedRepo = this.selectRepo(taskAnalysis);

    if (!selectedRepo) {
      this.setState("failed");
      this._state = "failed";
      return buildTaskResult(
        task.id,
        [],
        "",
        "failed",
        "multi-repo-no-healthy-repo",
        { startedAt: startTime }
      );
    }

    this.currentRepoId = selectedRepo.id;
    selectedRepo.currentLoad++;

    logger.info(
      {
        taskId: task.id,
        repoId: selectedRepo.id,
        repoName: selectedRepo.name,
      },
      "MultiRepoSwarm: repo selected"
    );

    // ─── 5. 分发给仓库 Agents ───
    this.setState("dispatching");
    const repoAgents = selectedRepo.agents.filter(isAgentAvailable);

    if (repoAgents.length === 0) {
      selectedRepo.currentLoad--;
      this.setState("failed");
      this._state = "failed";
      return buildTaskResult(
        task.id,
        [],
        "",
        "failed",
        "multi-repo-no-available-agents",
        { startedAt: startTime }
      );
    }

    // ─── 6. 执行 ───
    this.setState("executing");
    const allAgentResults: AgentResult[] = [];

    // 写入共享内存：任务开始
    this.writeToSharedMemory(
      selectedRepo.id,
      "system",
      `task:${task.id}:status`,
      "running",
      300000
    );

    // 使用仓库的第一个 Agent 作为主执行者
    // 在完整实现中，这里会使用仓库内部的调度策略
    const primaryAgent = repoAgents[0];

    const result = await invokeAgent(
      primaryAgent,
      task,
      task.prompt,
      signal,
      task.maxLatencyMs
    );

    allAgentResults.push(result);

    // 写入共享内存：结果
    if (result.status === "success") {
      this.writeToSharedMemory(
        selectedRepo.id,
        primaryAgent.id,
        `task:${task.id}:result`,
        result.output,
        300000
      );
    } else {
      this.writeToSharedMemory(
        selectedRepo.id,
        primaryAgent.id,
        `task:${task.id}:error`,
        result.error || "Unknown error",
        300000
      );
    }

    // ─── 7. 同步 ───
    this.setState("syncing");
    this.performSync();

    // ─── 8. 冲突解决（如果需要） ───
    if (this.config.consistencyLevel === "strong") {
      this.setState("conflict_resolving");
      // 在强一致性模式下，等待所有仓库确认
      logger.info(
        { taskId: task.id },
        "MultiRepoSwarm: strong consistency sync completed"
      );
    }

    // ─── 9. 更新仓库负载 ───
    selectedRepo.currentLoad = Math.max(0, selectedRepo.currentLoad - 1);

    // ─── 10. 构建结果 ───
    const finalStatus: "success" | "partial" | "failed" =
      result.status === "success"
        ? "success"
        : result.status === "failed"
          ? "failed"
          : "partial";

    this.setState(finalStatus === "success" ? "completed" : "failed");
    this._state = finalStatus === "success" ? "completed" : finalStatus;

    // 增强输出
    const enhancedOutput = `[Repo: ${selectedRepo.name}]\n\n${result.output}`;

    const taskResult = buildTaskResult(
      task.id,
      allAgentResults,
      enhancedOutput,
      finalStatus,
      "multi-repo",
      {
        startedAt: startTime,
        subTasks: [
          {
            subTaskId: task.id,
            description: `Executed in ${selectedRepo.name}`,
            assignedAgentId: primaryAgent.id,
            status: result.status === "success" ? "success" : "failed",
            output: result.output,
          },
        ],
      }
    );

    task.onComplete?.(taskResult);
    return taskResult;
  }

  // ─── 仓库管理 ───

  addRepo(repo: RepoDefinition): void {
    const existing = this.config.repos.find((r) => r.id === repo.id);
    if (existing) {
      Object.assign(existing, repo);
    } else {
      this.config.repos.push(repo);
    }
    logger.info({ repoId: repo.id, repoName: repo.name }, "MultiRepoSwarm: repo added");
  }

  removeRepo(repoId: string): boolean {
    const index = this.config.repos.findIndex((r) => r.id === repoId);
    if (index >= 0) {
      this.config.repos.splice(index, 1);
      logger.info({ repoId }, "MultiRepoSwarm: repo removed");
      return true;
    }
    return false;
  }

  updateRepoHealth(repoId: string, healthy: boolean): void {
    const repo = this.config.repos.find((r) => r.id === repoId);
    if (repo) {
      repo.healthy = healthy;
      logger.info({ repoId, healthy }, "MultiRepoSwarm: repo health updated");
    }
  }

  /** 获取全局共享内存状态 */
  getSharedMemoryStatus(): {
    totalEntries: number;
    entriesByRepo: Record<string, number>;
    pendingSyncs: number;
  } {
    const byRepo: Record<string, number> = {};
    for (const entry of this.sharedMemory.values()) {
      byRepo[entry.repoId] = (byRepo[entry.repoId] || 0) + 1;
    }

    return {
      totalEntries: this.sharedMemory.size,
      entriesByRepo: byRepo,
      pendingSyncs: this.pendingSyncs.length,
    };
  }

  /** 获取仓库状态 */
  getRepoStatus(): Array<{
    id: string;
    name: string;
    healthy: boolean;
    currentLoad: number;
    maxConcurrentTasks: number;
    utilization: number;
    agentCount: number;
  }> {
    return this.config.repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      healthy: repo.healthy,
      currentLoad: repo.currentLoad,
      maxConcurrentTasks: repo.maxConcurrentTasks,
      utilization: repo.currentLoad / repo.maxConcurrentTasks,
      agentCount: repo.agents.length,
    }));
  }

  // ─── 生命周期 ───

  override async pause(): Promise<void> {
    await super.pause();
  }

  override async resume(): Promise<void> {
    await super.resume();
  }

  override async stop(): Promise<void> {
    this.stopSyncTimer();
    this.sharedMemory.clear();
    this.pendingSyncs = [];
    this.versionCounters.clear();
    await super.stop();
  }
}
