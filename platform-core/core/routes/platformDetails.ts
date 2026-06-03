import { Router } from "express";
import { asyncWrapper } from "../utils/asyncWrapper";
import { getHermesBridge } from "../coordinator/bridges";
import { getMegaProviderBridge } from "../coordinator/bridges";
import { logger } from "../server";

const router: Router = Router();

// ============================================================================
// Types — Platform Detail APIs
// ============================================================================

interface HermesStatus {
  enabled: boolean;
  mode: "disabled" | "local" | "remote";
  cycles: {
    total: number;
    lastCycleAt: string;
    avgCycleDurationMs: number;
  };
  memories: {
    total: number;
    active: number;
    fossilized: number;
    avgRelevance: number;
  };
  skills: {
    total: number;
    active: number;
    avgUsageCount: number;
  };
  evolution: {
    generation: number;
    compressionRatio: number;
    mutationRate: number;
  };
}

interface KnowledgeGraphNode {
  id: string;
  label: string;
  type: "concept" | "entity" | "event" | "skill" | "agent" | "memory";
  weight: number;
  x: number;
  y: number;
  cluster: number;
  metadata?: Record<string, unknown>;
}

interface KnowledgeGraphEdge {
  source: string;
  target: string;
  relation: string;
  strength: number;
}

interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  clusters: Array<{ id: number; name: string; color: string; nodeCount: number }>;
  stats: {
    nodeCount: number;
    edgeCount: number;
    density: number;
    avgClusteringCoefficient: number;
    lastUpdated: string;
  };
}

interface AgentZeroStatus {
  connected: boolean;
  version: string;
  litellm: {
    models: Array<{
      id: string;
      name: string;
      provider: string;
      contextWindow: number;
      costPer1kTokens: number;
      status: "active" | "inactive" | "error";
    }>;
    proxyHealthy: boolean;
    activeModelCount: number;
  };
  agents: Array<{
    id: string;
    name: string;
    status: "idle" | "running" | "error" | "paused";
    health: "healthy" | "degraded" | "unhealthy";
    currentTask?: string;
    skills: string[];
    lastHeartbeat: string;
  }>;
  messageBus: {
    throughputMsgsPerSec: number;
    totalMessagesToday: number;
    queueDepth: number;
    avgLatencyMs: number;
    backends: Array<{ type: string; healthy: boolean; latencyMs: number }>;
  };
  memory: {
    totalMemories: number;
    syncStatus: "synced" | "syncing" | "stale";
    lastSyncAt: string;
  };
}

interface OllamaModel {
  id: string;
  name: string;
  size: number; // bytes
  parameterCount: string;
  format: string;
  quantization: string;
  contextWindow: number;
  loaded: boolean;
  loadedAt?: string;
  lastUsed?: string;
  capabilities: string[];
}

interface OllamaUsage {
  gpu: {
    available: boolean;
    deviceName: string;
    totalVram: number; // MB
    usedVram: number;
    utilizationPercent: number;
    temperature: number;
  };
  cpu: {
    cores: number;
    threads: number;
    utilizationPercent: number;
    memoryUsed: number; // MB
    memoryTotal: number; // MB
  };
  models: Array<{
    modelId: string;
    loaded: boolean;
    vramUsed: number;
    loadTimeMs: number;
    requestsServed: number;
  }>;
  throughput: {
    tokensPerSecond: number;
    requestsPerMinute: number;
    avgLatencyMs: number;
  };
}

interface MegaHubStatus {
  providers: Array<{
    id: string;
    name: string;
    type: string;
    healthy: boolean;
    latencyMs: number;
    modelsAvailable: number;
    activeRequests: number;
    apiKeyConfigured: boolean;
  }>;
  routing: {
    strategy: "priority" | "cost" | "latency" | "balanced" | "round_robin";
    fallbackChain: string[];
    primaryProvider: string;
    decisionsLastHour: number;
  };
  loadBalancer: {
    activeConnections: number;
    queuedRequests: number;
    avgResponseTimeMs: number;
    errorRate: number;
    circuitBreakers: Array<{ providerId: string; open: boolean; lastFailure: string }>;
  };
  levelAPlatforms: Array<{
    tier: string;
    count: number;
    names: string[];
  }>;
}

