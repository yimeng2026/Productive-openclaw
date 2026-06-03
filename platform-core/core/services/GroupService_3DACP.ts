/**
 * GroupService — 3DACP 接入层
 * 群组管理、开会、接力、重组、健康检查
 */

import { ServiceAdapter } from '../coordinator/ServiceAdapter';
import type { AxisMessage, AxisStreamChunk } from '../coordinator/AxisMessage';

interface GroupMember {
  id: string; name: string; role: string;
  status: "online" | "offline" | "busy";
  avatarType?: string; accentColor?: string; currentTask?: string;
}

interface GroupTask {
  id: string; title: string;
  status: "pending" | "in_progress" | "completed";
  assigneeId: string; priority: "high" | "medium" | "low"; progress: number;
}

interface GroupState {
  id: string; name: string;
  type: "sequential" | "parallel" | "hierarchical" | "dynamic";
  status: "active" | "paused" | "completed";
  description: string;
  members: GroupMember[];
  tasks: GroupTask[];
  meetings: any[];
  relays: any[];
  conflicts: any[];
  health: { overall: "healthy" | "degraded" | "unhealthy"; lastCheck: string; issues: string[] };
  hierarchy: { level: number; parentId?: string; children: string[] };
}

const groups = new Map<string, GroupState>();
const uid = () => `grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const now = () => new Date().toISOString();

export class GroupService extends ServiceAdapter {
  constructor() {
    super({ moduleId: 'group', supportsStreaming: true });
  }

  protected async handleAction(action: string, data: unknown): Promise<unknown> {
    switch (action) {
      case 'create': return this.createGroup(data as Partial<GroupState>);
      case 'read': return this.readGroup(data as { id?: string });
      case 'update': return this.updateGroup(data as { id: string } & Partial<GroupState>);
      case 'delete': return this.deleteGroup(data as { id: string });
      case 'invoke': return this.orchestrate(data as { id: string; command: string });
      default: throw new Error(`GroupService: unsupported action '${action}'`);
    }
  }

  protected async handleStreamingAction(
    action: string, data: unknown, _msg: AxisMessage,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void> {
    if (action === 'stream') {
      const { id } = data as { id: string };
      return this.orchestrateStream(id, onChunk);
    }
    throw new Error(`GroupService: streaming action '${action}' not supported`);
  }

  private createGroup(data: Partial<GroupState>): GroupState {
    const g: GroupState = {
      id: uid(), name: data.name || 'New Group', type: data.type || 'sequential',
      status: 'active', description: data.description || '',
      members: data.members || [], tasks: data.tasks || [],
      meetings: [], relays: [], conflicts: [],
      health: { overall: 'healthy', lastCheck: now(), issues: [] },
      hierarchy: { level: 1, children: [] },
    };
    groups.set(g.id, g);
    return g;
  }

  private readGroup(data: { id?: string }): unknown {
    if (data.id) {
      const g = groups.get(data.id);
      if (!g) throw new Error(`Group not found: ${data.id}`);
      return g;
    }
    return Array.from(groups.values());
  }

  private updateGroup(data: { id: string } & Partial<GroupState>): GroupState {
    const g = groups.get(data.id);
    if (!g) throw new Error(`Group not found: ${data.id}`);
    Object.assign(g, data);
    return g;
  }

  private deleteGroup(data: { id: string }): { id: string; deleted: boolean } {
    if (!groups.has(data.id)) throw new Error(`Group not found: ${data.id}`);
    groups.delete(data.id);
    return { id: data.id, deleted: true };
  }

  private async orchestrate(data: { id: string; command: string }): Promise<unknown> {
    const g = groups.get(data.id);
    if (!g) throw new Error(`Group not found: ${data.id}`);
    return { groupId: data.id, command: data.command, status: 'executed', members: g.members.length };
  }

  private async orchestrateStream(id: string, onChunk: (chunk: AxisStreamChunk) => void): Promise<void> {
    const g = groups.get(id);
    if (!g) throw new Error(`Group not found: ${id}`);
    for (let i = 0; i < g.members.length; i++) {
      onChunk({ streamId: `group-${id}`, sequence: i, isLast: false, chunk: { member: g.members[i], status: 'active' } });
      await new Promise(r => setTimeout(r, 100));
    }
    onChunk({ streamId: `group-${id}`, sequence: g.members.length, isLast: true, chunk: { status: 'orchestration_complete' } });
  }
}

export function createGroupServiceAdapter(): GroupService {
  return new GroupService();
}
