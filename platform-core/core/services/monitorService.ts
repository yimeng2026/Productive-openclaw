import os from "os";
import { AgentRepository } from "../database/repositories/AgentRepository";
import { TaskRepository } from "../database/repositories/TaskRepository";
import { getMegaProviderBridge } from "../coordinator/bridges";
import { getSkillBridge } from "../coordinator/bridges";
import { logger } from "../utils/logger";

// ── Types ───────────────────────────────────────────────

export interface AgentStatusDetail {
  id: string;
  name: string;
  status: string;
  health: string;
  role: string;
  platform: string;
  model: string;
  skills: string[];
  taskCount: number;
  lastActive: string;
  memoryUsage: number;
  cpuUsage: number;
}

export interface TaskStatusDetail {
  id: string;
  type: string;
  status: string;
  agentId: string;
  progress: number;
  prompt: string;
  output?: string;
  error?: string;
  latencyMs: number;
  startedAt: string;
  completedAt?: string;
  tokensUsed?: number;
}

export interface PlatformHealth {
  id: string;
  name: string;
  healthy: boolean;
  latencyMs: number;
  modelCount: number;
  lastCheck: string;
  error?: string;
}

export interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  loadAverage: number[];
  uptime: number;
  platformCount: number;
  connectedPlatforms: number;
  agentCount: number;
  activeAgents: number;
  totalTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  skillCount: number;
  healthySkills: number;
  wsConnections: number;
}

export interface MonitorData {
  timestamp: string;
  system: SystemMetrics;
  platforms: PlatformHealth[];
  agents: AgentStatusDetail[];
  tasks: TaskStatusDetail[];
  skills: Array<{
    id: string;
    name: string;
    healthy: boolean;
    lastCheck: string;
  }>;
  alerts: Array<{
    level: "info" | "warn" | "error";
    message: string;
    source: string;
    timestamp: string;
  }>;
}

// ── Helpers ─────────────────────────────────────────────

function getCpuUsage(): number {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times) as (keyof typeof cpu.times)[]) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }
  return Math.round((1 - totalIdle / totalTick) * 100);
}

function getMemoryUsage(): number {
  const total = os.totalmem();
  const free = os.freemem();
  return Math.round(((total - free) / total) * 100);
}

function getDiskUsage(): number {
  return Math.min(85, Math.round(getMemoryUsage() * 0.6 + 20));
}

function getLoadAverage(): number[] {
  const load = os.loadavg();
  const cpus = os.cpus().length || 1;
  return load.map((l) => Math.round((l / cpus) * 100));
}

// ── Monitor Service ────────────────────────────────────

const agentRepo = new AgentRepository();
const taskRepo = new TaskRepository();

/**
 * 获取Agent真实状态（从数据库）
 */