interface ModelRouterStatus {
  decisions: Array<{
    id: string;
    timestamp: string;
    model: string;
    strategy: string;
    selectedProvider: string;
    fallbackChain: string[];
    estimatedLatencyMs: number;
    estimatedCost: number;
    constraints: string[];
    success: boolean;
    actualLatencyMs?: number;
  }>;
  distribution: Array<{
    providerId: string;
    requestCount: number;
    tokenCount: number;
    successRate: number;
    avgLatencyMs: number;
    sharePercent: number;
  }>;
  latencyMetrics: {
    p50: number;
    p90: number;
    p99: number;
    min: number;
    max: number;
    trend: "improving" | "stable" | "degrading";
  };
  health: {
    totalRequests24h: number;
    successRate: number;
    errorBreakdown: Record<string, number>;
    lastErrorAt?: string;
  };
}

// ============================================================================
// Mock Data Generators
// ============================================================================

function generateKnowledgeGraph(): KnowledgeGraph {
  const clusters = [
    { id: 0, name: "Core Concepts", color: "#7fb89f", nodeCount: 8 },
    { id: 1, name: "Agent Network", color: "#7fa3b0", nodeCount: 9 },
    { id: 2, name: "Skills & Tools", color: "#c9a96e", nodeCount: 7 },
    { id: 3, name: "Memory & State", color: "#a78b9a", nodeCount: 6 },
    { id: 4, name: "Platform Integration", color: "#d4a373", nodeCount: 4 },
  ];

  const nodeLabels = [
    // Cluster 0: Core Concepts
    "Sylva", "Mega", "Hermes", "Agent-Zero", "OpenClaw", "Task Router", "State Manager", "Message Bus",
    // Cluster 1: Agent Network
    "Agent Alpha", "Agent Beta", "Agent Gamma", "Agent Delta", "Leader Node", "Worker Pool", "Swarm Coordinator", "Health Monitor", "Load Balancer",
    // Cluster 2: Skills & Tools
    "Code Review", "Web Search", "Data Analysis", "Document Parser", "Image Analysis", "Prompt Engineer", "RAG Builder",
    // Cluster 3: Memory & State
    "Short-term Memory", "Long-term Memory", "Shared Context", "Episodic Buffer", "Semantic Store", "Fossil Archive",
    // Cluster 4: Platform Integration
    "Ollama", "Kimi", "Claude", "OpenRouter",
  ];

  const nodeTypes: KnowledgeGraphNode["type"][] = [
    "concept", "concept", "concept", "concept", "concept", "concept", "concept", "concept",
    "agent", "agent", "agent", "agent", "agent", "agent", "agent", "agent", "agent",
    "skill", "skill", "skill", "skill", "skill", "skill", "skill",
    "memory", "memory", "memory", "memory", "memory", "memory",
    "entity", "entity", "entity", "entity",
  ];

  const nodes: KnowledgeGraphNode[] = nodeLabels.map((label, i) => {
    const cluster = clusters.find((c) => {
      let offset = 0;
      for (const cl of clusters) {
        if (cl.id === c.id) return i >= offset && i < offset + cl.nodeCount;
        offset += cl.nodeCount;
      }
      return false;
    }) || clusters[0];

    return {
      id: `n${i}`,
      label,
      type: nodeTypes[i],
      weight: Math.random() * 0.8 + 0.2,
      x: Math.cos((i / nodeLabels.length) * Math.PI * 2) * (200 + Math.random() * 100) + 400,
      y: Math.sin((i / nodeLabels.length) * Math.PI * 2) * (200 + Math.random() * 100) + 300,
      cluster: cluster.id,
      metadata: { description: `Node representing ${label}` },
    };
  });

  const edges: KnowledgeGraphEdge[] = [];
  const edgeSet = new Set<string>();

  // Create edges based on cluster proximity and some cross-cluster connections
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const sameCluster = nodes[i].cluster === nodes[j].cluster;
      const prob = sameCluster ? 0.35 : 0.08;
      if (Math.random() < prob) {
        const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          const relations = ["depends_on", "communicates_with", "extends", "uses", "references", "triggers"];
          edges.push({
            source: nodes[i].id,
            target: nodes[j].id,
            relation: relations[Math.floor(Math.random() * relations.length)],
            strength: Math.random() * 0.7 + 0.3,
          });
        }
      }
    }
  }

  return {
    nodes,
    edges,
    clusters,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      density: edges.length / (nodes.length * (nodes.length - 1) / 2),
      avgClusteringCoefficient: 0.42 + Math.random() * 0.2,
      lastUpdated: new Date().toISOString(),
    },
  };
}

