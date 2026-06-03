/**
 * SwarmCoordinator.ts — SYLVA 蜂群协调器
 *
 * 核心职责:
 * 1. 任务分解 (decompose) — 将复杂任务拆分为子任务
 * 2. 动态调度 (dispatch) — 根据Agent能力和负载分配任务
 * 3. 结果聚合 (aggregate) — 合并多个Agent的结果
 * 4. 负载均衡 (rebalance) — 动态调整Agent分配
 * 5. 同步压缩 (syncCompress) — 所有绑定Agent同步压缩上下文
 *
 * 设计原则:
 * - Coordinator强制使用最长窗口模型 (GPT-4.1 1M / Gemini 2.5 Pro 2M)
 * - 所有Worker绑定同一共享记忆池
 * - 战车绑定: 所有Agent像战车一样共享同一协作空间
 */

import { SwarmNode, NodeType, AgentConfig } from './SwarmNode';
import { IMessageBus, MessageType, SwarmMessage } from './SwarmMessageBus';
import { SwarmConfig } from './SwarmConfig';
import { SubTask, TaskResult, ExecutionMode, ExecutionContext } from './ExecutionModes';
import { SnapshotEngine, Snapshot, AgentTemplate, deepClone } from './SnapshotEngine';
import { SnapshotStorage, StorageConfig, StorageStats } from './SnapshotStorage';

// ──────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────

export interface CoordinatorConfig {
  /** 协调器使用的模型 (强制最长窗口) */
  model: string;           // e.g. 'gpt-4.1' or 'gemini-2.5-pro'
  /** 模型最大token数 */
  maxTokens: number;       // e.g. 1_000_000
  /** 任务分解策略 */
  decompositionStrategy: 'auto' | 'template' | 'llm-driven';
  /** 调度策略 */
  dispatchStrategy: 'round-robin' | 'capability-match' | 'load-balanced';
  /** 结果聚合策略 */
  aggregationStrategy: 'concat' | 'summarize' | 'merge' | 'vote';
}

/** 战车状态 (Agent Chariot) */
export interface ChariotState {
  id: string;
  name: string;
  coordinator: SwarmNode;           // 根协调器
  agents: SwarmNode[];              // 绑定Agent列表
  sharedMemory: SharedMemoryPool;   // 共享记忆池
  status: 'idle' | 'running' | 'paused' | 'error';
  createdAt: Date;
  taskCount: number;
}

/** 共享记忆池 */
export interface SharedMemoryPool {
  /** HOT层: 实时共享 (最近3轮，所有Agent读写) */
  hot: Map<string, any>;
  /** WARM层: 摘要共享 (Coordinator生成结构化摘要) */
  warm: Map<string, string>;
  /** COLD层: 归档共享 (向量数据库) */
  cold: VectorStore;
  
  read(agentId: string, key: string): any;
  write(agentId: string, key: string, value: any): void;
  subscribe(agentId: string, key: string, callback: (value: any) => void): void;
  sync(): void;  // 强制同步所有Agent
}

/** 向量存储接口 */
interface VectorStore {
  add(id: string, embedding: number[], metadata: any): void;
  search(query: number[], topK: number): SearchResult[];
}

interface SearchResult {
  id: string;
  score: number;
  metadata: any;
}

/** 压缩命令 */
export interface CompressCommand {
  level: 'early' | 'critical' | 'emergency';
  preserveFirstTurns: number;
  preserveLastTurns: number;
  targetUsage: number;  // 目标上下文使用率 (0-1)
}

// ──────────────────────────────────────────
// 协调器实现
// ──────────────────────────────────────────

export class SwarmCoordinator {
  private config: CoordinatorConfig;
  private messageBus: IMessageBus;
  private chariots: Map<string, ChariotState> = new Map();
  private globalTaskHistory: TaskResult[] = [];

  // 快照系统
  private snapshotEngine: SnapshotEngine;
  private snapshotStorage: SnapshotStorage;

  constructor(
    config: CoordinatorConfig,
    messageBus: IMessageBus,
    storageConfig?: StorageConfig,
  ) {
    this.config = config;
    this.messageBus = messageBus;
    this.snapshotEngine = new SnapshotEngine(this);
    this.snapshotStorage = new SnapshotStorage(
      storageConfig ?? { backend: 'memory', autoSave: true },
    );
    this.setupMessageHandlers();
  }

  // ── 1. 战车管理 ─────────────────────────

