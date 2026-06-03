import { SwarmNode, AgentStateSnapshot } from "./SwarmNode";
import { EventEmitter } from "events";

/**
 * AgentGroup - 可无限嵌套的Agent群组
 * 
 * 核心特性：
 * - 每个Group有独立Coordinator
 * - Group可包含Agents和subGroups（其他Group实例）
 * - 合并时原有结构保持相对不变
 * - Coordinator对外暴露控制接口
 */

export type GroupStatus = 'idle' | 'planning' | 'executing' | 'handoff' | 'completed' | 'error' | 'paused';

export interface AgentGroupConfig {
  id: string;
  name: string;
  description?: string;
  coordinatorPresetId?: string;
  parentGroupId?: string;
  autoStart?: boolean;
}

export interface HandoffPayload {
  objective: string;
  completedActions: string[];
  blockers: string[];
  nextExecutor: string;
  expectedOutput: string;
  stateSnapshot: AgentStateSnapshot;
  timestamp: Date;
}

export class AgentGroup extends EventEmitter {
  public readonly id: string;
  public name: string;
  public description: string;
  public status: GroupStatus = 'idle';
  public readonly createdAt: Date;

  // 层级关系
  public parentGroup: AgentGroup | null = null;
  public subGroups: Map<string, AgentGroup> = new Map();

  // 成员
  public agents: SwarmNode[] = [];
  public coordinator: GroupCoordinator;

  // 编排状态
  public blueprintId?: string;
  public currentTask?: string;
  public handoffQueue: HandoffPayload[] = [];

  constructor(config: AgentGroupConfig) {
    super();
    this.id = config.id;
    this.name = config.name;
    this.description = config.description || '';
    this.createdAt = new Date();

    // 创建本群组的Coordinator
    this.coordinator = new GroupCoordinator(this, config.coordinatorPresetId);

    if (config.parentGroupId) {
      // 延迟绑定parent，等注册时处理
    }

    if (config.autoStart) {
      this.activate();
    }
  }

  // ========== 层级操作 ==========

  /** 添加子群组（实现无限嵌套） */
  addSubGroup(subGroup: AgentGroup): boolean {
    if (subGroup.id === this.id) return false; // 不能嵌套自己
    if (this.subGroups.has(subGroup.id)) return false;

    subGroup.parentGroup = this;
    this.subGroups.set(subGroup.id, subGroup);

    // 子群组的Coordinator向本群组Coordinator注册
    this.coordinator.registerSubCoordinator(subGroup.coordinator);

    this.emit('subGroupAdded', { groupId: this.id, subGroupId: subGroup.id });
    return true;
  }

  /** 移除子群组 */
  removeSubGroup(subGroupId: string): boolean {
    const subGroup = this.subGroups.get(subGroupId);
    if (!subGroup) return false;

    subGroup.parentGroup = null;
    this.subGroups.delete(subGroupId);
    this.coordinator.unregisterSubCoordinator(subGroupId);

    this.emit('subGroupRemoved', { groupId: this.id, subGroupId });
    return true;
  }

  /** 添加Agent */
  addAgent(agent: SwarmNode): boolean {
    const exists = this.agents.some((a) => a.getStateSnapshot().id === agent.getStateSnapshot().id);
    if (exists) return false;

    this.agents.push(agent);
    this.emit('agentAdded', { groupId: this.id, agentId: agent.getStateSnapshot().id });
    return true;
  }

  /** 移除Agent */
  removeAgent(agentId: string): boolean {
    const idx = this.agents.findIndex((a) => a.getStateSnapshot().id === agentId);
    if (idx === -1) return false;

    const agent = this.agents[idx];
    this.agents.splice(idx, 1);
    this.emit('agentRemoved', { groupId: this.id, agentId });
    return true;
  }

  // ========== 状态管理 ==========

  activate(): void {
    this.status = 'idle';
    this.coordinator.activate();
    this.emit('activated', { groupId: this.id });
  }

  pause(reason?: string): void {
    this.status = 'paused';
    this.coordinator.pause(reason);
    // 级联暂停子群组
    for (const sub of this.subGroups.values()) {
      sub.pause(`parent-paused: ${reason || 'unknown'}`);
    }
    this.emit('paused', { groupId: this.id, reason });
  }

  resume(): void {
    this.status = 'idle';
    this.coordinator.resume();
    for (const sub of this.subGroups.values()) {
      sub.resume();
    }
    this.emit('resumed', { groupId: this.id });
  }

  // ========== 查询 ==========

