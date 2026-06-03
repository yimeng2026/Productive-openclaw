/**
 * SwarmNode.ts — SYLVA 蜂群节点
 *
 * 递归类型设计：
 * - type = 'agent':    叶子节点，直接执行任务（调用平台API）
 * - type = 'sub-swarm': 中间节点，持有子协调器和子节点集合
 *
 * 统一接口：
 * - execute(task): 所有节点（无论层级）都暴露相同的执行接口
 * - delegate(task): 将任务委托给最合适的子节点
 *
 * 平台无关：
 * - 不直接调用任何平台API
 * - 通过 agentCallback 回调函数与外部Agent平台对接
 * - 通过 eventBus 与蜂群消息总线通信
 */

import { IMessageBus, MessageType, SwarmMessage } from './SwarmMessageBus';
import { SwarmConfig } from './SwarmConfig';
import { SubTask, TaskResult, ExecutionContext } from './ExecutionModes';

// ── 接口隔离：打破 SwarmNode ↔ SwarmCoordinator 循环依赖 ──

/** SwarmCoordinator 的精简接口，用于 sub-swarm 延迟初始化 */
export interface ISwarmCoordinator {
  decompose(task: SubTask): SubTask[] | Promise<SubTask[]>;
  dispatchAll(subTasks: SubTask[], context: ExecutionContext): Promise<TaskResult[]>;
  aggregate(results: TaskResult[], originalTask?: SubTask): TaskResult | Promise<TaskResult>;
  selectBestNode?(task: SubTask): SwarmNode | undefined;
}

/** 动态加载 SwarmCoordinator 的工厂（避免编译时循环依赖） */
let coordinatorModule: Promise<typeof import('./SwarmCoordinator')> | null = null;
async function getSwarmCoordinatorClass(): Promise<typeof import('./SwarmCoordinator')> {
  if (!coordinatorModule) {
    coordinatorModule = import('./SwarmCoordinator');
  }
  return coordinatorModule;
}

// ──────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────

export type NodeType = 'agent' | 'sub-swarm';

/** Agent节点专用配置 */
export interface AgentConfig {
  /** Agent模型ID/名称 */
  modelId: string;
  /** 专长领域标签 */
  expertise: string[];
  /** 温度参数（创造性 vs 确定性） */
  temperature?: number;
  /** 最大token数 */
  maxTokens?: number;
  /** 系统提示词 */
  systemPrompt?: string;
}

/** 子蜂群配置 */
export interface SubSwarmConfig {
  /** 子节点列表（递归：每个节点也可以是 sub-swarm） */
  workers: SwarmNode[];
  /** 子蜂群协调器（延迟初始化，运行时动态加载 SwarmCoordinator） */
  coordinator?: ISwarmCoordinator;
  /** 子蜂群专用配置（继承父节点，可覆盖） */
  configOverride?: Partial<SwarmConfig>;
}

/** 平台无关的Agent执行回调 */
export type AgentCallback = (
  task: SubTask,
  agentConfig: AgentConfig
) => Promise<unknown>;

/** Agent状态快照（用于外部查询和监控） */
export interface AgentStateSnapshot {
  id: string;
  type: NodeType;
  name: string;
  role: string;
  lifecycleState: 'active' | 'paused' | 'isolated';
  pauseReason?: string;
  pausedAt?: number;
  meta: NodeMeta;
  agentConfig?: AgentConfig;
  subSwarmSummary?: {
    workerCount: number;
    totalSubtreeNodes: number;
  };
  isExecuting: boolean;
  isAvailable: boolean;
  isActive: boolean;
}

/** 节点元数据 */
export interface NodeMeta {
  createdAt: number;
  lastActiveAt: number;
  totalTasksExecuted: number;
  totalTasksFailed: number;
  averageExecutionTimeMs: number;
  currentLoad: number;      // 0-1，当前负载
  depth: number;            // 在蜂群树中的深度
}

/** 蜂群节点 — 递归核心数据结构 */
export class SwarmNode {
  readonly id: string;
  readonly type: NodeType;
  readonly name: string;
  readonly role: string;       // 角色描述，如 "code-writer", "reviewer"

  // Agent 节点属性（type='agent' 时存在）
  agentConfig?: AgentConfig;
  private agentCallback?: AgentCallback;

  // Sub-swarm 节点属性（type='sub-swarm' 时存在）
  subSwarm?: SubSwarmConfig;

  // 共享基础设施
  private eventBus: IMessageBus;
  private config: SwarmConfig;
  private parent?: SwarmNode;

