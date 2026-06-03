// backend/src/services/modelRouter.ts
// 模型路由器 — 对接多厂商AI模型，支持智能路由策略
// 最小可用版本：配置驱动 + 延迟优先/加权轮询/能力匹配

import { logger } from '../utils/logger';
import { getMegaProviderBridge } from '../coordinator/bridges';
import type { ProviderConfig, ModelInfo, ProviderHealthResult } from '../coordinator/bridges/MegaProviderBridge';
import { pushLog } from '../websocket/push';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '../coordinator/bridges/ProviderAdapters';

// ============================================================================
// 类型定义
// ============================================================================

export type RouteStrategy =
  | 'latency-first'
  | 'weighted-cost'
  | 'round-robin'
  | 'capability-match'
  | 'sticky-session';

export interface RoutingRequest {
  /** 用户请求的能力需求列表 */
  capabilities?: string[];
  /** 会话ID（用于会话亲和） */
  sessionId?: string;
  /** 期望的上下文长度 */
  minContextWindow?: number;
  /** 请求类型 */
  requestType?: 'chat' | 'code' | 'vision' | 'embedding' | 'reasoning';
  /** 是否启用流式输出 */
  streaming?: boolean;
  /** 是否强制使用特定提供商 */
  forceProvider?: string;
  /** 是否强制使用特定模型 */
  forceModel?: string;
  /** 路由策略覆盖 */
  strategy?: RouteStrategy;
  /** 提示文本（用于估算token） */
  prompt?: string;
}

export interface RoutingDecision {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  strategy: RouteStrategy;
  confidence: number;
  latencyMs: number;
  estimatedCost?: number;
  fallbackChain: string[];
  reason: string;
}

export interface ProviderHealth {
  providerId: string;
  providerName: string;
  healthy: boolean;
  latencyMs: number;
  successRate: number;
  errorRate: number;
  lastCheckedAt: number;
  consecutiveErrors: number;
  modelsAvailable: number;
}

export interface RoutingStats {
  totalRouted: number;
  totalErrors: number;
  avgLatency: number;
  byProvider: Record<string, {
    requests: number;
    errors: number;
    avgLatency: number;
  }>;
  byStrategy: Record<string, number>;
}

// ============================================================================
// 权重与成本配置（可扩展为从数据库/配置文件加载）
// ============================================================================

const COST_PER_1K_TOKENS: Record<string, number> = {
  'gpt-4o': 0.005,
  'gpt-4o-mini': 0.0006,
  'claude-3-5-sonnet': 0.003,
  'claude-3-opus': 0.015,
  'moonshot-v1-8k': 0.003,
  'moonshot-v1-32k': 0.006,
  'moonshot-v1-128k': 0.012,
  'deepseek-chat': 0.0001,
  'deepseek-reasoner': 0.003,
  'gemini-1.5-pro': 0.0035,
  'gemini-1.5-flash': 0.0007,
};

const DEFAULT_WEIGHTS: Record<string, number> = {
  openai: 25,
  anthropic: 20,
  moonshot: 35,
  deepseek: 10,
  google: 5,
  ollama: 5,
};

// ============================================================================
// 能力匹配映射
// ============================================================================

const CAPABILITY_PROVIDER_MAP: Record<string, string[]> = {
  code: ['deepseek', 'openai', 'anthropic', 'moonshot'],
  vision: ['openai', 'anthropic', 'google', 'moonshot'],
  reasoning: ['deepseek', 'anthropic', 'openai'],
  embedding: ['openai', 'moonshot', 'google'],
  longContext: ['anthropic', 'moonshot', 'google'],
  functionCalling: ['openai', 'anthropic', 'moonshot'],
  streaming: ['openai', 'anthropic', 'moonshot', 'deepseek', 'google'],
};

// ============================================================================
// 会话亲和存储（内存，生产环境建议Redis）
// ============================================================================

const sessionAffinity = new Map<string, { providerId: string; modelId: string }>();
const roundRobinIndex = new Map<string, number>();

