// types.ts — SYLVA Unified Coordinator 类型定义
// 对应架构文档: Agent_Integration_Architecture_v2.md

// ─────────────────────────────────────────────
// Agent 注册中心
// ─────────────────────────────────────────────

export type AgentStatus = 'idle' | 'running' | 'error' | 'paused';
export type AgentHealth = 'healthy' | 'degraded' | 'unhealthy';
export type AgentRole = 'leader' | 'worker' | 'solo';
export type AgentZeroMode = 'native' | 'bridge' | 'none';
export type LevelBAccessLayer = 'mega' | 'sylva' | 'agentzero';
export type LevelCRuntime = 'openclaw' | 'sylva' | 'stepclaw' | 'kimi-desktop' | 'chatclaw' | 'bloomgarden' | 'qclaw' | 'minimax' | 'modelscope';

// 模型能力定义（从 ContextBudgetManager 重新导出）
import type { ModelCapability, ContextBudget } from './ContextBudgetManager';
export type { ModelCapability, ContextBudget };

export interface AgentRegistration {
  id: string;
  name: string;

  // 平台等级绑定
  levelA: string[];
  levelB: LevelBAccessLayer;
  levelC: LevelCRuntime;

  // Agent-Zero 集成
  agentZeroProfile?: string;
  agentZeroMode: AgentZeroMode;

  // 群组信息
  swarmId?: string;
  role: AgentRole;

  // 状态
  status: AgentStatus;
  health: AgentHealth;
  lastHealthCheckAt?: number;

  // 能力
  skills: string[];
  capabilities: string[];

  // 资源
  maxConcurrentTasks: number;
  priority: number;

  // 扩展配置
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  config?: Record<string, unknown>;

  // 模型上下文预算（新增）
  modelCapability?: ModelCapability;
  contextBudget?: ContextBudget;

  createdAt: number;
  updatedAt: number;
}

// ─────────────────────────────────────────────
// 任务路由
// ─────────────────────────────────────────────

export type TaskType = 'chat' | 'code' | 'search' | 'analysis' | 'custom';
export type ExecutionMode = 'solo' | 'swarm';
export type SwarmMode = 'sequential' | 'parallel' | 'hierarchical' | 'dynamic';
export type RoutingStrategy = 'priority' | 'cost' | 'latency' | 'balanced' | 'round_robin';

export interface TaskRequest {
  id: string;
  type: TaskType;

  // 目标指定
  targetAgent?: string;
  targetSwarm?: string;

  // 内容
  prompt: string;
  context?: Record<string, unknown>;
  attachments?: string[];

  // 约束
  requireStreaming?: boolean;
  requireVision?: boolean;
  requireToolUse?: boolean;
  maxLatencyMs?: number;

  // 策略
  executionMode: ExecutionMode;
  swarmMode?: SwarmMode;
  routingStrategy?: RoutingStrategy;

  // 回调
  onProgress?: (delta: string) => void;
  onComplete?: (result: TaskResult) => void;
  onError?: (error: Error) => void;
}

export type TaskState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskResult {
  taskId: string;
  agentId: string;
  state: TaskState;
  output?: string;
  error?: string;
  latencyMs?: number;
  tokensUsed?: number;
  createdAt: number;
  completedAt?: number;
}

export interface TaskError {
  taskId: string;
  agentId?: string;
  error: string;
  code?: string;
  timestamp: number;
}

// ─────────────────────────────────────────────
// Swarm 状态
// ─────────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  agentId: string;
  content: string;
  tags: string[];
  timestamp: number;
}

export interface SwarmState {
  id: string;
  name: string;

  // 成员
  agents: string[]; // Agent IDs
  leader?: string;

  // 任务状态
  activeTasks: Map<string, TaskResult>;
  completedTasks: TaskResult[];
  failedTasks: TaskError[];

  // 共享记忆
  sharedContext: string;
  sharedMemory: MemoryEntry[];

  // 配置
  mode: SwarmMode;
  maxDepth: number;
  syncIntervalMs: number;

  createdAt: number;
  updatedAt: number;
}

// ─────────────────────────────────────────────
// 消息总线
// ─────────────────────────────────────────────

export type MessageType =
  | 'agent.register'
  | 'agent.unregister'
  | 'agent.heartbeat'
  | 'agent.status_change'
  | 'task.assigned'
  | 'task.progress'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'swarm.sync'
  | 'swarm.join'
  | 'swarm.leave'
  | 'custom';

export interface AgentMessage {
  id: string;
  type: MessageType;
  source: string; // Agent ID or 'coordinator'
  target?: string; // Agent ID or broadcast
  payload: Record<string, unknown>;
  timestamp: number;
  correlationId?: string;
}

export type MessageHandler = (message: AgentMessage) => void | Promise<void>;

export type MessageBusBackend = 'local' | 'redis' | 'websocket';

export interface MessageBusOptions {
  backend: MessageBusBackend;
  redisUrl?: string;
  websocketUrl?: string;
}

// ─────────────────────────────────────────────
// 健康检查
// ─────────────────────────────────────────────

export interface HealthCheckResult {
  agentId: string;
  healthy: boolean;
  latencyMs: number;
  details?: Record<string, unknown>;
  checkedAt: number;
}

// ─────────────────────────────────────────────
// 创建 Agent 请求 / 响应
// ─────────────────────────────────────────────

export interface CreateAgentRequest {
  name: string;
  providers: {
    id: string;
    priority: number;
    model?: string;
  }[];
  accessLayer?: LevelBAccessLayer;
  routingStrategy?: RoutingStrategy;
  runtime?: LevelCRuntime;
  agentZero?: {
    enabled: boolean;
    mode: 'native' | 'bridge';
    profile?: string;
    skills?: string[];
  };
  swarm?: {
    swarmId?: string;
    createNew?: boolean;
    role?: 'leader' | 'worker';
  };
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  skills?: string[];
  maxConcurrentTasks?: number;
}

export interface CreateAgentResponse {
  agent: AgentRegistration;
  swarm?: SwarmState;
  healthCheck: boolean;
  providerStatus: Record<string, boolean>;
}