  /** 创建新战车 (绑定多个Agent) */
  createChariot(name: string, agents: SwarmNode[]): ChariotState {
    const chariotId = `chariot-${Date.now()}`;
    
    // 创建协调器节点 (根节点)
    const coordinatorNode: SwarmNode = {
      id: `coordinator-${chariotId}`,
      type: 'sub-swarm',
      name: `${name}-Coordinator`,
      role: 'coordinator',
      subSwarm: {
        coordinator: null as any, // 自引用，在下面设置
        workers: agents,
        maxDepth: SwarmConfig.maxDepth,
        communicationPattern: 'hierarchical',
      },
      execute: async (task, context) => this.coordinateTask(task, agents, context),
      delegate: async (task, to) => to.execute(task, {} as ExecutionContext),
    };

    // 自引用
    coordinatorNode.subSwarm!.coordinator = coordinatorNode;

    // 创建共享记忆池
    const sharedMemory: SharedMemoryPool = {
      hot: new Map(),
      warm: new Map(),
      cold: { add: () => {}, search: () => [] },
      read: (agentId, key) => this.readFromPool(chariotId, agentId, key),
      write: (agentId, key, value) => this.writeToPool(chariotId, agentId, key, value),
      subscribe: (agentId, key, cb) => this.subscribeToPool(chariotId, agentId, key, cb),
      sync: () => this.syncPool(chariotId),
    };

    const chariot: ChariotState = {
      id: chariotId,
      name,
      coordinator: coordinatorNode,
      agents,
      sharedMemory,
      status: 'idle',
      createdAt: new Date(),
      taskCount: 0,
    };

    this.chariots.set(chariotId, chariot);
    
    // 广播战车创建
    this.messageBus.publish('chariot.created', {
      chariotId,
      name,
      agentCount: agents.length,
      coordinatorModel: this.config.model,
    });

    return chariot;
  }

  /** 从快照创建新战车（自动继承父战车状态） */
  createChariotFromSnapshot(
    name: string,
    snapshot: Snapshot,
    agents: SwarmNode[],
  ): ChariotState {
    const chariotId = `chariot-${Date.now()}`;

    // 1. 创建协调器节点
    const coordinatorNode: SwarmNode = {
      id: `coordinator-${chariotId}`,
      type: 'sub-swarm',
      name: `${name}-Coordinator`,
      role: 'coordinator',
      subSwarm: {
        coordinator: null as any,
        workers: agents,
        maxDepth: SwarmConfig.maxDepth,
        communicationPattern: 'hierarchical',
      },
      execute: async (task, context) => this.coordinateTask(task, agents, context),
      delegate: async (task, to) => to.execute(task, {} as ExecutionContext),
    };
    coordinatorNode.subSwarm!.coordinator = coordinatorNode;

    // 2. 创建共享记忆池（继承自快照 + 深拷贝）
    const sharedMemory: SharedMemoryPool = {
      hot: new Map(),
      warm: new Map(),
      cold: { add: () => {}, search: () => [] },
      read: (agentId, key) => this.readFromPool(chariotId, agentId, key),
      write: (agentId, key, value) => this.writeToPool(chariotId, agentId, key, value),
      subscribe: (agentId, key, cb) => this.subscribeToPool(chariotId, agentId, key, cb),
      sync: () => this.syncPool(chariotId),
    };

    // 3. 从快照恢复共享记忆
    for (const [key, value] of Object.entries(snapshot.sharedMemory.hot)) {
      sharedMemory.hot.set(key, deepClone(value));
    }
    for (const [key, value] of Object.entries(snapshot.sharedMemory.warm)) {
      sharedMemory.warm.set(key, value);
    }

    // 4. 恢复任务历史
    const clonedHistory = snapshot.taskHistory.map(item => deepClone(item));
    sharedMemory.write('system', 'global-task-history', clonedHistory);

    const chariot: ChariotState = {
      id: chariotId,
      name,
      coordinator: coordinatorNode,
      agents,
      sharedMemory,
      status: 'idle',
      createdAt: new Date(),
      taskCount: 0,
    };

    this.chariots.set(chariotId, chariot);

    // 5. 记录继承关系（将继承快照保存为新车子的初始快照）
    const inheritedSnapshot = this.snapshotEngine.cloneFromSnapshot(snapshot, {
      name,
    });
    inheritedSnapshot.inheritedSnapshot.metadata.sourceChariotId = chariotId;
    this.snapshotStorage.save(inheritedSnapshot.inheritedSnapshot).catch(console.error);

    // 6. 广播创建事件
    this.messageBus.publish('chariot.created', {
      chariotId,
      name,
      agentCount: agents.length,
      coordinatorModel: this.config.model,
      inheritedFrom: snapshot.metadata.snapshotId,
    });

    return chariot;
  }