// ============================================================================
// 健康状态缓存
// ============================================================================

let healthCache: ProviderHealth[] = [];
let healthCacheTime = 0;
const HEALTH_CACHE_TTL_MS = 30000;

// ============================================================================
// 路由统计
// ============================================================================

const routingStats: RoutingStats = {
  totalRouted: 0,
  totalErrors: 0,
  avgLatency: 0,
  byProvider: {},
  byStrategy: {},
};

// ============================================================================
// ModelRouter 类
// ============================================================================

export class ModelRouter {
  private defaultStrategy: RouteStrategy = 'latency-first';
  private stickySessionEnabled = true;

  /**
   * 获取所有Provider的健康状态
   */
  async getProviderHealth(): Promise<ProviderHealth[]> {
    const now = Date.now();
    if (now - healthCacheTime < HEALTH_CACHE_TTL_MS && healthCache.length > 0) {
      return healthCache;
    }

    const bridge = getMegaProviderBridge();
    const providers = bridge.listProviders();
    const healths: ProviderHealth[] = [];

    for (const provider of providers) {
      try {
        const result = await bridge.checkHealth(provider.id);
        healths.push({
          providerId: provider.id,
          providerName: provider.name,
          healthy: result.healthy,
          latencyMs: result.latencyMs ?? 9999,
          successRate: result.successRate ?? (result.healthy ? 99 : 0),
          errorRate: result.errorRate ?? 0,
          lastCheckedAt: now,
          consecutiveErrors: result.consecutiveErrors ?? 0,
          modelsAvailable: result.modelsAvailable ?? provider.models.length,
        });
      } catch {
        healths.push({
          providerId: provider.id,
          providerName: provider.name,
          healthy: false,
          latencyMs: 9999,
          successRate: 0,
          errorRate: 100,
          lastCheckedAt: now,
          consecutiveErrors: 999,
          modelsAvailable: 0,
        });
      }
    }

    healthCache = healths;
    healthCacheTime = now;
    return healths;
  }

  /**
   * 执行路由决策
   */
  async route(request: RoutingRequest): Promise<RoutingDecision> {
    const healths = await this.getProviderHealth();
    const bridge = getMegaProviderBridge();
    const allProviders = bridge.listProviders();

    // 0. 强制路由
    if (request.forceProvider) {
      const forced = allProviders.find((p) => p.id === request.forceProvider);
      if (forced) {
        const model = request.forceModel
          ? forced.models.find((m) => m.id === request.forceModel)
          : forced.models[0];
        if (model) {
          return this.buildDecision(forced, model, 'sticky-session', healths, '强制路由');
        }
      }
    }

    // 0b. 按 forceModel 查找 Provider
    if (request.forceModel && !request.forceProvider) {
      for (const provider of allProviders) {
        const model = provider.models.find(
          (m) => m.id === request.forceModel || provider.modelAliases[request.forceModel!] === m.id
        );
        if (model) {
          const health = healths.find((h) => h.providerId === provider.id);
          if (health?.healthy) {
            return this.buildDecision(provider, model, 'sticky-session', healths, '强制模型路由');
          }
        }
      }
    }

    // 1. 会话亲和
    if (this.stickySessionEnabled && request.sessionId) {
      const affinity = sessionAffinity.get(request.sessionId);
      if (affinity) {
        const provider = allProviders.find((p) => p.id === affinity.providerId);
        if (provider) {
          const health = healths.find((h) => h.providerId === provider.id);
          if (health?.healthy) {
            const model = provider.models.find((m) => m.id === affinity.modelId) ?? provider.models[0];
            return this.buildDecision(provider, model, 'sticky-session', healths, '会话亲和命中');
          }
        }
      }
    }

    const strategy = request.strategy ?? this.defaultStrategy;
    let decision: RoutingDecision | null = null;

    switch (strategy) {
      case 'latency-first':
        decision = this.routeLatencyFirst(request, healths, allProviders);
        break;
      case 'weighted-cost':
        decision = this.routeWeightedCost(request, healths, allProviders);
        break;
      case 'round-robin':
        decision = this.routeRoundRobin(request, healths, allProviders);
        break;
      case 'capability-match':
        decision = this.routeCapabilityMatch(request, healths, allProviders);
        break;
      case 'sticky-session':
        decision = this.routeLatencyFirst(request, healths, allProviders); // fallback
        break;
      default:
        decision = this.routeLatencyFirst(request, healths, allProviders);
    }

    // 记录会话亲和
    if (request.sessionId && decision) {
      sessionAffinity.set(request.sessionId, {
        providerId: decision.providerId,
        modelId: decision.modelId,
      });
    }

    // 更新统计
    this.recordRouting(decision, strategy);

    // 推送路由日志
    pushLog(
      `route-${Date.now()}`,
      new Date().toISOString(),
      'ModelRouter',
      decision ? 'INFO' : 'ERROR',
      decision
        ? `路由决策: ${request.requestType || 'chat'} -> ${decision.providerName}/${decision.modelName} (${decision.strategy}, 置信度 ${Math.round(decision.confidence * 100)}%)`
        : `路由失败: 无可用Provider满足请求`,
      'modelRouter'
    );

    if (!decision) {
      throw new Error('No available provider matches the routing request');
    }

    return decision;
  }

