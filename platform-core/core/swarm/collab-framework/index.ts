/**
 * CollabFramework/index.ts — 统一入口与单例管理
 *
 * 为后端路由层提供便捷的服务访问入口：
 * - getSwarmCoordinator()
 * - getHandoffProtocol()
 * - getInterventionService()
 *
 * 所有服务共享同一个 LocalMessageBus 实例。
 */

import { LocalMessageBus } from './SwarmMessageBus';
import { SwarmCoordinator, CoordinatorConfig } from './SwarmCoordinator';
import { InterChariotHandoffProtocol } from './InterChariotHandoffProtocol';
import { InterventionService } from './InterventionService';

// ──────────────────────────────────────────
// 共享消息总线（单例）
// ──────────────────────────────────────────

let messageBusInstance: LocalMessageBus | null = null;

function getMessageBus(): LocalMessageBus {
  if (!messageBusInstance) {
    messageBusInstance = new LocalMessageBus();
  }
  return messageBusInstance;
}

// ──────────────────────────────────────────
// 服务单例
// ──────────────────────────────────────────

let swarmCoordinatorInstance: SwarmCoordinator | null = null;
let handoffProtocolInstance: InterChariotHandoffProtocol | null = null;
let interventionServiceInstance: InterventionService | null = null;

// ── SwarmCoordinator ─────────────────────

export function getSwarmCoordinator(): SwarmCoordinator {
  if (!swarmCoordinatorInstance) {
    const config: CoordinatorConfig = {
      model: 'gpt-4',
      maxTokens: 128000,
      decompositionStrategy: 'auto',
      dispatchStrategy: 'capability-match',
      aggregationStrategy: 'merge',
    };
    swarmCoordinatorInstance = new SwarmCoordinator(config, getMessageBus());
  }
  return swarmCoordinatorInstance;
}

/** 允许外部注入预配置的 SwarmCoordinator（用于测试或自定义初始化） */
export function setSwarmCoordinator(coordinator: SwarmCoordinator): void {
  swarmCoordinatorInstance = coordinator;
  // 同步更新 InterventionService 中的 coordinator 引用
  if (interventionServiceInstance) {
    interventionServiceInstance.setSwarmCoordinator(coordinator);
  }
}

// ── InterChariotHandoffProtocol ───────────

export function getHandoffProtocol(): InterChariotHandoffProtocol {
  if (!handoffProtocolInstance) {
    handoffProtocolInstance = new InterChariotHandoffProtocol(getMessageBus());
  }
  return handoffProtocolInstance;
}

/** 允许外部注入预配置的 HandoffProtocol */
export function setHandoffProtocol(protocol: InterChariotHandoffProtocol): void {
  handoffProtocolInstance = protocol;
}

// ── InterventionService ───────────────────

export function getInterventionService(): InterventionService {
  if (!interventionServiceInstance) {
    interventionServiceInstance = new InterventionService(
      getMessageBus(),
      swarmCoordinatorInstance || undefined
    );
  }
  return interventionServiceInstance;
}

/** 允许外部注入预配置的 InterventionService */
export function setInterventionService(service: InterventionService): void {
  interventionServiceInstance = service;
}

// ──────────────────────────────────────────
// 统一重置（测试用）
// ──────────────────────────────────────────

export function resetCollabFramework(): void {
  messageBusInstance = null;
  swarmCoordinatorInstance = null;
  handoffProtocolInstance = null;
  interventionServiceInstance = null;
}

// ──────────────────────────────────────────
// 导出所有类型（方便路由层直接引用）
// ──────────────────────────────────────────

export * from './SwarmMessageBus';
export * from './SwarmNode';
export * from './SwarmConfig';
export * from './ExecutionModes';
export * from './SnapshotEngine';
export * from './SnapshotStorage';
export * from './SwarmCoordinator';
export * from './InterChariotHandoffProtocol';
export * from './InterventionService';
