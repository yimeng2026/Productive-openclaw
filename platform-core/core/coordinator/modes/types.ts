/**
 * ExecutionMode — 统一的 Swarm 执行模式接口
 *
 * 所有执行模式（串行/并行/层级/动态）均实现此接口，
 * 由 Unified Swarm Coordinator 在运行时根据配置调度。
 */

import { logger } from "../../utils/logger";

// ─── 核心类型 ───

export type SwarmMode =
  | "sequential"
  | "parallel"
  | "hierarchical"
  | "dynamic"
  | "hierarchical-swarm"
  | "agent-rearrange"
  | "forest-swarm"
  | "heavy-swarm"
  | "swarm-router"
  | "ruflo"
  | "multi-repo";

export type AgentStatus =
  | "idle"
  | "running"
  | "error"
  | "paused"
  | "stopped";

export type AgentHealth =
  | "healthy"
  | "degraded"
  | "unhealthy";

export type ExecutionState =
  | "idle"
  | "running"
  | "paused"
  | "stopped"
  | "completed"
  | "failed"
  | "partial";

// ─── Agent 注册信息 ───

export interface AgentRegistration {
  id: string;
  name: string;
  // 平台等级绑定
  levelA: string[];
  levelB: string;
  levelC: string;
  // Agent-Zero 集成
  agentZeroProfile?: string;
  agentZeroMode: "native" | "bridge" | "none";
  // 群组信息
  swarmId?: string;
  role: "leader" | "worker" | "solo";
  // 状态
  status: AgentStatus;
  health: AgentHealth;
  // 能力
  skills: string[];
  capabilities: string[];
  // 资源
  maxConcurrentTasks: number;
  priority: number;
  // 运行时上下文（模式内部使用）
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

// ─── 任务请求 ───

export interface TaskRequest {
  id: string;
  type: "chat" | "code" | "search" | "analysis" | "custom";
  // 目标
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
  executionMode: "solo" | "swarm";
  swarmMode?: SwarmMode;
  // 串行模式：错误处理策略
  onError?: "stop" | "skip" | "retry";
  // 并行模式：聚合策略
  aggregationStrategy?: "vote" | "merge" | "best" | "all";
  // 层级模式：最大嵌套深度
  maxDepth?: number;
  // 动态模式：负载阈值
  loadThreshold?: number;
  // 回调
  onProgress?: (delta: string) => void;
  onComplete?: (result: TaskResult) => void;
  onErrorCb?: (error: TaskError) => void;
}

// ─── 执行上下文 ───

export interface ExecutionContext {
  swarmId: string;
  sharedContext: string;
  sharedMemory: MemoryEntry[];
  // 断点续传数据
  checkpoint?: CheckpointData;
  // 运行时配置
  timeoutMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
}

export interface MemoryEntry {
  id: string;
  agentId: string;
  content: string;
  role: "system" | "user" | "assistant";
  timestamp: number;
}

export interface CheckpointData {
  taskId: string;
  completedAgentIds: string[];
  lastOutput?: string;
  lastAgentIndex?: number;
  timestamp: number;
  stateSnapshot?: Record<string, unknown>;
}

// ─── 任务结果 ───

export interface TaskResult {
  taskId: string;
  status: "success" | "partial" | "failed";
  // 聚合结果
  output: string;
  // 各 Agent 的独立结果
  agentResults: AgentResult[];
  // 元数据
  metadata: ResultMetadata;
}

export interface AgentResult {
  agentId: string;
  agentName: string;
  status: "success" | "failed" | "skipped" | "timeout" | "pending";
  output: string;
  error?: string;
  latencyMs: number;
  tokensUsed?: number;
}

export interface ResultMetadata {
  startedAt: number;
  completedAt: number;
  totalLatencyMs: number;
  agentsUsed: number;
  agentsFailed: number;
  strategy: string;
  // 层级模式专用
  subTasks?: SubTaskResult[];
  // 动态模式专用
  rebalancingEvents?: RebalancingEvent[];
  // 路由模式专用
  routingDecision?: {
    strategy: string;
    confidence: number;
    reason: string;
    alternatives: Array<{ strategy: string; confidence: number }>;
  };
}

export interface SubTaskResult {
  subTaskId: string;
  description: string;
  assignedAgentId: string;
  status: "success" | "failed" | "pending";
  output: string;
}

export interface RebalancingEvent {
  timestamp: number;
  action: "add" | "remove" | "replace";
  agentId: string;
  reason: string;
}

// ─── 任务错误 ───

export interface TaskError {
  taskId: string;
  agentId?: string;
  code: string;
  message: string;
  stack?: string;
  recoverable: boolean;
}

// ─── 执行模式接口 ───

export interface ExecutionMode {
  readonly mode: SwarmMode;
  readonly state: ExecutionState;

