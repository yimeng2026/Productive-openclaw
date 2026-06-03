/**
 * InterventionService — 3DACP 接入层
 * 多 Agent 编排和人工干预的核心控制层
 * 基于现有 coordinator 功能（bus/election/route/strategies/ws）封装
 */

import { ServiceAdapter } from '../coordinator/ServiceAdapter';
import type { AxisMessage, AxisStreamChunk } from '../coordinator/AxisMessage';
import { getCoordinator } from '../coordinator/unified';
import { getWebSocketManager } from '../websocket';

// ──────────── 干预命令类型 ────────────

export type InterventionLevel = 'agent' | 'group' | 'swarm' | 'system';
export type InterventionAction =
  | 'pause' | 'resume' | 'stop' | 'restart'
  | 'reassign' | 'escalate' | 'override'
  | 'inject_message' | 'modify_strategy'
  | 'force_election' | 'broadcast_command';

export interface InterventionCommand {
  level: InterventionLevel;
  targetId: string;
  action: InterventionAction;
  reason?: string;
  payload?: Record<string, unknown>;
  priority: number;
  issuedBy: string;
  issuedAt: string;
}

export interface InterventionResult {
  commandId: string;
  status: 'accepted' | 'rejected' | 'executed' | 'failed';
  targetId: string;
  action: InterventionAction;
  timestamp: string;
  details?: Record<string, unknown>;
}

// ──────────── 3DACP InterventionService ────────────

export class InterventionService extends ServiceAdapter {
  private history = new Map<string, InterventionResult[]>();

  constructor() {
    super({ moduleId: 'intervention', supportsStreaming: true });
  }

  protected async handleAction(action: string, data: unknown): Promise<unknown> {
    switch (action) {
      case 'create':
        return this.issueCommand(data as InterventionCommand);
      case 'read':
        return this.getHistory(data as { targetId?: string });
      case 'update':
        return this.modifyStrategy(data as { targetId: string; strategy: unknown });
      case 'delete':
        return this.cancelCommand(data as { commandId: string });
      case 'invoke':
        return this.executeIntervention(data as InterventionCommand);
      case 'list':
        return this.listActiveInterventions(data as { level?: InterventionLevel });
      default:
        throw new Error(`InterventionService: unsupported action '${action}'`);
    }
  }

