/**
 * AgentZeroBridge.ts — SYLVA AgentZero 精细控制桥接
 *
 * 核心职责:
 * 1. 对单个Agent的精确操控（spawn/kill/pause/resume/reassign/inspect/updateConfig/triggerEvolution）
 * 2. Group级别操作底层逐个Agent执行，非整体开关
 * 3. 跨Group迁移Agent（reassign）
 * 4. Agent配置热更新（updateConfig）
 * 5. 暂停/恢复状态机支持
 *
 * 设计原则:
 * - 操控粒度精确到单个Agent
 * - 所有Group操作都展开为对单个Agent的操作序列
 * - 与现有 SwarmCoordinator / SwarmNode 完全兼容
 * - 通过 MessageBus 发送事件，保持松耦合
 */

import { SwarmCoordinator, ChariotState } from './SwarmCoordinator';
import { SwarmNode, AgentConfig, AgentStateSnapshot } from './SwarmNode';
import { IMessageBus, MessageType, SwarmMessage } from './SwarmMessageBus';
import { SubTask, TaskResult } from './ExecutionModes';

// ──────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────

/** AgentZero 对单个Agent的操作类型 */
export type AgentZeroAgentAction =
  | 'spawn'      // 创建新Agent
  | 'kill'       // 销毁Agent
  | 'pause'      // 暂停Agent
  | 'resume'     // 恢复Agent
  | 'reassign'   // 跨Group迁移Agent
  | 'inspect'    // 获取Agent状态
  | 'updateConfig' // 热更新Agent配置
  | 'triggerEvolution'; // 触发自我进化

/** AgentZero 对Group的操作类型 */
export type AgentZeroGroupAction =
  | 'pauseAll'    // 逐个暂停所有Agent
  | 'resumeAll'   // 逐个恢复所有Agent
  | 'inspectAll'  // 获取所有Agent状态
  | 'rebalance'   // 重平衡负载
  | 'compress';   // 同步压缩上下文

/** AgentZero 操作结果 */
export interface AgentZeroResult {
  success: boolean;
  agentId?: string;
  groupId?: string;
  action: string;
  data?: any;
  error?: string;
  timestamp: number;
}

/** AgentZero 控制指令 */
export interface AgentZeroCommand {
  type: 'AGENT_ZERO_COMMAND';
  target: string;      // agentId 或 groupId
  action: AgentZeroAgentAction | AgentZeroGroupAction;
  params?: Record<string, any>;
  issuedBy: string;    // 指令发出者标识
  issuedAt: number;
}

/** AgentZero 执行结果回发 */
export interface AgentZeroResultMessage {
  type: 'AGENT_ZERO_RESULT';
  target: string;
  action: string;
  success: boolean;
  data?: any;
  error?: string;
  commandId: string;
  processedAt: number;
}

/** AgentZero 状态报告 */
export interface AgentZeroStateReport {
  totalAgents: number;
  activeAgents: number;
  pausedAgents: number;
  isolatedAgents: number;
  totalGroups: number;
  agentStates: Record<string, AgentStateSnapshot>;
  groupHierarchy: GroupHierarchyNode[];
}

/** Group层级结构 */
export interface GroupHierarchyNode {
  groupId: string;
  name: string;
  status: string;
  agentCount: number;
  subGroups?: GroupHierarchyNode[];
}

// ──────────────────────────────────────────
// AgentZeroController — 核心控制类
// ──────────────────────────────────────────

export class AgentZeroController {
  private coordinator: SwarmCoordinator;
  private messageBus: IMessageBus;

  constructor(coordinator: SwarmCoordinator, messageBus: IMessageBus) {
    this.coordinator = coordinator;
    this.messageBus = messageBus;
  }

  // ═══════════════════════════════════════════
  // 单个Agent操控
  // ═══════════════════════════════════════════

