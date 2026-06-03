import { EventEmitter } from "events";
import { AgentGroup, GroupCoordinator, HandoffPayload } from "./GroupCoordinator";

/**
 * Blueprint Engine
 * 
 * 功能：
 * - 解析蓝图定义（nodes + edges）
 * - 拓扑排序确定执行顺序
 * - 按序/并行调度Group/Agent执行
 * - 状态机推进
 */

export interface BlueprintNode {
  id: string;
  presetId?: string;           // Agent Preset引用
  groupId?: string;            // 绑定到已有Group
  type: 'agent' | 'group' | 'coordinator';
  position: { x: number; y: number };
  configOverrides?: Record<string, any>;
  entrypoint?: boolean;       // 是否入口节点
}

export interface BlueprintEdge {
  id: string;
  sourceId: string;
  targetId: string;
  condition?: string;          // 条件表达式
  handoffProtocol: 'sequential' | 'parallel' | 'conditional';
  delayMs?: number;           // 执行延迟
}

export interface Blueprint {
  id: string;
  name: string;
  description?: string;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  variables?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export type BlueprintStatus = 'draft' | 'ready' | 'running' | 'paused' | 'completed' | 'error';

export interface BlueprintExecution {
  blueprintId: string;
  executionId: string;
  status: BlueprintStatus;
  currentNodeId?: string;
  completedNodes: string[];
  failedNodes: string[];
  results: Map<string, any>;
  startedAt: Date;
  endedAt?: Date;
}

export class BlueprintEngine extends EventEmitter {
  private blueprints: Map<string, Blueprint> = new Map();
  private executions: Map<string, BlueprintExecution> = new Map();

  // ========== 蓝图管理 ==========

