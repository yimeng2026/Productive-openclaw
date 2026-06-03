/**
 * @file HermesBridge.ts
 * @description Hermes 记忆系统桥接模块 — 可选插件模式
 *   支持三种运行模式：
 *   - disabled: 完全禁用，所有方法返回空/错误提示（默认）
 *   - local:    通过子进程调用本地 hermes-cli.ts（仅本地开发）
 *   - remote:   通过 HTTP API 连接外部 Hermes 服务（生产/服务器部署）
 *   
 *   设计原则：sylva_platform 作为独立部署平台，不应硬依赖本地 OpenClaw。
 *   本地 Hermes Memory Cycle（06:03 自动执行）只在启用 local 模式时生效。
 */

import { spawn } from "child_process";
import { logger } from "../../utils/logger";

// ============================================================================
// 类型定义
// ============================================================================

/** 记忆查询结果 */
export interface HermesMemoryEntry {
  id: string;
  agentId: string;
  content: string;
  tags: string[];
  timestamp: string;
  relevance?: number;
}

/** 记忆存储请求 */
export interface HermesStoreRequest {
  agentId: string;
  content: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/** 记忆查询请求 */
export interface HermesQueryRequest {
  agentId: string;
  limit?: number;
  query?: string;
  tags?: string[];
}

/** 技能信息 */
export interface HermesSkillInfo {
  id: string;
  name: string;
  description?: string;
  version?: string;
  entry?: string;
}

/** 运行模式 */
export type HermesMode = "disabled" | "local" | "remote";

/** HermesBridge 配置 */
export interface HermesBridgeConfig {
  /** 运行模式：disabled（默认）| local | remote */
  mode: HermesMode;
  
  // --- local 模式配置 ---
  /** 本地 hermes-cli.ts 路径 */
  cliPath: string;
  /** 工作目录 */
  workspaceDir: string;
  
  // --- remote 模式配置 ---
  /** 外部 Hermes API 基础 URL */
  apiBaseUrl: string;
  /** API 认证 Token */
  apiToken?: string;
  
  // --- 通用配置 ---
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

/** 桥接错误 */
export class HermesBridgeError extends Error {
  public readonly code: string;
  public readonly stderr?: string;

  constructor(message: string, code: string, stderr?: string) {
    super(message);
    this.name = "HermesBridgeError";
    this.code = code;
    this.stderr = stderr;
  }
}

// ============================================================================
// 常量
// ============================================================================

const DEFAULT_CONFIG: HermesBridgeConfig = {
  mode: (process.env.HERMES_MODE as HermesMode) || "disabled",
  cliPath: process.env.HERMES_CLI_PATH || "skills/hermes/scripts/hermes-cli.ts",
  workspaceDir: process.env.HERMES_WORKSPACE_DIR || process.cwd(),
  apiBaseUrl: process.env.HERMES_API_URL || "http://localhost:18690/hermes",
  apiToken: process.env.HERMES_API_TOKEN,
  timeoutMs: Number(process.env.HERMES_TIMEOUT || "30000"),
  maxRetries: Number(process.env.HERMES_MAX_RETRIES || "2"),
  retryDelayMs: Number(process.env.HERMES_RETRY_DELAY || "500"),
};

/** 禁用模式下的空响应提示 */
const DISABLED_RESPONSE = {
  memories: [] as HermesMemoryEntry[],
  skills: [] as HermesSkillInfo[],
  success: false,
  message: "Hermes 桥接已禁用（mode=disabled）。如需启用，请设置 HERMES_MODE=local 或 HERMES_MODE=remote 并配置相应参数。",
};

// ============================================================================
// HermesBridge 类 — 可选插件模式
// ============================================================================

export class HermesBridge {
  private config: HermesBridgeConfig;
  private _enabled: boolean;

  constructor(config?: Partial<HermesBridgeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this._enabled = this.config.mode !== "disabled";

    if (this._enabled) {
      logger.info(
        { mode: this.config.mode, cliPath: this.config.cliPath, apiUrl: this.config.apiBaseUrl },
        `HermesBridge initialized [mode=${this.config.mode}]`
      );
    } else {
      logger.info(
        "HermesBridge initialized [mode=disabled] — 本地记忆周期不会触发"
      );
    }
  }

  /** 是否已启用 */
  get enabled(): boolean {
    return this._enabled;
  }

  /** 当前模式 */
  get mode(): HermesMode {
    return this.config.mode;
  }

  // ==========================================================================
  // 公共 API 方法
  // ==========================================================================

  /**
   * 查询 Agent 的记忆
   * @param agentId - Agent ID
   * @param limit - 返回数量限制
   * @returns 记忆条目列表（禁用模式下返回空数组）
   */
  async queryMemories(
    agentId: string,
    limit?: number
  ): Promise<HermesMemoryEntry[]> {
    if (!this._enabled) {
      logger.debug("HermesBridge.queryMemories: mode=disabled, returning empty");
      return DISABLED_RESPONSE.memories;
    }

    try {
      const result = await this._execute("query", [agentId, limit?.toString() || "10"]);
      return this._parseMemories(result, agentId);
    } catch (err) {
      logger.warn({ err, agentId }, "Hermes query failed");
      return [];
    }
  }

  /**
   * 存储记忆到 Hermes
   * @param req - 存储请求
   * @returns 是否成功（禁用模式下返回 false）
   */
  async storeMemory(req: HermesStoreRequest): Promise<boolean> {
    if (!this._enabled) {
      logger.debug("HermesBridge.storeMemory: mode=disabled, skipping");
      return DISABLED_RESPONSE.success;
    }

    try {
      await this._execute("store", [
        req.agentId,
        req.content,
        JSON.stringify(req.tags || []),
        JSON.stringify(req.metadata || {}),
      ]);
      return true;
    } catch (err) {
      logger.warn({ err, agentId: req.agentId }, "Hermes store failed");
      return false;
    }
  }

