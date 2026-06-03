/**
 * InterventionService.ts — SYLVA 通用人工干预服务
 *
 * 核心职责：
 * 1. 提交干预请求（暂停/恢复/终止Agent、紧急停止战车、自定义干预）
 * 2. 审批队列管理（待审批列表、审批处理）
 * 3. 干预执行与状态追踪
 * 4. 事件广播（通过 MessageBus）
 *
 * 与 InterChariotHandoffProtocol 的区别：
 * - HandoffProtocol 只处理「交接审批」（approveByHuman）
 * - InterventionService 处理「通用干预」（任何操作的人工介入）
 *
 * 对接路由：routes/intervention.ts
 */

import { IMessageBus, MessageType, SwarmMessage } from './SwarmMessageBus';
import { SwarmCoordinator, ChariotState } from './SwarmCoordinator';
import { SwarmNode } from './SwarmNode';

// ──────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────

export type InterventionType =
  | 'AGENT_PAUSE'
  | 'AGENT_RESUME'
  | 'AGENT_TERMINATE'
  | 'EMERGENCY_STOP'
  | 'CHARIOT_PAUSE'
  | 'CHARIOT_RESUME'
  | 'CUSTOM';

export interface InterventionTarget {
  agentId?: string;
  chariotId?: string;
  coordinatorId?: string;
}

export interface InterventionRequest {
  id: string;
  type: InterventionType;
  target: InterventionTarget;
  payload: any;
  reason: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'cancelled';
  submittedAt: number;
  executedAt?: number;
  resolvedAt?: number;
  resolvedBy?: string;
}

export interface InterventionResult {
  interventionId: string;
  status: InterventionRequest['status'];
  executed: boolean;
  error?: string;
  affectedAgents?: string[];
  affectedChariots?: string[];
}

export interface ApprovalItem {
  id: string;
  type: InterventionType;
  target: string;          // 格式化后的目标描述
  targetRaw: InterventionTarget;
  reason: string;
  priority: string;
  submittedAt: number;
  requiresHumanApproval: boolean;
}

export interface InterventionStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  executed: number;
  cancelled: number;
  byType: Record<InterventionType, number>;
  byPriority: Record<string, number>;
}

// ──────────────────────────────────────────
// 干预服务实现
// ──────────────────────────────────────────

export class InterventionService {
  private interventions = new Map<string, InterventionRequest>();
  private messageBus: IMessageBus;
  private swarmCoordinator?: SwarmCoordinator;
  private idCounter = 0;

  constructor(messageBus: IMessageBus, swarmCoordinator?: SwarmCoordinator) {
    this.messageBus = messageBus;
    this.swarmCoordinator = swarmCoordinator;
    this.setupMessageHandlers();
  }

  /** 注入 SwarmCoordinator（用于执行涉及战车/Agent的干预） */
  setSwarmCoordinator(coordinator: SwarmCoordinator): void {
    this.swarmCoordinator = coordinator;
  }

  private generateId(): string {
    this.idCounter++;
    return `intv-${Date.now()}-${this.idCounter.toString(36).padStart(4, '0')}`;
  }

  private setupMessageHandlers(): void {
    // 监听干预执行完成事件
    this.messageBus.subscribe('intervention.executed', (msg: SwarmMessage) => {
      const { interventionId } = msg.payload as any;
      const intv = this.interventions.get(interventionId);
      if (intv && intv.status === 'approved') {
        intv.status = 'executed';
        intv.executedAt = Date.now();
      }
    });
  }

  // ═══════════════════════════════════════════════════════
  // 1. 提交干预
  // ═══════════════════════════════════════════════════════

  async submitIntervention(
    req: Omit<InterventionRequest, 'id' | 'status' | 'submittedAt'>
  ): Promise<InterventionResult> {
    const intervention: InterventionRequest = {
      ...req,
      id: this.generateId(),
      status: 'pending',
      submittedAt: Date.now(),
    };

    this.interventions.set(intervention.id, intervention);

    // 广播干预提交事件
    await this.messageBus.publish('intervention.submitted', {
      type: MessageType.STATE_SYNC,
      sender: 'InterventionService',
      topic: 'intervention.submitted',
      payload: {
        interventionId: intervention.id,
        type: intervention.type,
        target: intervention.target,
        priority: intervention.priority,
        reason: intervention.reason,
      },
    });

    // 紧急干预：无需审批，直接执行
    if (intervention.type === 'EMERGENCY_STOP' || intervention.priority === 'critical') {
      return this.executeIntervention(intervention.id);
    }

    return {
      interventionId: intervention.id,
      status: intervention.status,
      executed: false,
    };
  }

  // ═══════════════════════════════════════════════════════
  // 2. 执行干预（内部）
  // ═══════════════════════════════════════════════════════

