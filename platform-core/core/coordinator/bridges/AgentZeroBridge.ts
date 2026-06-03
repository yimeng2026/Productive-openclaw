/**
 * @file AgentZeroBridge.ts
 * @description Agent-Zero 深度集成桥接模块
 *   连接 Sylva Backend (Node.js) 和 Agent-Zero (Python/FastAPI)
 *   提供 Agent 注册、状态同步、任务路由、记忆共享等双向通信能力
 */

import { logger } from "../../utils/logger";

// ============================================================================
// 类型定义
// ============================================================================

/** Agent 注册信息 */
export interface AgentRegistration {
  id: string;
  name: string;
  model?: string;
  systemPrompt?: string;
  skills?: string[];
  capabilities?: string[];
  maxConcurrentTasks?: number;
  priority?: number;
}

/** Agent 状态 */
export interface AgentZeroStatus {
  agentId: string;
  status: "idle" | "running" | "error" | "paused";
  currentTask?: string;
  output?: string;
  health: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
}

/** 任务请求 */
export interface ZeroTaskRequest {
  id?: string;
  agentId?: string;
  prompt: string;
  context?: Record<string, unknown>;
  attachments?: string[];
  requireStreaming?: boolean;
  maxLatencyMs?: number;
}

/** 任务结果 */
export interface ZeroTaskResult {
  taskId: string;
  agentId: string;
  status: "pending" | "running" | "completed" | "failed";
  output?: string;
  error?: string;
  durationMs?: number;
  timestamp: string;
}

/** 记忆条目 */
export interface ZeroMemoryEntry {
  id?: string;
  content: string;
  tags?: string[];
  timestamp?: string;
}

/** AgentZeroBridge 配置 */
export interface AgentZeroBridgeConfig {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  wsEnabled: boolean;
  wsUrl?: string;
}