// ============================================================================
// Hermes Routes
// ============================================================================

router.get("/hermes/status", asyncWrapper(async (_req, res) => {
  const bridge = getHermesBridge();
  const status: HermesStatus = {
    enabled: bridge.enabled,
    mode: bridge.mode,
    cycles: {
      total: 1427,
      lastCycleAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      avgCycleDurationMs: 2847,
    },
    memories: {
      total: 15234,
      active: 8431,
      fossilized: 6803,
      avgRelevance: 0.73,
    },
    skills: {
      total: 67,
      active: 45,
      avgUsageCount: 312,
    },
    evolution: {
      generation: 23,
      compressionRatio: 0.34,
      mutationRate: 0.02,
    },
  };

  res.json({ success: true, data: status });
}));

router.get("/hermes/graph", asyncWrapper(async (_req, res) => {
  const graph = generateKnowledgeGraph();
  res.json({ success: true, data: graph });
}));

// ============================================================================
// Agent-Zero Routes
// ============================================================================

router.get("/agent-zero/status", asyncWrapper(async (_req, res) => {
  const status: AgentZeroStatus = {
    connected: true,
    version: "0.4.2",
    litellm: {
      models: [
        { id: "gpt-4o", name: "GPT-4o", provider: "openai", contextWindow: 128000, costPer1kTokens: 0.005, status: "active" },
        { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", provider: "anthropic", contextWindow: 200000, costPer1kTokens: 0.003, status: "active" },
        { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "google", contextWindow: 1000000, costPer1kTokens: 0.00035, status: "active" },
        { id: "deepseek-chat", name: "DeepSeek V3", provider: "deepseek", contextWindow: 64000, costPer1kTokens: 0.0009, status: "active" },
        { id: "kimi-k2", name: "Kimi K2", provider: "moonshot", contextWindow: 256000, costPer1kTokens: 0.002, status: "active" },
        { id: "qwen2.5:7b-custom", name: "Qwen2.5 7B (Local)", provider: "ollama", contextWindow: 32768, costPer1kTokens: 0, status: "active" },
      ],
      proxyHealthy: true,
      activeModelCount: 6,
    },
    agents: [
      { id: "az-1", name: "Zero-Core", status: "running", health: "healthy", currentTask: "route-task-8392", skills: ["routing", "planning"], lastHeartbeat: new Date(Date.now() - 5000).toISOString() },
      { id: "az-2", name: "Zero-Worker-A", status: "idle", health: "healthy", skills: ["code", "analysis"], lastHeartbeat: new Date(Date.now() - 8000).toISOString() },
      { id: "az-3", name: "Zero-Worker-B", status: "running", health: "healthy", currentTask: "analyze-data-221", skills: ["search", "summarization"], lastHeartbeat: new Date(Date.now() - 6000).toISOString() },
      { id: "az-4", name: "Zero-Worker-C", status: "paused", health: "degraded", skills: ["vision", "ocr"], lastHeartbeat: new Date(Date.now() - 120000).toISOString() },
    ],
    messageBus: {
      throughputMsgsPerSec: 142.5,
      totalMessagesToday: 28473,
      queueDepth: 12,
      avgLatencyMs: 3.2,
      backends: [
        { type: "local", healthy: true, latencyMs: 0.5 },
        { type: "redis", healthy: true, latencyMs: 2.1 },
        { type: "websocket", healthy: true, latencyMs: 5.8 },
      ],
    },
    memory: {
      totalMemories: 4521,
      syncStatus: "synced",
      lastSyncAt: new Date(Date.now() - 60000).toISOString(),
    },
  };

  res.json({ success: true, data: status });
}));

// ============================================================================
// Ollama Routes
// ============================================================================

router.get("/ollama/models", asyncWrapper(async (_req, res) => {
  const models: OllamaModel[] = [
    {
      id: "qwen2.5:7b-custom",
      name: "Qwen2.5 7B Custom",
      size: 4_700_000_000,
      parameterCount: "7.6B",
      format: "gguf",
      quantization: "Q4_K_M",
      contextWindow: 32768,
      loaded: true,
      loadedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      lastUsed: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      capabilities: ["streaming", "chat", "localInference"],
    },
    {
      id: "qwen2.5:1.5b",
      name: "Qwen2.5 1.5B",
      size: 986_000_000,
      parameterCount: "1.5B",
      format: "gguf",
      quantization: "Q4_K_M",
      contextWindow: 32768,
      loaded: false,
      capabilities: ["streaming", "chat", "localInference"],
    },
    {
      id: "qwen2.5:0.5b",
      name: "Qwen2.5 0.5B",
      size: 397_000_000,
      parameterCount: "0.5B",
      format: "gguf",
      quantization: "Q4_0",
      contextWindow: 32768,
      loaded: false,
      capabilities: ["streaming", "chat", "localInference"],
    },
    {
      id: "DeepSeek-R1-Distill-Qwen-14B",
      name: "DeepSeek R1 Distill Qwen 14B",
      size: 9_100_000_000,
      parameterCount: "14B",
      format: "gguf",
      quantization: "Q4_K_M",
      contextWindow: 32768,
      loaded: true,
      loadedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      lastUsed: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      capabilities: ["streaming", "chat", "reasoning", "localInference"],
    },
    {
      id: "llama3.2:3b",
      name: "Llama 3.2 3B",
      size: 1_900_000_000,
      parameterCount: "3.2B",
      format: "gguf",
      quantization: "Q4_K_M",
      contextWindow: 128000,
      loaded: false,
      capabilities: ["streaming", "chat", "toolUse", "localInference"],
    },
  ];

  res.json({ success: true, data: models, count: models.length });
}));

router.get("/ollama/usage", asyncWrapper(async (_req, res) => {
  const usage: OllamaUsage = {
    gpu: {
      available: true,
      deviceName: "NVIDIA RTX 4090",
      totalVram: 24564,
      usedVram: 14230,
      utilizationPercent: 58,
      temperature: 68,
    },
    cpu: {
      cores: 16,
      threads: 32,
      utilizationPercent: 23,
      memoryUsed: 12480,
      memoryTotal: 65536,
    },
    models: [
      { modelId: "qwen2.5:7b-custom", loaded: true, vramUsed: 5200, loadTimeMs: 3200, requestsServed: 847 },
      { modelId: "DeepSeek-R1-Distill-Qwen-14B", loaded: true, vramUsed: 9030, loadTimeMs: 7800, requestsServed: 124 },
    ],
    throughput: {
      tokensPerSecond: 42.3,
      requestsPerMinute: 8.5,
      avgLatencyMs: 1250,
    },
  };

  res.json({ success: true, data: usage });
}));

// ============================================================================
// Mega Hub Routes
// ============================================================================

router.get("/mega-hub/status", asyncWrapper(async (_req, res) => {
  const bridge = getMegaProviderBridge();
  const providers = bridge.listProviders();

  const megaHubStatus: MegaHubStatus = {
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      healthy: bridge.hasApiKey(p.id) || p.type === "local",
      latencyMs: Math.floor(Math.random() * 200) + 50,
      modelsAvailable: p.models.length,
      activeRequests: Math.floor(Math.random() * 10),
      apiKeyConfigured: bridge.hasApiKey(p.id) || p.type === "local",
    })),
    routing: {
      strategy: "balanced",
      fallbackChain: ["moonshot", "deepseek", "openai", "anthropic"],
      primaryProvider: "moonshot",
      decisionsLastHour: 2847,
    },
    loadBalancer: {
      activeConnections: 42,
      queuedRequests: 3,
      avgResponseTimeMs: 234,
      errorRate: 0.002,
      circuitBreakers: [
        { providerId: "grok", open: false, lastFailure: new Date(Date.now() - 24 * 3600 * 1000).toISOString() },
        { providerId: "perplexity", open: false, lastFailure: new Date(Date.now() - 12 * 3600 * 1000).toISOString() },
      ],
    },
    levelAPlatforms: [
      { tier: "国际", count: 9, names: ["OpenAI", "Anthropic", "Google", "Grok", "Mistral", "Cohere", "AI21", "Perplexity", "DeepSeek"] },
      { tier: "国内", count: 9, names: ["阿里云", "智谱", "百度", "腾讯", "MiniMax", "字节豆包", "零一万物", "Moonshot", "StepFun"] },
      { tier: "网关", count: 5, names: ["OpenRouter", "Together", "Fireworks", "SiliconFlow", "Groq"] },
      { tier: "云厂商", count: 3, names: ["AWS Bedrock", "Azure OpenAI", "Google Vertex"] },
      { tier: "本地", count: 5, names: ["Ollama", "LM Studio", "vLLM", "SGLang", "llama.cpp"] },
    ],
  };

  res.json({ success: true, data: megaHubStatus });
}));

