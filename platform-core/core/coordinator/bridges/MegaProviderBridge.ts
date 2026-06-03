// MegaProviderBridge.ts — Mega Provider Hub 桥接模块
// 连接 Sylva Backend 与 mega/providers/ 的统一 Provider 接入层
// 提供 Provider 查询、健康检查、路由决策

import { logger } from "../../utils/logger";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import {
  executeChatCompletion,
  estimateTokens,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ChatCompletionChunk,
} from "./ProviderAdapters";

// ============================================================================
// 类型定义
// ============================================================================

export type ProviderType = "international" | "chinese" | "gateway" | "cloud" | "local";
export type ApiFormat = "openai" | "anthropic" | "bedrock" | "vertex" | "zhipu" | "baidu" | "tencent" | "cohere" | "ai21" | "minimax" | "custom";
export type AuthType = "bearer" | "api_key_header" | "api_key" | "aws_signature_v4" | "oauth2" | "signature" | "gcp_service_account" | "none";
export type ProviderStatus = "active" | "beta" | "deprecated";

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  type: "chat" | "embedding" | "image" | "audio" | "video" | "rerank";
  capabilities: string[];
  status: "active" | "preview" | "legacy" | "deprecated";
}

export interface ProviderFeatures {
  streaming: boolean;
  functionCalling: boolean;
  toolUse: boolean;
  vision: boolean;
  audio: boolean;
  video: boolean;
  jsonMode: boolean;
  reasoning: boolean;
  computerUse: boolean;
  webSearch: boolean;
  fileSearch: boolean;
  embeddings: boolean;
  imageGeneration: boolean;
  audioGeneration: boolean;
  reranking: boolean;
  promptCaching: boolean;
  structuredOutputs: boolean;
  parallelToolCalling: boolean;
  batchApi: boolean;
  localInference?: boolean;
  offline?: boolean;
  quantization?: boolean;
}

export interface RoutingPolicy {
  priority?: number;
  fallbackChain?: string[];
  costWeight?: number;
  latencyWeight?: number;
  qualityWeight?: number;
  maxRpm?: number;
  maxTpm?: number;
  enabled: boolean;
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  apiFormat: ApiFormat;
  baseUrl: string;
  authType: AuthType;
  apiKeyEnvVar: string;
  models: ModelInfo[];
  modelAliases: Record<string, string>;
  features: ProviderFeatures;
  routing: RoutingPolicy;
  status: ProviderStatus;
  docsUrl?: string;
  notes?: string[];
}

export interface ProviderHealthResult {
  providerId: string;
  healthy: boolean;
  latencyMs: number;
  lastCheck: string;
  error?: string;
  modelsAvailable: number;
  successRate?: number;
  errorRate?: number;
  consecutiveErrors?: number;
}

export interface RouteRequest {
  model: string;
  preferredProviders?: string[];
  strategy?: RoutingStrategy;
  constraints?: RouteConstraints;
  promptTokens?: number;
  maxOutputTokens?: number;
}

export interface RouteResult {
  primary: ProviderRoute;
  fallbackChain: ProviderRoute[];
  allCandidates: ProviderRoute[];
}

export interface ProviderRoute {
  providerId: string;
  providerName: string;
  modelId: string;
  priority: number;
  estimatedCost?: number;
  estimatedLatency?: number;
}

export interface RouteConstraints {
  requireStreaming?: boolean;
  requireVision?: boolean;
  requireToolUse?: boolean;
  requireReasoning?: boolean;
  requireEmbeddings?: boolean;
  maxLatencyMs?: number;
  maxCostPer1kTokens?: number;
}

export type RoutingStrategy = "priority" | "cost" | "latency" | "balanced" | "round_robin";

// ============================================================================
// MegaProviderBridge 类
// ============================================================================