  // ── 快照快捷操作 ────────────────────────

  /** 保存指定战车的当前快照 */
  async saveSnapshot(chariotId: string, options?: {
    tags?: string[];
    description?: string;
    parentSnapshotId?: string;
  }): Promise<Snapshot> {
    const snapshot = this.snapshotEngine.captureSnapshot(chariotId, {
      tags: options?.tags,
      description: options?.description,
      parentSnapshotId: options?.parentSnapshotId,
    });

    await this.snapshotStorage.save(snapshot);

    this.messageBus.publish('snapshot.saved', {
      chariotId,
      snapshotId: snapshot.metadata.snapshotId,
      version: snapshot.metadata.version,
    });

    return snapshot;
  }

  /** 恢复指定战车到最新快照状态 */
  async loadSnapshot(chariotId: string, snapshotId?: string): Promise<void> {
    let snapshot: Snapshot | undefined;

    if (snapshotId) {
      snapshot = await this.snapshotStorage.get(snapshotId);
    } else {
      snapshot = await this.snapshotStorage.getLatest(chariotId);
    }

    if (!snapshot) {
      throw new Error(`SwarmCoordinator: No snapshot found for chariot ${chariotId}`);
    }

    this.snapshotEngine.restoreSnapshot(chariotId, snapshot);
  }

  /** 获取指定战车的快照列表 */
  async getSnapshots(chariotId: string): Promise<Snapshot[]> {
    return this.snapshotStorage.getByChariot(chariotId);
  }

  /** 获取快照血缘链 */
  async getSnapshotLineage(snapshotId: string): Promise<Snapshot[]> {
    return this.snapshotStorage.getLineage(snapshotId);
  }

  /** 手动触发全量清理 */
  async cleanupSnapshots(): Promise<number> {
    return this.snapshotStorage.cleanupAll();
  }

  /** 获取快照存储统计 */
  async getSnapshotStats(): Promise<StorageStats> {
    return this.snapshotStorage.getStats();
  }

  // ── 2. 任务协调 ─────────────────────────

  /** 协调任务执行 */
  private async coordinateTask(
    task: SubTask,
    agents: SwarmNode[],
    context: ExecutionContext,
  ): Promise<TaskResult> {
    // Step 1: 任务分解
    const subTasks = this.decompose(task, agents);
    
    // Step 2: 动态调度
    const assignments = this.dispatch(subTasks, agents);
    
    // Step 3: 并行执行
    const results = await Promise.all(
      assignments.map(async ({ agent, subTask }) => {
        // 将共享记忆注入Agent上下文
        const enrichedContext = this.injectSharedMemory(context, agent);
        return agent.execute(subTask, enrichedContext);
      }),
    );
    
    // Step 4: 结果聚合
    const aggregated = this.aggregate(results);
    
    // Step 5: 更新共享记忆
    this.updateSharedMemory(task, results, aggregated);
    
    return aggregated;
  }

  // ── 3. 任务分解 ─────────────────────────

  /** 将任务分解为子任务 */
  decompose(task: SubTask, agents: SwarmNode[]): SubTask[] {
    switch (this.config.decompositionStrategy) {
      case 'auto':
        return this.autoDecompose(task, agents);
      case 'template':
        return this.templateDecompose(task);
      case 'llm-driven':
        return this.llmDrivenDecompose(task, agents);
      default:
        return this.autoDecompose(task, agents);
    }
  }

  private autoDecompose(task: SubTask, agents: SwarmNode[]): SubTask[] {
    // 基于Agent数量和任务复杂度自动分解
    const agentCount = agents.length;
    const complexity = this.assessComplexity(task);
    
    if (complexity < 1000) {
      // 简单任务不分解
      return [task];
    }
    
    // 按能力分域分解
    const domains = this.identifyDomains(task);
    return domains.map((domain, idx) => ({
      id: `${task.id}-sub-${idx}`,
      parentId: task.id,
      type: domain.type,
      content: domain.content,
      priority: task.priority,
      estimatedTokens: Math.floor(complexity / domains.length),
    }));
  }

