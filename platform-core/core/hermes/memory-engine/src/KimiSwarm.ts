// KimiSwarm — 6 兄弟并行调度器
// 通过 Hermes AgentSwarm 内部调度，突破 OpenClaw 5-slot 限制

import { HermesEngine } from './HermesEngine';
import { AgentRole } from './AgentSwarm';

export interface KimiBrother {
  id: string;
  name: string;
  role: AgentRole;
  specialty: string;
  apiKeyIndex: number; // 0-5 对应 6 个 Kimi API Key
}

/**
 * Kimi 6 兄弟初始化配置
 */
export const KIMI_BROTHERS: Omit<KimiBrother, 'id'>[] = [
  {
    name: 'Kimi-老大·形式化',
    role: 'prover',
    specialty: 'Lean 形式化证明、定理填充、sorry 消除',
    apiKeyIndex: 0,
  },
  {
    name: 'Kimi-老二·写作',
    role: 'writer',
    specialty: '论文撰写、技术文档、报告生成',
    apiKeyIndex: 1,
  },
  {
    name: 'Kimi-老三·审稿',
    role: 'reviewer',
    specialty: '代码审查、质量检查、逻辑验证',
    apiKeyIndex: 2,
  },
  {
    name: 'Kimi-老四·研究',
    role: 'researcher',
    specialty: '信息检索、数据分析、文献调研',
    apiKeyIndex: 3,
  },
  {
    name: 'Kimi-老五·优化',
    role: 'optimizer',
    specialty: '性能优化、架构改进、代码重构',
    apiKeyIndex: 4,
  },
  {
    name: 'Kimi-老六·协调',
    role: 'coordinator',
    specialty: '任务调度、Agent 同步、冲突解决',
    apiKeyIndex: 5,
  },
];

/**
 * Kimi Swarm 调度器
 * 在单个 Hermes Engine slot 内驱动 6 个 Kimi 逻辑 Agent
 */
export class KimiSwarm {
  private hermes: HermesEngine;
  private brothers: Map<string, KimiBrother> = new Map();

  constructor(hermes: HermesEngine) {
    this.hermes = hermes;
  }

  /**
   * 孵化 6 兄弟
   */
  spawnBrothers(): KimiBrother[] {
    const spawned: KimiBrother[] = [];

    for (const config of KIMI_BROTHERS) {
      const agentId = this.hermes.spawnKimiAgent(config.role, config.name);
      const brother: KimiBrother = { ...config, id: agentId };
      this.brothers.set(agentId, brother);
      spawned.push(brother);

      console.log(`[KimiSwarm] 孵化: ${brother.name} (id=${agentId}, key=${brother.apiKeyIndex})`);
    }

    return spawned;
  }

  /**
   * 分配任务到指定兄弟
   */
  assignTask(
    brotherId: string,
    taskType: string,
    payload: Record<string, unknown>
  ): string {
    const brother = this.brothers.get(brotherId);
    if (!brother) {
      throw new Error(`Brother ${brotherId} not found`);
    }

    // 注入 API Key 索引到 payload
    const enrichedPayload = {
      ...payload,
      apiKeyIndex: brother.apiKeyIndex,
      agentName: brother.name,
      agentRole: brother.role,
    };

    return this.hermes.submitToSwarm(taskType, enrichedPayload, {
      preferredRole: brother.role,
      priority: 80, // Kimi 任务高优先级
    });
  }

  /**
   * 广播任务到所有兄弟（各处理一部分）
   */
  broadcastTask(
    taskType: string,
    basePayload: Record<string, unknown>,
    shardFn?: (index: number, total: number) => Record<string, unknown>
  ): string[] {
    const all = Array.from(this.brothers.values());
    const taskIds: string[] = [];

    for (let i = 0; i < all.length; i++) {
      const brother = all[i];
      const shard = shardFn ? shardFn(i, all.length) : {};
      const payload = { ...basePayload, ...shard, shardIndex: i, totalShards: all.length };
      const taskId = this.assignTask(brother.id, taskType, payload);
      taskIds.push(taskId);
    }

    return taskIds;
  }

  /**
   * 获取 6 兄弟状态
   */
  getBrotherStatus(): Array<KimiBrother & { taskCount: number; status: string }> {
    const swarmStats = this.hermes.getSwarmStats();
    return Array.from(this.brothers.values()).map((b) => ({
      ...b,
      taskCount: swarmStats.runningTasks + swarmStats.pendingTasks,
      status: 'active',
    }));
  }

  /**
   * 销毁所有兄弟
   */
  killAll(): void {
    for (const [id, brother] of this.brothers) {
      console.log(`[KimiSwarm] 销毁: ${brother.name}`);
      this.hermes.destroySwarm();
    }
    this.brothers.clear();
  }
}

export default KimiSwarm;