  /**
   * 执行任务
   * @param task  任务请求
   * @param agents  Agent 注册列表
   * @param context  执行上下文
   */
  execute(
    task: TaskRequest,
    agents: AgentRegistration[],
    context: ExecutionContext
  ): Promise<TaskResult>;

  /** 暂停执行 */
  pause(): Promise<void>;

  /** 恢复执行 */
  resume(): Promise<void>;

  /** 停止执行 */
  stop(): Promise<void>;
}

// ─── 抽象基类 ───

export abstract class BaseExecutionMode implements ExecutionMode {
  abstract readonly mode: SwarmMode;
  protected _state: ExecutionState = "idle";
  protected pausedAgents: Set<string> = new Set();
  protected abortController: AbortController | null = null;
  protected currentTaskId: string | null = null;

  get state(): ExecutionState {
    return this._state;
  }

  abstract execute(
    task: TaskRequest,
    agents: AgentRegistration[],
    context: ExecutionContext
  ): Promise<TaskResult>;

  async pause(): Promise<void> {
    if (this._state === "running") {
      this._state = "paused";
      logger.info({ mode: this.mode, taskId: this.currentTaskId }, "Execution paused");
    }
  }

  async resume(): Promise<void> {
    if (this._state === "paused") {
      this._state = "running";
      logger.info({ mode: this.mode, taskId: this.currentTaskId }, "Execution resumed");
    }
  }

  async stop(): Promise<void> {
    this._state = "stopped";
    if (this.abortController) {
      this.abortController.abort("Execution stopped by user");
    }
    logger.info({ mode: this.mode, taskId: this.currentTaskId }, "Execution stopped");
  }

  protected checkPaused(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this._state !== "paused") {
          resolve();
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });
  }

  protected createAbortController(): AbortController {
    this.abortController = new AbortController();
    return this.abortController;
  }

  protected isAborted(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }
}

// ─── 辅助函数 ───

/**
 * 调用单个 Agent 执行任务（模拟，实际集成 Agent-Zero / Provider）
 */
export async function invokeAgent(
  agent: AgentRegistration,
  task: TaskRequest,
  input: string,
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<AgentResult> {
  const startTime = Date.now();
  const effectiveTimeout = timeoutMs || task.maxLatencyMs || 30000;

  try {
    // TODO: 替换为实际的 Agent-Zero / Provider 调用
    // 当前为模拟实现
    const result = await Promise.race([
      simulateAgentExecution(agent, input),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Agent ${agent.id} timed out after ${effectiveTimeout}ms`));
        }, effectiveTimeout);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error(`Agent ${agent.id} execution aborted`));
        });
      }),
    ]);

    return {
      agentId: agent.id,
      agentName: agent.name,
      status: "success",
      output: result,
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { agentId: agent.id, taskId: task.id, error: errorMsg },
      "Agent execution failed"
    );
    return {
      agentId: agent.id,
      agentName: agent.name,
      status: "failed",
      output: "",
      error: errorMsg,
      latencyMs: Date.now() - startTime,
    };
  }
}

/**
 * 模拟 Agent 执行（占位实现）
 */
async function simulateAgentExecution(
  agent: AgentRegistration,
  input: string
): Promise<string> {
  // 模拟处理延迟
  const delay = Math.random() * 500 + 200;
  await new Promise((resolve) => setTimeout(resolve, delay));

  // 模拟健康检查失败
  if (agent.health === "unhealthy") {
    throw new Error(`Agent ${agent.id} is unhealthy`);
  }

  return `[${agent.name}] Processed: ${input.slice(0, 100)}${input.length > 100 ? "..." : ""}`;
}

/**
 * 检查 Agent 是否可用
 */
export function isAgentAvailable(agent: AgentRegistration): boolean {
  return agent.status !== "error" && agent.health !== "unhealthy";
}

/**
 * 生成任务结果
 */
export function buildTaskResult(
  taskId: string,
  agentResults: AgentResult[],
  output: string,
  status: "success" | "partial" | "failed",
  strategy: string,
  extra?: Partial<ResultMetadata>
): TaskResult {
  const failed = agentResults.filter((r) => r.status === "failed").length;
  const totalLatency = agentResults.reduce((sum, r) => sum + r.latencyMs, 0);

  return {
    taskId,
    status,
    output,
    agentResults,
    metadata: {
      startedAt: 0, // 由调用方填充
      completedAt: Date.now(),
      totalLatencyMs: totalLatency,
      agentsUsed: agentResults.length,
      agentsFailed: failed,
      strategy,
      ...extra,
    },
  };
}

/**
 * 保存检查点（断点续传）
 */
export function saveCheckpoint(
  context: ExecutionContext,
  data: Partial<CheckpointData>
): CheckpointData {
  const checkpoint: CheckpointData = {
    taskId: context.checkpoint?.taskId || "",
    completedAgentIds: context.checkpoint?.completedAgentIds || [],
    timestamp: Date.now(),
    ...data,
  };
  return checkpoint;
}