  /**
   * 核心方法：操控单个Agent
   *
   * @param agentId 目标Agent ID
   * @param action 操作类型
   * @param params 操作参数
   * @returns 操作结果
   */
  async controlAgent(
    agentId: string,
    action: AgentZeroAgentAction,
    params?: Record<string, any>
  ): Promise<AgentZeroResult> {
    const timestamp = Date.now();

    try {
      switch (action) {
        case 'spawn':
          return await this.handleSpawn(agentId, params, timestamp);
        case 'kill':
          return await this.handleKill(agentId, timestamp);
        case 'pause':
          return await this.handlePause(agentId, params, timestamp);
        case 'resume':
          return await this.handleResume(agentId, timestamp);
        case 'reassign':
          return await this.handleReassign(agentId, params, timestamp);
        case 'inspect':
          return await this.handleInspect(agentId, timestamp);
        case 'updateConfig':
          return await this.handleUpdateConfig(agentId, params, timestamp);
        case 'triggerEvolution':
          return await this.handleTriggerEvolution(agentId, params, timestamp);
        default:
          return {
            success: false,
            agentId,
            action,
            error: `Unknown action: ${action}`,
            timestamp,
          };
      }
    } catch (err) {
      return {
        success: false,
        agentId,
        action,
        error: err instanceof Error ? err.message : String(err),
        timestamp,
      };
    }
  }

  // ── 具体操作实现 ────────────────────────

  /** 创建新Agent */
  private async handleSpawn(
    agentId: string,
    params?: Record<string, any>,
    timestamp?: number
  ): Promise<AgentZeroResult> {
    const {
      chariotId,
      name,
      role,
      agentConfig,
      eventBus,
      config,
      parent,
      agentCallback,
    } = params || {};

    if (!chariotId || !eventBus || !config) {
      return {
        success: false,
        agentId,
        action: 'spawn',
        error: 'Missing required params: chariotId, eventBus, config',
        timestamp: timestamp || Date.now(),
      };
    }

    const chariot = this.coordinator.getChariot(chariotId);
    if (!chariot) {
      return {
        success: false,
        agentId,
        action: 'spawn',
        error: `Chariot ${chariotId} not found`,
        timestamp: timestamp || Date.now(),
      };
    }

    const newAgent = new SwarmNode({
      id: agentId,
      type: 'agent',
      name: name || `Agent-${agentId}`,
      role: role || 'worker',
      agentConfig: agentConfig || { modelId: 'default', expertise: [] },
      eventBus,
      config,
      parent,
      agentCallback,
    });

    chariot.agents.push(newAgent);

    // 广播Agent创建事件
    await this.messageBus.publish('agentzero.agent.spawned', {
      type: MessageType.NODE_REGISTER,
      sender: 'AgentZero',
      topic: 'agentzero.agent.spawned',
      payload: { agentId, chariotId, name: newAgent.name, role: newAgent.role },
    });

    return {
      success: true,
      agentId,
      action: 'spawn',
      data: { agentSnapshot: newAgent.getStateSnapshot() },
      timestamp: timestamp || Date.now(),
    };
  }

  /** 销毁Agent */
  private async handleKill(agentId: string, timestamp?: number): Promise<AgentZeroResult> {
    const agent = this.coordinator.getAgentById(agentId);
    if (!agent) {
      return {
        success: false,
        agentId,
        action: 'kill',
        error: `Agent ${agentId} not found`,
        timestamp: timestamp || Date.now(),
      };
    }

    // 从所属战车中移除
    for (const chariot of this.coordinator.getChariots()) {
      const idx = chariot.agents.findIndex((a) => a.id === agentId);
      if (idx >= 0) {
        chariot.agents.splice(idx, 1);
        break;
      }
      // 也检查嵌套的子蜂群
      chariot.coordinator.traverse((node) => {
        if (node.subSwarm) {
          const subIdx = node.subSwarm.workers.findIndex((w) => w.id === agentId);
          if (subIdx >= 0) {
            node.subSwarm.workers.splice(subIdx, 1);
          }
        }
      });
    }

    // 广播Agent销毁事件
    await this.messageBus.publish('agentzero.agent.killed', {
      type: MessageType.NODE_DEREGISTER,
      sender: 'AgentZero',
      topic: 'agentzero.agent.killed',
      payload: { agentId, killedAt: Date.now() },
    });

    return {
      success: true,
      agentId,
      action: 'kill',
      timestamp: timestamp || Date.now(),
    };
  }

