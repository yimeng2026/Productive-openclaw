/**
 * InterChariotHandoffProtocol.ts — 跨战车结构化交接协议
 *
 * 核心职责：
 * 1. 群组与群组之间通过协调员自主编排
 * 2. 标准化的状态对象传递（非原始文本）
 * 3. 交接生命周期管理：发起 → 确认 → 执行 → 完成
 * 4. 历史追踪与审计
 *
 * 设计参考：The Zeroth 的 Structured Handoff
 * 交接内容：objective / completedActions / blockers / nextAssignee / expectedOutput
 */

import { IMessageBus, MessageType, SwarmMessage } from './SwarmMessageBus';
import { TaskResult } from './SwarmNode';

// ── 类型定义 ───────────────────────────────────────────────

export interface HandoffPayload {
  version: '1.0';
  handoffId: string;          // 唯一标识符
  timestamp: number;

  // 源与目标
  source: {
    chariotId: string;
    coordinatorId: string;
    agentId?: string;         // 发起Agent（可选）
  };
  target: {
    chariotId: string;
    coordinatorId: string;
    agentId?: string;         // 指定接收Agent（可选）
  };

  // 交接内容（The Zeroth 风格结构化数据）
  objective: string;          // 目标描述
  completedActions: string[]; // 已完成的动作列表
  blockers?: string[];        // 当前阻塞项
  nextAssignee?: string;      // 建议的下一责任人
  expectedOutput?: string;    // 期望的输出格式

  // 上下文传递
  context: {
    sharedMemoryKeys: string[];   // 共享记忆池的key引用
    fileReferences: string[];    // 相关文件引用
    conversationSummary: string;   // 对话摘要
  };

  // 控制元数据
  priority: 'critical' | 'high' | 'normal' | 'low';
  deadline?: number;          // 截止时间戳
  requiresHumanApproval: boolean; // 是否需要人工审批

  // 生命周期状态
  status: 'pending' | 'accepted' | 'rejected' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  
  // 历史记录
  history: HandoffHistoryEntry[];
}

export interface HandoffHistoryEntry {
  timestamp: number;
  action: HandoffAction;
  actor: string;              // chariotId 或 agentId 或 userId
  actorType: 'coordinator' | 'agent' | 'human' | 'system';
  note?: string;
}

export type HandoffAction =
  | 'created'
  | 'transferred'
  | 'accepted'
  | 'rejected'
  | 'started'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'approved_by_human'
  | 'escalated';

export interface HandoffInitiateRequest {
  sourceChariotId: string;
  sourceCoordinatorId: string;
  sourceAgentId?: string;
  targetChariotId: string;
  targetCoordinatorId: string;
  targetAgentId?: string;
  objective: string;
  completedActions?: string[];
  blockers?: string[];
  nextAssignee?: string;
  expectedOutput?: string;
  sharedMemoryKeys?: string[];
  fileReferences?: string[];
  conversationSummary?: string;
  priority?: 'critical' | 'high' | 'normal' | 'low';
  deadline?: number;
  requiresHumanApproval?: boolean;
}

export interface HandoffResult {
  handoffId: string;
  status: HandoffPayload['status'];
  createdAt: number;
  completedAt?: number;
  result?: TaskResult;
  error?: string;
}

// ── 交接协议实现 ───────────────────────────────────────────

export class InterChariotHandoffProtocol {
  private messageBus: IMessageBus;
  private pendingHandoffs = new Map<string, HandoffPayload>();
  private completedHandoffs = new Map<string, HandoffPayload>();
  private handoffHistory = new Map<string, HandoffHistoryEntry[]>();
  private idCounter = 0;

  constructor(messageBus: IMessageBus) {
    this.messageBus = messageBus;
    this.setupMessageHandlers();
  }

  private generateHandoffId(): string {
    this.idCounter++;
    return `handoff-${Date.now()}-${this.idCounter.toString(36)}`;
  }

  private addHistory(handoffId: string, entry: HandoffHistoryEntry): void {
    const history = this.handoffHistory.get(handoffId) || [];
    history.push(entry);
    this.handoffHistory.set(handoffId, history);

    // 同步到 payload
    const payload = this.pendingHandoffs.get(handoffId) || this.completedHandoffs.get(handoffId);
    if (payload) {
      payload.history = [...history];
    }
  }

  private setupMessageHandlers(): void {
    // 监听交接相关消息
    this.messageBus.subscribe('handoff.*', (msg: SwarmMessage) => {
      // 处理交接事件广播
      if (msg.payload?.handoffId) {
        this.syncHandoffState(msg.payload.handoffId, msg.payload);
      }
    });
  }