  async executeIntervention(interventionId: string): Promise<InterventionResult> {
    const intervention = this.interventions.get(interventionId);
    if (!intervention) {
      return { interventionId, status: 'cancelled', executed: false, error: 'Intervention not found' };
    }

    if (intervention.status !== 'pending' && intervention.status !== 'approved') {
      return { interventionId, status: intervention.status, executed: false, error: `Cannot execute intervention in status: ${intervention.status}` };
    }

    const affectedAgents: string[] = [];
    const affectedChariots: string[] = [];
    let error: string | undefined;

    try {
      switch (intervention.type) {
        case 'AGENT_PAUSE':
          await this.executeAgentPause(intervention.target.agentId!);
          if (intervention.target.agentId) affectedAgents.push(intervention.target.agentId);
          break;

        case 'AGENT_RESUME':
          await this.executeAgentResume(intervention.target.agentId!);
          if (intervention.target.agentId) affectedAgents.push(intervention.target.agentId);
          break;

        case 'AGENT_TERMINATE':
          await this.executeAgentTerminate(intervention.target.agentId!);
          if (intervention.target.agentId) affectedAgents.push(intervention.target.agentId);
          break;

        case 'EMERGENCY_STOP':
          await this.executeEmergencyStop(intervention.target.chariotId!);
          if (intervention.target.chariotId) affectedChariots.push(intervention.target.chariotId);
          break;

        case 'CHARIOT_PAUSE':
          await this.executeChariotPause(intervention.target.chariotId!);
          if (intervention.target.chariotId) affectedChariots.push(intervention.target.chariotId);
          break;

        case 'CHARIOT_RESUME':
          await this.executeChariotResume(intervention.target.chariotId!);
          if (intervention.target.chariotId) affectedChariots.push(intervention.target.chariotId);
          break;

        case 'CUSTOM':
          // 自定义干预：仅广播事件，不执行预设动作
          await this.messageBus.publish('intervention.custom', {
            type: MessageType.CUSTOM,
            sender: 'InterventionService',
            topic: 'intervention.custom',
            payload: intervention.payload,
          });
          break;

        default:
          error = `Unknown intervention type: ${intervention.type}`;
      }
    } catch (err: any) {
      error = err.message || String(err);
    }

    // 更新状态
    if (error) {
      intervention.status = 'cancelled';
    } else {
      intervention.status = 'executed';
      intervention.executedAt = Date.now();
    }

    // 广播执行结果
    await this.messageBus.publish('intervention.executed', {
      type: MessageType.STATE_SYNC,
      sender: 'InterventionService',
      topic: 'intervention.executed',
      payload: {
        interventionId,
        status: intervention.status,
        error,
        affectedAgents,
        affectedChariots,
      },
    });

    return {
      interventionId,
      status: intervention.status,
      executed: intervention.status === 'executed',
      error,
      affectedAgents,
      affectedChariots,
    };
  }

  // ── 具体执行方法 ────────────────────────

