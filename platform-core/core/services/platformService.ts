import { logger } from "../utils/logger";
import { getMegaProviderBridge } from "../coordinator/bridges";
import type { ProviderConfig, ProviderHealthResult } from "../coordinator/bridges/MegaProviderBridge";
import { getSkillBridge } from "../coordinator/bridges";

// ── Types ───────────────────────────────────────────────

export interface PlatformWithModels {
  id: string;
  name: string;
  provider: string;
  tier: "cloud" | "local" | "custom";
  baseUri: string;
  status: "connected" | "disconnected" | "configuring" | "error";
  modelCount: number;
  latency: number;
  lastUsed: string;
  icon: string;
  tint: string;
  description: string;
  apiKeyRequired: boolean;
  docsUrl: string;
  models: Array<{
    id: string;
    name: string;
    contextWindow: number;
    capabilities: string[];
    status: string;
  }>;
  health?: ProviderHealthResult;
}

export interface ModelDetail {
  id: string;
  name: string;
  provider: string;
  platformId: string;
  contextLength: number;
  capabilities: string[];
  description: string;
  version?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  status?: string;
}

// ── Platform Service ────────────────────────────────────

const PLATFORM_META: Record<string, {
  icon: string;
  tint: string;
  description: string;
  docsUrl: string;
}> = {
  openai: { icon: "zap", tint: "#7fa3b0", description: "GPT 系列模型，领先的通用人工智能平台", docsUrl: "https://platform.openai.com/docs" },
  anthropic: { icon: "diamond", tint: "#a78b9a", description: "Claude 系列模型，以安全性和长上下文著称", docsUrl: "https://docs.anthropic.com" },
  google: { icon: "sparkles", tint: "#c9a96e", description: "Google Gemini 系列，原生多模态大模型", docsUrl: "https://ai.google.dev/docs" },
  deepseek: { icon: "brain", tint: "#5b8ab5", description: "DeepSeek 推理模型，数学和编程能力强", docsUrl: "https://platform.deepseek.com/docs" },
  moonshot: { icon: "star", tint: "#d4a373", description: "Moonshot 系列长文本大模型，支持超长上下文", docsUrl: "https://platform.moonshot.cn/docs" },
  ollama: { icon: "cpu", tint: "#7fb89f", description: "本地模型运行时，运行 Llama、Qwen、DeepSeek 等开源模型", docsUrl: "https://ollama.com/library" },
  azure: { icon: "server", tint: "#5b8ab5", description: "Azure 托管的 OpenAI 服务，企业级部署", docsUrl: "https://learn.microsoft.com/azure/ai-services/openai/" },
  custom: { icon: "server", tint: "#c97b84", description: "任意 OpenAI 兼容的自定义 API 端点", docsUrl: "" },
  openrouter: { icon: "route", tint: "#8fa87f", description: "OpenRouter 模型网关，统一接入多个 Provider", docsUrl: "https://openrouter.ai/docs" },
  together: { icon: "zap", tint: "#7fa3b0", description: "Together AI 推理平台", docsUrl: "https://docs.together.ai" },
  groq: { icon: "flash", tint: "#7fb89f", description: "Groq 超高速推理", docsUrl: "https://console.groq.com/docs" },
  lmstudio: { icon: "cpu", tint: "#7fb89f", description: "LM Studio 本地模型", docsUrl: "https://lmstudio.ai/docs" },
  vllm: { icon: "cpu", tint: "#7fb89f", description: "vLLM 高性能本地推理", docsUrl: "https://docs.vllm.ai" },
  sglang: { icon: "cpu", tint: "#7fb89f", description: "SGLang 高效本地推理", docsUrl: "https://docs.sglang.ai" },
  llamacpp: { icon: "cpu", tint: "#7fb89f", description: "llama.cpp 轻量本地推理", docsUrl: "https://github.com/ggerganov/llama.cpp" },
  bedrock: { icon: "server", tint: "#5b8ab5", description: "AWS Bedrock 托管模型", docsUrl: "https://docs.aws.amazon.com/bedrock/" },
  vertex: { icon: "server", tint: "#5b8ab5", description: "Google Vertex AI", docsUrl: "https://cloud.google.com/vertex-ai/docs" },
};