  /**
   * 获取可用的技能列表
   * @returns 技能列表（禁用模式下返回空数组）
   */
  async listSkills(): Promise<HermesSkillInfo[]> {
    if (!this._enabled) {
      return DISABLED_RESPONSE.skills;
    }

    try {
      const result = await this._execute("list-skills", []);
      return this._parseSkills(result);
    } catch (err) {
      logger.warn({ err }, "Hermes listSkills failed");
      return [];
    }
  }

  /**
   * 触发 Hermes Memory Cycle（06:03 自动执行）
   * @returns 执行结果摘要（禁用模式下返回提示信息）
   */
  async triggerMemoryCycle(): Promise<{ success: boolean; message: string; details?: Record<string, unknown> }> {
    if (!this._enabled) {
      return {
        success: false,
        message: DISABLED_RESPONSE.message,
      };
    }

    try {
      const result = await this._execute("cycle", []);
      return {
        success: true,
        message: "Memory cycle triggered",
        details: typeof result === "object" ? (result as Record<string, unknown>) : undefined,
      };
    } catch (err) {
      logger.warn({ err }, "Hermes memory cycle failed");
      return {
        success: false,
        message: `Memory cycle failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ==========================================================================
  // 内部实现
  // ==========================================================================

  /**
   * 根据模式选择执行方式
   */
  private async _execute<T = unknown>(command: string, args: string[]): Promise<T> {
    switch (this.config.mode) {
      case "local":
        return this._runLocal<T>(command, args);
      case "remote":
        return this._runRemote<T>(command, args);
      default:
        throw new HermesBridgeError("HermesBridge is disabled", "DISABLED");
    }
  }

  /**
   * local 模式：通过子进程调用 hermes-cli.ts
   * ⚠️ 仅在本地 OpenClaw 环境可用时使用
   */
  private _runLocal<T>(command: string, args: string[]): Promise<T> {
    return new Promise((resolve, reject) => {
      const cliArgs = [
        this.config.cliPath,
        command,
        ...args,
        "--workspace",
        this.config.workspaceDir,
      ];

      logger.debug({ command, args }, "Hermes local exec");

      const child = spawn("npx", ["tsx", ...cliArgs], {
        cwd: this.config.workspaceDir,
        env: { ...process.env, NODE_ENV: "production" },
        timeout: this.config.timeoutMs,
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("error", (err) => {
        reject(
          new HermesBridgeError(
            `Hermes CLI spawn failed: ${err.message}`,
            "SPAWN_ERROR",
            stderr
          )
        );
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject(
            new HermesBridgeError(
              `Hermes CLI exited with code ${code}`,
              `EXIT_${code}`,
              stderr
            )
          );
          return;
        }

        try {
          const trimmed = stdout.trim();
          if (!trimmed) {
            resolve({} as unknown as T);
            return;
          }
          resolve(JSON.parse(trimmed) as T);
        } catch {
          resolve(stdout as unknown as T);
        }
      });
    });
  }

  /**
   * remote 模式：通过 HTTP API 连接外部 Hermes 服务
   * 适用于服务器部署，连接本地或远程的 OpenClaw gateway
   */
  private async _runRemote<T>(command: string, args: string[]): Promise<T> {
    const url = `${this.config.apiBaseUrl}/${command}`;
    
    logger.debug({ url, command }, "Hermes remote API call");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiToken) {
      headers["Authorization"] = `Bearer ${this.config.apiToken}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ args, workspace: this.config.workspaceDir }),
    });

    if (!response.ok) {
      throw new HermesBridgeError(
        `Hermes API error: ${response.status} ${response.statusText}`,
        `HTTP_${response.status}`
      );
    }

    return response.json() as Promise<T>;
  }

  // ==========================================================================
  // 解析辅助方法
  // ==========================================================================

  private _parseMemories(result: unknown, agentId: string): HermesMemoryEntry[] {
    if (!Array.isArray(result)) {
      logger.warn({ result }, "Hermes query returned non-array");
      return [];
    }

    return result.map((item: any) => ({
      id: item.id || crypto.randomUUID(),
      agentId: item.agent_id || agentId,
      content: item.content || item.text || String(item),
      tags: item.tags || [],
      timestamp: item.timestamp || new Date().toISOString(),
      relevance: item.relevance || item.score,
    }));
  }

  private _parseSkills(result: unknown): HermesSkillInfo[] {
    if (!Array.isArray(result)) return [];
    return result.map((item: any) => ({
      id: item.id || "",
      name: item.name || "",
      description: item.description,
      version: item.version,
      entry: item.entry,
    }));
  }
}

// ============================================================================
// 工厂方法 & 单例
// ============================================================================

let _instance: HermesBridge | null = null;

/**
 * 获取 HermesBridge 实例（单例）
 * 首次调用时根据环境变量初始化
 */
export function getHermesBridge(config?: Partial<HermesBridgeConfig>): HermesBridge {
  if (!_instance) {
    _instance = new HermesBridge(config);
  }
  return _instance;
}

/**
 * 重新初始化 HermesBridge（配置变更时使用）
 */
export function resetHermesBridge(config?: Partial<HermesBridgeConfig>): HermesBridge {
  _instance = new HermesBridge(config);
  return _instance;
}

/**
 * 快速检查 Hermes 是否可用
 */
export function isHermesEnabled(): boolean {
  return getHermesBridge().enabled;
}