  getAgentById(agentId: string): SwarmNode | undefined {
    // 先在直接agents中查找
    const direct = this.agents.find((a) => a.getStateSnapshot().id === agentId);
    if (direct) return direct;

    // 递归在子群组中查找
    for (const sub of this.subGroups.values()) {
      const found = sub.getAgentById(agentId);
      if (found) return found;
    }

    return undefined;
  }

  getAllAgents(): SwarmNode[] {
    const all = [...this.agents];
    for (const sub of this.subGroups.values()) {
      all.push(...sub.getAllAgents());
    }
    return all;
  }

  getAllAgentSnapshots(): AgentStateSnapshot[] {
    return this.getAllAgents().map((a) => a.getStateSnapshot());
  }

  getStats() {
    const allAgents = this.getAllAgentSnapshots();
    return {
      groupId: this.id,
      directAgents: this.agents.length,
      subGroups: this.subGroups.size,
      totalAgents: allAgents.length,
      active: allAgents.filter((a) => a.lifecycleState === 'active').length,
      paused: allAgents.filter((a) => a.lifecycleState === 'paused').length,
      isolated: allAgents.filter((a) => a.lifecycleState === 'isolated').length,
      status: this.status,
    };
  }

  // ========== 序列化 ==========

  toJSON(): object {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      status: this.status,
      createdAt: this.createdAt,
      agents: this.agents.map((a) => a.getStateSnapshot().id),
      subGroups: Array.from(this.subGroups.keys()),
      parentGroup: this.parentGroup?.id || null,
      stats: this.getStats(),
    };
  }
}

/**
 * GroupCoordinator - 群组专属协调员
 * 
 * 职责：
 * 1. 组织本群组内部自主编排
 * 2. 对外暴露控制接口（供用户人工干预）
 * 3. 向上级Coordinator汇报/接收下级Coordinator汇报
 */
export class GroupCoordinator extends EventEmitter {
  public group: AgentGroup;
  public presetId?: string;
  public isActive: boolean = false;

  // 下级协调员（子群组的Coordinator）
  private subCoordinators: Map<string, GroupCoordinator> = new Map();

  // 编排状态
  private executionPlan: string[] = [];
  private currentStep: number = 0;

  constructor(group: AgentGroup, presetId?: string) {
    super();
    this.group = group;
    this.presetId = presetId;
  }

  // ========== 生命周期 ==========

  activate(): void {
    this.isActive = true;
    this.emit('activated', { coordinatorId: this.getId(), groupId: this.group.id });
  }

  pause(reason?: string): void {
    this.isActive = false;
    this.emit('paused', { coordinatorId: this.getId(), reason });
  }

  resume(): void {
    this.isActive = true;
    this.emit('resumed', { coordinatorId: this.getId() });
  }

  // ========== 编排核心 ==========

  /**
   * 执行编排计划
   * 按顺序或并行调度本群组的Agents执行任务
   */
  async executePlan(plan: string[]): Promise<void> {
    this.executionPlan = plan;
    this.currentStep = 0;
    this.group.status = 'executing';

    for (let i = 0; i < plan.length; i++) {
      if (!this.isActive) {
        this.emit('executionInterrupted', { step: i, reason: 'coordinator paused' });
        break;
      }

      this.currentStep = i;
      const task = plan[i];
      
      // 选择最合适的Agent执行
      const agent = this.selectBestAgent(task);
      if (!agent) {
        this.emit('executionError', { step: i, task, error: 'no suitable agent' });
        continue;
      }

      try {
        // 执行任务并等待结果
        const result = await this.delegateTask(agent, task);
        
        // 构建HandoffPayload
        const handoff: HandoffPayload = {
          objective: task,
          completedActions: [task],
          blockers: result.blockers || [],
          nextExecutor: plan[i + 1] || 'none',
          expectedOutput: result.output || '',
          stateSnapshot: agent.getStateSnapshot(),
          timestamp: new Date(),
        };

        this.group.handoffQueue.push(handoff);
        this.emit('handoff', handoff);

      } catch (err) {
        this.emit('executionError', { step: i, task, error: err instanceof Error ? err.message : String(err) });
      }
    }

    this.group.status = this.isActive ? 'completed' : 'paused';
    this.emit('planCompleted', { groupId: this.group.id, stepsCompleted: this.currentStep + 1 });
  }

