import { SwarmNode, AgentStateSnapshot } from "./SwarmNode";

/**
 * AgentZeroPolicyBridge
 *
 * 在 SwarmNode 已有 pause/resume/isolate 基础上，增加：
 * - 跨 Chariot 迁移 Agent
 * - 全局 Agent 状态查询
 * - 批量控制
 */

export interface ChariotState {
  id: string;
  name: string;
  coordinator: SwarmNode;
  agents: SwarmNode[];
}

/** 迁移结果 */
export interface ReassignResult {
  success: boolean;
  sourceChariotId?: string;
  targetChariotId?: string;
  error?: string;
}

/** 批量控制结果 */
export interface BatchControlResult {
  succeeded: string[];
  failed: string[];
  errors: Map<string, string>;
}

export class AgentZeroPolicyBridge {
  private chariots = new Map<string, ChariotState>();

  constructor(chariots: ChariotState[] = []) {
    for (const c of chariots) {
      this.chariots.set(c.id, c);
    }
  }

  /** 注册一个 Chariot */
  registerChariot(chariot: ChariotState): void {
    this.chariots.set(chariot.id, chariot);
  }

  /** 注销一个 Chariot */
  unregisterChariot(chariotId: string): boolean {
    return this.chariots.delete(chariotId);
  }

  /** 获取所有 Chariot 的 ID 列表 */
  getChariotIds(): string[] {
    return Array.from(this.chariots.keys());
  }

  /** 获取所有 Chariot 基本信息 */
  getChariots(): { id: string; name: string; agentCount: number }[] {
    return Array.from(this.chariots.values()).map((c) => ({
      id: c.id,
      name: c.name,
      agentCount: c.agents.length,
    }));
  }

  /** 全局 Agent 状态查询 */
  getAllAgentsGlobal(): AgentStateSnapshot[] {
    const snapshots: AgentStateSnapshot[] = [];
    for (const chariot of this.chariots.values()) {
      // Coordinator is also an agent
      snapshots.push(chariot.coordinator.getStateSnapshot());
      for (const agent of chariot.agents) {
        agent.traverse((node) => {
          snapshots.push(node.getStateSnapshot());
        });
      }
    }
    return snapshots;
  }

  /** 按 ID 在全局范围查找 Agent */
  findAgentGlobal(agentId: string): SwarmNode | undefined {
    for (const chariot of this.chariots.values()) {
      if (chariot.coordinator.getStateSnapshot().id === agentId) {
        return chariot.coordinator;
      }
      const found = chariot.coordinator.findById(agentId);
      if (found) return found;
      for (const agent of chariot.agents) {
        const foundInAgent = agent.findById(agentId);
        if (foundInAgent) return foundInAgent;
      }
    }
    return undefined;
  }

  /** 获取某个 Agent 当前所在的 Chariot ID */
  getAgentChariotId(agentId: string): string | undefined {
    for (const [chariotId, chariot] of this.chariots) {
      if (chariot.coordinator.getStateSnapshot().id === agentId) {
        return chariotId;
      }
      if (chariot.coordinator.findById(agentId)) {
        return chariotId;
      }
      for (const agent of chariot.agents) {
        if (agent.findById(agentId)) {
          return chariotId;
        }
      }
    }
    return undefined;
  }