  private templateDecompose(task: SubTask): SubTask[] {
    // 基于预定义模板分解 (如: 编码任务 = 需求分析→设计→编码→测试→审查)
    const templates: Record<string, string[]> = {
      'coding': ['需求分析', '架构设计', '代码实现', '测试验证', '代码审查'],
      'research': ['资料收集', '信息整合', '分析报告', '结论提炼'],
      'writing': ['大纲规划', '内容撰写', '编辑润色', '格式检查'],
    };
    
    const template = templates[task.type] || templates['research'];
    return template.map((step, idx) => ({
      id: `${task.id}-sub-${idx}`,
      parentId: task.id,
      type: step,
      content: `[${step}] ${task.content}`,
      priority: task.priority,
      estimatedTokens: 5000,
    }));
  }

  private llmDrivenDecompose(task: SubTask, agents: SwarmNode[]): SubTask[] {
    // 由Coordinator LLM动态分解 (需要调用模型API)
    // 简化版: 先使用auto分解
    return this.autoDecompose(task, agents);
  }

  // ── 4. 动态调度 ─────────────────────────

  /** 为单个任务选择最合适的 Agent（从 dispatch 逻辑中提取的能力匹配算法） */
  selectBestNode(task: SubTask): SwarmNode | undefined {
    const allAgents = this.getAllAgents().filter(a => a.isActive());
    if (allAgents.length === 0) return undefined;

    let bestAgent = allAgents[0];
    let bestScore = -Infinity;

    for (const agent of allAgents) {
      const score = this.matchScore(task, agent);
      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    return bestScore > 0 ? bestAgent : undefined;
  }

  /** 将子任务分配给最合适的Agent */
  dispatch(subTasks: SubTask[], agents: SwarmNode[]): { agent: SwarmNode; subTask: SubTask }[] {
    const available = agents.filter(a => a.status !== 'error');
    
    switch (this.config.dispatchStrategy) {
      case 'round-robin':
        return this.roundRobinDispatch(subTasks, available);
      case 'capability-match':
        return this.capabilityMatchDispatch(subTasks, available);
      case 'load-balanced':
        return this.loadBalancedDispatch(subTasks, available);
      default:
        return this.capabilityMatchDispatch(subTasks, available);
    }
  }

  /**
   * dispatchAll — dispatch + execute 的完整包装
   * 返回所有子任务的执行结果（兼容 ISwarmCoordinator 接口）
   */
  async dispatchAll(subTasks: SubTask[], context: ExecutionContext): Promise<TaskResult[]> {
    // 获取当前战车中的所有 Agent
    const allAgents = this.getAllAgents();
    const assignments = this.dispatch(subTasks, allAgents);

    const results = await Promise.all(
      assignments.map(async ({ agent, subTask }) => {
        const enrichedContext = this.injectSharedMemory(context, agent);
        return agent.execute(subTask);
      }),
    );

    return results;
  }

  private capabilityMatchDispatch(
    subTasks: SubTask[],
    agents: SwarmNode[],
  ): { agent: SwarmNode; subTask: SubTask }[] {
    return subTasks.map(subTask => {
      // 根据子任务类型匹配最合适的Agent
      const bestMatch = agents.reduce((best, agent) => {
        const score = this.matchScore(subTask, agent);
        return score > best.score ? { agent, score } : best;
      }, { agent: agents[0], score: 0 });
      
      return { agent: bestMatch.agent, subTask };
    });
  }

  /** 计算任务与Agent的匹配分数（公开API，供路由层调用） */
  matchScore(subTask: SubTask, agent: SwarmNode): number {
    let score = 0;
    
    // 角色匹配
    if (agent.role === subTask.type) score += 10;
    if (agent.role?.includes(subTask.type)) score += 5;
    
    // 负载状态
    if (agent.status === 'idle') score += 3;
    if (agent.status === 'running') score += 1;
    
    // 历史成功率
    const history = this.globalTaskHistory.filter(r => r.agentId === agent.id);
    if (history.length > 0) {
      const successRate = history.filter(r => r.success).length / history.length;
      score += successRate * 5;
    }
    
    return score;
  }

  private roundRobinDispatch(
    subTasks: SubTask[],
    agents: SwarmNode[],
  ): { agent: SwarmNode; subTask: SubTask }[] {
    return subTasks.map((subTask, idx) => ({
      agent: agents[idx % agents.length],
      subTask,
    }));
  }

  private loadBalancedDispatch(
    subTasks: SubTask[],
    agents: SwarmNode[],
  ): { agent: SwarmNode; subTask: SubTask }[] {
    // 按当前负载排序，优先分配给空闲Agent
    const sorted = [...agents].sort((a, b) => {
      const loadA = a.currentTasks?.length || 0;
      const loadB = b.currentTasks?.length || 0;
      return loadA - loadB;
    });
    
    return this.roundRobinDispatch(subTasks, sorted);
  }

  // ── 5. 结果聚合 ─────────────────────────

  /** 聚合多个Agent的结果 */
  aggregate(results: TaskResult[]): TaskResult {
    switch (this.config.aggregationStrategy) {
      case 'concat':
        return this.concatResults(results);
      case 'summarize':
        return this.summarizeResults(results);
      case 'merge':
        return this.mergeResults(results);
      case 'vote':
        return this.voteResults(results);
      default:
        return this.mergeResults(results);
    }
  }

  private concatResults(results: TaskResult[]): TaskResult {
    return {
      agentId: 'coordinator',
      success: results.every(r => r.success),
      output: results.map(r => r.output).join('\n\n---\n\n'),
      metadata: { aggregated: true, count: results.length },
    };
  }

  private summarizeResults(results: TaskResult[]): TaskResult {
    // 由Coordinator LLM生成摘要
    return {
      agentId: 'coordinator',
      success: results.every(r => r.success),
      output: `[摘要] ${results.length} 个Agent完成任务。\n关键结果:\n${
        results.map(r => `- ${r.agentId}: ${r.success ? '成功' : '失败'}`).join('\n')
      }`,
      metadata: { aggregated: true, strategy: 'summarize' },
    };
  }

  private mergeResults(results: TaskResult[]): TaskResult {
    // 合并去重
    const outputs = results.map(r => r.output);
    return {
      agentId: 'coordinator',
      success: results.every(r => r.success),
      output: outputs.join('\n'),
      metadata: { aggregated: true, merged: true },
    };
  }

  private voteResults(results: TaskResult[]): TaskResult {
    // 投票机制 (适用于有多个解的问题)
    const successes = results.filter(r => r.success);
    const majority = successes.length > results.length / 2;
    
    return {
      agentId: 'coordinator',
      success: majority,
      output: majority
        ? `共识达成 (${successes.length}/${results.length}):\n${successes[0]?.output || ''}`
        : `未达成共识 (${successes.length}/${results.length})`,
      metadata: { aggregated: true, strategy: 'vote' },
    };
  }

  // ── 6. 负载均衡 ─────────────────────────

  /** 动态调整Agent分配：检测负载不均并触发任务迁移 */
  rebalance(chariotId: string): { migrated: number; details: string[] } {
    const chariot = this.chariots.get(chariotId);
    if (!chariot) return { migrated: 0, details: ['Chariot not found'] };

    const details: string[] = [];
    let migrated = 0;

    // 收集各 Agent 负载
    const loads = chariot.agents.map(a => ({
      agent: a,
      load: a.meta.currentLoad,
      taskCount: this.globalTaskHistory.filter(r => r.agentId === a.id).length,
      isActive: a.isActive(),
    }));

    const activeLoads = loads.filter(l => l.isActive);
    if (activeLoads.length === 0) {
      return { migrated: 0, details: ['No active agents'] };
    }

    const avgLoad = activeLoads.reduce((sum, l) => sum + l.load, 0) / activeLoads.length;
    const maxLoad = Math.max(...activeLoads.map(l => l.load));
    const minLoad = Math.min(...activeLoads.map(l => l.load));

    details.push(`Load stats: avg=${avgLoad.toFixed(2)}, max=${maxLoad.toFixed(2)}, min=${minLoad.toFixed(2)}`);

    // 如果最大负载超过平均2倍，触发重平衡
    if (maxLoad > avgLoad * 2 && maxLoad > 0.5) {
      const overloaded = activeLoads.filter(l => l.load > avgLoad * 1.5).sort((a, b) => b.load - a.load);
      const underloaded = activeLoads.filter(l => l.load < avgLoad * 0.5).sort((a, b) => a.load - b.load);

      for (const heavy of overloaded) {
        for (const light of underloaded) {
          if (heavy.load - light.load > 0.5) {
            // 发布重平衡事件（实际迁移由上层调度器执行）
            this.messageBus.publish('coordinator.rebalance', {
              type: MessageType.REBALANCE,
              sender: 'SwarmCoordinator',
              topic: 'coordinator.rebalance',
              payload: {
                chariotId,
                fromAgent: heavy.agent.id,
                toAgent: light.agent.id,
                reason: 'load-imbalance',
                details: { avgLoad, maxLoad, minLoad },
              },
            });
            migrated++;
            details.push(`Triggered migration: ${heavy.agent.id} → ${light.agent.id}`);
          }
        }
      }
    }

    return { migrated, details };
  }

  // ── 7. 同步压缩 ─────────────────────────

  /** 检测上下文压力 */
  detectPressure(chariot: ChariotState): {
    level: 'none' | 'early' | 'critical' | 'emergency';
    maxUsage: number;
    avgUsage: number;
  } {
    const usages = chariot.agents.map(a => this.getAgentContextUsage(a));
    const maxUsage = Math.max(...usages, 0);
    const avgUsage = usages.reduce((a, b) => a + b, 0) / usages.length;
    
    let level: 'none' | 'early' | 'critical' | 'emergency' = 'none';
    if (maxUsage > 0.95) level = 'emergency';
    else if (maxUsage > 0.60) level = 'critical';
    else if (maxUsage > 0.40) level = 'early';
    
    return { level, maxUsage, avgUsage };
  }

  /** 同步压缩所有Agent上下文（HOT→WARM→COLD三层压缩） */
  async syncCompress(chariotId: string): Promise<{ compressed: number; errors: string[] }> {
    const chariot = this.chariots.get(chariotId);
    if (!chariot) throw new Error(`Chariot ${chariotId} not found`);

    const errors: string[] = [];
    let compressed = 0;

    // 1. 检测压力
    const pressure = this.detectPressure(chariot);
    if (pressure.level === 'none') return { compressed: 0, errors: ['No pressure detected'] };

    // 2. 生成压缩命令
    const command: CompressCommand = {
      level: pressure.level,
      preserveFirstTurns: 2,
      preserveLastTurns: 3,
      targetUsage: pressure.level === 'emergency' ? 0.5 : 0.7,
    };

    // 3. 广播压缩命令
    this.messageBus.publish('chariot.compress', {
      type: MessageType.STATE_SYNC,
      sender: 'SwarmCoordinator',
      topic: 'chariot.compress',
      payload: { chariotId, command, pressure },
    });

    // 4. 所有Agent并行压缩 + 调用 compress 回调
    await Promise.all(chariot.agents.map(async (agent) => {
      try {
        const beforeUsage = this.getAgentContextUsage(agent);
        await this.compressAgent(agent, command);
        const afterUsage = this.getAgentContextUsage(agent);
        if (afterUsage < beforeUsage) compressed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Agent ${agent.id}: ${msg}`);
      }
    }));

    // 5. 执行共享记忆池的三层同步（HOT→WARM→COLD）
    this.syncMemoryPool(chariot);

    // 6. 广播完成
    this.messageBus.publish('chariot.compress.done', {
      type: MessageType.STATE_SYNC,
      sender: 'SwarmCoordinator',
      topic: 'chariot.compress.done',
      payload: { chariotId, command, compressed, errorCount: errors.length },
    });

    return { compressed, errors };
  }

  /** 共享记忆池三层同步：HOT → WARM → COLD */
  private syncMemoryPool(chariot: ChariotState): void {
    const hot = chariot.sharedMemory.hot;
    const warm = chariot.sharedMemory.warm;
    const cold = chariot.sharedMemory.cold;

    // HOT → WARM: 将超过3轮旧的条目压缩为摘要
    const now = Date.now();
    const hotKeysToMove: string[] = [];
    for (const [key, value] of hot.entries()) {
      const meta = value?._meta as { lastAccess?: number; accessCount?: number } | undefined;
      const age = meta?.lastAccess ? now - meta.lastAccess : 0;
      const count = meta?.accessCount ?? 0;
      // 低频访问且过期的 → WARM
      if (age > 60000 && count < 3) {
        warm.set(key, this.summarizeForWarm(value));
        hotKeysToMove.push(key);
      }
    }
    for (const key of hotKeysToMove) {
      hot.delete(key);
    }

    // WARM → COLD: 将长期未更新的摘要归档到向量存储
    const warmKeysToMove: string[] = [];
    for (const [key, value] of warm.entries()) {
      // 使用内容哈希或简单摘要作为向量索引
      try {
        cold.add(`warm-${chariot.id}-${key}`, this.textToEmbedding(value), {
          chariotId: chariot.id,
          key,
          summary: value,
          archivedAt: now,
        });
        warmKeysToMove.push(key);
      } catch (err) {
        console.warn(`[syncMemoryPool] Failed to archive ${key} to cold:`, err);
      }
    }
    for (const key of warmKeysToMove) {
      warm.delete(key);
    }

    console.log(`[SwarmCoordinator] Memory sync for ${chariot.id}: HOT=${hot.size}, WARM=${warm.size}, archived=${warmKeysToMove.length}`);
  }

  private summarizeForWarm(value: any): string {
    if (typeof value === 'string') return value.slice(0, 500);
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value).slice(0, 500);
    }
    return String(value).slice(0, 500);
  }

  private textToEmbedding(text: string): number[] {
    // 简化版：使用字符频率作为伪嵌入向量
    // 实际生产环境应调用嵌入模型API
    const vec = new Array(64).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % 64] += text.charCodeAt(i) / 65536;
    }
    // 归一化
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map(v => v / norm);
  }

  private async compressAgent(agent: SwarmNode, command: CompressCommand): Promise<void> {
    // 通过agent的compress回调触发平台级压缩
    // 检查 agent 是否有 compress 回调
    const agentAny = agent as any;
    if (typeof agentAny.compress === 'function') {
      await agentAny.compress(command);
    } else {
      // 降级：仅打印日志
      console.log(`[Compress] ${agent.id}: ${command.level} → target ${(command.targetUsage * 100).toFixed(0)}%`);
    }
  }

  private getAgentContextUsage(agent: SwarmNode): number {
    // 获取Agent当前上下文使用率 (0-1)
    // 优先检查 agent 上的动态属性，否则基于负载估算
    return (agent as any).contextUsage ?? agent.meta.currentLoad;
  }

  // ── 8. 共享记忆池操作 ───────────────────

  private poolData: Map<string, Map<string, { value: any; subscribers: Set<Function> }>> = new Map();

  private readFromPool(chariotId: string, agentId: string, key: string): any {
    const pool = this.poolData.get(chariotId);
    if (!pool) return undefined;
    const entry = pool.get(key);
    return entry?.value;
  }

  private writeToPool(chariotId: string, agentId: string, key: string, value: any): void {
    if (!this.poolData.has(chariotId)) {
      this.poolData.set(chariotId, new Map());
    }
    const pool = this.poolData.get(chariotId)!;
    const entry = pool.get(key);
    
    if (entry) {
      entry.value = value;
      entry.subscribers.forEach(cb => cb(value));
    } else {
      pool.set(key, { value, subscribers: new Set() });
    }
    
    // 广播写入事件
    this.messageBus.publish('memory.write', { chariotId, agentId, key });
  }

  private subscribeToPool(chariotId: string, agentId: string, key: string, callback: Function): void {
    if (!this.poolData.has(chariotId)) {
      this.poolData.set(chariotId, new Map());
    }
    const pool = this.poolData.get(chariotId)!;
    const entry = pool.get(key);
    
    if (entry) {
      entry.subscribers.add(callback);
    } else {
      pool.set(key, { value: undefined, subscribers: new Set([callback]) });
    }
  }

  private syncPool(chariotId: string): void {
    const chariot = this.chariots.get(chariotId);
    if (!chariot) return;
    this.syncMemoryPool(chariot);
  }

  private injectSharedMemory(context: ExecutionContext, agent: SwarmNode): ExecutionContext {
    // 将共享记忆注入Agent执行上下文
    return {
      ...context,
      sharedMemory: {
        read: (key: string) => this.readFromPool(agent.id.split('-')[0], agent.id, key),
        write: (key: string, value: any) => this.writeToPool(agent.id.split('-')[0], agent.id, key, value),
      },
    };
  }

  private updateSharedMemory(task: SubTask, results: TaskResult[], aggregated: TaskResult): void {
    // 将任务结果写入共享记忆池
    const chariotId = task.id.split('-')[0]; // 简化
    if (!this.chariots.has(chariotId)) return;
    
    const chariot = this.chariots.get(chariotId)!;
    chariot.sharedMemory.write('coordinator', `task-${task.id}-result`, {
      task,
      results,
      aggregated,
      timestamp: Date.now(),
    });
  }

  // ── 9. 辅助方法 ─────────────────────────

  private assessComplexity(task: SubTask): number {
    // 基于内容长度和类型评估复杂度
    const length = task.content.length;
    const typeMultiplier: Record<string, number> = {
      'coding': 2,
      'research': 1.5,
      'writing': 1,
      'analysis': 1.8,
    };
    return length * (typeMultiplier[task.type] || 1);
  }

  private identifyDomains(task: SubTask): { type: string; content: string }[] {
    // 识别任务中的不同领域
    const domains = [];
    const content = task.content.toLowerCase();
    
    if (content.includes('code') || content.includes('编码')) {
      domains.push({ type: 'coding', content: task.content });
    }
    if (content.includes('doc') || content.includes('文档')) {
      domains.push({ type: 'writing', content: task.content });
    }
    if (content.includes('test') || content.includes('测试')) {
      domains.push({ type: 'testing', content: task.content });
    }
    
    return domains.length > 0 ? domains : [{ type: task.type, content: task.content }];
  }

  private setupMessageHandlers(): void {
    // 监听Agent完成事件
    this.messageBus.subscribe('agent.completed', (msg: SwarmMessage) => {
      const result = msg.payload as TaskResult;
      this.globalTaskHistory.push(result);
    });
    
    // 监听压缩请求
    this.messageBus.subscribe('coordinator.compress.request', (msg: SwarmMessage) => {
      const { chariotId } = msg.payload;
      this.syncCompress(chariotId).catch(console.error);
    });
  }

  // ── 10. 公共API ────────────────────────

  /** 获取所有战车 */
  getChariots(): ChariotState[] {
    return Array.from(this.chariots.values());
  }

  /** 获取战车状态 */
  getChariot(chariotId: string): ChariotState | undefined {
    return this.chariots.get(chariotId);
  }

  /** 暂停战车 */
  pauseChariot(chariotId: string): void {
    const chariot = this.chariots.get(chariotId);
    if (chariot) {
      chariot.status = 'paused';
      this.messageBus.publish('chariot.paused', { chariotId });
    }
  }

  /** 恢复战车 */
  resumeChariot(chariotId: string): void {
    const chariot = this.chariots.get(chariotId);
    if (chariot) {
      chariot.status = 'running';
      this.messageBus.publish('chariot.resumed', { chariotId });
    }
  }

  /** 销毁战车 */
  destroyChariot(chariotId: string): void {
    const chariot = this.chariots.get(chariotId);
    if (chariot) {
      // 1. 自动保存最终快照（临终快照）—— 异步但不阻塞
      Promise.resolve().then(async () => {
        try {
          const finalSnapshot = this.snapshotEngine.captureSnapshot(chariotId, {
            tags: ['final', 'auto-saved'],
            description: `Final snapshot before destroy of chariot ${chariotId}`,
          });
          await this.snapshotStorage.save(finalSnapshot);
        } catch (err) {
          // 临终快照失败不阻塞销毁流程
          console.error(`[SwarmCoordinator] Failed to save final snapshot for ${chariotId}:`, err);
        }
      });

      chariot.status = 'error'; // 标记为销毁
      this.chariots.delete(chariotId);
      this.messageBus.publish('chariot.destroyed', { chariotId });
    }
  }

  /** 根据ID递归查找Agent节点 */
  getAgentById(agentId: string): SwarmNode | undefined {
    for (const chariot of this.chariots.values()) {
      const found = chariot.coordinator.findById(agentId);
      if (found) return found;
      // 也搜索战车直接绑定的agents列表
      for (const agent of chariot.agents) {
        const foundInAgent = agent.findById(agentId);
        if (foundInAgent) return foundInAgent;
      }
    }
    return undefined;
  }

  /**
   * 遍历所有战车中的所有节点
   * @param callback 对每个节点执行的回调函数
   */
  traverse(callback: (node: SwarmNode, chariotId: string) => void): void {
    for (const [chariotId, chariot] of this.chariots) {
      chariot.coordinator.traverse((node) => callback(node, chariotId));
      for (const agent of chariot.agents) {
        agent.traverse((node) => callback(node, chariotId));
      }
    }
  }

  /** 获取所有战车中的所有Agent节点 */
  getAllAgents(): SwarmNode[] {
    const agents: SwarmNode[] = [];
    for (const chariot of this.chariots.values()) {
      agents.push(...chariot.agents);
      // 递归获取子蜂群中的agent
      for (const agent of chariot.agents) {
        agents.push(...agent.getAllAgents());
      }
    }
    // 去重（因为 chariot.agents 和 agent.getAllAgents() 可能有重叠）
    const seen = new Set<string>();
    return agents.filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  }
}

export default SwarmCoordinator;