  /** 暂停Agent */
  private async handlePause(
    agentId: string,
    params?: Record<string, any>,
    timestamp?: number
  ): Promise<AgentZeroResult> {
    const agent = this.coordinator.getAgentById(agentId);
    if (!agent) {
      return {
        success: false,
        agentId,
        action: 'pause',
        error: `Agent ${agentId} not found`,
        timestamp: timestamp || Date.now(),
      };
    }

    const reason = params?.reason as string;
    agent.pause(reason);

    return {
      success: true,
      agentId,
      action: 'pause',
      data: { state: agent.getLifecycleState(), reason },
      timestamp: timestamp || Date.now(),
    };
  }

  /** 恢复Agent */
  private async handleResume(agentId: string, timestamp?: number): Promise<AgentZeroResult> {
    const agent = this.coordinator.getAgentById(agentId);
    if (!agent) {
      return {
        success: false,
        agentId,
        action: 'resume',
        error: `Agent ${agentId} not found`,
        timestamp: timestamp || Date.now(),
      };
    }

    agent.resume();

    return {
      success: true,
      agentId,
      action: 'resume',
      data: { state: agent.getLifecycleState() },
      timestamp: timestamp || Date.now(),
    };
  }

  /** 跨Group迁移Agent */
  private async handleReassign(
    agentId: string,
    params?: Record<string, any>,
    timestamp?: number
  ): Promise<AgentZeroResult> {
    const { targetChariotId } = params || {};
    if (!targetChariotId) {
      return {
        success: false,
        agentId,
        action: 'reassign',
        error: 'Missing required param: targetChariotId',
        timestamp: timestamp || Date.now(),
      };
    }

    const agent = this.coordinator.getAgentById(agentId);
    if (!agent) {
      return {
        success: false,
        agentId,
        action: 'reassign',
        error: `Agent ${agentId} not found`,
        timestamp: timestamp || Date.now(),
      };
    }

    const targetChariot = this.coordinator.getChariot(targetChariotId as string);
    if (!targetChariot) {
      return {
        success: false,
        agentId,
        action: 'reassign',
        error: `Target chariot ${targetChariotId} not found`,
        timestamp: timestamp || Date.now(),
      };
    }

    // 从原战车移除
    let removed = false;
    for (const chariot of this.coordinator.getChariots()) {
      const idx = chariot.agents.findIndex((a) => a.id === agentId);
      if (idx >= 0) {
        chariot.agents.splice(idx, 1);
        removed = true;
        break;
      }
    }

    if (!removed) {
      return {
        success: false,
        agentId,
        action: 'reassign',
        error: `Agent ${agentId} could not be removed from source chariot`,
        timestamp: timestamp || Date.now(),
      };
    }

    // 添加到目标战车
    targetChariot.agents.push(agent);

    // 广播迁移事件
    await this.messageBus.publish('agentzero.agent.reassigned', {
      type: MessageType.STATE_SYNC,
      sender: 'AgentZero',
      topic: 'agentzero.agent.reassigned',
      payload: { agentId, targetChariotId, timestamp: Date.now() },
    });

    return {
      success: true,
      agentId,
      action: 'reassign',
      data: { targetChariotId, state: agent.getStateSnapshot() },
      timestamp: timestamp || Date.now(),
    };
  }

  /** 获取Agent状态 */
  private async handleInspect(agentId: string, timestamp?: number): Promise<AgentZeroResult> {
    const agent = this.coordinator.getAgentById(agentId);
    if (!agent) {
      return {
        success: false,
        agentId,
        action: 'inspect',
        error: `Agent ${agentId} not found`,
        timestamp: timestamp || Date.now(),
      };
    }

    return {
      success: true,
      agentId,
      action: 'inspect',
      data: { state: agent.getStateSnapshot() },
      timestamp: timestamp || Date.now(),
    };
  }

  /** 热更新Agent配置 */
  private async handleUpdateConfig(
    agentId: string,
    params?: Record<string, any>,
    timestamp?: number
  ): Promise<AgentZeroResult> {
    const { configDelta } = params || {};
    if (!configDelta) {
      return {
        success: false,
        agentId,
        action: 'updateConfig',
        error: 'Missing required param: configDelta',
        timestamp: timestamp || Date.now(),
      };
    }

    const agent = this.coordinator.getAgentById(agentId);
    if (!agent) {
      return {
        success: false,
        agentId,
        action: 'updateConfig',
        error: `Agent ${agentId} not found`,
        timestamp: timestamp || Date.now(),
      };
    }

    try {
      agent.updateConfig(configDelta as Partial<AgentConfig>);

      return {
        success: true,
        agentId,
        action: 'updateConfig',
        data: { updatedFields: Object.keys(configDelta), state: agent.getStateSnapshot() },
        timestamp: timestamp || Date.now(),
      };
    } catch (err) {
      return {
        success: false,
        agentId,
        action: 'updateConfig',
        error: err instanceof Error ? err.message : String(err),
        timestamp: timestamp || Date.now(),
      };
    }
  }