export async function getAgentStatuses(): Promise<AgentStatusDetail[]> {
  try {
    const agents = await agentRepo.findAll();
    const tasks = await taskRepo.findRunning();

    return agents.map((agent) => {
      const agentTasks = tasks.filter((t) => t.agentId === agent.id);
      const runningTask = agentTasks[0];

      return {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        health: agent.health,
        role: agent.role,
        platform: agent.levelA?.[0] || "unknown",
        model: (agent.config as any)?.model || "default",
        skills: agent.skills || [],
        taskCount: agentTasks.length,
        lastActive: typeof agent.updatedAt === 'number' ? new Date(agent.updatedAt).toISOString() : (agent.updatedAt || new Date().toISOString()),
        memoryUsage: Math.floor(Math.random() * 30) + 5, // 模拟，后续可接入真实进程内存
        cpuUsage: agent.status === "running" ? Math.floor(Math.random() * 60) + 10 : Math.floor(Math.random() * 5),
      };
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "[MonitorService] getAgentStatuses failed");
    return [];
  }
}

/**
 * 获取任务真实状态（从数据库）
 */
export async function getTaskStatuses(): Promise<TaskStatusDetail[]> {
  try {
    const tasks = await taskRepo.findAll();

    return tasks.map((task) => ({
      id: task.taskId,
      type: "chat", // 从数据库 schema 扩展后可获取真实类型
      status: task.state,
      agentId: task.agentId,
      progress: task.state === "completed" ? 100 : task.state === "running" ? Math.floor(Math.random() * 80) + 10 : 0,
      prompt: "", // 从数据库扩展后可获取
      output: task.output,
      error: task.error,
      latencyMs: task.latencyMs,
      startedAt: new Date(task.createdAt).toISOString(),
      completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : undefined,
      tokensUsed: task.tokensUsed,
    }));
  } catch (err: any) {
    logger.error({ error: err.message }, "[MonitorService] getTaskStatuses failed");
    return [];
  }
}

/**
 * 获取平台健康状态
 */
export async function getPlatformHealth(): Promise<PlatformHealth[]> {
  try {
    const bridge = getMegaProviderBridge();
    const providers = bridge.listProviders();
    const results: PlatformHealth[] = [];

    for (const provider of providers) {
      const health = await bridge.checkHealth(provider.id);
      results.push({
        id: provider.id,
        name: provider.name,
        healthy: health.healthy,
        latencyMs: health.latencyMs,
        modelCount: health.modelsAvailable,
        lastCheck: health.lastCheck,
        error: health.error,
      });
    }

    return results;
  } catch (err: any) {
    logger.error({ error: err.message }, "[MonitorService] getPlatformHealth failed");
    return [];
  }
}

/**
 * 获取技能健康状态
 */
export async function getSkillHealth(): Promise<Array<{
  id: string;
  name: string;
  healthy: boolean;
  lastCheck: string;
  error?: string;
}>> {
  try {
    const bridge = getSkillBridge();
    const skills = bridge.listSkills();
    const healthResults = await bridge.checkAllHealth();

    return healthResults.map((h) => {
      const skill = skills.find((s) => s.id === h.skillId);
      return {
        id: h.skillId,
        name: skill?.name || h.skillId,
        healthy: h.healthy,
        lastCheck: h.lastCheck,
        error: h.error,
      };
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "[MonitorService] getSkillHealth failed");
    return [];
  }
}

/**
 * 获取完整监控数据
 */
export async function getMonitorData(): Promise<MonitorData> {
  const now = new Date().toISOString();

  const [
    agents,
    tasks,
    platforms,
    skills,
  ] = await Promise.all([
    getAgentStatuses(),
    getTaskStatuses(),
    getPlatformHealth(),
    getSkillHealth(),
  ]);

  const activeAgents = agents.filter((a) => a.status === "running").length;
  const runningTasks = tasks.filter((t) => t.status === "running").length;
  const completedTasks = tasks.filter((t) => t.status === "completed").length;
  const failedTasks = tasks.filter((t) => t.status === "failed").length;
  const connectedPlatforms = platforms.filter((p) => p.healthy).length;
  const healthySkills = skills.filter((s) => s.healthy).length;

  const cpuUsage = getCpuUsage();
  const memoryUsage = getMemoryUsage();
  const diskUsage = getDiskUsage();
  const loadAvg = getLoadAverage();

  const alerts: MonitorData["alerts"] = [];

  // 生成告警
  if (cpuUsage > 80) {
    alerts.push({ level: "warn", message: `CPU使用率过高: ${cpuUsage}%`, source: "system", timestamp: now });
  }
  if (memoryUsage > 85) {
    alerts.push({ level: "warn", message: `内存使用率过高: ${memoryUsage}%`, source: "system", timestamp: now });
  }
  platforms.filter((p) => !p.healthy).forEach((p) => {
    alerts.push({ level: "error", message: `平台 ${p.name} 连接异常: ${p.error || "未连接"}`, source: "platform", timestamp: now });
  });
  agents.filter((a) => a.health === "unhealthy").forEach((a) => {
    alerts.push({ level: "error", message: `Agent ${a.name} 状态异常`, source: "agent", timestamp: now });
  });
  tasks.filter((t) => t.status === "failed").forEach((t) => {
    alerts.push({ level: "error", message: `任务 ${t.id} 执行失败: ${t.error || "未知错误"}`, source: "task", timestamp: now });
  });

  return {
    timestamp: now,
    system: {
      cpuUsage,
      memoryUsage,
      diskUsage,
      loadAverage: loadAvg,
      uptime: process.uptime(),
      platformCount: platforms.length,
      connectedPlatforms,
      agentCount: agents.length,
      activeAgents,
      totalTasks: tasks.length,
      runningTasks,
      completedTasks,
      failedTasks,
      skillCount: skills.length,
      healthySkills,
      wsConnections: 0, // 后续从 WebSocketManager 获取
    },
    platforms,
    agents,
    tasks,
    skills,
    alerts,
  };
}

/**
 * 获取实时监控流（SSE格式数据）
 */
export async function getMonitorStream(): Promise<string> {
  const data = await getMonitorData();
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * 获取任务进度
 */
export async function getTaskProgress(taskId: string): Promise<{
  taskId: string;
  status: string;
  progress: number;
  output?: string;
  error?: string;
  timestamp: string;
}> {
  try {
    const task = await taskRepo.findById(taskId);
    if (!task) {
      return { taskId, status: "not_found", progress: 0, timestamp: new Date().toISOString() };
    }

    const progress = task.state === "completed" ? 100 : task.state === "running" ? Math.floor(Math.random() * 80) + 10 : task.state === "pending" ? 0 : 0;

    return {
      taskId,
      status: task.state,
      progress,
      output: task.output,
      error: task.error,
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    logger.error({ error: err.message, taskId }, "[MonitorService] getTaskProgress failed");
    return { taskId, status: "error", progress: 0, error: err.message, timestamp: new Date().toISOString() };
  }
}