  createBlueprint(definition: Omit<Blueprint, 'id' | 'createdAt' | 'updatedAt'>): Blueprint {
    const id = `bp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date();
    
    const blueprint: Blueprint = {
      ...definition,
      id,
      createdAt: now,
      updatedAt: now,
    };

    this.blueprints.set(id, blueprint);
    this.emit('blueprintCreated', { blueprint });
    return blueprint;
  }

  getBlueprint(id: string): Blueprint | undefined {
    return this.blueprints.get(id);
  }

  updateBlueprint(id: string, updates: Partial<Omit<Blueprint, 'id' | 'createdAt'>>): Blueprint | undefined {
    const existing = this.blueprints.get(id);
    if (!existing) return undefined;

    const updated: Blueprint = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };

    this.blueprints.set(id, updated);
    this.emit('blueprintUpdated', { blueprint: updated });
    return updated;
  }

  deleteBlueprint(id: string): boolean {
    const existed = this.blueprints.delete(id);
    if (existed) this.emit('blueprintDeleted', { blueprintId: id });
    return existed;
  }

  listBlueprints(): Blueprint[] {
    return Array.from(this.blueprints.values()).sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
    );
  }

  // ========== 拓扑排序 ==========

  /**
   * 对蓝图节点进行拓扑排序，确定执行顺序
   */
  topologicalSort(blueprintId: string): string[] | undefined {
    const blueprint = this.blueprints.get(blueprintId);
    if (!blueprint) return undefined;

    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    // 初始化
    for (const node of blueprint.nodes) {
      inDegree.set(node.id, 0);
      adjacency.set(node.id, []);
    }

    // 构建邻接表和入度
    for (const edge of blueprint.edges) {
      const current = adjacency.get(edge.sourceId) || [];
      current.push(edge.targetId);
      adjacency.set(edge.sourceId, current);
      inDegree.set(edge.targetId, (inDegree.get(edge.targetId) || 0) + 1);
    }

    // Kahn算法
    const queue: string[] = [];
    const result: string[] = [];

    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) queue.push(nodeId);
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      const neighbors = adjacency.get(current) || [];
      for (const neighbor of neighbors) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    // 检查环
    if (result.length !== blueprint.nodes.length) {
      this.emit('error', { blueprintId, message: 'Blueprint contains cycles' });
      return undefined;
    }

    return result;
  }

  // ========== 执行引擎 ==========

  /**
   * 启动蓝图执行
   */
  async executeBlueprint(blueprintId: string, groups: Map<string, AgentGroup>): Promise<BlueprintExecution | undefined> {
    const blueprint = this.blueprints.get(blueprintId);
    if (!blueprint) return undefined;

    const executionId = `exec-${Date.now()}`;
    const execution: BlueprintExecution = {
      blueprintId,
      executionId,
      status: 'running',
      completedNodes: [],
      failedNodes: [],
      results: new Map(),
      startedAt: new Date(),
    };

    this.executions.set(executionId, execution);
    this.emit('executionStarted', { execution });

    const order = this.topologicalSort(blueprintId);
    if (!order) {
      execution.status = 'error';
      execution.endedAt = new Date();
      this.emit('executionFailed', { execution, reason: 'circular dependency' });
      return execution;
    }

    // 按拓扑顺序执行
    for (const nodeId of order) {
      if (execution.status === 'paused') {
        this.emit('executionPaused', { execution });
        break;
      }

      const node = blueprint.nodes.find((n) => n.id === nodeId);
      if (!node) continue;

      execution.currentNodeId = nodeId;

      try {
        let result: any;

        if (node.type === 'group' && node.groupId) {
          // 执行Group
          const group = groups.get(node.groupId);
          if (group) {
            result = await this.executeGroupNode(group, node, execution);
          }
        } else if (node.type === 'agent' && node.presetId) {
          // 执行Agent（查找所在Group）
          result = await this.executeAgentNode(node, groups, execution);
        } else if (node.type === 'coordinator' && node.groupId) {
          // 执行Coordinator指令
          const group = groups.get(node.groupId);
          if (group) {
            result = await this.executeCoordinatorNode(group, node, execution);
          }
        }

        execution.results.set(nodeId, result);
        execution.completedNodes.push(nodeId);
        this.emit('nodeCompleted', { execution, nodeId, result });

      } catch (err) {
        execution.failedNodes.push(nodeId);
        this.emit('nodeFailed', { execution, nodeId, error: err instanceof Error ? err.message : String(err) });

        // 失败处理：根据edges查找fallback路径
        const fallbackEdge = blueprint.edges.find(
          (e) => e.sourceId === nodeId && e.handoffProtocol === 'conditional'
        );
        if (!fallbackEdge) {
          execution.status = 'error';
          break;
        }
      }
    }

    if (execution.status === 'running') {
      execution.status = 'completed';
    }
    execution.endedAt = new Date();
    execution.currentNodeId = undefined;

    this.emit('executionCompleted', { execution });
    return execution;
  }

  private async executeGroupNode(group: AgentGroup, node: BlueprintNode, execution: BlueprintExecution): Promise<any> {
    // 激活Group并执行其Coordinator的计划
    group.activate();
    
    const plan = [`blueprint-${execution.executionId}-${node.id}`];
    await group.coordinator.executePlan(plan);
    
    return {
      groupId: group.id,
      status: group.status,
      agents: group.getAllAgentSnapshots(),
    };
  }

  private async executeAgentNode(node: BlueprintNode, groups: Map<string, AgentGroup>, execution: BlueprintExecution): Promise<any> {
    // 在所有Group中查找该Agent
    let targetAgent: any = undefined;
    let targetGroup: AgentGroup | undefined;

    for (const group of groups.values()) {
      const agent = group.getAgentById(node.presetId!);
      if (agent) {
        targetAgent = agent;
        targetGroup = group;
        break;
      }
    }

    if (!targetAgent || !targetGroup) {
      throw new Error(`Agent ${node.presetId} not found in any group`);
    }

    // 构建任务
    const task = `blueprint-task-${execution.executionId}-${node.id}`;
    
    // 委托执行
    const result = await targetGroup.coordinator.delegateTask(targetAgent, task);
    
    return {
      agentId: node.presetId,
      groupId: targetGroup.id,
      result,
    };
  }

  private async executeCoordinatorNode(group: AgentGroup, node: BlueprintNode, execution: BlueprintExecution): Promise<any> {
    // 向Coordinator发送特殊指令
    const command = node.configOverrides?.command || 'default';
    
    if (command === 'pause') {
      group.pause('blueprint-coordinator-command');
    } else if (command === 'resume') {
      group.resume();
    }

    return {
      groupId: group.id,
      command,
      coordinatorStatus: group.coordinator.isActive,
    };
  }

  // ========== 执行控制 ==========

  pauseExecution(executionId: string): boolean {
    const execution = this.executions.get(executionId);
    if (!execution || execution.status !== 'running') return false;
    
    execution.status = 'paused';
    this.emit('executionPaused', { execution });
    return true;
  }

  resumeExecution(executionId: string): boolean {
    const execution = this.executions.get(executionId);
    if (!execution || execution.status !== 'paused') return false;
    
    execution.status = 'running';
    this.emit('executionResumed', { execution });
    return true;
  }

  getExecution(executionId: string): BlueprintExecution | undefined {
    return this.executions.get(executionId);
  }

  listExecutions(blueprintId?: string): BlueprintExecution[] {
    const all = Array.from(this.executions.values());
    if (blueprintId) {
      return all.filter((e) => e.blueprintId === blueprintId);
    }
    return all;
  }

  // ========== 序列化 ==========

  exportBlueprint(id: string): string | undefined {
    const blueprint = this.blueprints.get(id);
    if (!blueprint) return undefined;
    return JSON.stringify(blueprint, null, 2);
  }

  importBlueprint(json: string): Blueprint | undefined {
    try {
      const parsed = JSON.parse(json) as Blueprint;
      return this.createBlueprint({
        name: parsed.name,
        description: parsed.description,
        nodes: parsed.nodes,
        edges: parsed.edges,
        variables: parsed.variables,
      });
    } catch {
      return undefined;
    }
  }
}