  /** 选择最适合执行任务的Agent */
  selectBestAgent(task: string): SwarmNode | undefined {
    const available = this.group.agents.filter((a) => a.isAvailable());
    if (available.length === 0) return undefined;

    // 按capability score排序，选最高的
    return available.reduce((best, current) => {
      // 简化版：假设task是SubTask类型，这里做适配
      const bestScore = (best as any).getCapabilityScore?.(task) || 0;
      const currentScore = (current as any).getCapabilityScore?.(task) || 0;
      return currentScore > bestScore ? current : best;
    });
  }

  /** 委派任务给Agent */
  async delegateTask(agent: SwarmNode, task: string): Promise<{ output?: string; blockers?: string[] }> {
    // 适配SwarmNode的execute/delegate接口
    if (typeof (agent as any).execute === 'function') {
      const result = await (agent as any).execute({ description: task } as any);
      return { output: result?.output || '', blockers: [] };
    }
    return { output: '', blockers: ['Agent does not support execution'] };
  }

  // ========== 人工干预接口 ==========

  /** 重新分配Agent到另一个任务 */
  reassignAgent(agentId: string, newTask: string): boolean {
    const agent = this.group.getAgentById(agentId);
    if (!agent) return false;

    this.emit('agentReassigned', { agentId, newTask, groupId: this.group.id });
    return true;
  }

  /** 向Agent发送指令 */
  injectCommand(agentId: string, command: string): boolean {
    const agent = this.group.getAgentById(agentId);
    if (!agent) return false;

    // 适配：如果Agent支持指令注入
    this.emit('commandInjected', { agentId, command, groupId: this.group.id });
    return true;
  }

  /** 强制终止Agent */
  terminateAgent(agentId: string): boolean {
    const agent = this.group.getAgentById(agentId);
    if (!agent) return false;

    // 使用isolate作为软终止
    if (typeof (agent as any).isolate === 'function') {
      (agent as any).isolate('force-terminated-by-coordinator');
    }

    this.emit('agentTerminated', { agentId, groupId: this.group.id });
    return true;
  }

  /** 批量控制 */
  batchControl(agentIds: string[], action: 'pause' | 'resume' | 'isolate'): { succeeded: string[]; failed: string[] } {
    const succeeded: string[] = [];
    const failed: string[] = [];

    for (const id of agentIds) {
      const agent = this.group.getAgentById(id);
      if (!agent) {
        failed.push(id);
        continue;
      }

      try {
        switch (action) {
          case 'pause':
            (agent as any).pause?.('batch-control');
            break;
          case 'resume':
            (agent as any).resume?.();
            break;
          case 'isolate':
            (agent as any).isolate?.('batch-control');
            break;
        }
        succeeded.push(id);
      } catch {
        failed.push(id);
      }
    }

    this.emit('batchControl', { action, succeeded, failed, groupId: this.group.id });
    return { succeeded, failed };
  }

  // ========== 层级协调 ==========

  /** 注册下级Coordinator */
  registerSubCoordinator(coordinator: GroupCoordinator): void {
    this.subCoordinators.set(coordinator.group.id, coordinator);
    
    // 监听下级事件并向上传递
    coordinator.on('handoff', (payload: HandoffPayload) => {
      this.emit('subCoordinatorHandoff', { subGroupId: coordinator.group.id, payload });
    });

    coordinator.on('executionError', (err: any) => {
      this.emit('subCoordinatorError', { subGroupId: coordinator.group.id, error: err });
    });
  }

  unregisterSubCoordinator(groupId: string): void {
    const coord = this.subCoordinators.get(groupId);
    if (coord) {
      coord.removeAllListeners();
      this.subCoordinators.delete(groupId);
    }
  }

  /** 向上级Coordinator汇报状态 */
  reportToParent(): object {
    const report = {
      groupId: this.group.id,
      coordinatorId: this.getId(),
      status: this.group.status,
      stats: this.group.getStats(),
      handoffQueueLength: this.group.handoffQueue.length,
      isActive: this.isActive,
      currentStep: this.currentStep,
      totalSteps: this.executionPlan.length,
    };

    this.emit('report', report);
    return report;
  }

  // ========== 工具方法 ==========

  getId(): string {
    return `coordinator-${this.group.id}`;
  }

  getSubCoordinators(): GroupCoordinator[] {
    return Array.from(this.subCoordinators.values());
  }

  toJSON(): object {
    return {
      id: this.getId(),
      groupId: this.group.id,
      presetId: this.presetId,
      isActive: this.isActive,
      currentStep: this.currentStep,
      totalSteps: this.executionPlan.length,
      subCoordinators: Array.from(this.subCoordinators.keys()),
    };
  }
}