const MEGA_PROVIDERS_PATH = resolve(process.cwd(), "../../../mega/providers");
const FALLBACK_PROVIDERS: ProviderConfig[] = [
  // 内置的 Ollama 配置（本地，无需 API Key）
  {
    id: "ollama",
    name: "Ollama Local",
    type: "local",
    apiFormat: "openai",
    baseUrl: "http://localhost:11434/v1",
    authType: "none",
    apiKeyEnvVar: "",
    models: [
      { id: "qwen2.5:7b-custom", name: "Qwen2.5 7B Custom", contextWindow: 32768, maxOutputTokens: 8192, type: "chat", capabilities: ["streaming", "localInference"], status: "active" },
      { id: "qwen2.5:1.5b", name: "Qwen2.5 1.5B", contextWindow: 32768, maxOutputTokens: 8192, type: "chat", capabilities: ["streaming", "localInference"], status: "active" },
      { id: "qwen2.5:0.5b", name: "Qwen2.5 0.5B", contextWindow: 32768, maxOutputTokens: 8192, type: "chat", capabilities: ["streaming", "localInference"], status: "active" },
      { id: "DeepSeek-R1-Distill-Qwen-14B", name: "DeepSeek R1 Distill 14B", contextWindow: 32768, maxOutputTokens: 8192, type: "chat", capabilities: ["streaming", "reasoning", "localInference"], status: "active" },
    ],
    modelAliases: {},
    features: {
      streaming: true, functionCalling: false, toolUse: false, vision: false, audio: false, video: false,
      jsonMode: false, reasoning: true, computerUse: false, webSearch: false, fileSearch: false,
      embeddings: false, imageGeneration: false, audioGeneration: false, reranking: false,
      promptCaching: false, structuredOutputs: false, parallelToolCalling: false, batchApi: false,
      localInference: true, offline: true, quantization: true,
    },
    routing: { priority: 10, enabled: true },
    status: "active",
    notes: ["Local inference engine, no API key required", "Supports GGUF quantized models"],
  },
];

export class MegaProviderBridge {
  private providers = new Map<string, ProviderConfig>();
  private healthCache = new Map<string, ProviderHealthResult>();
  private initialized = false;
  private roundRobinIndex = 0;

  // ── 动态检测 Ollama 本地模型 ─────────────────

