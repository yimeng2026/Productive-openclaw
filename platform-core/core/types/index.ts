export interface Agent {
  id: string;
  name: string;
  status: "idle" | "running" | "error";
  createdAt: number;
  /**
   * agentType 区分 "智能体"（空壳，无工作文件/状态/记忆/外部集成）
   * 与 "Agent"（完整实体，含工作文件、记忆、技能等）
   */
  agentType?: "agent" | "entity";
  /** 工作文件数量 */
  fileCount?: number;
  /** 记忆文件数量 */
  memoryCount?: number;
  /** 所属平台 */
  platform?: string;
  /** 所选模型 */
  model?: string;
  /** 技能列表 */
  skills?: string[];
}

export interface Channel {
  id: string;
  name: string;
  type: "dm" | "group";
  participants: string[];
  createdAt: number;
}

export interface Model {
  id: string;
  name: string;
  provider: string;
  capabilities: string[];
}

export interface WebSocketMessage {
  type: string;
  payload?: unknown;
}

export interface HealthResponse {
  status: "ok" | "error";
  uptime: number;
}

export interface Memory {
  id: string;
  agentId: string;
  content: string;
  type: string;
  createdAt: string;
}