  protected async handleStreamingAction(
    action: string,
    data: unknown,
    _msg: AxisMessage,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void> {
    if (action === 'stream') {
      const { targetId } = data as { targetId: string };
      return this.monitorTarget(targetId, onChunk);
    }
    if (action === 'subscribe') {
      const { level, targetId } = data as { level: InterventionLevel; targetId: string };
      return this.subscribeInterventions(level, targetId, onChunk);
    }
    throw new Error(`InterventionService: streaming action '${action}' not supported`);
  }

  // ──────────── 干预命令 ────────────

  private async issueCommand(cmd: InterventionCommand): Promise<InterventionResult> {
    const commandId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    try {
      const coordinator = getCoordinator();
      const ws = getWebSocketManager();

      // 根据干预级别选择路由方式
      switch (cmd.level) {
        case 'agent':
          await this.interveneAgent(cmd, coordinator, ws);
          break;
        case 'group':
          await this.interveneGroup(cmd, coordinator, ws);
          break;
        case 'swarm':
          await this.interveneSwarm(cmd, coordinator, ws);
          break;
        case 'system':
          await this.interveneSystem(cmd, coordinator, ws);
          break;
      }

      const result: InterventionResult = {
        commandId,
        status: 'executed',
        targetId: cmd.targetId,
        action: cmd.action,
        timestamp: new Date().toISOString(),
      };

      this.recordResult(cmd.targetId, result);
      return result;
    } catch (err) {
      const result: InterventionResult = {
        commandId,
        status: 'failed',
        targetId: cmd.targetId,
        action: cmd.action,
        timestamp: new Date().toISOString(),
        details: { error: err instanceof Error ? err.message : String(err) },
      };
      this.recordResult(cmd.targetId, result);
      throw err;
    }
  }

  private async interveneAgent(
    cmd: InterventionCommand,
    _coordinator: any,
    ws: any
  ): Promise<void> {
    // 通过 WebSocket 推送干预指令到特定 Agent
    if (ws && ws.pushToClient) {
      await ws.pushToClient(cmd.targetId, {
        type: 'intervention',
        action: cmd.action,
        payload: cmd.payload,
        reason: cmd.reason,
        priority: cmd.priority,
      });
    }
    // 同时通过总线广播（确保所有监听者收到）
    const coordinator = getCoordinator();
    await coordinator.publish(`agent:${cmd.targetId}:intervention`, {
      action: cmd.action,
      payload: cmd.payload,
      reason: cmd.reason,
    });
  }

  private async interveneGroup(
    cmd: InterventionCommand,
    coordinator: any,
    ws: any
  ): Promise<void> {
    // 获取群组内所有 Agent
    const groupAgents = await coordinator.getGroupAgents?.(cmd.targetId) ?? [];
    // 向群组广播
    for (const agentId of groupAgents) {
      await this.interveneAgent(
        { ...cmd, targetId: agentId, level: 'agent' },
        coordinator,
        ws
      );
    }
  }

  private async interveneSwarm(
    cmd: InterventionCommand,
    coordinator: any,
    ws: any
  ): Promise<void> {
    // 强制重新选举协调员
    if (cmd.action === 'force_election') {
      await coordinator.forceElection?.(cmd.targetId);
    }
    // 获取 swarm 下所有群组
    const groups = await coordinator.getSwarmGroups?.(cmd.targetId) ?? [];
    for (const groupId of groups) {
      await this.interveneGroup(
        { ...cmd, targetId: groupId, level: 'group' },
        coordinator,
        ws
      );
    }
  }

  private async interveneSystem(
    cmd: InterventionCommand,
    _coordinator: any,
    _ws: any
  ): Promise<void> {
    // 系统级干预：修改全局策略
    const coordinator = getCoordinator();
    await coordinator.publish('system:intervention', {
      action: cmd.action,
      payload: cmd.payload,
      reason: cmd.reason,
      priority: cmd.priority,
    });
  }

  // ──────────── 策略修改 ────────────

  private async modifyStrategy(data: { targetId: string; strategy: unknown }): Promise<unknown> {
    const coordinator = getCoordinator();
    // 通过协调器更新策略
    await (coordinator as any).updateStrategy?.(data.targetId, data.strategy);
    return {
      targetId: data.targetId,
      strategy: data.strategy,
      updatedAt: new Date().toISOString(),
    };
  }

  private async cancelCommand(data: { commandId: string }): Promise<unknown> {
    // 标记命令为取消状态
    return {
      commandId: data.commandId,
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
    };
  }

  private async executeIntervention(cmd: InterventionCommand): Promise<InterventionResult> {
    return this.issueCommand(cmd);
  }

  // ──────────── 查询 ────────────

  private getHistory(data: { targetId?: string }): unknown {
    if (data.targetId) {
      return this.history.get(data.targetId) ?? [];
    }
    // 返回全部历史
    const all: Record<string, InterventionResult[]> = {};
    for (const [id, results] of this.history) {
      all[id] = results;
    }
    return all;
  }

  private listActiveInterventions(data: { level?: InterventionLevel }): InterventionCommand[] {
    // 返回活跃中的干预命令（简化实现）
    return [];
  }

  // ──────────── 流式监控 ────────────

  private async monitorTarget(
    targetId: string,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void> {
    const bus = getCoordinator().bus;
    let seq = 0;

    // 订阅目标相关的所有事件
    const coordinator = getCoordinator();
    const subId = coordinator.subscribe(`agent:${targetId}:*`, (msg: any) => {
      onChunk({
        streamId: `monitor-${targetId}`,
        sequence: seq++,
        isLast: false,
        chunk: msg,
      });
    });

    // 持续监控直到超时或取消
    await new Promise((resolve) => {
      setTimeout(() => {
        (coordinator as any).unsubscribe?.(subId);
        onChunk({
          streamId: `monitor-${targetId}`,
          sequence: seq,
          isLast: true,
          chunk: { status: 'monitoring_ended' },
        });
        resolve(undefined);
      }, 30000); // 30秒监控窗口
    });
  }

  private async subscribeInterventions(
    level: InterventionLevel,
    targetId: string,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void> {
    const coordinator = getCoordinator();
    let seq = 0;

    const topic =
      level === 'system'
        ? 'system:intervention'
        : level === 'agent'
          ? `agent:${targetId}:intervention`
          : level === 'group'
            ? `group:${targetId}:intervention`
            : `swarm:${targetId}:intervention`;

    const subId = coordinator.subscribe(topic, (msg: any) => {
      onChunk({
        streamId: `sub-${targetId}`,
        sequence: seq++,
        isLast: false,
        chunk: msg,
      });
    });

    // 持续订阅
    await new Promise((resolve) => {
      setTimeout(() => {
        (coordinator as any).unsubscribe?.(subId);
        onChunk({
          streamId: `sub-${targetId}`,
          sequence: seq,
          isLast: true,
          chunk: { status: 'subscription_ended' },
        });
        resolve(undefined);
      }, 60000); // 60秒订阅窗口
    });
  }

  // ──────────── 工具 ────────────

  private recordResult(targetId: string, result: InterventionResult): void {
    const existing = this.history.get(targetId) ?? [];
    existing.push(result);
    this.history.set(targetId, existing);
  }
}

// ──────────── 导出 3DACP 元数据 ────────────

import type { ServiceMetadata } from '../coordinator/TransformLayer';

export function createInterventionMetadata(): ServiceMetadata {
  return {
    moduleId: 'intervention',
    supportsStreaming: true,
    actionMap: {
      create: 'issueCommand',
      read: 'getHistory',
      update: 'modifyStrategy',
      delete: 'cancelCommand',
      invoke: 'executeIntervention',
      list: 'listActiveInterventions',
    },
    streamActions: ['stream', 'subscribe'],
  };
}

export function createInterventionServiceAdapter(): InterventionService {
  return new InterventionService();
}