  // 运行时状态
  meta: NodeMeta;
  private isExecuting = false;

  constructor(options: {
    id: string;
    type: NodeType;
    name: string;
    role: string;
    agentConfig?: AgentConfig;
    subSwarm?: Omit<SubSwarmConfig, 'coordinator'>;
    eventBus: IMessageBus;
    config: SwarmConfig;
    parent?: SwarmNode;
    agentCallback?: AgentCallback;
  }) {
    this.id = options.id;
    this.type = options.type;
    this.name = options.name;
    this.role = options.role;
    this.eventBus = options.eventBus;
    this.config = options.config;
    this.parent = options.parent;
    this.agentCallback = options.agentCallback;

    const now = Date.now();
    this.meta = {
      createdAt: now,
      lastActiveAt: now,
      totalTasksExecuted: 0,
      totalTasksFailed: 0,
      averageExecutionTimeMs: 0,
      currentLoad: 0,
      depth: options.parent ? options.parent.meta.depth + 1 : 0,
    };

    if (options.type === 'agent') {
      if (!options.agentConfig) {
        throw new Error(`SwarmNode [${options.id}]: agent node requires agentConfig`);
      }
      this.agentConfig = options.agentConfig;
    } else {
      if (!options.subSwarm) {
        throw new Error(`SwarmNode [${options.id}]: sub-swarm node requires subSwarm.workers`);
      }
      this.subSwarm = {
        ...options.subSwarm,
        workers: options.subSwarm.workers,
      };
      // 子节点深度自动计算
      for (const worker of this.subSwarm.workers) {
        (worker as any).meta.depth = this.meta.depth + 1;
        (worker as any).parent = this;
      }
    }
  }

  // ═══════════════════════════════════════════
  // 核心接口：execute
  // ═══════════════════════════════════════════

  /**
   * 执行入口 — 所有节点（agent/sub-swarm）的统一接口
   *
   * 执行流程：
   * 1. 发布 TASK_START 消息
   * 2. 根据节点类型分发：
   *    - agent: 调用 agentCallback 执行实际任务
   *    - sub-swarm: 委托给 SwarmCoordinator 分解调度
   * 3. 发布 TASK_COMPLETE / TASK_FAIL 消息
   * 4. 更新节点元数据
   */
  async execute(task: SubTask): Promise<TaskResult> {
    // 检查节点是否处于活跃状态
    if (this.lifecycleState === 'paused') {
      return {
        taskId: task.id,
        status: 'failure',
        error: `SwarmNode [${this.id}]: node is paused (${this.pauseReason || 'no reason'})`,
        durationMs: 0,
        nodeId: this.id,
        depth: this.meta.depth,
      };
    }
    if (this.lifecycleState === 'isolated') {
      return {
        taskId: task.id,
        status: 'failure',
        error: `SwarmNode [${this.id}]: node is isolated (${this.pauseReason || 'no reason'})`,
        durationMs: 0,
        nodeId: this.id,
        depth: this.meta.depth,
      };
    }

    const startTime = Date.now();
    this.isExecuting = true;
    this.meta.currentLoad = 1;
    this.meta.lastActiveAt = startTime;

    // 广播：开始执行
    await this.eventBus.publish(`task.${task.id}`, {
      type: MessageType.TASK_START,
      sender: this.id,
      topic: `task.${task.id}`,
      payload: {
        nodeId: this.id,
        nodeName: this.name,
        nodeType: this.type,
        task,
      },
      taskId: task.id,
      depth: this.meta.depth,
    });

    try {
      let result: TaskResult;

      if (this.type === 'agent') {
        result = await this.executeAsAgent(task, startTime);
      } else {
        result = await this.executeAsSubSwarm(task, startTime);
      }

      // 广播：执行完成
      await this.eventBus.publish(`task.${task.id}`, {
        type: result.status === 'success' ? MessageType.TASK_COMPLETE : MessageType.TASK_FAIL,
        sender: this.id,
        topic: `task.${task.id}`,
        payload: {
          nodeId: this.id,
          result,
          durationMs: Date.now() - startTime,
        },
        taskId: task.id,
        depth: this.meta.depth,
      });

      // 更新统计
      this.meta.totalTasksExecuted++;
      if (result.status !== 'success') {
        this.meta.totalTasksFailed++;
      }
      this.updateAverageExecutionTime(Date.now() - startTime);

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const failResult: TaskResult = {
        taskId: task.id,
        status: 'failure',
        error: errorMsg,
        durationMs: Date.now() - startTime,
        nodeId: this.id,
        depth: this.meta.depth,
      };

      await this.eventBus.publish(`task.${task.id}`, {
        type: MessageType.TASK_FAIL,
        sender: this.id,
        topic: `task.${task.id}`,
        payload: {
          nodeId: this.id,
          result: failResult,
          error: errorMsg,
        },
        taskId: task.id,
        depth: this.meta.depth,
      });

      this.meta.totalTasksFailed++;
      this.updateAverageExecutionTime(Date.now() - startTime);

      return failResult;
    } finally {
      this.isExecuting = false;
      this.meta.currentLoad = 0;
    }
  }

