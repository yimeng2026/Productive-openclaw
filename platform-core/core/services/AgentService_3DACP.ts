/**
 * AgentService — 3DACP 接入层
 * Agent CRUD + 状态管理 + Provider 桥接
 */

import { ServiceAdapter } from '../coordinator/ServiceAdapter';
import { AgentRepository } from '../database/repositories/AgentRepository';
import { TaskRepository } from '../database/repositories/TaskRepository';
import { getMegaProviderBridge } from '../coordinator/bridges';
import type { AgentStatus, AgentRole, LevelBAccessLayer, LevelCRuntime } from '../coordinator/unified/types';

const agentRepo = new AgentRepository();
const taskRepo = new TaskRepository();

async function enrichAgent(agent: any) {
  const tasks = await taskRepo.findByAgent(agent.id);
  const runningTasks = tasks.filter((t: any) => t.state === 'running');
  const providerStatus: Record<string, boolean> = {};
  const bridge = getMegaProviderBridge();
  for (const pid of agent.levelA || []) {
    try {
      const health = await bridge.checkHealth(pid);
      providerStatus[pid] = health.healthy;
    } catch {
      providerStatus[pid] = false;
    }
  }
  return {
    ...agent,
    taskCount: tasks.length,
    runningTaskCount: runningTasks.length,
    lastActive: agent.updatedAt || agent.createdAt,
    providerStatus,
  };
}

export class AgentService extends ServiceAdapter {
  constructor() {
    super({ moduleId: 'agent', supportsStreaming: false });
  }

  protected async handleAction(action: string, data: unknown): Promise<unknown> {
    switch (action) {
      case 'create':
        return this.createAgent(data as Record<string, unknown>);
      case 'read':
        return this.readAgent(data as { id?: string; status?: string; health?: string; role?: string; skill?: string });
      case 'update':
        return this.updateAgent(data as { id: string } & Record<string, unknown>);
      case 'delete':
        return this.deleteAgent(data as { id: string });
      case 'invoke':
        return this.invokeAgent(data as { id: string; action: string; payload?: unknown });
      default:
        throw new Error(`AgentService: unsupported action '${action}'`);
    }
  }

  private async createAgent(data: Record<string, unknown>): Promise<unknown> {
    const { name, levelA, levelB, levelC, role, skills, systemPrompt, temperature, maxTokens, maxConcurrentTasks } = data;
    if (!name) throw new Error('name is required');
    const agent = await agentRepo.create({
      id: `agent_${Date.now()}`,
      name: name as string,
      levelA: levelA as string[],
      levelB: (levelB as LevelBAccessLayer) ?? 'mega',
      levelC: (levelC as LevelCRuntime) ?? 'openclaw',
      agentZeroMode: 'none',
      role: (role as AgentRole) ?? 'solo',
      skills: skills as string[],
      systemPrompt: systemPrompt as string,
      temperature: temperature as number,
      maxTokens: maxTokens as number,
      maxConcurrentTasks: maxConcurrentTasks as number,
      status: 'running' as AgentStatus,
      health: 'healthy',
      capabilities: [],
      priority: 1,
      modelCapability: null,
      contextBudget: null,
      config: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return enrichAgent(agent);
  }

  private async readAgent(data: { id?: string; status?: string; health?: string; role?: string; skill?: string }): Promise<unknown> {
    if (data.id) {
      const agent = await agentRepo.findById(data.id);
      if (!agent) throw new Error(`Agent not found: ${data.id}`);
      return enrichAgent(agent);
    }
    let agents: any[];
    if (data.status) agents = await agentRepo.findByStatus(data.status as any);
    else if (data.health) agents = await agentRepo.findByHealth(data.health as any);
    else if (data.role) agents = await agentRepo.findByRole(data.role as any);
    else if (data.skill) agents = await agentRepo.findBySkill(data.skill);
    else agents = await agentRepo.findAll();
    return Promise.all(agents.map(enrichAgent));
  }

  private async updateAgent(data: { id: string } & Record<string, unknown>): Promise<unknown> {
    const agent = await agentRepo.findById(data.id);
    if (!agent) throw new Error(`Agent not found: ${data.id}`);
    const updated = await agentRepo.update(data.id, data as any);
    return enrichAgent(updated);
  }

  private async deleteAgent(data: { id: string }): Promise<{ id: string; deleted: boolean }> {
    const agent = await agentRepo.findById(data.id);
    if (!agent) throw new Error(`Agent not found: ${data.id}`);
    await agentRepo.delete(data.id);
    return { id: data.id, deleted: true };
  }

  private async invokeAgent(data: { id: string; action: string; payload?: unknown }): Promise<unknown> {
    const { id, action: agentAction, payload } = data;
    const agent = await agentRepo.findById(id);
    if (!agent) throw new Error(`Agent not found: ${id}`);
    // 根据 action 分发
    switch (agentAction) {
      case 'chat':
        return { agentId: id, action: agentAction, payload };
      case 'execute':
        return { agentId: id, action: agentAction, payload, status: 'started' };
      default:
        return { agentId: id, action: agentAction, payload };
    }
  }
}

export function createAgentServiceAdapter(): AgentService {
  return new AgentService();
}
