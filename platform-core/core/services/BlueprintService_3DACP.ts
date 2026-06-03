/**
 * BlueprintService — 3DACP 接入层
 * 将现有 blueprints.ts 路由功能接入 AxisGateway
 */

import { ServiceAdapter } from '../coordinator/ServiceAdapter';
import type { AxisMessage } from '../coordinator/AxisMessage';

// ──────────── Blueprint 数据类型（与 blueprints.ts 对齐）────────────

interface BlueprintNode {
  id: string;
  type: 'agent' | 'condition' | 'action' | 'input' | 'output';
  config: Record<string, unknown>;
}

interface BlueprintEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
}

interface Blueprint {
  id: string;
  name: string;
  description?: string;
  category: string;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  status: 'draft' | 'active' | 'paused';
  createdAt: string;
  updatedAt: string;
}

interface BlueprintExecution {
  id: string;
  blueprintId: string;
  status: 'running' | 'completed' | 'failed' | 'paused';
  startedAt: string;
  completedAt?: string;
  nodeResults: Record<string, unknown>;
}

// ──────────── 内存存储（与 blueprints.ts 一致）────────────

const blueprints = new Map<string, Blueprint>();
const executions = new Map<string, BlueprintExecution>();

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const now = () => new Date().toISOString();

// ──────────── 预设蓝图 ────────────