  /**
   * Agent 模式执行 — 调用外部平台API（通过回调解耦）
   */
  private async executeAsAgent(task: SubTask, startTime: number): Promise<TaskResult> {
    if (!this.agentCallback || !this.agentConfig) {
      throw new Error(`SwarmNode [${this.id}]: agentCallback not configured`);
    }

    // 设置超时控制
    const timeoutMs = task.timeoutMs ?? this.config.taskTimeoutMs;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Task timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    // 竞争：执行 vs 超时
    const data = await Promise.race([
      this.agentCallback(task, this.agentConfig),
      timeoutPromise,
    ]);

    return {
      taskId: task.id,
      status: 'success',
      data,
      durationMs: Date.now() - startTime,
      nodeId: this.id,
      depth: this.meta.depth,
    };
  }

  /**
   * Sub-swarm 模式执行 — 委托给协调器（延迟初始化 + 动态导入打破循环依赖）
   */
  private async executeAsSubSwarm(task: SubTask, startTime: number): Promise<TaskResult> {
    if (!this.subSwarm) {
      throw new Error(`SwarmNode [${this.id}]: subSwarm not initialized`);
    }

    // 延迟初始化协调器：首次使用时动态导入 SwarmCoordinator
    if (!this.subSwarm.coordinator) {
      const mod = await getSwarmCoordinatorClass();
      // 使用默认 CoordinatorConfig（SwarmNode 不持有完整 coordinator 配置）
      const coordinatorConfig = {
        model: 'gpt-4',
        maxTokens: 128000,
        decompositionStrategy: 'auto' as const,
        dispatchStrategy: 'capability-match' as const,
        aggregationStrategy: 'merge' as const,
      };
      this.subSwarm.coordinator = new mod.SwarmCoordinator(
        coordinatorConfig,
        this.eventBus,
        { backend: 'memory', autoSave: true },
      ) as ISwarmCoordinator;
    }

    const coordinator = this.subSwarm.coordinator;

    // 1. 分解任务
    const subTasks = await coordinator.decompose(task);

    // 2. 调度执行
    const execContext: ExecutionContext = {
      mode: this.config.defaultExecutionMode,
      depth: this.meta.depth + 1,
      parentTaskId: task.id,
      startTime,
      config: {
        timeoutMs: task.timeoutMs ?? this.config.taskTimeoutMs,
        maxRetries: this.config.maxRetries,
      },
    };

    const results = await coordinator.dispatchAll(
      Array.isArray(subTasks) ? subTasks : [subTasks],
      execContext,
    );

    // 3. 聚合结果
    const aggregated = await coordinator.aggregate(results, task);

    return {
      taskId: task.id,
      status: aggregated.status,
      data: aggregated.data,
      error: aggregated.error,
      durationMs: Date.now() - startTime,
      nodeId: this.id,
      depth: this.meta.depth,
    };
  }

  // ═══════════════════════════════════════════
  // 核心接口：delegate
  // ═══════════════════════════════════════════

  /**
   * 委托任务 — 将任务转交给最合适的子节点
   *
   * 智能匹配逻辑：
   * 1. 如果本节点是 agent → 直接执行（不应被调用，防御性处理）
   * 2. 如果本节点是 sub-swarm → 使用 coordinator.dispatch 选择子节点
   */
  async delegate(task: SubTask): Promise<TaskResult> {
    if (this.type === 'agent') {
      // Agent 节点不应该被委托（除非配置为可代理模式）
      return this.execute(task);
    }

    if (!this.subSwarm?.coordinator) {
      // 协调器未初始化，直接执行（会触发子蜂群分解）
      return this.execute(task);
    }

    // 使用协调器的动态调度
    const node = this.subSwarm.coordinator.selectBestNode(task);
    if (!node) {
      return {
        taskId: task.id,
        status: 'failure',
        error: `SwarmNode [${this.id}]: no available worker to delegate task`,
        durationMs: 0,
        nodeId: this.id,
        depth: this.meta.depth,
      };
    }

    return node.execute(task);
  }