function getMeta(id: string) {
  return PLATFORM_META[id] || { icon: "server", tint: "#c97b84", description: "自定义平台", docsUrl: "" };
}

function formatRelativeTime(date: Date | string | number): string {
  const now = Date.now();
  const ts = typeof date === "number" ? date : new Date(date).getTime();
  const diff = now - ts;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${Math.floor(diff / 86400000)}天前`;
}

/**
 * 获取所有平台的真实数据（含Ollama实时检测）
 */
export async function getPlatformsReal(): Promise<PlatformWithModels[]> {
  const bridge = getMegaProviderBridge();
  const providers = bridge.listProviders();
  const healthResults = await bridge.checkAllHealth();
  const healthMap = new Map(healthResults.map((h) => [h.providerId, h]));

  const platforms: PlatformWithModels[] = [];

  for (const provider of providers) {
    const meta = getMeta(provider.id);
    const health = healthMap.get(provider.id);
    const isConnected = health?.healthy ?? false;
    const latency = health?.latencyMs ?? 0;

    // 推断 tier
    let tier: "cloud" | "local" | "custom" = "custom";
    if (provider.type === "local") tier = "local";
    else if (["international", "chinese", "gateway", "cloud"].includes(provider.type)) tier = "cloud";

    const platform: PlatformWithModels = {
      id: provider.id,
      name: provider.name,
      provider: provider.name,
      tier,
      baseUri: provider.baseUrl,
      status: isConnected ? "connected" : provider.type === "local" ? "disconnected" : "configuring",
      modelCount: isConnected ? (health?.modelsAvailable ?? provider.models.length) : 0,
      latency: latency > 0 ? latency : 0,
      lastUsed: isConnected ? "刚刚" : "从未",
      icon: meta.icon,
      tint: meta.tint,
      description: meta.description,
      apiKeyRequired: provider.authType !== "none",
      docsUrl: meta.docsUrl,
      models: provider.models.map((m) => ({
        id: m.id,
        name: m.name,
        contextWindow: m.contextWindow,
        capabilities: m.capabilities,
        status: m.status,
      })),
      health,
    };

    platforms.push(platform);
  }

  // 添加自定义端点占位（如果还没有）
  if (!platforms.find((p) => p.id === "custom")) {
    const meta = getMeta("custom");
    platforms.push({
      id: "custom",
      name: "自定义端点",
      provider: "Custom Endpoint",
      tier: "custom",
      baseUri: "",
      status: "disconnected",
      modelCount: 0,
      latency: 0,
      lastUsed: "从未",
      icon: meta.icon,
      tint: meta.tint,
      description: meta.description,
      apiKeyRequired: true,
      docsUrl: meta.docsUrl,
      models: [],
    });
  }

  return platforms;
}

/**
 * 获取所有模型的真实数据
 */
export async function getModelsReal(): Promise<ModelDetail[]> {
  const bridge = getMegaProviderBridge();
  const providers = bridge.listProviders();
  const models: ModelDetail[] = [];

  for (const provider of providers) {
    for (const model of provider.models) {
      models.push({
        id: model.id,
        name: model.name,
        provider: provider.name,
        platformId: provider.id,
        contextLength: model.contextWindow,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        capabilities: [...model.capabilities, ...(model.type === "chat" ? ["chat"] : [])],
        description: `${provider.name} ${model.name}，上下文 ${model.contextWindow} tokens`,
        version: "latest",
        status: model.status,
      });
    }
  }

  // 添加自定义占位模型
  models.push({
    id: "custom-generic",
    name: "Custom Model",
    provider: "Custom",
    platformId: "custom",
    contextLength: 4096,
    capabilities: ["chat"],
    description: "自定义端点模型",
    version: "1.0",
    status: "active",
  });

  return models;
}

/**
 * 获取单个平台详情（含实时健康检查）
 */
export async function getPlatformDetail(platformId: string): Promise<PlatformWithModels | null> {
  const bridge = getMegaProviderBridge();
  const provider = bridge.getProvider(platformId);
  if (!provider) return null;

  const health = await bridge.checkHealth(platformId);
  const meta = getMeta(platformId);
  const isConnected = health.healthy;

  let tier: "cloud" | "local" | "custom" = "custom";
  if (provider.type === "local") tier = "local";
  else if (["international", "chinese", "gateway", "cloud"].includes(provider.type)) tier = "cloud";

  return {
    id: provider.id,
    name: provider.name,
    provider: provider.name,
    tier,
    baseUri: provider.baseUrl,
    status: isConnected ? "connected" : provider.type === "local" ? "disconnected" : "configuring",
    modelCount: isConnected ? health.modelsAvailable : 0,
    latency: health.latencyMs > 0 ? health.latencyMs : 0,
    lastUsed: isConnected ? "刚刚" : "从未",
    icon: meta.icon,
    tint: meta.tint,
    description: meta.description,
    apiKeyRequired: provider.authType !== "none",
    docsUrl: meta.docsUrl,
    models: provider.models.map((m) => ({
      id: m.id,
      name: m.name,
      contextWindow: m.contextWindow,
      capabilities: m.capabilities,
      status: m.status,
    })),
    health,
  };
}

/**
 * 测试平台连接（实际HTTP探测）
 */
export async function testPlatformConnection(platformId: string): Promise<{
  success: boolean;
  latency: number;
  status: string;
  error?: string;
}> {
  const bridge = getMegaProviderBridge();
  const health = await bridge.checkHealth(platformId);

  if (health.healthy) {
    return {
      success: true,
      latency: health.latencyMs,
      status: "connected",
    };
  } else {
    return {
      success: false,
      latency: health.latencyMs,
      status: "error",
      error: health.error || "Connection failed",
    };
  }
}

/**
 * 刷新Ollama模型列表（实时探测）
 */
export async function refreshOllamaModels(): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const bridge = getMegaProviderBridge();
    await bridge.refreshOllamaModels();
    const provider = bridge.getProvider("ollama");
    const count = provider?.models.length ?? 0;
    logger.info({ count }, "[PlatformService] Ollama models refreshed");
    return { success: true, count };
  } catch (err: any) {
    logger.error({ error: err.message }, "[PlatformService] Failed to refresh Ollama");
    return { success: false, count: 0, error: err.message };
  }
}

/**
 * 获取技能的真实数据（从SkillBridge扫描）
 */
export async function getSkillsReal(): Promise<Array<{
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  runtime: string;
  capabilities: string[];
  installed: boolean;
  enabled: boolean;
  entry: string;
}>> {
  const bridge = getSkillBridge();
  const skills = bridge.listSkills();

  // 执行健康检查以确定 installed 状态
  const healthResults = await bridge.checkAllHealth();
  const healthMap = new Map(healthResults.map((h) => [h.skillId, h.healthy]));

  return skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description || `${skill.name} 技能`,
    category: skill.category,
    version: skill.version,
    runtime: skill.runtime,
    capabilities: skill.capabilities,
    installed: healthMap.get(skill.id) ?? true,
    enabled: healthMap.get(skill.id) ?? true,
    entry: skill.entry,
  }));
}

/**
 * 扫描workspace skills（实时）
 */
export async function scanWorkspaceSkills(): Promise<Array<{
  id: string;
  name: string;
  category: string;
  version: string;
  runtime: string;
  entry: string;
  description?: string;
}>> {
  const bridge = getSkillBridge();
  const skills = await bridge.scanSkills();
  return skills.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    version: s.version,
    runtime: s.runtime,
    entry: s.entry,
    description: s.description,
  }));
}