  /** 触发Agent自我进化 */
  private async handleTriggerEvolution(
    agentId: string,
    params?: Record<string, any>,
    timestamp?: number
  ): Promise<AgentZeroResult> {
    const agent = this.coordinator.getAgentById(agentId);
    if (!agent) {
      return {
        success: false,
        agentId,
        action: 'triggerEvolution',
        error: `Agent ${agentId} not found`,
        timestamp: timestamp || Date.now(),
      };
    }

    // 通过消息总线发送进化触发事件，由 EvolutionEngine 监听处理
    await this.messageBus.publish('agentzero.evolution.triggered', {
      type: MessageType.CUSTOM,
      sender: 'AgentZero',
      topic: 'agentzero.evolution.triggered',
      payload: { agentId, params, triggeredAt: Date.now() },
    });

    return {
      success: true,
      agentId,
      action: 'triggerEvolution',
      data: { triggered: true, agentId },
      timestamp: timestamp || Date.now(),
    };
  }

  // ═══════════════════════════════════════════
  // Group级别操控（底层逐个Agent执行）
  // ═══════════════════════════════════════════

  /**
   * Group级别操作 — 注意：底层是逐个Agent执行，不是整体开关
   *
   * @param groupId 目标Group（战车）ID
   * @param action 操作类型
   * @param params 操作参数
   * @returns 操作结果列表
   */
  async controlGroup(
    groupId: string,
    action: AgentZeroGroupAction,
    params?: Record<string, any>
  ): Promise<AgentZeroResult[]> {
    const chariot = this.coordinator.getChariot(groupId);
    if (!chariot) {
      return [{
        success: false,
        groupId,
        action,
        error: `Group ${groupId} not found`,
        timestamp: Date.now(),
      }];
    }

    const results: AgentZeroResult[] = [];

    switch (action) {
      case 'pauseAll': {
        // 逐个暂停每个Agent
        for (const agent of chariot.agents) {
          const reason = params?.reason as string;
          const r = await this.controlAgent(agent.id, 'pause', { reason });
          results.push(r);
          // 递归暂停子蜂群中的Agent
          agent.traverse(async (node) => {
            if (node.type === 'agent' && node.id !== agent.id) {
              const subR = await this.controlAgent(node.id, 'pause', { reason });
              results.push(subR);
            }
          });
        }
        break;
      }

      case 'resumeAll': {
        // 逐个恢复每个Agent
        for (const agent of chariot.agents) {
          const r = await this.controlAgent(agent.id, 'resume');
          results.push(r);
          // 递归恢复子蜂群中的Agent
          agent.traverse(async (node) => {
            if (node.type === 'agent' && node.id !== agent.id) {
              const subR = await this.controlAgent(node.id, 'resume');
              results.push(subR);
            }
          });
        }
        break;
      }

      case 'inspectAll': {
        // 逐个获取每个Agent状态
        for (const agent of chariot.agents) {
          const r = await this.controlAgent(agent.id, 'inspect');
          results.push(r);
          agent.traverse(async (node) => {
            if (node.type === 'agent' && node.id !== agent.id) {
              const subR = await this.controlAgent(node.id, 'inspect');
              results.push(subR);
            }
          });
        }
        break;
      }

      case 'rebalance': {
        // 触发战车重平衡
        this.coordinator.rebalance(groupId);
        results.push({
          success: true,
          groupId,
          action: 'rebalance',
          data: { rebalanceInitiated: true },
          timestamp: Date.now(),
        });
        break;
      }

      case 'compress': {
        // 触发战车同步压缩
        await this.coordinator.syncCompress(groupId);
        results.push({
          success: true,
          groupId,
          action: 'compress',
          data: { compressInitiated: true },
          timestamp: Date.now(),
        });
        break;
      }

      default: {
        results.push({
          success: false,
          groupId,
          action,
          error: `Unknown group action: ${action}`,
          timestamp: Date.now(),
        });
      }
    }

    return results;
  }