  // ═══════════════════════════════════════════
  // 硬件自适应：负载检查
  // ═══════════════════════════════════════════

  /**
   * 检查当前节点是否可接受新任务
   * 用于负载均衡决策
   */
  isAvailable(): boolean {
    // 正在执行 = 不可用
    if (this.isExecuting) return false;

    // 当前负载过高 = 不可用（对于agent节点，当前只有0/1两种状态）
    if (this.meta.currentLoad >= 1) return false;

    // 失败率过高 = 暂时不可用（冷却期）
    const failureRate = this.meta.totalTasksExecuted > 0
      ? this.meta.totalTasksFailed / this.meta.totalTasksExecuted
      : 0;
    if (failureRate > 0.5 && this.meta.totalTasksExecuted > 5) {
      return false;
    }

    return true;
  }

  /**
   * 获取节点能力评分（用于调度器选择最优节点）
   */
  getCapabilityScore(task: SubTask): number {
    let score = 0;

    // 角色匹配度
    if (task.meta?.requiredRole && task.meta.requiredRole === this.role) {
      score += 100;
    }

    // Agent专长匹配
    if (this.type === 'agent' && this.agentConfig) {
      const taskTags = (task.meta?.expertiseTags as string[]) ?? [];
      const matchCount = taskTags.filter(tag =>
        this.agentConfig!.expertise.includes(tag)
      ).length;
      score += matchCount * 30;
    }

    // 负载越低分数越高
    score += (1 - this.meta.currentLoad) * 20;

    // 历史执行速度（越快越好）
    if (this.meta.averageExecutionTimeMs > 0) {
      score += Math.max(0, 50 - this.meta.averageExecutionTimeMs / 1000);
    }

    // 深度惩罚（优先使用浅层节点，减少递归开销）
    score -= this.meta.depth * 5;

    return score;
  }

  // ═══════════════════════════════════════════
  // 递归工具方法
  // ═══════════════════════════════════════════

  /**
   * 递归统计子树节点数
   */
  countSubtree(): number {
    let count = 1; // 自己
    if (this.type === 'sub-swarm' && this.subSwarm) {
      for (const worker of this.subSwarm.workers) {
        count += worker.countSubtree();
      }
    }
    return count;
  }

  /**
   * 递归获取所有叶子节点（agent节点）
   */
  getAllAgents(): SwarmNode[] {
    if (this.type === 'agent') return [this];
    const agents: SwarmNode[] = [];
    if (this.subSwarm) {
      for (const worker of this.subSwarm.workers) {
        agents.push(...worker.getAllAgents());
      }
    }
    return agents;
  }

  /**
   * 递归获取指定深度的所有节点
   */
  getNodesAtDepth(targetDepth: number): SwarmNode[] {
    if (this.meta.depth === targetDepth) return [this];
    const nodes: SwarmNode[] = [];
    if (this.subSwarm) {
      for (const worker of this.subSwarm.workers) {
        nodes.push(...worker.getNodesAtDepth(targetDepth));
      }
    }
    return nodes;
  }

  /**
   * 获取当前节点所在的根蜂群
   */
  getRootSwarm(): SwarmNode {
    let current: SwarmNode = this;
    while (current.parent) {
      current = current.parent;
    }
    return current;
  }

  /**
   * 递归遍历所有节点，执行回调
   * @param callback 对每个节点执行的回调函数
   */
  traverse(callback: (node: SwarmNode) => void): void {
    callback(this);
    if (this.type === 'sub-swarm' && this.subSwarm) {
      for (const worker of this.subSwarm.workers) {
        worker.traverse(callback);
      }
    }
  }

  /**
   * 根据ID递归查找节点
   * @param id 目标节点ID
   * @returns 找到的节点，或 undefined
   */
  findById(id: string): SwarmNode | undefined {
    if (this.id === id) return this;
    if (this.type === 'sub-swarm' && this.subSwarm) {
      for (const worker of this.subSwarm.workers) {
        const found = worker.findById(id);
        if (found) return found;
      }
    }
    return undefined;
  }

  // ═══════════════════════════════════════════
  // 状态管理：暂停 / 恢复
  // ═══════════════════════════════════════════