  async refreshOllamaModels(): Promise<void> {
    try {
      const res = await fetch("http://localhost:11434/api/tags", {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return;

      const data = await res.json() as { models?: Array<{ name: string; model?: string; size?: number; digest?: string; details?: any }> };
      if (!data.models || data.models.length === 0) return;

      const models: ModelInfo[] = data.models.map((m) => ({
        id: m.name,
        name: m.name,
        contextWindow: this.inferContextWindow(m.name),
        maxOutputTokens: 8192,
        type: "chat" as const,
        capabilities: ["streaming", "localInference"],
        status: "active" as const,
      }));

      // 更新或创建 Ollama Provider
      const existing = this.providers.get("ollama");
      if (existing) {
        existing.models = models;
        existing.routing.enabled = true;
        logger.info({ count: models.length }, "[MegaProviderBridge] Ollama models refreshed");
      } else {
        // 创建新的 Ollama Provider
        const ollamaProvider: ProviderConfig = {
          id: "ollama",
          name: "Ollama Local",
          type: "local",
          apiFormat: "openai",
          baseUrl: "http://localhost:11434/v1",
          authType: "none",
          apiKeyEnvVar: "",
          models,
          modelAliases: {},
          features: {
            streaming: true, functionCalling: false, toolUse: false, vision: false, audio: false, video: false,
            jsonMode: false, reasoning: models.some(m => m.id.includes("deepseek") || m.id.includes("r1")), computerUse: false,
            webSearch: false, fileSearch: false, embeddings: false, imageGeneration: false,
            audioGeneration: false, reranking: false, promptCaching: false, structuredOutputs: false,
            parallelToolCalling: false, batchApi: false, localInference: true, offline: true, quantization: true,
          },
          routing: { priority: 10, enabled: true },
          status: "active",
          notes: ["Auto-detected local models", "Supports GGUF quantized models"],
        };
        this.providers.set("ollama", ollamaProvider);
      }
    } catch (err: any) {
      logger.warn({ error: err.message }, "[MegaProviderBridge] Failed to refresh Ollama models");
    }
  }

  private inferContextWindow(modelName: string): number {
    // 根据模型名称推断上下文窗口
    if (modelName.includes("128k")) return 128000;
    if (modelName.includes("32k")) return 32768;
    if (modelName.includes("8k")) return 8192;
    if (modelName.includes("1m") || modelName.includes("1M")) return 1000000;
    if (modelName.includes("128b") || modelName.includes("70b") || modelName.includes("14b") || modelName.includes("7b")) return 32768;
    if (modelName.includes("1.5b") || modelName.includes("0.5b")) return 32768;
    return 32768; // 默认
  }

  // ── 初始化（含 Ollama 模型检测）────────────────

  async init(): Promise<void> {
    if (this.initialized) return;
    this.loadBuiltinProviders();
    await this.scanProviderConfigs();
    await this.refreshOllamaModels(); // 启动时自动检测 Ollama 模型
    this.initialized = true;
    logger.info({ count: this.providers.size }, "[MegaProviderBridge] Providers loaded");
  }

  // ── 加载内置 Provider ───────────────────────

  private loadBuiltinProviders(): void {
    for (const provider of FALLBACK_PROVIDERS) {
      this.providers.set(provider.id, provider);
    }
  }

  // ── 扫描 mega/providers/ 配置 ──────────────

  private async scanProviderConfigs(): Promise<void> {
    // 扫描 mega/providers/ 下的 Markdown 配置文件
    // 实际实现：解析 markdown 中的 YAML 配置块
    // 简化版：从环境变量读取常用 Provider 配置

    const envProviders = this.loadProvidersFromEnv();
    for (const provider of envProviders) {
      this.providers.set(provider.id, provider);
    }
  }

  private loadProvidersFromEnv(): ProviderConfig[] {
    const providers: ProviderConfig[] = [];

    // OpenAI
    if (process.env.OPENAI_API_KEY) {
      providers.push({
        id: "openai",
        name: "OpenAI",
        type: "international",
        apiFormat: "openai",
        baseUrl: "https://api.openai.com/v1",
        authType: "bearer",
        apiKeyEnvVar: "OPENAI_API_KEY",
        models: [
          { id: "gpt-4o", name: "GPT-4o", contextWindow: 128000, maxOutputTokens: 16384, type: "chat", capabilities: ["streaming", "vision", "functionCalling", "jsonMode"], status: "active" },
          { id: "gpt-4o-mini", name: "GPT-4o Mini", contextWindow: 128000, maxOutputTokens: 16384, type: "chat", capabilities: ["streaming", "vision", "functionCalling", "jsonMode"], status: "active" },
        ],
        modelAliases: { "gpt-4": "gpt-4o", "gpt-4-turbo": "gpt-4o" },
        features: {
          streaming: true, functionCalling: true, toolUse: true, vision: true, audio: true, video: false,
          jsonMode: true, reasoning: false, computerUse: false, webSearch: false, fileSearch: false,
          embeddings: true, imageGeneration: true, audioGeneration: false, reranking: false,
          promptCaching: true, structuredOutputs: true, parallelToolCalling: true, batchApi: true,
        },
        routing: { priority: 1, enabled: true },
        status: "active",
      });
    }

    // Anthropic
    if (process.env.ANTHROPIC_API_KEY) {
      providers.push({
        id: "anthropic",
        name: "Anthropic Claude",
        type: "international",
        apiFormat: "anthropic",
        baseUrl: "https://api.anthropic.com",
        authType: "api_key_header",
        apiKeyEnvVar: "ANTHROPIC_API_KEY",
        models: [
          { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", contextWindow: 200000, maxOutputTokens: 8192, type: "chat", capabilities: ["streaming", "vision", "toolUse"], status: "active" },
          { id: "claude-3-opus-20240229", name: "Claude 3 Opus", contextWindow: 200000, maxOutputTokens: 4096, type: "chat", capabilities: ["streaming", "vision", "toolUse"], status: "active" },
        ],
        modelAliases: { "claude": "claude-3-5-sonnet-20241022" },
        features: {
          streaming: true, functionCalling: true, toolUse: true, vision: true, audio: false, video: false,
          jsonMode: true, reasoning: true, computerUse: false, webSearch: false, fileSearch: false,
          embeddings: false, imageGeneration: false, audioGeneration: false, reranking: false,
          promptCaching: true, structuredOutputs: true, parallelToolCalling: true, batchApi: false,
        },
        routing: { priority: 2, enabled: true },
        status: "active",
      });
    }

    // Google
    if (process.env.GOOGLE_API_KEY) {
      providers.push({
        id: "google",
        name: "Google Gemini",
        type: "international",
        apiFormat: "openai",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        authType: "bearer",
        apiKeyEnvVar: "GOOGLE_API_KEY",
        models: [
          { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", contextWindow: 1000000, maxOutputTokens: 8192, type: "chat", capabilities: ["streaming", "vision", "functionCalling"], status: "active" },
          { id: "gemini-2.0-pro", name: "Gemini 2.0 Pro", contextWindow: 2000000, maxOutputTokens: 8192, type: "chat", capabilities: ["streaming", "vision", "functionCalling"], status: "active" },
        ],
        modelAliases: {},
        features: {
          streaming: true, functionCalling: true, toolUse: true, vision: true, audio: true, video: false,
          jsonMode: true, reasoning: false, computerUse: false, webSearch: false, fileSearch: false,
          embeddings: true, imageGeneration: true, audioGeneration: false, reranking: false,
          promptCaching: false, structuredOutputs: true, parallelToolCalling: false, batchApi: false,
        },
        routing: { priority: 3, enabled: true },
        status: "active",
      });
    }

    // DeepSeek
    if (process.env.DEEPSEEK_API_KEY) {
      providers.push({
        id: "deepseek",
        name: "DeepSeek",
        type: "international",
        apiFormat: "openai",
        baseUrl: "https://api.deepseek.com/v1",
        authType: "bearer",
        apiKeyEnvVar: "DEEPSEEK_API_KEY",
        models: [
          { id: "deepseek-chat", name: "DeepSeek V3", contextWindow: 64000, maxOutputTokens: 8192, type: "chat", capabilities: ["streaming", "functionCalling", "reasoning"], status: "active" },
          { id: "deepseek-reasoner", name: "DeepSeek R1", contextWindow: 64000, maxOutputTokens: 8192, type: "chat", capabilities: ["streaming", "reasoning"], status: "active" },
        ],
        modelAliases: {},
        features: {
          streaming: true, functionCalling: true, toolUse: false, vision: false, audio: false, video: false,
          jsonMode: true, reasoning: true, computerUse: false, webSearch: false, fileSearch: false,
          embeddings: false, imageGeneration: false, audioGeneration: false, reranking: false,
          promptCaching: false, structuredOutputs: true, parallelToolCalling: false, batchApi: false,
        },
        routing: { priority: 4, enabled: true },
        status: "active",
      });
    }

    // Kimi Code (api.kimi.com/coding/v1) — 用户提供的 5 个 key 均有效
    const kimiCodeKeys = [
      process.env.KIMI_CODE_API_KEY_1,
      process.env.KIMI_CODE_API_KEY_2,
      process.env.KIMI_CODE_API_KEY_3,
      process.env.KIMI_CODE_API_KEY_4,
      process.env.KIMI_CODE_API_KEY_5,
    ].filter(Boolean);

    if (kimiCodeKeys.length > 0 || process.env.KIMICODE_API_KEY || process.env.KIMI_API_KEY) {
      providers.push({
        id: "kimi-code",
        name: "Kimi Code",
        type: "chinese",
        apiFormat: "openai",
        baseUrl: "https://api.kimi.com/coding/v1",
        authType: "bearer",
        apiKeyEnvVar: "KIMICODE_API_KEY",
        models: [
          { id: "kimi-for-coding", name: "Kimi For Coding", contextWindow: 262144, maxOutputTokens: 32768, type: "chat", capabilities: ["streaming", "reasoning"], status: "active" },
        ],
        modelAliases: { "kimi": "kimi-for-coding" },
        features: {
          streaming: true, functionCalling: true, toolUse: false, vision: false, audio: false, video: false,
          jsonMode: true, reasoning: true, computerUse: false, webSearch: false, fileSearch: false,
          embeddings: false, imageGeneration: false, audioGeneration: false, reranking: false,
          promptCaching: false, structuredOutputs: true, parallelToolCalling: false, batchApi: false,
        },
        routing: { priority: 5, enabled: true },
        status: "active",
      });
    }

    return providers;
  }

  // ── 列出 Provider ──────────────────────────

  listProviders(): ProviderConfig[] {
    return Array.from(this.providers.values());
  }

  listByType(type: ProviderType): ProviderConfig[] {
    return this.listProviders().filter((p) => p.type === type);
  }

  listByCategory(): Record<string, ProviderConfig[]> {
    const categories: Record<string, ProviderConfig[]> = {
      international: [],
      chinese: [],
      gateway: [],
      cloud: [],
      local: [],
    };
    for (const provider of this.providers.values()) {
      categories[provider.type].push(provider);
    }
    return categories;
  }

  getProvider(id: string): ProviderConfig | undefined {
    return this.providers.get(id);
  }

  // ── 健康检查 ────────────────────────────────

  async checkHealth(providerId: string): Promise<ProviderHealthResult> {
    const provider = this.providers.get(providerId);
    const result: ProviderHealthResult = {
      providerId,
      healthy: false,
      latencyMs: -1,
      lastCheck: new Date().toISOString(),
      modelsAvailable: 0,
    };

    if (!provider) {
      result.error = "Provider not found";
      this.healthCache.set(providerId, result);
      return result;
    }

    const start = Date.now();

    try {
      // 本地 Provider（Ollama）→ 直接 HTTP 探测
      if (provider.type === "local" || provider.apiFormat === "openai") {
        const res = await fetch(`${provider.baseUrl}/models`, {
          method: "GET",
          headers: provider.authType === "bearer" && process.env[provider.apiKeyEnvVar]
            ? { Authorization: `Bearer ${process.env[provider.apiKeyEnvVar]}` }
            : provider.authType === "none"
            ? {}
            : {},
          signal: AbortSignal.timeout(5000),
        });

        result.latencyMs = Date.now() - start;
        result.healthy = res.ok;

        if (res.ok) {
          try {
            const data = await res.json() as any;
            result.modelsAvailable = data.data?.length || data.models?.length || provider.models.length;
          } catch {
            result.modelsAvailable = provider.models.length;
          }
        } else {
          result.error = `HTTP ${res.status}: ${res.statusText}`;
        }
      }
      // 云端 Provider → 检查 API Key 存在性（轻量级）
      else {
        const hasKey = !!process.env[provider.apiKeyEnvVar];
        result.latencyMs = Date.now() - start;
        result.healthy = hasKey;
        result.modelsAvailable = hasKey ? provider.models.length : 0;
        if (!hasKey) result.error = "API Key not configured";
      }
    } catch (err: any) {
      result.latencyMs = Date.now() - start;
      result.error = err.message;
    }

    this.healthCache.set(providerId, result);
    return result;
  }

  async checkAllHealth(): Promise<ProviderHealthResult[]> {
    const results: ProviderHealthResult[] = [];
    for (const id of this.providers.keys()) {
      results.push(await this.checkHealth(id));
    }
    return results;
  }

  getCachedHealth(providerId: string): ProviderHealthResult | undefined {
    return this.healthCache.get(providerId);
  }

  // ── 路由决策 ────────────────────────────────

  async route(request: RouteRequest): Promise<RouteResult> {
    const { model, preferredProviders, strategy = "balanced", constraints } = request;

    // 1. 查找候选 Provider
    let candidates = this.findCandidates(model, preferredProviders);

    // 2. 约束过滤
    if (constraints) {
      candidates = candidates.filter((c) => this.meetsConstraints(c, constraints));
    }

    // 3. 健康过滤
    candidates = candidates.filter((c) => {
      const health = this.healthCache.get(c.providerId);
      return !health || health.healthy;
    });

    if (candidates.length === 0) {
      throw new Error(`No healthy provider found for model: ${model}`);
    }

    // 4. 策略排序
    const sorted = this.sortCandidates(candidates, strategy, request);

    return {
      primary: sorted[0],
      fallbackChain: sorted.slice(1),
      allCandidates: sorted,
    };
  }

  private findCandidates(model: string, preferred?: string[]): ProviderRoute[] {
    const routes: ProviderRoute[] = [];

    for (const [providerId, provider] of this.providers) {
      // 检查是否是优先 Provider
      if (preferred && !preferred.includes(providerId)) continue;
      if (!provider.routing.enabled) continue;

      // 查找匹配的模型
      const modelMatch = provider.models.find((m) => m.id === model || provider.modelAliases[model] === m.id);
      if (modelMatch && modelMatch.status !== "deprecated") {
        routes.push({
          providerId,
          providerName: provider.name,
          modelId: modelMatch.id,
          priority: provider.routing.priority ?? 100,
        });
      }
    }

    return routes;
  }

  private meetsConstraints(route: ProviderRoute, constraints: RouteConstraints): boolean {
    const provider = this.providers.get(route.providerId);
    if (!provider) return false;

    const f = provider.features;
    if (constraints.requireStreaming && !f.streaming) return false;
    if (constraints.requireVision && !f.vision) return false;
    if (constraints.requireToolUse && !f.toolUse) return false;
    if (constraints.requireReasoning && !f.reasoning) return false;
    if (constraints.requireEmbeddings && !f.embeddings) return false;

    return true;
  }

  private sortCandidates(
    candidates: ProviderRoute[],
    strategy: RoutingStrategy,
    request: RouteRequest
  ): ProviderRoute[] {
    switch (strategy) {
      case "priority":
        return candidates.sort((a, b) => a.priority - b.priority);

      case "cost": {
        // 简化成本估算（本地 < 国内 < 国际）
        const costMap: Record<string, number> = { local: 0.1, chinese: 0.5, international: 1, gateway: 0.8, cloud: 0.7 };
        return candidates.sort((a, b) => {
          const pa = this.providers.get(a.providerId);
          const pb = this.providers.get(b.providerId);
          return (costMap[pa?.type || "international"] || 1) - (costMap[pb?.type || "international"] || 1);
        });
      }

      case "latency": {
        return candidates.sort((a, b) => {
          const ha = this.healthCache.get(a.providerId)?.latencyMs ?? Infinity;
          const hb = this.healthCache.get(b.providerId)?.latencyMs ?? Infinity;
          return ha - hb;
        });
      }

      case "balanced": {
        return candidates.sort((a, b) => {
          const scoreA = this.calculateScore(a, request);
          const scoreB = this.calculateScore(b, request);
          return scoreB - scoreA; // 高分优先
        });
      }

      case "round_robin": {
        const index = this.roundRobinIndex % candidates.length;
        this.roundRobinIndex = (this.roundRobinIndex + 1) % candidates.length;
        return [...candidates.slice(index), ...candidates.slice(0, index)];
      }

      default:
        return candidates;
    }
  }

  private calculateScore(route: ProviderRoute, request: RouteRequest): number {
    const provider = this.providers.get(route.providerId);
    if (!provider) return 0;

    const health = this.healthCache.get(route.providerId);
    const latencyScore = health ? Math.max(0, 1 - health.latencyMs / 5000) : 0.5;

    // 成本分数（本地 > 国内 > 国际）
    const costMap: Record<string, number> = { local: 1, chinese: 0.7, international: 0.3, gateway: 0.6, cloud: 0.5 };
    const costScore = costMap[provider.type] || 0.3;

    // 能力匹配分数
    const model = provider.models.find((m) => m.id === route.modelId);
    let capabilityScore = 0.5;
    if (model) {
      const caps = model.capabilities;
      let matches = 0;
      let checks = 0;
      if (request.constraints?.requireStreaming) { checks++; if (provider.features.streaming) matches++; }
      if (request.constraints?.requireVision) { checks++; if (provider.features.vision) matches++; }
      if (request.constraints?.requireToolUse) { checks++; if (provider.features.toolUse) matches++; }
      if (request.constraints?.requireReasoning) { checks++; if (provider.features.reasoning || caps.includes("reasoning")) matches++; }
      if (checks > 0) capabilityScore = matches / checks;
    }

    // 加权综合
    const weights = { latency: 0.3, cost: 0.3, capability: 0.4 };
    return weights.latency * latencyScore + weights.cost * costScore + weights.capability * capabilityScore;
  }

  // ── 获取 API Key ────────────────────────────

  getApiKey(providerId: string): string | undefined {
    const provider = this.providers.get(providerId);
    if (!provider || !provider.apiKeyEnvVar) return undefined;
    return process.env[provider.apiKeyEnvVar];
  }

  hasApiKey(providerId: string): boolean {
    return !!this.getApiKey(providerId);
  }

  // ── 模型别名解析 ────────────────────────────

  resolveModelAlias(alias: string): { providerId: string; modelId: string } | null {
    for (const [providerId, provider] of this.providers) {
      const resolved = provider.modelAliases[alias];
      if (resolved) {
        return { providerId, modelId: resolved };
      }
      // 也检查是否直接匹配模型ID
      const model = provider.models.find((m) => m.id === alias);
      if (model) {
        return { providerId, modelId: model.id };
      }
    }
    return null;
  }

  // ── 实际调用 LLM API ─────────────────────────

  /**
   * 执行 Chat Completion（非流式）
   */
  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const route = await this.route({ model: request.model, strategy: "balanced" });
    const primary = route.primary;
    const provider = this.providers.get(primary.providerId);
    if (!provider) {
      throw new Error(`Provider ${primary.providerId} not found`);
    }

    const apiKey = this.getApiKey(primary.providerId);
    if (!apiKey && provider.authType !== "none") {
      throw new Error(`API key not configured for ${provider.name}`);
    }

    const start = Date.now();
    const generator = await executeChatCompletion(
      provider.apiFormat,
      provider.baseUrl,
      apiKey || "",
      provider.id,
      request,
    );

    // 非流式请求：取第一个（也是唯一一个）yield 值
    const result = await generator.next();
    if (result.done && result.value) {
      const latency = Date.now() - start;
      logger.info(
        { provider: provider.id, model: request.model, latencyMs: latency, tokens: result.value.usage?.totalTokens },
        "[MegaProviderBridge] chatCompletion completed",
      );
      return result.value;
    }

    throw new Error("Unexpected stream response for non-streaming request");
  }

  /**
   * 执行流式 Chat Completion
   */
  async streamChatCompletion(
    request: ChatCompletionRequest,
  ): Promise<AsyncGenerator<ChatCompletionChunk, ChatCompletionResponse | undefined>> {
    const route = await this.route({ model: request.model, strategy: "latency" });
    const primary = route.primary;
    const provider = this.providers.get(primary.providerId);
    if (!provider) {
      throw new Error(`Provider ${primary.providerId} not found`);
    }

    const apiKey = this.getApiKey(primary.providerId);
    if (!apiKey && provider.authType !== "none") {
      throw new Error(`API key not configured for ${provider.name}`);
    }

    logger.info(
      { provider: provider.id, model: request.model, stream: true },
      "[MegaProviderBridge] streamChatCompletion started",
    );

    return executeChatCompletion(
      provider.apiFormat,
      provider.baseUrl,
      apiKey || "",
      provider.id,
      { ...request, stream: true },
    );
  }

  /**
   * 简单聊天快捷方式
   */
  async chat(
    model: string,
    messages: ChatCompletionRequest["messages"],
    options: Omit<ChatCompletionRequest, "model" | "messages"> = {},
  ): Promise<string> {
    const result = await this.chatCompletion({ model, messages, ...options });
    return result.content;
  }
}

// ============================================================================
// 单例导出
// ============================================================================

let bridgeInstance: MegaProviderBridge | null = null;

export function getMegaProviderBridge(): MegaProviderBridge {
  if (!bridgeInstance) {
    bridgeInstance = new MegaProviderBridge();
  }
  return bridgeInstance;
}

export async function initMegaProviderBridge(): Promise<MegaProviderBridge> {
  const bridge = getMegaProviderBridge();
  await bridge.init();
  return bridge;
}

export default MegaProviderBridge;