  // ═══════════════════════════════════════════
  // 查询方法
  // ═══════════════════════════════════════════

  /** 获取单个Agent完整状态 */
  getAgentState(agentId: string): AgentStateSnapshot | undefined {
    const agent = this.coordinator.getAgentById(agentId);
    return agent?.getStateSnapshot();
  }

  /** 获取Group状态树 */
  getGroupState(groupId: string, recursive = true): any {
    const chariot = this.coordinator.getChariot(groupId);
    if (!chariot) return undefined;

    const buildAgentTree = (agent: SwarmNode): any => {
      const snapshot = agent.getStateSnapshot();
      if (recursive && agent.type === 'sub-swarm' && agent.subSwarm) {
        return {
          ...snapshot,
          workers: agent.subSwarm.workers.map((w) => buildAgentTree(w)),
        };
      }
      return snapshot;
    };

    return {
      chariotId: chariot.id,
      name: chariot.name,
      status: chariot.status,
      createdAt: chariot.createdAt,
      taskCount: chariot.taskCount,
      agentCount: chariot.agents.length,
      agents: chariot.agents.map((a) => buildAgentTree(a)),
      coordinatorSnapshot: chariot.coordinator.getStateSnapshot(),
    };
  }

  /** 列出所有Agent（含嵌套） */
  listAllAgents(groupId?: string): AgentStateSnapshot[] {
    const snapshots: AgentStateSnapshot[] = [];

    if (groupId) {
      const chariot = this.coordinator.getChariot(groupId);
      if (chariot) {
        for (const agent of chariot.agents) {
          agent.traverse((node) => {
            if (node.type === 'agent') {
              snapshots.push(node.getStateSnapshot());
            }
          });
        }
      }
    } else {
      for (const agent of this.coordinator.getAllAgents()) {
        snapshots.push(agent.getStateSnapshot());
      }
    }

    return snapshots;
  }

  /** 列出所有Group层级 */
  listAllGroups(): GroupHierarchyNode[] {
    return this.coordinator.getChariots().map((chariot) => {
      const countAgents = (node: SwarmNode): number => {
        if (node.type === 'agent') return 1;
        return (
          1 +
          (node.subSwarm?.workers.reduce((sum, w) => sum + countAgents(w), 0) || 0)
        );
      };

      // 构建子Group层级
      const buildSubGroups = (node: SwarmNode): GroupHierarchyNode | undefined => {
        if (node.type !== 'sub-swarm' || !node.subSwarm) return undefined;
        return {
          groupId: node.id,
          name: node.name,
          status: node.getLifecycleState(),
          agentCount: countAgents(node),
          subGroups: node.subSwarm.workers
            .map((w) => buildSubGroups(w))
            .filter((g): g is GroupHierarchyNode => g !== undefined),
        };
      };

      return {
        groupId: chariot.id,
        name: chariot.name,
        status: chariot.status,
        agentCount: chariot.agents.reduce((sum, a) => sum + countAgents(a), 0),
        subGroups: chariot.agents
          .map((a) => buildSubGroups(a))
          .filter((g): g is GroupHierarchyNode => g !== undefined),
      };
    });
  }

  // ═══════════════════════════════════════════
  // 全局状态报告
  // ═══════════════════════════════════════════

  /** 生成全局状态报告 */
  generateStateReport(): AgentZeroStateReport {
    const allAgents = this.coordinator.getAllAgents();
    const agentStates: Record<string, AgentStateSnapshot> = {};

    for (const agent of allAgents) {
      agentStates[agent.id] = agent.getStateSnapshot();
    }

    const activeAgents = allAgents.filter((a) => a.isActive()).length;
    const pausedAgents = allAgents.filter((a) => a.getLifecycleState() === 'paused').length;
    const isolatedAgents = allAgents.filter((a) => a.getLifecycleState() === 'isolated').length;

    return {
      totalAgents: allAgents.length,
      activeAgents,
      pausedAgents,
      isolatedAgents,
      totalGroups: this.coordinator.getChariots().length,
      agentStates,
      groupHierarchy: this.listAllGroups(),
    };
  }
}

export default AgentZeroController;