  /**
   * 跨 Chariot 迁移 Agent
   * 将 agentId 对应的 Agent 从当前 Chariot agents 数组移除，添加到目标 Chariot agents 数组
   */
  reassign(agentId: string, targetChariotId: string): ReassignResult {
    const sourceChariotId = this.getAgentChariotId(agentId);
    if (!sourceChariotId) {
      return { success: false, error: `Agent ${agentId} not found in any chariot` };
    }

    if (sourceChariotId === targetChariotId) {
      return { success: true, sourceChariotId, targetChariotId };
    }

    const sourceChariot = this.chariots.get(sourceChariotId);
    const targetChariot = this.chariots.get(targetChariotId);

    if (!sourceChariot) {
      return { success: false, error: `Source chariot ${sourceChariotId} not found` };
    }
    if (!targetChariot) {
      return { success: false, error: `Target chariot ${targetChariotId} not found` };
    }

    // Cannot migrate a coordinator
    if (sourceChariot.coordinator.getStateSnapshot().id === agentId) {
      return { success: false, error: `Cannot migrate chariot coordinator ${agentId}` };
    }

    // Find agent in source chariot agents array
    const agentIdx = sourceChariot.agents.findIndex(
      (a) => a.getStateSnapshot().id === agentId || a.findById(agentId) !== undefined
    );

    if (agentIdx === -1) {
      return { success: false, error: `Agent ${agentId} not in source chariot agents array` };
    }

    const agentNode = sourceChariot.agents[agentIdx];

    // Lifecycle safety: pause before moving
    const wasActive = typeof agentNode.isActive === "function" ? agentNode.isActive() : false;
    if (wasActive) {
      agentNode.pause?.("reassign-pending");
    }

    // Remove from source agents array
    sourceChariot.agents.splice(agentIdx, 1);

    // Add to target agents array
    targetChariot.agents.push(agentNode);

    // Resume if it was active before
    if (wasActive) {
      agentNode.resume?.();
    }

    console.info(`[AgentZeroPolicyBridge] Reassigned agent ${agentId} ${sourceChariotId} → ${targetChariotId}`);
    return { success: true, sourceChariotId, targetChariotId };
  }

  /** 批量控制 */
  batchControl(
    agentIds: string[],
    action: "pause" | "resume" | "isolate"
  ): BatchControlResult {
    const succeeded: string[] = [];
    const failed: string[] = [];
    const errors = new Map<string, string>();

    for (const id of agentIds) {
      const agent = this.findAgentGlobal(id);
      if (!agent) {
        failed.push(id);
        errors.set(id, "Agent not found");
        continue;
      }

      try {
        switch (action) {
          case "pause":
            if (typeof agent.pause !== "function") {
              throw new Error("Agent does not support pause");
            }
            agent.pause("batch-control");
            break;
          case "resume":
            if (typeof agent.resume !== "function") {
              throw new Error("Agent does not support resume");
            }
            agent.resume();
            break;
          case "isolate":
            if (typeof agent.isolate !== "function") {
              throw new Error("Agent does not support isolate");
            }
            agent.isolate("batch-control");
            break;
        }
        succeeded.push(id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[AgentZeroPolicyBridge] batchControl ${action} failed for ${id}:`, msg);
        failed.push(id);
        errors.set(id, msg);
      }
    }

    return { succeeded, failed, errors };
  }

  /** 批量迁移 */
  batchReassign(
    agentIds: string[],
    targetChariotId: string
  ): { succeeded: ReassignResult[]; failed: ReassignResult[] } {
    const succeeded: ReassignResult[] = [];
    const failed: ReassignResult[] = [];

    for (const id of agentIds) {
      const result = this.reassign(id, targetChariotId);
      if (result.success) {
        succeeded.push(result);
      } else {
        failed.push(result);
      }
    }

    return { succeeded, failed };
  }

  /** 查询全局统计 */
  getGlobalStats(): {
    chariotCount: number;
    totalAgents: number;
    activeAgents: number;
    pausedAgents: number;
    isolatedAgents: number;
    errorAgents: number;
  } {
    const all = this.getAllAgentsGlobal();
    return {
      chariotCount: this.chariots.size,
      totalAgents: all.length,
      activeAgents: all.filter((a) => a.lifecycleState === "active").length,
      pausedAgents: all.filter((a) => a.lifecycleState === "paused").length,
      isolatedAgents: all.filter((a) => a.lifecycleState === "isolated").length,
      errorAgents: all.filter((a) => a.lifecycleState === "error").length,
    };
  }

  /** 按生命周期状态过滤 */
  getAgentsByState(state: AgentStateSnapshot["lifecycleState"]): AgentStateSnapshot[] {
    return this.getAllAgentsGlobal().filter((a) => a.lifecycleState === state);
  }
}