  /**
   * 延迟优先策略
   */
  private routeLatencyFirst(
    request: RoutingRequest,
    healths: ProviderHealth[],
    providers: ProviderConfig[]
  ): RoutingDecision | null {
    const candidates = this.filterCandidates(request, healths, providers);
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => a.health.latencyMs - b.health.latencyMs);
    const best = candidates[0];

    return this.buildDecision(
      best.provider,
      best.model,
      'latency-first',
      healths,
      `延迟最低: ${best.health.latencyMs}ms`
    );
  }

  /**
   * 成本加权策略
   */
  private routeWeightedCost(
    request: RoutingRequest,
    healths: ProviderHealth[],
    providers: ProviderConfig[]
  ): RoutingDecision | null {
    const candidates = this.filterCandidates(request, healths, providers);
    if (candidates.length === 0) return null;

    // 按成本排序（越低越好）
    candidates.sort((a, b) => {
      const costA = this.estimateCost(a.model);
      const costB = this.estimateCost(b.model);
      return costA - costB;
    });

    // 加权随机选择（低成本有更高概率）
    const weights = candidates.map((c) => {
      const cost = this.estimateCost(c.model);
      return cost <= 0 ? 100 : Math.max(1, 100 / (cost * 1000));
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    let selected = candidates[0];
    for (let i = 0; i < candidates.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        selected = candidates[i];
        break;
      }
    }

    return this.buildDecision(
      selected.provider,
      selected.model,
      'weighted-cost',
      healths,
      `成本加权: 约 ¥${this.estimateCost(selected.model).toFixed(4)}/1K tokens`
    );
  }

  /**
   * 轮询策略
   */
  private routeRoundRobin(
    request: RoutingRequest,
    healths: ProviderHealth[],
    providers: ProviderConfig[]
  ): RoutingDecision | null {
    const candidates = this.filterCandidates(request, healths, providers);
    if (candidates.length === 0) return null;

    const key = request.sessionId ?? 'global';
    let idx = roundRobinIndex.get(key) ?? -1;
    idx = (idx + 1) % candidates.length;
    roundRobinIndex.set(key, idx);

    const selected = candidates[idx];
    return this.buildDecision(
      selected.provider,
      selected.model,
      'round-robin',
      healths,
      `轮询: 第 ${idx + 1}/${candidates.length} 个`
    );
  }

  /**
   * 能力匹配策略
   */
  private routeCapabilityMatch(
    request: RoutingRequest,
    healths: ProviderHealth[],
    providers: ProviderConfig[]
  ): RoutingDecision | null {
    const candidates = this.filterCandidates(request, healths, providers);
    if (candidates.length === 0) return null;

    // 计算每个候选的能力匹配分数
    const scored = candidates.map((c) => {
      let score = 0;
      const caps = request.capabilities ?? [];

      // 直接能力匹配
      for (const cap of caps) {
        if (c.model.capabilities.includes(cap)) score += 3;
        const preferredProviders = CAPABILITY_PROVIDER_MAP[cap];
        if (preferredProviders?.includes(c.provider.id)) score += 2;
      }

      // 请求类型匹配
      if (request.requestType) {
        const typeMap: Record<string, string[]> = {
          chat: ['chat'],
          code: ['chat'],
          vision: ['chat'],
          embedding: ['embedding'],
          reasoning: ['chat'],
        };
        if (typeMap[request.requestType]?.some((t) => c.model.capabilities.includes(t))) {
          score += 2;
        }
      }

      // 上下文长度满足度
      if (request.minContextWindow && c.model.contextWindow >= request.minContextWindow) {
        score += 1;
      }

      // 延迟惩罚
      score -= c.health.latencyMs / 1000;

      return { ...c, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    return this.buildDecision(
      best.provider,
      best.model,
      'capability-match',
      healths,
      `能力匹配得分: ${Math.round(best.score)}`
    );
  }

  /**
   * 过滤可用候选
   */
  private filterCandidates(
    request: RoutingRequest,
    healths: ProviderHealth[],
    providers: ProviderConfig[]
  ): Array<{ provider: ProviderConfig; model: ModelInfo; health: ProviderHealth }> {
    const candidates: Array<{ provider: ProviderConfig; model: ModelInfo; health: ProviderHealth }> = [];

    for (const provider of providers) {
      const health = healths.find((h) => h.providerId === provider.id);
      if (!health || !health.healthy) continue;
      if (provider.routing && provider.routing.enabled === false) continue;

      for (const model of provider.models) {
        if (model.status !== 'active' && model.status !== 'preview') continue;
        if (request.minContextWindow && model.contextWindow < request.minContextWindow) continue;
        if (request.streaming && !provider.features.streaming) continue;

        candidates.push({ provider, model, health });
      }
    }

    return candidates;
  }

  /**
   * 构建路由决策
   */
  private buildDecision(
    provider: ProviderConfig,
    model: ModelInfo,
    strategy: RouteStrategy,
    healths: ProviderHealth[],
    reason: string
  ): RoutingDecision {
    const health = healths.find((h) => h.providerId === provider.id);
    const allHealthyProviders = healths.filter((h) => h.healthy).map((h) => h.providerName);
    const fallbackChain = provider.routing?.fallbackChain ?? allHealthyProviders;

    // 置信度计算
    let confidence = 0.5;
    if (health) {
      confidence += (health.successRate / 100) * 0.3;
      confidence += Math.max(0, 1 - health.latencyMs / 2000) * 0.2;
    }
    confidence = Math.min(0.99, confidence);

    return {
      providerId: provider.id,
      providerName: provider.name,
      modelId: model.id,
      modelName: model.name,
      strategy,
      confidence,
      latencyMs: health?.latencyMs ?? 0,
      estimatedCost: this.estimateCost(model),
      fallbackChain: fallbackChain.filter((n) => n !== provider.name),
      reason,
    };
  }

  /**
   * 估算成本
   */
  private estimateCost(model: ModelInfo): number {
    return COST_PER_1K_TOKENS[model.id] ?? 0.003;
  }

  /**
   * 记录路由统计
   */
  private recordRouting(decision: RoutingDecision | null, strategy: RouteStrategy): void {
    routingStats.totalRouted += 1;
    routingStats.byStrategy[strategy] = (routingStats.byStrategy[strategy] ?? 0) + 1;

    if (decision) {
      const p = routingStats.byProvider[decision.providerId] ?? {
        requests: 0,
        errors: 0,
        avgLatency: 0,
      };
      p.requests += 1;
      p.avgLatency = (p.avgLatency * (p.requests - 1) + decision.latencyMs) / p.requests;
      routingStats.byProvider[decision.providerId] = p;
    }
  }

  /**
   * 获取路由统计
   */
  getStats(): RoutingStats {
    const providers = Object.values(routingStats.byProvider);
    routingStats.avgLatency =
      providers.length > 0
        ? providers.reduce((a, b) => a + b.avgLatency, 0) / providers.length
        : 0;
    return { ...routingStats };
  }

  /**
   * 获取可用路由策略
   */
  getStrategies(): Array<{
    id: RouteStrategy;
    name: string;
    description: string;
    enabled: boolean;
    priority: number;
    fallbackTo?: string;
    rules: string[];
  }> {
    return [
      {
        id: 'latency-first',
        name: '延迟优先',
        description: '选择当前延迟最低的可用模型，适用于实时对话场景',
        enabled: true,
        priority: 1,
        fallbackTo: 'weighted-cost',
        rules: ['latency < 2000ms', 'availability = 100%'],
      },
      {
        id: 'weighted-cost',
        name: '成本加权',
        description: '按模型定价和服务质量加权分配流量，平衡性能与成本',
        enabled: true,
        priority: 2,
        fallbackTo: 'round-robin',
        rules: ['cost_per_token < 0.01', 'context_length >= 32K'],
      },
      {
        id: 'round-robin',
        name: '轮询均衡',
        description: '简单的轮询调度，均匀分配请求到所有可用模型',
        enabled: true,
        priority: 3,
        fallbackTo: 'latency-first',
        rules: ['all_available = true'],
      },
      {
        id: 'capability-match',
        name: '能力匹配',
        description: '根据请求的特定能力需求（代码、视觉、长文本）匹配最适合的模型',
        enabled: true,
        priority: 4,
        fallbackTo: 'latency-first',
        rules: ['capability match >= 90%'],
      },
      {
        id: 'sticky-session',
        name: '会话亲和',
        description: '同一会话的请求固定路由到同一模型，保持上下文一致性',
        enabled: true,
        priority: 5,
        fallbackTo: 'latency-first',
        rules: ['session_id != null'],
      },
    ];
  }

  /**
   * 获取Provider权重分布
   */
  async getWeightDistribution(): Promise<Array<{
    provider: string;
    weight: number;
    latency: number;
    successRate: number;
  }>> {
    const healths = await this.getProviderHealth();
    const totalWeight = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);

    return healths.map((h) => ({
      provider: h.providerName,
      weight: Math.round(((DEFAULT_WEIGHTS[h.providerId] ?? 5) / totalWeight) * 100),
      latency: h.latencyMs,
      successRate: h.successRate,
    }));
  }

  /**
   * 获取故障转移链
   */
  async getFallbackChains(): Promise<Array<{ from: string; chain: string[] }>> {
    const healths = await this.getProviderHealth();
    const healthy = healths.filter((h) => h.healthy).map((h) => h.providerName);

    return healths.map((h) => ({
      from: h.providerName,
      chain: [h.providerName, ...healthy.filter((n) => n !== h.providerName)],
    }));
  }

  /**
   * 设置默认策略
   */
  setDefaultStrategy(strategy: RouteStrategy): void {
    this.defaultStrategy = strategy;
  }

  /**
   * 获取默认策略
   */
  getDefaultStrategy(): RouteStrategy {
    return this.defaultStrategy;
  }

  // ── 执行层：路由决策后实际调用 LLM API ───────

  /**
   * 执行聊天请求（非流式）
   * 1. 路由选择 Provider
   * 2. 调用 MegaProviderBridge.chatCompletion
   * 3. 返回结果 + 推送日志
   */
  async execute(request: {
    model?: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
    routingRequest?: RoutingRequest;
  }): Promise<{
    success: boolean;
    content: string;
    providerId: string;
    modelId: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    latencyMs: number;
    error?: string;
  }> {
    const start = Date.now();
    const bridge = getMegaProviderBridge();

    // 标准化消息格式
    const messages: ChatCompletionRequest['messages'] = request.messages.map((m) => ({
      role: m.role as any,
      content: m.content,
    }));

    // 如果没有指定 model，先路由决策
    let modelId = request.model;
    let providerId: string;

    if (!modelId) {
      const routingReq = request.routingRequest || {
        requestType: 'chat',
        capabilities: [],
      };
      const decision = await this.route(routingReq);
      modelId = decision.modelId;
      providerId = decision.providerId;
    } else {
      // 验证模型存在
      const alias = bridge.resolveModelAlias(modelId);
      if (alias) {
        providerId = alias.providerId;
        modelId = alias.modelId;
      } else {
        // 尝试直接路由
        const decision = await this.route({
          ...request.routingRequest,
          forceModel: modelId,
        });
        modelId = decision.modelId;
        providerId = decision.providerId;
      }
    }

    try {
      const result = await bridge.chatCompletion({
        model: modelId,
        messages,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        stream: false,
      });

      const latencyMs = Date.now() - start;

      pushLog(
        `exec-${Date.now()}`,
        new Date().toISOString(),
        'ModelRouter',
        'INFO',
        `执行完成: ${providerId}/${modelId} | ${latencyMs}ms | ${result.usage?.totalTokens ?? '?'} tokens`,
        'modelRouter',
        { providerId, modelId, latencyMs, tokens: result.usage },
      );

      return {
        success: true,
        content: result.content,
        providerId: result.provider,
        modelId: result.model,
        usage: result.usage,
        latencyMs,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      logger.error({ err: err.message, providerId, modelId }, '[ModelRouter] execute failed');

      pushLog(
        `exec-err-${Date.now()}`,
        new Date().toISOString(),
        'ModelRouter',
        'ERROR',
        `执行失败: ${providerId}/${modelId} — ${err.message}`,
        'modelRouter',
        { providerId, modelId, latencyMs, error: err.message },
      );

      return {
        success: false,
        content: '',
        providerId,
        modelId,
        latencyMs,
        error: err.message,
      };
    }
  }

  /**
   * 执行流式聊天请求
   * 返回 AsyncGenerator，前端可通过 SSE / WebSocket 消费
   */
  async executeStream(request: {
    model?: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
    routingRequest?: RoutingRequest;
  }): Promise<AsyncGenerator<ChatCompletionChunk, ChatCompletionResponse | undefined>> {
    const bridge = getMegaProviderBridge();

    const messages: ChatCompletionRequest['messages'] = request.messages.map((m) => ({
      role: m.role as any,
      content: m.content,
    }));

    let modelId = request.model;
    let providerId: string;

    if (!modelId) {
      const routingReq = request.routingRequest || {
        requestType: 'chat',
        capabilities: [],
      };
      const decision = await this.route(routingReq);
      modelId = decision.modelId;
      providerId = decision.providerId;
    } else {
      const alias = bridge.resolveModelAlias(modelId);
      if (alias) {
        providerId = alias.providerId;
        modelId = alias.modelId;
      } else {
        const decision = await this.route({
          ...request.routingRequest,
          forceModel: modelId,
        });
        modelId = decision.modelId;
        providerId = decision.providerId;
      }
    }

    pushLog(
      `stream-${Date.now()}`,
      new Date().toISOString(),
      'ModelRouter',
      'INFO',
      `流式启动: ${providerId}/${modelId}`,
      'modelRouter',
    );

    return bridge.streamChatCompletion({
      model: modelId,
      messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      stream: true,
    });
  }

  /**
   * 简单聊天快捷方式
   */
  async chat(prompt: string, options?: Partial<RoutingRequest>): Promise<string> {
    const result = await this.execute({
      messages: [{ role: 'user', content: prompt }],
      routingRequest: options,
    });
    return result.content;
  }
}

// ============================================================================
// 单例
// ============================================================================

let routerInstance: ModelRouter | null = null;

export function getModelRouter(): ModelRouter {
  if (!routerInstance) {
    routerInstance = new ModelRouter();
  }
  return routerInstance;
}

export function resetModelRouter(): void {
  routerInstance = null;
}
