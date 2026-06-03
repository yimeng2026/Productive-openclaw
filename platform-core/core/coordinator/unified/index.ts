// index.ts — SYLVA Unified Coordinator 统一入口 v2.1
// 导出所有核心模块、类型和便捷工厂方法

export * from './types';
export { AgentRegistry } from './AgentRegistry';
export { TaskRouter } from './TaskRouter';
export { StateManager } from './StateManager';
export { MessageBus, getMessageBus, initMessageBus, resetMessageBus } from './MessageBus';
export { TopicRegistry, getTopicRegistry, resetTopicRegistry } from './TopicRegistry';
export { MessageRouter, getMessageRouter, resetMessageRouter } from './MessageRouter';

import { AgentRegistry } from './AgentRegistry';
import { TaskRouter } from './TaskRouter';
import { StateManager } from './StateManager';
import { MessageBus } from './MessageBus';
import { TopicRegistry } from './TopicRegistry';
import { MessageRouter } from './MessageRouter';
import { logger } from '../../utils/logger';

/**
 * UnifiedCoordinator — 统一协调器 v2.1
 * 将 AgentRegistry、TaskRouter、StateManager、MessageBus、TopicRegistry、MessageRouter 组合为单一入口。
 * 对应架构文档: Agent_Integration_Architecture_v2.md
 */
export class UnifiedCoordinator {
  registry: AgentRegistry;
  router: TaskRouter;
  state: StateManager;
  bus: MessageBus;
  topics: TopicRegistry;
  messageRouter: MessageRouter;
  initialized = false;

  constructor() {
    this.registry = new AgentRegistry();
    this.router = new TaskRouter(this.registry);
    this.state = new StateManager();
    this.bus = new MessageBus({ backend: 'hybrid', maxHistory: 2000 });
    this.topics = new TopicRegistry();
    this.messageRouter = new MessageRouter(this.topics, this.registry);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.registry.init();
    await this.state.init();
    await this.bus.start(this.registry);
    this.initialized = true;
    logger.info('[UnifiedCoordinator] All modules initialized (v2.1)');
  }

  /**
   * 快捷方法：注册 Agent 并自动订阅消息总线心跳
   */
  async registerAgent(
    ...args: Parameters<AgentRegistry['register']>
  ): Promise<ReturnType<AgentRegistry['register']>> {
    await this.ensureInit();
    const agent = await this.registry.register(...args);

    // 自动订阅该 Agent 的状态变更消息
    this.bus.subscribe(
      (msg) => {
        if (msg.type === 'agent.status_change' && msg.payload.agentId === agent.id) {
          const newStatus = msg.payload.status as any;
          this.registry.updateStatus(agent.id, newStatus).catch(() => {
            // 忽略状态更新失败
          });
        }
      },
      { source: agent.id }
    );

    // 在 TopicRegistry 也注册 Agent 主题
    this.topics.subscribe(`agent/${agent.id}/+`, (topic, payload, meta) => {
      logger.debug({ agentId: agent.id, topic, messageId: meta.messageId }, '[UnifiedCoordinator] Agent topic received');
    });

    return agent;
  }

  /**
   * 快捷方法：创建 Swarm 并绑定 Agents
   */
  async createSwarm(
    id: string,
    name: string,
    agentIds: string[],
    options: {
      mode?: import('./types').SwarmMode;
      leader?: string;
      maxDepth?: number;
      syncIntervalMs?: number;
    } = {}
  ): Promise<ReturnType<StateManager['createSwarm']>> {
    await this.ensureInit();

    // 更新 Agents 的 swarm 归属
    for (const agentId of agentIds) {
      const role = agentId === options.leader ? 'leader' : 'worker';
      await this.registry.updateSwarm(agentId, id, role as any);
    }

    const swarm = await this.state.createSwarm(id, name, agentIds, options);

    // 注册 Swarm 主题
    this.topics.subscribe(`swarm/${id}/+`, (topic, payload, meta) => {
      logger.debug({ swarmId: id, topic, messageId: meta.messageId }, '[UnifiedCoordinator] Swarm topic received');
    });

    return swarm;
  }

  /**
   * 快捷方法：发送任务，自动路由到 Agent 或 Swarm
   */
  async sendTask(task: import('./types').TaskRequest): Promise<{ agentIds: string[]; mode: import('./types').SwarmMode }> {
    await this.ensureInit();
    const route = await this.router.routeTask(task);

    // 记录任务到 StateManager
    if (task.targetSwarm) {
      for (const agentId of route.agentIds) {
        await this.state.createTask(task.id, task.targetSwarm, agentId);
      }
    } else if (route.agentIds.length === 1) {
      const agent = this.registry.get(route.agentIds[0]);
      if (agent?.swarmId) {
        await this.state.createTask(task.id, agent.swarmId, route.agentIds[0]);
      }
    }

    // 发送任务分配消息到总线（新版主题 + 旧版消息）
    await this.bus.publishTopic(
      `task/${task.id}/assigned`,
      {
        taskId: task.id,
        agentIds: route.agentIds,
        mode: route.mode,
        strategy: route.strategy,
        prompt: task.prompt,
      },
      { source: 'coordinator', correlationId: task.id }
    );

    // 旧版兼容广播
    await this.bus.broadcast('task.assigned', {
      taskId: task.id,
      agentIds: route.agentIds,
      mode: route.mode,
      strategy: route.strategy,
    });

    return { agentIds: route.agentIds, mode: route.mode };
  }

  /**
   * 快捷方法：运行健康检查并广播结果
   */
  async healthCheckAll(): Promise<ReturnType<AgentRegistry['runHealthChecks']>> {
    await this.ensureInit();
    const results = await this.registry.runHealthChecks();

    for (const result of results) {
      await this.bus.publishTopic(
        `agent/${result.agentId}/heartbeat`,
        {
          agentId: result.agentId,
          healthy: result.healthy,
          latencyMs: result.latencyMs,
        },
        { source: 'coordinator' }
      );
    }

    return results;
  }

  /**
   * 快捷方法：发布到主题（新版 API）
   */
  async publish(
    topic: string,
    payload: Record<string, unknown>,
    options?: Parameters<MessageBus['publishTopic']>[2]
  ): Promise<ReturnType<MessageBus['publishTopic']>> {
    await this.ensureInit();
    return this.bus.publishTopic(topic, payload, options);
  }

  /**
   * 快捷方法：订阅主题（新版 API）
   */
  subscribe(
    pattern: string,
    handler: Parameters<TopicRegistry['subscribe']>[1],
    options?: Parameters<TopicRegistry['subscribe']>[2]
  ): string {
    return this.bus.subscribeTopic(pattern, handler, options);
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) await this.init();
  }
}

/** 全局单例（可选） */
let coordinatorInstance: UnifiedCoordinator | null = null;

export function getCoordinator(): UnifiedCoordinator {
  if (!coordinatorInstance) {
    coordinatorInstance = new UnifiedCoordinator();
  }
  return coordinatorInstance;
}

export function resetCoordinator(): void {
  coordinatorInstance = null;
}