  private syncHandoffState(handoffId: string, update: Partial<HandoffPayload>): void {
    const payload = this.pendingHandoffs.get(handoffId);
    if (payload && update.status) {
      payload.status = update.status;
      if (update.history) {
        payload.history = [...payload.history, ...update.history];
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // 1. 发起交接
  // ═══════════════════════════════════════════════════════

  async initiate(request: HandoffInitiateRequest): Promise<string> {
    const handoffId = this.generateHandoffId();
    const now = Date.now();

    const payload: HandoffPayload = {
      version: '1.0',
      handoffId,
      timestamp: now,
      source: {
        chariotId: request.sourceChariotId,
        coordinatorId: request.sourceCoordinatorId,
        agentId: request.sourceAgentId,
      },
      target: {
        chariotId: request.targetChariotId,
        coordinatorId: request.targetCoordinatorId,
        agentId: request.targetAgentId,
      },
      objective: request.objective,
      completedActions: request.completedActions || [],
      blockers: request.blockers,
      nextAssignee: request.nextAssignee,
      expectedOutput: request.expectedOutput,
      context: {
        sharedMemoryKeys: request.sharedMemoryKeys || [],
        fileReferences: request.fileReferences || [],
        conversationSummary: request.conversationSummary || '',
      },
      priority: request.priority || 'normal',
      deadline: request.deadline,
      requiresHumanApproval: request.requiresHumanApproval || false,
      status: 'pending',
      history: [{
        timestamp: now,
        action: 'created',
        actor: request.sourceCoordinatorId,
        actorType: 'coordinator',
        note: `Handoff created from ${request.sourceChariotId} to ${request.targetChariotId}: ${request.objective}`,
      }],
    };

    this.pendingHandoffs.set(handoffId, payload);
    this.handoffHistory.set(handoffId, payload.history);

    // 广播交接创建事件
    this.messageBus.publish(`handoff.${handoffId}.created`, {
      type: MessageType.TASK_SUBMIT,
      sender: request.sourceCoordinatorId,
      topic: `handoff.${handoffId}.created`,
      payload: { handoffId, ...payload },
    });

    // 如果需要人工审批，发送审批请求
    if (payload.requiresHumanApproval) {
      this.messageBus.publish('handoff.humanApprovalRequired', {
        type: MessageType.TASK_SUBMIT,
        sender: 'InterChariotHandoffProtocol',
        topic: 'handoff.humanApprovalRequired',
        payload: { handoffId, objective: payload.objective, source: payload.source, target: payload.target },
      });
    }

    return handoffId;
  }

  // ═══════════════════════════════════════════════════════
  // 2. 接受交接
  // ═══════════════════════════════════════════════════════

  async accept(handoffId: string, receiverChariotId: string, receiverCoordinatorId: string): Promise<void> {
    const payload = this.pendingHandoffs.get(handoffId);
    if (!payload) {
      throw new Error(`Handoff ${handoffId} not found`);
    }

    if (payload.status !== 'pending') {
      throw new Error(`Handoff ${handoffId} is not pending (current: ${payload.status})`);
    }

    // 验证接收方
    if (payload.target.chariotId !== receiverChariotId) {
      throw new Error(`Handoff ${handoffId} target mismatch: expected ${payload.target.chariotId}, got ${receiverChariotId}`);
    }

    payload.status = 'accepted';
    payload.target.coordinatorId = receiverCoordinatorId;

    this.addHistory(handoffId, {
      timestamp: Date.now(),
      action: 'accepted',
      actor: receiverCoordinatorId,
      actorType: 'coordinator',
      note: `Handoff accepted by ${receiverChariotId}`,
    });

    this.messageBus.publish(`handoff.${handoffId}.accepted`, {
      type: MessageType.TASK_ASSIGN,
      sender: receiverCoordinatorId,
      topic: `handoff.${handoffId}.accepted`,
      payload: { handoffId, receiverChariotId },
    });
  }

  // ═══════════════════════════════════════════════════════
  // 3. 拒绝交接
  // ═══════════════════════════════════════════════════════

  async reject(handoffId: string, reason: string, rejectedBy?: string): Promise<void> {
    const payload = this.pendingHandoffs.get(handoffId);
    if (!payload) {
      throw new Error(`Handoff ${handoffId} not found`);
    }

    payload.status = 'rejected';

    this.addHistory(handoffId, {
      timestamp: Date.now(),
      action: 'rejected',
      actor: rejectedBy || payload.target.coordinatorId,
      actorType: 'coordinator',
      note: `Handoff rejected: ${reason}`,
    });

    // 移出 pending，移入 completed
    this.pendingHandoffs.delete(handoffId);
    this.completedHandoffs.set(handoffId, payload);

    this.messageBus.publish(`handoff.${handoffId}.rejected`, {
      type: MessageType.TASK_FAIL,
      sender: rejectedBy || payload.target.coordinatorId,
      topic: `handoff.${handoffId}.rejected`,
      payload: { handoffId, reason },
    });
  }

  // ═══════════════════════════════════════════════════════
  // 4. 开始执行（接受后→执行）
  // ═══════════════════════════════════════════════════════

  async start(handoffId: string, executorCoordinatorId: string): Promise<void> {
    const payload = this.pendingHandoffs.get(handoffId);
    if (!payload) {
      throw new Error(`Handoff ${handoffId} not found`);
    }

    if (payload.status !== 'accepted') {
      throw new Error(`Handoff ${handoffId} must be accepted before starting (current: ${payload.status})`);
    }

    payload.status = 'in_progress';

    this.addHistory(handoffId, {
      timestamp: Date.now(),
      action: 'started',
      actor: executorCoordinatorId,
      actorType: 'coordinator',
      note: 'Handoff execution started',
    });

    this.messageBus.publish(`handoff.${handoffId}.started`, {
      type: MessageType.TASK_START,
      sender: executorCoordinatorId,
      topic: `handoff.${handoffId}.started`,
      payload: { handoffId },
    });
  }

  // ═══════════════════════════════════════════════════════
  // 5. 完成交接
  // ═══════════════════════════════════════════════════════

  async complete(handoffId: string, result: TaskResult, completedBy?: string): Promise<void> {
    const payload = this.pendingHandoffs.get(handoffId);
    if (!payload) {
      throw new Error(`Handoff ${handoffId} not found`);
    }

    payload.status = result.status === 'success' ? 'completed' : 'failed';

    this.addHistory(handoffId, {
      timestamp: Date.now(),
      action: result.status === 'success' ? 'completed' : 'failed',
      actor: completedBy || payload.target.coordinatorId,
      actorType: 'coordinator',
      note: `Handoff ${result.status}: ${result.error || 'success'}`,
    });

    // 移出 pending，移入 completed
    this.pendingHandoffs.delete(handoffId);
    this.completedHandoffs.set(handoffId, payload);

    this.messageBus.publish(`handoff.${handoffId}.completed`, {
      type: result.status === 'success' ? MessageType.TASK_COMPLETE : MessageType.TASK_FAIL,
      sender: completedBy || payload.target.coordinatorId,
      topic: `handoff.${handoffId}.completed`,
      payload: { handoffId, result },
    });
  }

  // ═══════════════════════════════════════════════════════
  // 6. 取消交接
  // ═══════════════════════════════════════════════════════

  async cancel(handoffId: string, reason: string, cancelledBy?: string): Promise<void> {
    const payload = this.pendingHandoffs.get(handoffId);
    if (!payload) {
      throw new Error(`Handoff ${handoffId} not found`);
    }

    payload.status = 'cancelled';

    this.addHistory(handoffId, {
      timestamp: Date.now(),
      action: 'cancelled',
      actor: cancelledBy || 'system',
      actorType: 'system',
      note: `Handoff cancelled: ${reason}`,
    });

    this.pendingHandoffs.delete(handoffId);
    this.completedHandoffs.set(handoffId, payload);

    this.messageBus.publish(`handoff.${handoffId}.cancelled`, {
      type: MessageType.TASK_FAIL,
      sender: cancelledBy || 'system',
      topic: `handoff.${handoffId}.cancelled`,
      payload: { handoffId, reason },
    });
  }

  // ═══════════════════════════════════════════════════════
  // 7. 人工审批
  // ═══════════════════════════════════════════════════════

  async approveByHuman(handoffId: string, approvedBy: string, comment?: string): Promise<void> {
    const payload = this.pendingHandoffs.get(handoffId);
    if (!payload) {
      throw new Error(`Handoff ${handoffId} not found`);
    }

    if (!payload.requiresHumanApproval) {
      throw new Error(`Handoff ${handoffId} does not require human approval`);
    }

    this.addHistory(handoffId, {
      timestamp: Date.now(),
      action: 'approved_by_human',
      actor: approvedBy,
      actorType: 'human',
      note: comment || 'Approved by human operator',
    });

    // 如果之前是 pending，现在可以继续流转
    if (payload.status === 'pending') {
      payload.status = 'accepted';
    }

    this.messageBus.publish(`handoff.${handoffId}.humanApproved`, {
      type: MessageType.STATE_SYNC,
      sender: approvedBy,
      topic: `handoff.${handoffId}.humanApproved`,
      payload: { handoffId, approvedBy, comment },
    });
  }

  // ═══════════════════════════════════════════════════════
  // 8. 升级（上报到更高层级）
  // ═══════════════════════════════════════════════════════

  async escalate(handoffId: string, reason: string, escalatedBy: string, targetLevel: number): Promise<string> {
    const payload = this.pendingHandoffs.get(handoffId);
    if (!payload) {
      throw new Error(`Handoff ${handoffId} not found`);
    }

    this.addHistory(handoffId, {
      timestamp: Date.now(),
      action: 'escalated',
      actor: escalatedBy,
      actorType: 'coordinator',
      note: `Escalated to level ${targetLevel}: ${reason}`,
    });

    // 创建新的交接，目标为更高层级
    const newHandoffId = await this.initiate({
      sourceChariotId: payload.target.chariotId,
      sourceCoordinatorId: payload.target.coordinatorId,
      targetChariotId: `level-${targetLevel}-coordinator`,
      targetCoordinatorId: `level-${targetLevel}-coordinator`,
      objective: `[ESCALATED] ${payload.objective}: ${reason}`,
      completedActions: [...payload.completedActions, `Escalated: ${reason}`],
      priority: 'critical',
      requiresHumanApproval: true,
      conversationSummary: payload.context.conversationSummary,
    });

    this.messageBus.publish(`handoff.${handoffId}.escalated`, {
      type: MessageType.ERROR_REPORT,
      sender: escalatedBy,
      topic: `handoff.${handoffId}.escalated`,
      payload: { handoffId, newHandoffId, reason, targetLevel },
    });

    return newHandoffId;
  }

  // ═══════════════════════════════════════════════════════
  // 9. 查询接口
  // ═══════════════════════════════════════════════════════

  /** 查询指定交接 */
  getHandoff(handoffId: string): HandoffPayload | undefined {
    return this.pendingHandoffs.get(handoffId) || this.completedHandoffs.get(handoffId);
  }

  /** 查询待处理的交接 */
  getPendingHandoffs(chariotId?: string): HandoffPayload[] {
    const all = Array.from(this.pendingHandoffs.values());
    if (!chariotId) return all;
    return all.filter((h) => h.source.chariotId === chariotId || h.target.chariotId === chariotId);
  }

  /** 查询已完成/已关闭的交接 */
  getCompletedHandoffs(chariotId?: string): HandoffPayload[] {
    const all = Array.from(this.completedHandoffs.values());
    if (!chariotId) return all;
    return all.filter((h) => h.source.chariotId === chariotId || h.target.chariotId === chariotId);
  }

  /** 查询某个 Chariot 的所有交接 */
  getHandoffsForChariot(chariotId: string): { pending: HandoffPayload[]; completed: HandoffPayload[] } {
    return {
      pending: this.getPendingHandoffs(chariotId),
      completed: this.getCompletedHandoffs(chariotId),
    };
  }

  /** 查询交接历史 */
  getHandoffHistory(handoffId: string): HandoffHistoryEntry[] {
    return this.handoffHistory.get(handoffId) || [];
  }

  /** 查询统计 */
  getStats(): {
    totalCreated: number;
    pending: number;
    accepted: number;
    inProgress: number;
    completed: number;
    failed: number;
    rejected: number;
    cancelled: number;
    requiresHumanApproval: number;
  } {
    const all = [...Array.from(this.pendingHandoffs.values()), ...Array.from(this.completedHandoffs.values())];
    return {
      totalCreated: all.length,
      pending: all.filter((h) => h.status === 'pending').length,
      accepted: all.filter((h) => h.status === 'accepted').length,
      inProgress: all.filter((h) => h.status === 'in_progress').length,
      completed: all.filter((h) => h.status === 'completed').length,
      failed: all.filter((h) => h.status === 'failed').length,
      rejected: all.filter((h) => h.status === 'rejected').length,
      cancelled: all.filter((h) => h.status === 'cancelled').length,
      requiresHumanApproval: all.filter((h) => h.requiresHumanApproval && h.status === 'pending').length,
    };
  }
}