  /** 节点生命周期状态 */
  private lifecycleState: 'active' | 'paused' | 'isolated' = 'active';

  /** 暂停原因记录 */
  private pauseReason?: string;

  /** 暂停时间戳 */
  private pausedAt?: number;

  /**
   * 暂停节点 — 阻止接受新任务，当前任务完成后进入休眠
   * @param reason 暂停原因
   */
  pause(reason?: string): void {
    if (this.lifecycleState === 'paused') return;
    this.lifecycleState = 'paused';
    this.pauseReason = reason;
    this.pausedAt = Date.now();
    this.eventBus.publish('node.paused', {
      type: MessageType.STATE_SYNC,
      sender: this.id,
      topic: 'node.paused',
      payload: { nodeId: this.id, reason, pausedAt: this.pausedAt },
    });
  }

  /**
   * 恢复节点 — 重新接受任务
   */
  resume(): void {
    if (this.lifecycleState !== 'paused') return;
    this.lifecycleState = 'active';
    const duration = this.pausedAt ? Date.now() - this.pausedAt : 0;
    this.pauseReason = undefined;
    this.pausedAt = undefined;
    this.eventBus.publish('node.resumed', {
      type: MessageType.STATE_SYNC,
      sender: this.id,
      topic: 'node.resumed',
      payload: { nodeId: this.id, pausedDurationMs: duration },
    });
  }

  /**
   * 终止节点 — 永久停止，不再接受任何任务（比 isolate 更强）
   * @param reason 终止原因
   */
  terminate(reason?: string): void {
    this.lifecycleState = 'isolated';
    this.pauseReason = reason || 'Terminated by intervention';
    this.eventBus.publish('node.terminated', {
      type: MessageType.NODE_DEREGISTER,
      sender: this.id,
      topic: 'node.terminated',
      payload: { nodeId: this.id, reason: this.pauseReason, terminatedAt: Date.now() },
    });
  }

  /**
   * 隔离节点 — 标记为故障，不再分配任务
   * @param reason 隔离原因
   */
  isolate(reason?: string): void {
    this.lifecycleState = 'isolated';
    this.pauseReason = reason;
    this.eventBus.publish('node.isolated', {
      type: MessageType.ERROR_REPORT,
      sender: this.id,
      topic: 'node.isolated',
      payload: { nodeId: this.id, reason },
    });
  }

  /**
   * 获取当前生命周期状态
   */
  getLifecycleState(): 'active' | 'paused' | 'isolated' {
    return this.lifecycleState;
  }

  /**
   * 检查节点是否处于活跃状态（可接受任务）
   */
  isActive(): boolean {
    return this.lifecycleState === 'active' && this.isAvailable();
  }

  /**
   * 更新节点配置（热更新）
   * @param configDelta 配置变更部分
   */
  updateConfig(configDelta: Partial<AgentConfig>): void {
    if (this.type !== 'agent' || !this.agentConfig) {
      throw new Error(`SwarmNode [${this.id}]: only agent nodes support config update`);
    }
    this.agentConfig = { ...this.agentConfig, ...configDelta };
    this.eventBus.publish('node.configUpdated', {
      type: MessageType.CONFIG_UPDATE,
      sender: this.id,
      topic: 'node.configUpdated',
      payload: { nodeId: this.id, updatedFields: Object.keys(configDelta) },
    });
  }

  /**
   * 获取节点完整状态快照
   */
  getStateSnapshot(): AgentStateSnapshot {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      role: this.role,
      lifecycleState: this.lifecycleState,
      pauseReason: this.pauseReason,
      pausedAt: this.pausedAt,
      meta: { ...this.meta },
      agentConfig: this.type === 'agent' ? { ...this.agentConfig } : undefined,
      subSwarmSummary: this.type === 'sub-swarm' ? {
        workerCount: this.subSwarm?.workers.length ?? 0,
        totalSubtreeNodes: this.countSubtree(),
      } : undefined,
      isExecuting: this.isExecuting,
      isAvailable: this.isAvailable(),
      isActive: this.isActive(),
    };
  }

  // ═══════════════════════════════════════════
  // 内部辅助
  // ═══════════════════════════════════════════

  private updateAverageExecutionTime(durationMs: number): void {
    const n = this.meta.totalTasksExecuted + this.meta.totalTasksFailed;
    const old = this.meta.averageExecutionTimeMs;
    this.meta.averageExecutionTimeMs = (old * (n - 1) + durationMs) / n;
  }
}