// ============================================================================
// Model Router Routes
// ============================================================================

router.get("/model-router/status", asyncWrapper(async (_req, res) => {
  const decisions = Array.from({ length: 20 }, (_, i) => ({
    id: `route-${Date.now()}-${i}`,
    timestamp: new Date(Date.now() - i * 5 * 60 * 1000).toISOString(),
    model: ["gpt-4o", "claude-3-5-sonnet", "kimi-k2", "deepseek-chat", "gemini-2.0-flash"][i % 5],
    strategy: ["balanced", "latency", "cost", "priority", "round_robin"][i % 5],
    selectedProvider: ["openai", "anthropic", "moonshot", "deepseek", "google"][i % 5],
    fallbackChain: ["moonshot", "deepseek", "openai"],
    estimatedLatencyMs: Math.floor(Math.random() * 500) + 100,
    estimatedCost: Math.random() * 0.01,
    constraints: ["streaming", "functionCalling"],
    success: Math.random() > 0.05,
    actualLatencyMs: Math.floor(Math.random() * 600) + 80,
  }));

  const distribution = [
    { providerId: "openai", requestCount: 3421, tokenCount: 12845000, successRate: 0.998, avgLatencyMs: 245, sharePercent: 28.5 },
    { providerId: "anthropic", requestCount: 2187, tokenCount: 9872000, successRate: 0.996, avgLatencyMs: 312, sharePercent: 18.2 },
    { providerId: "moonshot", requestCount: 4532, tokenCount: 15230000, successRate: 0.999, avgLatencyMs: 198, sharePercent: 37.8 },
    { providerId: "deepseek", requestCount: 1234, tokenCount: 4567000, successRate: 0.994, avgLatencyMs: 278, sharePercent: 10.3 },
    { providerId: "google", requestCount: 654, tokenCount: 2345000, successRate: 0.997, avgLatencyMs: 220, sharePercent: 5.2 },
  ];

  const status: ModelRouterStatus = {
    decisions,
    distribution,
    latencyMetrics: {
      p50: 198,
      p90: 312,
      p99: 520,
      min: 45,
      max: 1200,
      trend: "stable",
    },
    health: {
      totalRequests24h: 12028,
      successRate: 0.997,
      errorBreakdown: { timeout: 12, rate_limit: 8, auth_error: 3, unknown: 5 },
      lastErrorAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    },
  };

  res.json({ success: true, data: status });
}));

export default router;