  private async executeAgentPause(agentId: string): Promise<void> {
    if (!this.swarmCoordinator) throw new Error('SwarmCoordinator not available');
    const agent = this.swarmCoordinator.getAgentById(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    agent.pause('Manual pause by intervention');
  }

  private async executeAgentResume(agentId: string): Promise<void> {
    if (!this.swarmCoordinator) throw new Error('SwarmCoordinator not available');
    const agent = this.swarmCoordinator.getAgentById(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    agent.resume();
  }

  private async executeAgentTerminate(agentId: string): Promise<void> {
    if (!this.swarmCoordinator) throw new Error('SwarmCoordinator not available');
    const agent = this.swarmCoordinator.getAgentById(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    agent.terminate('Manual termination by intervention');
  }

  private async executeEmergencyStop(chariotId: string): Promise<void> {
    if (!this.swarmCoordinator) throw new Error('SwarmCoordinator not available');
    const chariot = this.swarmCoordinator.getChariot(chariotId);
    if (!chariot) throw new Error(`Chariot ${chariotId} not found`);

    // 1. 暂停战车
    this.swarmCoordinator.pauseChariot(chariotId);

    // 2. 暂停所有Agent
    for (const agent of chariot.agents) {
      agent.pause('Emergency stop triggered');
    }

    // 3. 广播紧急停止事件
    await this.messageBus.publish('chariot.emergencyStopped', {
      type: MessageType.ERROR_REPORT,
      sender: 'InterventionService',
      topic: 'chariot.emergencyStopped',
      payload: { chariotId, reason: 'Emergency stop executed', affectedAgents: chariot.agents.map(a => a.id) },
    });
  }

  private async executeChariotPause(chariotId: string): Promise<void> {
    if (!this.swarmCoordinator) throw new Error('SwarmCoordinator not available');
    this.swarmCoordinator.pauseChariot(chariotId);
  }

  private async executeChariotResume(chariotId: string): Promise<void> {
    if (!this.swarmCoordinator) throw new Error('SwarmCoordinator not available');
    this.swarmCoordinator.resumeChariot(chariotId);
  }

  // ═══════════════════════════════════════════════════════
  // 3. 便捷方法
  // ═══════════════════════════════════════════════════════

  /** 紧急停止战车 */
  async emergencyStop(chariotId: string, reason: string): Promise<InterventionResult> {
    return this.submitIntervention({
      type: 'EMERGENCY_STOP',
      target: { chariotId },
      payload: {},
      reason,
      priority: 'critical',
    });
  }

  /** 暂停指定 Agent */
  async pauseAgent(agentId: string, reason: string): Promise<InterventionResult> {
    return this.submitIntervention({
      type: 'AGENT_PAUSE',
      target: { agentId },
      payload: {},
      reason,
      priority: 'high',
    });
  }

  /** 恢复指定 Agent */
  async resumeAgent(agentId: string, reason: string): Promise<InterventionResult> {
    return this.submitIntervention({
      type: 'AGENT_RESUME',
      target: { agentId },
      payload: {},
      reason,
      priority: 'normal',
    });
  }

  /** 终止指定 Agent */
  async terminateAgent(agentId: string, reason: string): Promise<InterventionResult> {
    return this.submitIntervention({
      type: 'AGENT_TERMINATE',
      target: { agentId },
      payload: {},
      reason,
      priority: 'critical',
    });
  }

  // ═══════════════════════════════════════════════════════
  // 4. 审批队列管理
  // ═══════════════════════════════════════════════════════

  /** 获取待审批列表 */
  getPendingApprovals(): ApprovalItem[] {
    return Array.from(this.interventions.values())
      .filter((i) => i.status === 'pending')
      .map((i) => ({
        id: i.id,
        type: i.type,
        target: this.formatTarget(i.target),
        targetRaw: i.target,
        reason: i.reason,
        priority: i.priority,
        submittedAt: i.submittedAt,
        requiresHumanApproval: i.priority !== 'critical' && i.type !== 'EMERGENCY_STOP',
      }));
  }

  /** 处理审批 */
  processApproval(id: string, approved: boolean, resolvedBy?: string): InterventionResult {
    const intervention = this.interventions.get(id);
    if (!intervention) {
      return { interventionId: id, status: 'cancelled', executed: false, error: 'Intervention not found' };
    }

    if (intervention.status !== 'pending') {
      return { interventionId: id, status: intervention.status, executed: false, error: `Intervention is not pending (current: ${intervention.status})` };
    }

    intervention.status = approved ? 'approved' : 'rejected';
    intervention.resolvedAt = Date.now();
    intervention.resolvedBy = resolvedBy || 'system';

    // 广播审批结果
    this.messageBus.publish(`intervention.${approved ? 'approved' : 'rejected'}`, {
      type: MessageType.STATE_SYNC,
      sender: 'InterventionService',
      topic: `intervention.${approved ? 'approved' : 'rejected'}`,
      payload: {
        interventionId: id,
        approved,
        resolvedBy: intervention.resolvedBy,
      },
    });

    // 如果批准，自动执行
    if (approved) {
      return this.executeIntervention(id);
    }

    return {
      interventionId: id,
      status: intervention.status,
      executed: false,
    };
  }

  // ═══════════════════════════════════════════════════════
  // 5. 查询接口
  // ═══════════════════════════════════════════════════════

  /** 获取指定干预 */
  getIntervention(id: string): InterventionRequest | undefined {
    return this.interventions.get(id);
  }

  /** 获取所有干预 */
  getAllInterventions(): InterventionRequest[] {
    return Array.from(this.interventions.values());
  }

  /** 按状态筛选 */
  getInterventionsByStatus(status: InterventionRequest['status']): InterventionRequest[] {
    return Array.from(this.interventions.values()).filter((i) => i.status === status);
  }

  /** 获取战车相关的所有干预 */
  getInterventionsForChariot(chariotId: string): InterventionRequest[] {
    return Array.from(this.interventions.values()).filter(
      (i) => i.target.chariotId === chariotId
    );
  }

  /** 获取 Agent 相关的所有干预 */
  getInterventionsForAgent(agentId: string): InterventionRequest[] {
    return Array.from(this.interventions.values()).filter(
      (i) => i.target.agentId === agentId
    );
  }

  /** 获取统计 */
  getStats(): InterventionStats {
    const all = Array.from(this.interventions.values());
    const byType: Record<string, number> = {};
    const byPriority: Record<string, number> = {};

    for (const i of all) {
      byType[i.type] = (byType[i.type] || 0) + 1;
      byPriority[i.priority] = (byPriority[i.priority] || 0) + 1;
    }

    return {
      total: all.length,
      pending: all.filter((i) => i.status === 'pending').length,
      approved: all.filter((i) => i.status === 'approved').length,
      rejected: all.filter((i) => i.status === 'rejected').length,
      executed: all.filter((i) => i.status === 'executed').length,
      cancelled: all.filter((i) => i.status === 'cancelled').length,
      byType: byType as Record<InterventionType, number>,
      byPriority,
    };
  }

  // ═══════════════════════════════════════════════════════
  // 6. 辅助方法
  // ═══════════════════════════════════════════════════════

  private formatTarget(target: InterventionTarget): string {
    if (target.agentId) return `Agent: ${target.agentId}`;
    if (target.chariotId) return `Chariot: ${target.chariotId}`;
    if (target.coordinatorId) return `Coordinator: ${target.coordinatorId}`;
    return 'Unknown';
  }
}

export default InterventionService;
