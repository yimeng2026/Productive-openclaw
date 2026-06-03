// Sylva 统一平台适配器接口
// 所有原生平台必须通过此接口接入

export interface AgentConfig {
  id: string;
  name: string;
  platform: string;           // 所属平台: claude-code, codex, hermes...
  model?: string;             // 使用的大模型
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  skills?: string[];          // 技能列表
  enabled: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ChatParams {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: Tool[];
}

export interface ChatResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface PlatformStatus {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'error' | 'starting';
  version: string;
  pid?: number;
  uptime: number;
  memoryUsage: number;
  lastError?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
  costPer1kTokens: {
    input: number;
    output: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// 统一平台适配器接口 — 所有平台必须实现
// ═══════════════════════════════════════════════════════════════

export abstract class PlatformAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly sourcePath: string;    // 源代码路径: platforms/xxx

  protected config: Record<string, unknown> = {};
  protected status: PlatformStatus = {
    id: '',
    name: '',
    status: 'offline',
    version: '',
    uptime: 0,
    memoryUsage: 0,
  };

  // ── 生命周期 ────────────────────────────────────────────────

  /** 初始化平台（配置加载、依赖检查） */
  abstract initialize(config: Record<string, unknown>): Promise<void>;

  /** 启动平台进程 */
  abstract start(): Promise<void>;

  /** 停止平台进程 */
  abstract stop(): Promise<void>;

  /** 重启平台 */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  // ── 核心功能 ────────────────────────────────────────────────

  /** 发送聊天消息 */
  abstract chat(params: ChatParams): Promise<ChatResponse>;

  /** 流式聊天 */
  abstract chatStream(params: ChatParams): AsyncGenerator<ChatResponse>;

  /** 执行命令 */
  abstract execute(command: string, args?: string[]): Promise<string>;

  /** 创建 Agent */
  abstract createAgent(config: AgentConfig): Promise<AgentConfig>;

  /** 列出所有 Agent */
  abstract listAgents(): Promise<AgentConfig[]>;

  /** 删除 Agent */
  abstract deleteAgent(id: string): Promise<void>;

  // ── 工具与模型 ──────────────────────────────────────────────

  /** 获取可用工具列表 */
  abstract getTools(): Promise<Tool[]>;

  /** 获取可用模型列表 */
  abstract getModels(): Promise<ModelInfo[]>;

  // ── 状态监控 ──────────────────────────────────────────────

  /** 获取平台状态 */
  getStatus(): PlatformStatus {
    return { ...this.status };
  }

  /** 获取平台日志 */
  abstract getLogs(lines?: number): Promise<string[]>;

  /** 健康检查 */
  abstract healthCheck(): Promise<boolean>;
}

// ═══════════════════════════════════════════════════════════════
// 模型提供商统一接口
// ═══════════════════════════════════════════════════════════════

export abstract class ModelProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly apiEndpoint: string;

  protected apiKey?: string;
  protected models: ModelInfo[] = [];

  /** 设置 API Key */
  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /** 获取可用模型 */
  abstract fetchModels(): Promise<ModelInfo[]>;

  /** 统一聊天接口 */
  abstract chat(params: ChatParams): Promise<ChatResponse>;

  /** 流式聊天 */
  abstract chatStream(params: ChatParams): AsyncGenerator<ChatResponse>;

  /** 计算成本 */
  calculateCost(modelId: string, promptTokens: number, completionTokens: number): number {
    const model = this.models.find(m => m.id === modelId);
    if (!model) return 0;
    return (promptTokens * model.costPer1kTokens.input + completionTokens * model.costPer1kTokens.output) / 1000;
  }

  /** 验证 API Key */
  abstract validateKey(): Promise<boolean>;
}

// ═══════════════════════════════════════════════════════════════
// Sylva 统一网关
// ═══════════════════════════════════════════════════════════════

export class SylvaGateway {
  private adapters = new Map<string, PlatformAdapter>();
  private providers = new Map<string, ModelProvider>();
  private agentRegistry = new Map<string, AgentConfig>();

  // ── 平台管理 ────────────────────────────────────────────────

  registerPlatform(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  unregisterPlatform(id: string): void {
    this.adapters.delete(id);
  }

  getPlatform(id: string): PlatformAdapter | undefined {
    return this.adapters.get(id);
  }

  getAllPlatforms(): PlatformAdapter[] {
    return Array.from(this.adapters.values());
  }

  // ── 模型提供商管理 ──────────────────────────────────────────

  registerProvider(provider: ModelProvider): void {
    this.providers.set(provider.id, provider);
  }

  getProvider(id: string): ModelProvider | undefined {
    return this.providers.get(id);
  }

  getAllProviders(): ModelProvider[] {
    return Array.from(this.providers.values());
  }

  // ── 统一聊天入口 ───────────────────────────────────────────

  async unifiedChat(params: ChatParams & { agentId?: string }): Promise<ChatResponse> {
    // 1. 如果指定了 agent，通过 agent 对应的平台处理
    if (params.agentId) {
      const agent = this.agentRegistry.get(params.agentId);
      if (agent) {
        const platform = this.adapters.get(agent.platform);
        if (platform) {
          return platform.chat(params);
        }
      }
    }

    // 2. 如果没有指定 agent，使用默认模型提供商
    const defaultProvider = this.providers.get('kimi') || this.providers.values().next().value;
    if (!defaultProvider) {
      throw new Error('No model provider available');
    }

    return defaultProvider.chat(params);
  }

  // ── Agent 管理 ─────────────────────────────────────────────

  async createAgent(config: AgentConfig): Promise<AgentConfig> {
    const platform = this.adapters.get(config.platform);
    if (!platform) {
      throw new Error(`Platform ${config.platform} not found`);
    }
    const agent = await platform.createAgent(config);
    this.agentRegistry.set(agent.id, agent);
    return agent;
  }

  getAgent(id: string): AgentConfig | undefined {
    return this.agentRegistry.get(id);
  }

  getAllAgents(): AgentConfig[] {
    return Array.from(this.agentRegistry.values());
  }

  // ── 批量执行 ───────────────────────────────────────────────

  async broadcastChat(params: ChatParams, platformIds?: string[]): Promise<Map<string, ChatResponse>> {
    const targets = platformIds 
      ? platformIds.map(id => this.adapters.get(id)).filter(Boolean) as PlatformAdapter[]
      : this.getAllPlatforms();

    const results = new Map<string, ChatResponse>();
    await Promise.all(targets.map(async platform => {
      try {
        const response = await platform.chat(params);
        results.set(platform.id, response);
      } catch (err) {
        console.error(`Platform ${platform.id} chat failed:`, err);
      }
    }));
    return results;
  }

  // ── 状态汇总 ───────────────────────────────────────────────

  getSystemStatus(): {
    platforms: PlatformStatus[];
    providers: { id: string; name: string; status: string }[];
    agents: AgentConfig[];
  } {
    return {
      platforms: this.getAllPlatforms().map(p => p.getStatus()),
      providers: this.getAllProviders().map(p => ({ id: p.id, name: p.name, status: 'online' })),
      agents: this.getAllAgents(),
    };
  }
}

// 导出单例
export const sylvaGateway = new SylvaGateway();