/** 桥接错误 */
export class AgentZeroBridgeError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly retryable: boolean;

  constructor(
    message: string,
    code: string,
    statusCode?: number,
    retryable = false
  ) {
    super(message);
    this.name = "AgentZeroBridgeError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

// ============================================================================
// 常量
// ============================================================================

const DEFAULT_CONFIG: AgentZeroBridgeConfig = {
  baseUrl: process.env.AGENT_ZERO_URL || "http://localhost:8000",
  timeoutMs: Number(process.env.AGENT_ZERO_TIMEOUT || "30000"),
  maxRetries: Number(process.env.AGENT_ZERO_MAX_RETRIES || "3"),
  retryDelayMs: Number(process.env.AGENT_ZERO_RETRY_DELAY || "1000"),
  wsEnabled: process.env.AGENT_ZERO_WS_ENABLED === "true",
  wsUrl: process.env.AGENT_ZERO_WS_URL || "ws://localhost:8000/ws",
};

const RETRYABLE_STATUS_CODES = new Set([408, 429, 502, 503, 504]);

// ============================================================================
// AgentZeroBridge 类
// ============================================================================

export class AgentZeroBridge {
  private config: AgentZeroBridgeConfig;
  private ws: WebSocket | null = null;
  private stateListeners: Array<(update: AgentZeroStatus) => void> = [];

  constructor(config?: Partial<AgentZeroBridgeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info(
      { baseUrl: this.config.baseUrl },
      "AgentZeroBridge initialized"
    );
  }

  // ==========================================================================
  // 核心 API 方法
  // ==========================================================================

  /**
   * 注册 Agent 到 Agent-Zero
   * @param agent - Agent 注册信息
   * @returns 注册结果
   */
  async registerAgent(agent: AgentRegistration): Promise<{ success: boolean; agentId: string }> {
    const body = {
      id: agent.id,
      name: agent.name,
      model: agent.model,
      system_prompt: agent.systemPrompt,
      skills: agent.skills,
      capabilities: agent.capabilities,
      max_concurrent_tasks: agent.maxConcurrentTasks ?? 1,
      priority: agent.priority ?? 0,
    };

    const result = await this.request<{
      success: boolean;
      agent_id: string;
    }>("POST", "/api/agents", body);

    return { success: result.success, agentId: result.agent_id };
  }

  /**
   * 获取 Agent 状态
   * @param agentId - Agent ID
   * @returns Agent 状态
   */
  async getAgentStatus(agentId: string): Promise<AgentZeroStatus> {
    const result = await this.request<{
      agent_id: string;
      status: string;
      current_task?: string;
      output?: string;
      health: string;
      timestamp: string;
    }>("GET", `/api/agents/${encodeURIComponent(agentId)}/status`);

    return {
      agentId: result.agent_id,
      status: result.status as AgentZeroStatus["status"],
      currentTask: result.current_task,
      output: result.output,
      health: result.health as AgentZeroStatus["health"],
      timestamp: result.timestamp,
    };
  }

  /**
   * 路由任务到 Agent-Zero
   * @param task - 任务请求
   * @returns 任务结果
   */
  async routeTask(task: ZeroTaskRequest): Promise<ZeroTaskResult> {
    const body = {
      task_id: task.id || crypto.randomUUID(),
      agent_id: task.agentId,
      prompt: task.prompt,
      context: task.context,
      attachments: task.attachments,
      require_streaming: task.requireStreaming,
      max_latency_ms: task.maxLatencyMs,
    };

    const result = await this.request<{
      task_id: string;
      agent_id: string;
      status: string;
      output?: string;
      error?: string;
      duration_ms?: number;
      timestamp: string;
    }>("POST", "/api/tasks", body);

    return {
      taskId: result.task_id,
      agentId: result.agent_id,
      status: result.status as ZeroTaskResult["status"],
      output: result.output,
      error: result.error,
      durationMs: result.duration_ms,
      timestamp: result.timestamp,
    };
  }

  /**
   * 同步记忆到 Agent-Zero 上下文
   * @param agentId - Agent ID
   * @param memories - 记忆条目列表
   * @returns 同步结果
   */
  async syncMemory(
    agentId: string,
    memories: ZeroMemoryEntry[]
  ): Promise<{ success: boolean; synced: number }> {
    const body = {
      agent_id: agentId,
      memories: memories.map((m) => ({
        id: m.id || crypto.randomUUID(),
        content: m.content,
        tags: m.tags || [],
        timestamp: m.timestamp || new Date().toISOString(),
      })),
    };

    const result = await this.request<{
      success: boolean;
      synced: number;
    }>("POST", `/api/agents/${encodeURIComponent(agentId)}/context`, body);

    return { success: result.success, synced: result.synced };
  }

  /**
   * 获取 Agent-Zero 任务输出
   * @param taskId - 任务 ID
   * @returns 任务结果
   */
  async getZeroOutput(taskId: string): Promise<ZeroTaskResult> {
    const result = await this.request<{
      task_id: string;
      agent_id: string;
      status: string;
      output?: string;
      error?: string;
      duration_ms?: number;
      timestamp: string;
    }>("GET", `/api/tasks/${encodeURIComponent(taskId)}`);

    return {
      taskId: result.task_id,
      agentId: result.agent_id,
      status: result.status as ZeroTaskResult["status"],
      output: result.output,
      error: result.error,
      durationMs: result.duration_ms,
      timestamp: result.timestamp,
    };
  }

  // ==========================================================================
  // WebSocket 状态同步（可选）
  // ==========================================================================

  /**
   * 连接 Agent-Zero WebSocket 用于实时状态推送
   */
  connectWebSocket(): void {
    if (!this.config.wsEnabled || !this.config.wsUrl) return;

    try {
      this.ws = new WebSocket(this.config.wsUrl);

      this.ws.onopen = () => {
        logger.info("AgentZeroBridge WebSocket connected");
      };

      this.ws.onmessage = (event) => {
        try {
          const update = JSON.parse(event.data as string) as AgentZeroStatus;
          this.stateListeners.forEach((fn) => fn(update));
        } catch {
          logger.warn({ data: event.data }, "Invalid WebSocket message");
        }
      };

      this.ws.onerror = (err) => {
        logger.error({ err }, "AgentZeroBridge WebSocket error");
      };

      this.ws.onclose = () => {
        logger.info("AgentZeroBridge WebSocket disconnected");
        this.ws = null;
        // 自动重连
        if (this.config.wsEnabled) {
          setTimeout(() => this.connectWebSocket(), this.config.retryDelayMs);
        }
      };
    } catch (err) {
      logger.error({ err }, "Failed to connect AgentZeroBridge WebSocket");
    }
  }

  /**
   * 断开 WebSocket
   */
  disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * 订阅状态更新
   * @param listener - 状态更新回调
   * @returns 取消订阅函数
   */
  onStateUpdate(listener: (update: AgentZeroStatus) => void): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter((fn) => fn !== listener);
    };
  }

  // ==========================================================================
  // 内部 HTTP 请求 + 重试机制
  // ==========================================================================

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeoutMs
        );

        const fetchOptions: RequestInit = {
          method,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          signal: controller.signal,
        };

        if (body && method !== "GET") {
          fetchOptions.body = JSON.stringify(body);
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);

        if (!response.ok) {
          const statusCode = response.status;
          const errorText = await response.text().catch(() => "Unknown error");
          throw new AgentZeroBridgeError(
            `Agent-Zero API error: ${statusCode} - ${errorText}`,
            "API_ERROR",
            statusCode,
            RETRYABLE_STATUS_CODES.has(statusCode)
          );
        }

        const data = (await response.json()) as T;
        logger.debug({ method, path, attempt }, "AgentZeroBridge request success");
        return data;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        const isRetryable =
          err instanceof AgentZeroBridgeError
            ? err.retryable
            : err instanceof TypeError || // 网络错误
              (err instanceof Error && err.name === "AbortError"); // 超时

        if (!isRetryable || attempt === this.config.maxRetries - 1) {
          break;
        }

        const delay = this.config.retryDelayMs * Math.pow(2, attempt);
        logger.warn(
          { method, path, attempt, delayMs: delay, error: lastError.message },
          "AgentZeroBridge request retry"
        );
        await sleep(delay);
      }
    }

    logger.error(
      { method, path, error: lastError?.message },
      "AgentZeroBridge request failed after retries"
    );
    throw new AgentZeroBridgeError(
      lastError?.message || "Request failed",
      "REQUEST_FAILED",
      undefined,
      false
    );
  }
}

// ============================================================================
// 工具函数
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// 单例导出
// ============================================================================

export const agentZeroBridge = new AgentZeroBridge();