function getPresets(): Blueprint[] {
  const t = now();
  return [
    {
      id: 'preset-data-pipeline',
      name: '数据处理流水线',
      category: 'data',
      nodes: [
        { id: 'n1', type: 'input', config: { s: 'db' } },
        { id: 'n2', type: 'action', config: { op: 'etl' } },
        { id: 'n3', type: 'output', config: { d: 'warehouse' } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
      ],
      status: 'draft',
      createdAt: t,
      updatedAt: t,
    },
    {
      id: 'preset-content-review',
      name: '内容审核流程',
      category: 'mod',
      nodes: [
        { id: 'n1', type: 'input', config: { t: 'text' } },
        { id: 'n2', type: 'agent', config: { task: 'detect' } },
        { id: 'n3', type: 'output', config: { act: 'review' } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
      ],
      status: 'draft',
      createdAt: t,
      updatedAt: t,
    },
    {
      id: 'preset-customer-service',
      name: '智能客服流程',
      category: 'svc',
      nodes: [
        { id: 'n1', type: 'input', config: { ch: 'chat' } },
        { id: 'n2', type: 'condition', config: { rule: 'conf>0.9' } },
        { id: 'n3', type: 'output', config: { act: 'reply' } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
      ],
      status: 'draft',
      createdAt: t,
      updatedAt: t,
    },
  ];
}

// ──────────── 3DACP BlueprintService 适配器 ────────────

export class BlueprintService extends ServiceAdapter {
  constructor() {
    super({ moduleId: 'blueprint', supportsStreaming: true });
  }

  protected async handleAction(action: string, data: unknown): Promise<unknown> {
    switch (action) {
      case 'create':
        return this.createBlueprint(data as Partial<Blueprint>);
      case 'read':
        return this.readBlueprint(data as { id?: string; category?: string });
      case 'update':
        return this.updateBlueprint(data as { id: string } & Partial<Blueprint>);
      case 'delete':
        return this.deleteBlueprint(data as { id: string });
      case 'invoke':
        return this.executeBlueprint(data as { id: string });
      case 'list':
        return this.listBlueprints(data as { category?: string });
      default:
        throw new Error(`BlueprintService: unsupported action '${action}'`);
    }
  }

  protected async handleStreamingAction(
    action: string,
    data: unknown,
    _msg: AxisMessage,
    onChunk: (chunk: any) => void
  ): Promise<void> {
    if (action === 'stream') {
      const { id } = data as { id: string };
      const exec = this.executeBlueprintStream(id, onChunk);
      return exec;
    }
    throw new Error(`BlueprintService: streaming action '${action}' not supported`);
  }

  // ──────────── CRUD 实现 ────────────

  private createBlueprint(data: Partial<Blueprint>): Blueprint {
    if (!data.name || typeof data.name !== 'string') {
      throw new Error('name required');
    }
    if (!Array.isArray(data.nodes)) {
      throw new Error('nodes array required');
    }
    const t = now();
    const bp: Blueprint = {
      id: uid(),
      name: data.name,
      description: data.description,
      category: data.category || 'default',
      nodes: data.nodes,
      edges: data.edges || [],
      status: 'draft',
      createdAt: t,
      updatedAt: t,
    };
    blueprints.set(bp.id, bp);
    return bp;
  }

  private readBlueprint(data: { id?: string; category?: string }): unknown {
    if (data.id) {
      const bp = blueprints.get(data.id);
      if (!bp) throw new Error(`Blueprint not found: ${data.id}`);
      return bp;
    }
    if (data.category) {
      return Array.from(blueprints.values()).filter((b) => b.category === data.category);
    }
    // 返回所有 + 预设
    return {
      blueprints: Array.from(blueprints.values()),
      presets: getPresets(),
    };
  }

  private updateBlueprint(data: { id: string } & Partial<Blueprint>): Blueprint {
    const bp = blueprints.get(data.id);
    if (!bp) throw new Error(`Blueprint not found: ${data.id}`);
    if (data.name !== undefined) bp.name = data.name;
    if (data.description !== undefined) bp.description = data.description;
    if (data.category !== undefined) bp.category = data.category;
    if (data.nodes !== undefined) bp.nodes = data.nodes;
    if (data.edges !== undefined) bp.edges = data.edges;
    if (data.status !== undefined) bp.status = data.status;
    bp.updatedAt = now();
    return bp;
  }

  private deleteBlueprint(data: { id: string }): { id: string; deleted: boolean } {
    const { id } = data;
    if (!blueprints.has(id)) throw new Error(`Blueprint not found: ${id}`);
    blueprints.delete(id);
    for (const [eid, ex] of executions) {
      if (ex.blueprintId === id) executions.delete(eid);
    }
    return { id, deleted: true };
  }

  private executeBlueprint(data: { id: string }): BlueprintExecution {
    const { id } = data;
    const bp = blueprints.get(id);
    if (!bp) throw new Error(`Blueprint not found: ${id}`);
    const exec: BlueprintExecution = {
      id: uid(),
      blueprintId: bp.id,
      status: 'running',
      startedAt: now(),
      nodeResults: {},
    };
    executions.set(exec.id, exec);
    return exec;
  }

  private listBlueprints(data: { category?: string }): Blueprint[] {
    const all = Array.from(blueprints.values());
    if (data.category) {
      return all.filter((b) => b.category === data.category);
    }
    return all;
  }

  private async executeBlueprintStream(
    id: string,
    onChunk: (chunk: any) => void
  ): Promise<void> {
    const bp = blueprints.get(id);
    if (!bp) throw new Error(`Blueprint not found: ${id}`);

    // 模拟节点逐个执行
    for (let i = 0; i < bp.nodes.length; i++) {
      const node = bp.nodes[i];
      onChunk({
        sequence: i,
        nodeId: node.id,
        type: node.type,
        status: 'running',
        config: node.config,
      });
      // 模拟执行延迟
      await new Promise((r) => setTimeout(r, 100));
      onChunk({
        sequence: i,
        nodeId: node.id,
        type: node.type,
        status: 'completed',
        result: { ok: true },
      });
    }
    onChunk({
      sequence: bp.nodes.length,
      status: 'done',
      isLast: true,
    });
  }

  // ──────────── 额外操作 ────────────

  pauseBlueprint(data: { id: string }): BlueprintExecution {
    const { id } = data;
    const bp = blueprints.get(id);
    if (!bp) throw new Error(`Blueprint not found: ${id}`);
    const list = Array.from(executions.values())
      .filter((e) => e.blueprintId === id && e.status === 'running')
      .sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt));
    if (!list.length) throw new Error('No running execution');
    list[0].status = 'paused';
    return list[0];
  }

  resumeBlueprint(data: { id: string }): BlueprintExecution {
    const { id } = data;
    const bp = blueprints.get(id);
    if (!bp) throw new Error(`Blueprint not found: ${id}`);
    const list = Array.from(executions.values())
      .filter((e) => e.blueprintId === id && e.status === 'paused')
      .sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt));
    if (!list.length) throw new Error('No paused execution');
    list[0].status = 'running';
    return list[0];
  }

  getExecutions(data: { id: string }): BlueprintExecution[] {
    const { id } = data;
    return Array.from(executions.values()).filter((e) => e.blueprintId === id);
  }
}

// ──────────── 导出 3DACP 元数据 ────────────

import { createCrudAdapter } from '../coordinator/ServiceAdapter';
import type { ServiceMetadata } from '../coordinator/TransformLayer';

export function createBlueprintMetadata(): ServiceMetadata {
  return {
    moduleId: 'blueprint',
    supportsStreaming: true,
    actionMap: {
      create: 'create',
      read: 'read',
      update: 'update',
      delete: 'delete',
      invoke: 'executeBlueprint',
      stream: 'executeBlueprintStream',
      list: 'listBlueprints',
      pause: 'pauseBlueprint',
      resume: 'resumeBlueprint',
    },
    streamActions: ['stream', 'invoke'],
  };
}

export function createBlueprintServiceAdapter(): ServiceAdapter {
  return new BlueprintService();
}
