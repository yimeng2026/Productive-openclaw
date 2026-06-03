import { Router } from "express";
import { asyncWrapper } from "../utils/asyncWrapper";
import { getDb } from "../database/sqlite";
import { logger } from "../server";
import { getSkillBridge } from "../coordinator/bridges";
import { getMegaProviderBridge } from "../coordinator/bridges";

const router: Router = Router();

// ============================================================================
// Types
// ============================================================================

type SwarmMode = "sequential" | "parallel" | "hierarchical" | "dynamic";
type AgentStatus = "idle" | "running" | "error" | "paused";
type AgentHealth = "healthy" | "degraded" | "unhealthy";
type AgentRole = "leader" | "worker" | "solo";
type LevelBAccessLayer = "mega" | "sylva" | "agentzero";
type LevelCRuntime = "openclaw" | "sylva" | "stepclaw" | "kimi" | "minimax" | "modelscope" | "qclaw" | "chatclaw" | "bloomgarden";
type AgentZeroMode = "native" | "bridge" | "none";
type ProviderType = "international" | "chinese" | "gateway" | "cloud" | "local";

interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  apiKeyEnvVar: string;
  models: string[];
  capabilities: string[];
}

interface AgentRegistration {
  id: string;
  name: string;
  levelA: string[];
  levelB: LevelBAccessLayer;
  levelC: LevelCRuntime;
  agentZeroProfile?: string;
  agentZeroMode: AgentZeroMode;
  swarmId?: string;
  role: AgentRole;
  status: AgentStatus;
  health: AgentHealth;
  skills: string[];
  capabilities: string[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  maxConcurrentTasks: number;
  priority: number;
  createdAt: string;
  updatedAt?: string;
}

interface CreateAgentRequest {
  name: string;
  providers: { id: string; priority: number; model?: string }[];
  accessLayer?: LevelBAccessLayer;
  routingStrategy?: "priority" | "cost" | "latency" | "balanced";
  runtime?: LevelCRuntime;
  agentZero?: { enabled: boolean; mode: "native" | "bridge"; profile?: string; skills?: string[] };
  swarm?: { swarmId?: string; createNew?: boolean; role?: "leader" | "worker" };
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  skills?: string[];
  maxConcurrentTasks?: number;
}

interface TaskRequest {
  id?: string;
  type?: "chat" | "code" | "search" | "analysis" | "custom";
  prompt: string;
  context?: Record<string, unknown>;
  attachments?: string[];
}

interface SwarmState {
  id: string;
  name: string;
  mode: SwarmMode;
  agents: string[];
  leader?: string;
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  createdAt: string;
  updatedAt?: string;
}

// ============================================================================
// In-Memory Storage
// ============================================================================

const agents = new Map<string, AgentRegistration>();
const swarms = new Map<string, SwarmState>();
const activeTasks = new Map<string, { taskId: string; type: string; status: string; startedAt: string }>();

// ============================================================================
// Provider Registry (31 Level-A Providers + Ollama auto-detected)
// ============================================================================

const PROVIDERS: ProviderConfig[] = [
  { id: "openai", name: "OpenAI", type: "international", apiKeyEnvVar: "OPENAI_API_KEY", models: ["gpt-4o", "gpt-4o-mini"], capabilities: ["streaming", "functionCalling", "vision"] },
  { id: "anthropic", name: "Anthropic Claude", type: "international", apiKeyEnvVar: "ANTHROPIC_API_KEY", models: ["claude-3-5-sonnet", "claude-3-opus"], capabilities: ["streaming", "toolUse", "vision"] },
  { id: "google", name: "Google Gemini", type: "international", apiKeyEnvVar: "GOOGLE_API_KEY", models: ["gemini-2.0-flash", "gemini-2.0-pro"], capabilities: ["streaming", "functionCalling", "vision"] },
  { id: "grok", name: "Grok (xAI)", type: "international", apiKeyEnvVar: "GROK_API_KEY", models: ["grok-2"], capabilities: ["streaming"] },
  { id: "mistral", name: "Mistral AI", type: "international", apiKeyEnvVar: "MISTRAL_API_KEY", models: ["mistral-large", "mistral-medium"], capabilities: ["streaming", "functionCalling"] },
  { id: "cohere", name: "Cohere", type: "international", apiKeyEnvVar: "COHERE_API_KEY", models: ["command-r", "command-r-plus"], capabilities: ["streaming", "toolUse"] },
  { id: "ai21", name: "AI21 Labs", type: "international", apiKeyEnvVar: "AI21_API_KEY", models: ["jamba-1.5-large"], capabilities: ["streaming"] },
  { id: "perplexity", name: "Perplexity", type: "international", apiKeyEnvVar: "PERPLEXITY_API_KEY", models: ["sonar", "sonar-pro"], capabilities: ["streaming", "webSearch"] },
  { id: "deepseek", name: "DeepSeek", type: "international", apiKeyEnvVar: "DEEPSEEK_API_KEY", models: ["deepseek-chat", "deepseek-reasoner"], capabilities: ["streaming", "reasoning"] },
  { id: "aliyun", name: "阿里云 Qwen", type: "chinese", apiKeyEnvVar: "ALIYUN_API_KEY", models: ["qwen-max", "qwen-plus"], capabilities: ["streaming", "functionCalling"] },
  { id: "zhipu", name: "智谱 GLM", type: "chinese", apiKeyEnvVar: "ZHIPU_API_KEY", models: ["glm-4", "glm-4v"], capabilities: ["streaming", "vision"] },
  { id: "baidu", name: "百度 ERNIE", type: "chinese", apiKeyEnvVar: "BAIDU_API_KEY", models: ["ernie-4.0", "ernie-speed"], capabilities: ["streaming"] },
  { id: "tencent", name: "腾讯 Hunyuan", type: "chinese", apiKeyEnvVar: "TENCENT_API_KEY", models: ["hunyuan-pro", "hunyuan-standard"], capabilities: ["streaming"] },
  { id: "minimax", name: "MiniMax", type: "chinese", apiKeyEnvVar: "MINIMAX_API_KEY", models: ["abab6.5s", "abab6.5"], capabilities: ["streaming"] },
  { id: "doubao", name: "字节豆包", type: "chinese", apiKeyEnvVar: "DOUBAO_API_KEY", models: ["doubao-pro", "doubao-lite"], capabilities: ["streaming"] },
  { id: "yi", name: "零一万物 Yi", type: "chinese", apiKeyEnvVar: "YI_API_KEY", models: ["yi-large", "yi-medium"], capabilities: ["streaming"] },
  { id: "moonshot", name: "Moonshot Kimi", type: "chinese", apiKeyEnvVar: "MOONSHOT_API_KEY", models: ["kimi-latest", "kimi-k2"], capabilities: ["streaming", "functionCalling"] },
  { id: "stepfun", name: "StepFun (跃问)", type: "chinese", apiKeyEnvVar: "STEPFUN_API_KEY", models: ["step-1", "step-2"], capabilities: ["streaming"] },
  { id: "openrouter", name: "OpenRouter", type: "gateway", apiKeyEnvVar: "OPENROUTER_API_KEY", models: ["openai/gpt-4o", "anthropic/claude-3.5-sonnet"], capabilities: ["streaming", "functionCalling"] },
  { id: "together", name: "Together AI", type: "gateway", apiKeyEnvVar: "TOGETHER_API_KEY", models: ["llama-3-70b", "mixtral-8x22b"], capabilities: ["streaming"] },
  { id: "fireworks", name: "Fireworks AI", type: "gateway", apiKeyEnvVar: "FIREWORKS_API_KEY", models: ["llama-v3p1-405b"], capabilities: ["streaming", "functionCalling"] },
  { id: "siliconflow", name: "SiliconFlow", type: "gateway", apiKeyEnvVar: "SILICONFLOW_API_KEY", models: ["deepseek-ai/DeepSeek-V2.5"], capabilities: ["streaming"] },
  { id: "groq", name: "Groq", type: "gateway", apiKeyEnvVar: "GROQ_API_KEY", models: ["llama-3.1-70b", "mixtral-8x7b"], capabilities: ["streaming", "toolUse"] },
  { id: "bedrock", name: "AWS Bedrock", type: "cloud", apiKeyEnvVar: "AWS_ACCESS_KEY_ID", models: ["claude-3-5-sonnet", "llama-3-70b"], capabilities: ["streaming", "functionCalling"] },
  { id: "azure", name: "Azure OpenAI", type: "cloud", apiKeyEnvVar: "AZURE_OPENAI_API_KEY", models: ["gpt-4o", "gpt-4"], capabilities: ["streaming", "functionCalling", "vision"] },
  { id: "vertex", name: "Google Vertex", type: "cloud", apiKeyEnvVar: "GOOGLE_APPLICATION_CREDENTIALS", models: ["gemini-1.5-pro", "gemini-1.5-flash"], capabilities: ["streaming", "functionCalling", "vision"] },
  { id: "ollama", name: "Ollama Local", type: "local", apiKeyEnvVar: "", baseUrl: "http://localhost:11434/v1", models: ["qwen2.5:7b-custom", "qwen2.5:1.5b", "qwen2.5:0.5b", "DeepSeek-R1-Distill-Qwen-14B"], capabilities: ["streaming", "localInference", "reasoning"] },
  { id: "lmstudio", name: "LM Studio", type: "local", apiKeyEnvVar: "", models: ["local-model"], capabilities: ["streaming", "localInference"] },
  { id: "vllm", name: "vLLM", type: "local", apiKeyEnvVar: "", models: ["local-model"], capabilities: ["streaming", "localInference"] },
  { id: "sglang", name: "SGLang", type: "local", apiKeyEnvVar: "", models: ["local-model"], capabilities: ["streaming", "localInference"] },
  { id: "llamacpp", name: "llama.cpp", type: "local", apiKeyEnvVar: "", models: ["local-model"], capabilities: ["streaming", "localInference"] },
];

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function getAgentFromDb(id: string): Promise<AgentRegistration | null> {
  return agents.get(id) || null;
}

async function saveAgentToDb(agent: AgentRegistration): Promise<void> {
  agents.set(agent.id, agent);
}

async function deleteAgentFromDb(id: string): Promise<void> {
  agents.delete(id);
}

async function checkProviderHealth(providerId: string): Promise<boolean> {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (!provider) return false;
  if (provider.type === "local") {
    try {
      const res = await fetch(`${provider.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }
  return !!process.env[provider.apiKeyEnvVar];
}

async function registerAgentToZero(agent: AgentRegistration): Promise<boolean> {
  if (agent.agentZeroMode === "none") return true;
  try {
    const zeroUrl = process.env.AGENT_ZERO_URL || "http://localhost:8000";
    const res = await fetch(`${zeroUrl}/api/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: agent.id, name: agent.name, model: agent.levelA[0], system_prompt: agent.systemPrompt, skills: agent.skills }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function unregisterAgentFromZero(agentId: string): Promise<boolean> {
  try {
    const zeroUrl = process.env.AGENT_ZERO_URL || "http://localhost:8000";
    const res = await fetch(`${zeroUrl}/api/agents/${agentId}`, { method: "DELETE", signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// Providers Routes (mounted at /api/v2/providers)
// ============================================================================

router.get("/providers", asyncWrapper(async (_req, res) => {
  const bridge = getMegaProviderBridge();
  const providers = bridge.listByCategory();
  
  // Add health status to each provider
  const result: Record<string, any[]> = {};
  for (const [type, list] of Object.entries(providers)) {
    result[type] = list.map((p) => ({
      ...p,
      healthy: bridge.hasApiKey(p.id) || p.type === "local",
      apiKeyConfigured: bridge.hasApiKey(p.id) || p.type === "local",
    }));
  }

  const total = Object.values(result).reduce((sum, arr) => sum + arr.length, 0);
  res.json({ success: true, data: result, total });
}));

// GET /api/v2/providers/:id/health — Provider健康检查
router.get("/providers/:id/health", asyncWrapper(async (req, res) => {
  const { id } = req.params;
  const provider = PROVIDERS.find((p) => p.id === id);

  if (!provider) {
    res.status(404).json({ success: false, error: "Provider not found" });
    return;
  }

  const healthy = await checkProviderHealth(id);

  res.json({
    success: true,
    data: {
      providerId: id,
      name: provider.name,
      healthy,
      type: provider.type,
      apiKeyConfigured: provider.type === "local" ? true : !!process.env[provider.apiKeyEnvVar],
      checkedAt: new Date().toISOString(),
    },
  });
}));

// ============================================================================
// Swarm Routes (mounted at /api/v2/swarm)
// ============================================================================

router.get("/swarm", asyncWrapper(async (_req, res) => {
  const data = Array.from(swarms.values()).map((s) => ({ ...s, agentCount: s.agents.length }));
  res.json({ success: true, data, count: data.length });
}));

router.post("/swarm", asyncWrapper(async (req, res) => {
  const body = req.body as { name: string; mode: SwarmMode; agents: string[]; leader?: string };
  if (!body.name || !body.mode || !body.agents?.length) {
    res.status(400).json({ error: "Missing required fields: name, mode, agents" });
    return;
  }

  const swarmId = generateId("swarm");
  const now = new Date().toISOString();
  const swarm: SwarmState = {
    id: swarmId,
    name: body.name,
    mode: body.mode,
    agents: body.agents,
    leader: body.leader,
    activeTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    createdAt: now,
    updatedAt: now,
  };

  swarms.set(swarmId, swarm);

  // Update agent swarmId
  for (const agentId of body.agents) {
    const agent = agents.get(agentId);
    if (agent) {
      agent.swarmId = swarmId;
      agent.role = body.leader === agentId ? "leader" : "worker";
      agent.updatedAt = now;
    }
  }

  res.status(201).json({ success: true, data: swarm });
}));

// ============================================================================
// Agent Routes (mounted at /api/v2/agents)
// ============================================================================

router.post("/agents", asyncWrapper(async (req, res) => {
  const body = req.body as CreateAgentRequest;
  if (!body.name || !body.providers?.length) {
    res.status(400).json({ error: "Missing required fields: name, providers" });
    return;
  }

  const agentId = generateId("agent");
  const now = new Date().toISOString();

  // Step 1: Validate Providers
  const providerStatus: Record<string, boolean> = {};
  for (const p of body.providers) {
    providerStatus[p.id] = await checkProviderHealth(p.id);
  }

  // Step 2: Create Agent
  const agent: AgentRegistration = {
    id: agentId,
    name: body.name,
    levelA: body.providers.map((p) => p.id),
    levelB: body.accessLayer || "mega",
    levelC: body.runtime || "openclaw",
    agentZeroMode: body.agentZero?.enabled ? (body.agentZero.mode === "native" ? "native" : "bridge") : "none",
    agentZeroProfile: body.agentZero?.profile,
    role: body.swarm?.role || "solo",
    status: "idle",
    health: "healthy",
    skills: body.skills || [],
    capabilities: [],
    systemPrompt: body.systemPrompt,
    temperature: body.temperature ?? 0.7,
    maxTokens: body.maxTokens ?? 2048,
    maxConcurrentTasks: body.maxConcurrentTasks ?? 1,
    priority: 100,
    createdAt: now,
    updatedAt: now,
  };

  // Step 3: Agent-Zero Integration
  if (body.agentZero?.enabled) {
    const zeroRegistered = await registerAgentToZero(agent);
    if (!zeroRegistered) {
      agent.health = "degraded";
      agent.status = "error";
    }
  }

  // Step 4: Swarm Assignment
  if (body.swarm?.swarmId) {
    const swarm = swarms.get(body.swarm.swarmId);
    if (swarm) {
      agent.swarmId = swarm.id;
      agent.role = body.swarm.role || "worker";
      swarm.agents.push(agentId);
      swarm.updatedAt = now;
    }
  }

  await saveAgentToDb(agent);

  res.status(201).json({
    success: true,
    data: { agent, providerStatus, healthCheck: agent.health === "healthy" },
  });
}));

router.get("/agents", asyncWrapper(async (req, res) => {
  const { bySwarm, byProvider, byStatus } = req.query;
  let data = Array.from(agents.values());

  if (bySwarm) data = data.filter((a) => a.swarmId === bySwarm);
  if (byProvider) data = data.filter((a) => a.levelA.includes(String(byProvider)));
  if (byStatus) data = data.filter((a) => a.status === byStatus);

  res.json({ success: true, data, count: data.length });
}));

router.get("/agents/:id", asyncWrapper(async (req, res) => {
  const { id } = req.params;
  const agent = await getAgentFromDb(id);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const providerStatus: Record<string, boolean> = {};
  for (const pid of agent.levelA) {
    providerStatus[pid] = await checkProviderHealth(pid);
  }

  res.json({
    success: true,
    data: { agent, providerStatus, activeTask: activeTasks.get(id) || null },
  });
}));

router.put("/agents/:id", asyncWrapper(async (req, res) => {
  const { id } = req.params;
  const updates = req.body as Partial<CreateAgentRequest>;
  const agent = await getAgentFromDb(id);

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const now = new Date().toISOString();
  if (updates.name) agent.name = updates.name;
  if (updates.providers) agent.levelA = updates.providers.map((p) => p.id);
  if (updates.systemPrompt) agent.systemPrompt = updates.systemPrompt;
  if (updates.skills) agent.skills = updates.skills;
  if (updates.swarm?.swarmId !== undefined) agent.swarmId = updates.swarm.swarmId || undefined;
  agent.updatedAt = now;

  await saveAgentToDb(agent);

  const providerStatus: Record<string, boolean> = {};
  for (const pid of agent.levelA) {
    providerStatus[pid] = await checkProviderHealth(pid);
  }

  res.json({ success: true, data: { agent, providerStatus, revalidated: !!updates.providers } });
}));

router.delete("/agents/:id", asyncWrapper(async (req, res) => {
  const { id } = req.params;
  const agent = await getAgentFromDb(id);

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const zeroUnregistered = agent.agentZeroMode !== "none" ? await unregisterAgentFromZero(id) : false;

  if (agent.swarmId) {
    const swarm = swarms.get(agent.swarmId);
    if (swarm) {
      swarm.agents = swarm.agents.filter((a) => a !== id);
      if (swarm.leader === id) swarm.leader = undefined;
    }
  }

  await deleteAgentFromDb(id);
  activeTasks.delete(id);

  res.json({ success: true, data: { agentId: id, zeroUnregistered, deleted: true } });
}));

router.post("/agents/:id/tasks", asyncWrapper(async (req, res) => {
  const { id } = req.params;
  const body = req.body as TaskRequest;
  const agent = await getAgentFromDb(id);

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  if (!body.prompt) {
    res.status(400).json({ error: "Missing required field: prompt" });
    return;
  }

  const taskId = generateId("task");
  const now = new Date().toISOString();

  activeTasks.set(id, { taskId, type: body.type || "chat", status: "running", startedAt: now });
  agent.status = "running";
  agent.updatedAt = now;

  // Simulate async processing
  setTimeout(async () => {
    activeTasks.set(id, { taskId, type: body.type || "chat", status: "completed", startedAt: now });
    agent.status = "idle";
    agent.updatedAt = new Date().toISOString();
    await saveAgentToDb(agent);
  }, 100);

  res.status(202).json({
    success: true,
    data: { taskId, agentId: id, status: "accepted", executionMode: agent.swarmId ? "swarm" : "solo" },
  });
}));

// ============================================================================
// Skills API
// ============================================================================

router.get("/skills", asyncWrapper(async (_req, res) => {
  const bridge = getSkillBridge();
  const skills = bridge.listSkills();
  res.json({ success: true, data: skills, count: skills.length });
}));

router.get("/skills/:id/health", asyncWrapper(async (req, res) => {
  const bridge = getSkillBridge();
  const result = await bridge.checkHealth(req.params.id);
  res.json({ success: true, data: result });
}));

// ============================================================================
// Skill Scan API
// ============================================================================

router.post("/skills/scan", asyncWrapper(async (_req, res) => {
  const bridge = getSkillBridge();
  const skills = await bridge.scanSkills();
  res.json({ success: true, data: skills, count: skills.length, message: "Workspace skills scanned successfully" });
}));

// ============================================================================
// Task Management API (Chat Panel)
// ============================================================================

interface TaskDetail {
  taskId: string;
  agentId: string;
  type: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  prompt: string;
  progress: number;
  startedAt: string;
  completedAt?: string;
  output?: string;
  error?: string;
  interrupted: boolean;
}

const taskStore = new Map<string, TaskDetail>();

router.get("/tasks/:taskId", asyncWrapper(async (req, res) => {
  const { taskId } = req.params;
  const task = taskStore.get(taskId);

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.json({ success: true, data: task });
}));

router.get("/tasks/:taskId/results", asyncWrapper(async (req, res) => {
  const { taskId } = req.params;
  const task = taskStore.get(taskId);

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (task.status !== "completed" && task.status !== "failed") {
    res.status(202).json({ success: true, data: { taskId, status: task.status, message: "Task still in progress" } });
    return;
  }

  res.json({
    success: true,
    data: {
      taskId: task.taskId,
      status: task.status,
      output: task.output,
      error: task.error,
      completedAt: task.completedAt,
      durationMs: task.completedAt ? new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime() : undefined,
    },
  });
}));

router.post("/tasks", asyncWrapper(async (req, res) => {
  const body = req.body as { agentId?: string; prompt: string; type?: string; context?: Record<string, unknown> };
  if (!body.prompt) {
    res.status(400).json({ error: "Missing required field: prompt" });
    return;
  }

  const taskId = generateId("task");
  const now = new Date().toISOString();
  const task: TaskDetail = {
    taskId,
    agentId: body.agentId || "auto",
    type: body.type || "chat",
    status: "running",
    prompt: body.prompt,
    progress: 0,
    startedAt: now,
    interrupted: false,
  };

  taskStore.set(taskId, task);

  // Simulate async task execution
  const simulateTask = async () => {
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const t = taskStore.get(taskId);
      if (!t || t.interrupted) return;
      t.progress = i * 10;
    }
    const t = taskStore.get(taskId);
    if (!t || t.interrupted) return;
    t.status = "completed";
    t.completedAt = new Date().toISOString();
    t.output = `Task completed successfully. Processed: "${body.prompt.substring(0, 100)}${body.prompt.length > 100 ? "..." : ""}"`;
    t.progress = 100;
  };

  simulateTask().catch((err) => logger.error({ err, taskId }, "Task simulation failed"));

  res.status(201).json({ success: true, data: { taskId, status: "accepted", startedAt: now } });
}));

router.post("/tasks/:taskId/interrupt", asyncWrapper(async (req, res) => {
  const { taskId } = req.params;
  const task = taskStore.get(taskId);

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (task.status !== "running" && task.status !== "pending") {
    res.status(400).json({ error: `Cannot interrupt task in status: ${task.status}` });
    return;
  }

  task.interrupted = true;
  task.status = "cancelled";
  task.completedAt = new Date().toISOString();
  task.error = "Task interrupted by user";

  res.json({ success: true, data: { taskId, status: "cancelled" } });
}));

// ============================================================================
// Workspace API (Chat Panel)
// ============================================================================

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  lastModified?: string;
  children?: FileNode[];
}

const workspaceFiles: FileNode[] = [
  {
    name: "projects",
    path: "/workspace/projects",
    type: "directory",
    children: [
      {
        name: "sylva_platform",
        path: "/workspace/projects/sylva_platform",
        type: "directory",
        children: [
          { name: "backend", path: "/workspace/projects/sylva_platform/backend", type: "directory", children: [
            { name: "src", path: "/workspace/projects/sylva_platform/backend/src", type: "directory", children: [
              { name: "routes", path: "/workspace/projects/sylva_platform/backend/src/routes", type: "directory" },
              { name: "coordinator", path: "/workspace/projects/sylva_platform/backend/src/coordinator", type: "directory" },
              { name: "server.ts", path: "/workspace/projects/sylva_platform/backend/src/server.ts", type: "file", size: 3420 },
            ]},
            { name: "package.json", path: "/workspace/projects/sylva_platform/backend/package.json", type: "file", size: 1240 },
          ]},
          { name: "frontend", path: "/workspace/projects/sylva_platform/frontend", type: "directory", children: [
            { name: "src", path: "/workspace/projects/sylva_platform/frontend/src", type: "directory" },
            { name: "package.json", path: "/workspace/projects/sylva_platform/frontend/package.json", type: "file", size: 980 },
          ]},
        ],
      },
      {
        name: "mega",
        path: "/workspace/projects/mega",
        type: "directory",
        children: [
          { name: "providers", path: "/workspace/projects/mega/providers", type: "directory" },
          { name: "core", path: "/workspace/projects/mega/core", type: "directory" },
        ],
      },
    ],
  },
  {
    name: "skills",
    path: "/workspace/skills",
    type: "directory",
    children: [
      { name: "web-search", path: "/workspace/skills/web-search", type: "directory" },
      { name: "code-review", path: "/workspace/skills/code-review", type: "directory" },
      { name: "hermes", path: "/workspace/skills/hermes", type: "directory" },
    ],
  },
  {
    name: "memory",
    path: "/workspace/memory",
    type: "directory",
    children: [
      { name: "2026-04-08.md", path: "/workspace/memory/2026-04-08.md", type: "file", size: 2345 },
      { name: "2026-04-09.md", path: "/workspace/memory/2026-04-09.md", type: "file", size: 1890 },
    ],
  },
  { name: "README.md", path: "/workspace/README.md", type: "file", size: 4520 },
  { name: "SOUL.md", path: "/workspace/SOUL.md", type: "file", size: 3200 },
];

router.get("/workspace/files", asyncWrapper(async (_req, res) => {
  res.json({ success: true, data: workspaceFiles });
}));

router.post("/workspace/import", asyncWrapper(async (req, res) => {
  const { files } = req.body as { files?: Array<{ name: string; content: string; path?: string }> };
  if (!files || !Array.isArray(files) || files.length === 0) {
    res.status(400).json({ error: "Missing required field: files" });
    return;
  }

  const imported = files.map((f) => ({
    name: f.name,
    path: f.path || `/workspace/imported/${f.name}`,
    size: f.content.length,
    importedAt: new Date().toISOString(),
  }));

  res.status(201).json({ success: true, data: imported, count: imported.length });
}));

// ============================================================================
// Group / Collaboration Panel API (7 Panels)
// ============================================================================

interface Meeting {
  id: string;
  title: string;
  agenda: string[];
  participants: string[];
  startedAt: string;
  endedAt?: string;
  status: "scheduled" | "active" | "completed" | "cancelled";
  transcript?: string[];
  decisions?: string[];
}

interface Relay {
  id: string;
  fromAgent: string;
  toAgent: string;
  taskId: string;
  context: string;
  status: "pending" | "active" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  handoffNotes?: string;
}

interface Conflict {
  id: string;
  type: "resource" | "opinion" | "priority" | "deadlock";
  agents: string[];
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "resolving" | "resolved";
  createdAt: string;
  resolution?: string;
}

interface ReorganizationState {
  active: boolean;
  phase: "idle" | "planning" | "executing" | "verifying";
  plan?: {
    newLeader?: string;
    reassignments: Array<{ agentId: string; newRole: string; reason: string }>;
    newStructure: string;
  };
  startedAt?: string;
  completedAt?: string;
  affectedAgents: string[];
}

interface GroupState {
  id: string;
  name: string;
  agents: string[];
  leader?: string;
  status: "idle" | "running" | "meeting" | "relay" | "reorganizing" | "conflict";
  mode: SwarmMode;
  meetings: Meeting[];
  relays: Relay[];
  conflicts: Conflict[];
  reorganization: ReorganizationState;
  health: {
    overall: "healthy" | "degraded" | "unhealthy";
    agentHealth: Record<string, "healthy" | "degraded" | "unhealthy">;
    lastCheck: string;
  };
  hierarchy: {
    levels: number;
    levelsMap: Record<string, number>;
    reportingChain: Record<string, string[]>;
  };
  createdAt: string;
  updatedAt: string;
}

const groups = new Map<string, GroupState>();

function ensureGroup(groupId: string): GroupState {
  let group = groups.get(groupId);
  if (!group) {
    group = {
      id: groupId,
      name: `Group-${groupId}`,
      agents: [],
      status: "idle",
      mode: "parallel",
      meetings: [],
      relays: [],
      conflicts: [],
      reorganization: { active: false, phase: "idle", affectedAgents: [] },
      health: { overall: "healthy", agentHealth: {}, lastCheck: new Date().toISOString() },
      hierarchy: { levels: 1, levelsMap: {}, reportingChain: {} },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    groups.set(groupId, group);
  }
  return group;
}

// --- Group Status ---
router.get("/groups/:groupId/status", asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const group = ensureGroup(groupId);
  res.json({ success: true, data: group });
}));

router.post("/groups/:groupId/interrupt", asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const group = ensureGroup(groupId);

  group.status = "idle";
  group.updatedAt = new Date().toISOString();

  // Interrupt all running meetings and relays
  group.meetings.forEach((m) => { if (m.status === "active") { m.status = "cancelled"; m.endedAt = new Date().toISOString(); } });
  group.relays.forEach((r) => { if (r.status === "active" || r.status === "pending") { r.status = "failed"; r.handoffNotes = "Interrupted by group command"; } });

  res.json({ success: true, data: { groupId, status: "interrupted", interruptedAt: new Date().toISOString() } });
}));

// --- Meetings ---
router.get("/groups/:groupId/meetings", asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const group = ensureGroup(groupId);
  res.json({ success: true, data: group.meetings, count: group.meetings.length });
}));

router.post("/groups/:groupId/meeting", asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const body = req.body as { title?: string; agenda?: string[]; participants?: string[] };
  const group = ensureGroup(groupId);

  if (!body.title) {
    res.status(400).json({ error: "Missing required field: title" });
    return;
  }

  const meetingId = generateId("meeting");
  const meeting: Meeting = {
    id: meetingId,
    title: body.title,
    agenda: body.agenda || ["Status update", "Issue discussion", "Action items"],
    participants: body.participants || group.agents,
    startedAt: new Date().toISOString(),
    status: "active",
    transcript: [`[${new Date().toISOString()}] Meeting "${body.title}" started`],
    decisions: [],
  };

  group.meetings.unshift(meeting);
  group.status = "meeting";
  group.updatedAt = new Date().toISOString();

  res.status(201).json({ success: true, data: meeting });
}));

// --- Relays ---
router.get("/groups/:groupId/relays", asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const group = ensureGroup(groupId);
  res.json({ success: true, data: group.relays, count: group.relays.length });
}));

router.post("/groups/:groupId/relay", asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const body = req.body as { fromAgent: string; toAgent: string; taskId?: string; context?: string };
  const group = ensureGroup(groupId);

  if (!body.fromAgent || !body.toAgent) {
    res.status(400).json({ error: "Missing required fields: fromAgent, toAgent" });
    return;
  }

  const relayId = generateId("relay");
  const relay: Relay = {
    id: relayId,
    fromAgent: body.fromAgent,
    toAgent: body.toAgent,
    taskId: body.taskId || generateId("task"),
    context: body.context || "",
    status: "active",
    startedAt: new Date().toISOString(),
    handoffNotes: `Relay from ${body.fromAgent} to ${body.toAgent}`,
  };

  group.relays.unshift(relay);
  group.status = "relay";
  group.updatedAt = new Date().toISOString();

  res.status(201).json({ success: true, data: relay });
}));

// --- Reorganization ---
router.get("/groups/:groupId/reorganization", asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const group = ensureGroup(groupId);
  res.json({ success: true, data: group.reorganization });
}));

router.post("/groups/:groupId/reorganize", asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const body = req.body as { newLeader?: string; reassignments?: Array<{ agentId: string; newRole: string; reason: string }> };
  const group = ensureGroup(groupId);

  const reorg: ReorganizationState = {
    active: true,
    phase: "executing",
    plan: {
      newLeader: body.newLeader || group.leader,
      reassignments: body.reassignments || [],
      newStructure: body.newLeader ? `hierarchical with ${body.newLeader} as leader` : "flat",
    },
    startedAt: new Date().toISOString(),
    affectedAgents: group.agents,
  };

  group.reorganization = reorg;
  group.status = "reorganizing";
  if (body.newLeader) group.leader = body.newLeader;
  group.updatedAt = new Date().toISOString();

  // Simulate completion
  setTimeout(() => {
    const g = groups.get(groupId);
    if (g && g.reorganization.active) {
      g.reorganization.phase = "idle";
      g.reorganization.active = false;
      g.reorganization.completedAt = new Date().toISOString();
      g.status = "idle";
    }
  }, 3000);

  res.status(201).json({ success: true, data: reorg });
}));

// --- Conflicts ---
router.get("/groups/:groupId/conflicts", asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const group = ensureGroup(groupId);
  res.json({ success: true, data: group.conflicts, count: group.conflicts.length });
}));

router.post("/groups/:groupId/resolve", asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const body = req.body as { conflictId: string; resolution: string };
  const group = ensureGroup(groupId);

  if (!body.conflictId) {
    res.status(400).json({ error: "Missing required field: conflictId" });
    return;
  }

  const conflict = group.conflicts.find((c) => c.id === body.conflictId);
  if (!conflict) {
    res.status(404).json({ error: "Conflict not found" });
    return;
  }

  conflict.status = "resolved";
  conflict.resolution = body.resolution || "Resolved by coordinator intervention";

  // If no open conflicts remain, clear group conflict status
  if (!group.conflicts.some((c) => c.status === "open" || c.status === "resolving")) {
    if (group.status === "conflict") group.status = "idle";
  }
  group.updatedAt = new Date().toISOString();

  res.json({ success: true, data: conflict });
}));

// --- Health ---
router.get("/groups/:groupId/health", asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const group = ensureGroup(groupId);

  const health = {
    groupId,
    overall: group.health.overall,
    agentHealth: group.agents.map((aid) => {
      const agent = agents.get(aid);
      return {
        agentId: aid,
        name: agent?.name || "Unknown",
        status: agent?.status || "unknown",
        health: agent?.health || "unknown",
        lastHeartbeat: new Date(Date.now() - Math.random() * 30000).toISOString(),
      };
    }),
    lastCheck: new Date().toISOString(),
    metrics: {
      activeTasks: group.meetings.filter((m) => m.status === "active").length + group.relays.filter((r) => r.status === "active").length,
      openConflicts: group.conflicts.filter((c) => c.status === "open").length,
      completedMeetings: group.meetings.filter((m) => m.status === "completed").length,
    },
  };

  res.json({ success: true, data: health });
}));

// --- Hierarchy ---
router.get("/groups/:groupId/hierarchy", asyncWrapper(async (req, res) => {
  const { groupId } = req.params;
  const group = ensureGroup(groupId);

  // Build hierarchy from group agents
  const hierarchy = {
    groupId,
    levels: group.leader ? 2 : 1,
    structure: group.agents.map((aid) => {
      const agent = agents.get(aid);
      const isLeader = aid === group.leader;
      return {
        agentId: aid,
        name: agent?.name || `Agent-${aid}`,
        role: isLeader ? "leader" : "worker",
        level: isLeader ? 0 : 1,
        reportsTo: isLeader ? null : group.leader || null,
        children: isLeader ? group.agents.filter((a) => a !== aid).map((a) => agents.get(a)?.name || a) : [],
      };
    }),
    reportingChain: group.leader
      ? { [group.leader]: group.agents.filter((a) => a !== group.leader) }
      : {},
  };

  res.json({ success: true, data: hierarchy });
}));

// ============================================================================
// Knowledge Base Bind API
// ============================================================================

import { knowledgeBases } from "./knowledge-bases";

router.post("/agents/:agentId/knowledge-bases", asyncWrapper(async (req, res) => {
  const { agentId } = req.params;
  const body = req.body as { knowledgeBaseIds?: string[] };
  const agent = await getAgentFromDb(agentId);

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  if (!body.knowledgeBaseIds || !Array.isArray(body.knowledgeBaseIds)) {
    res.status(400).json({ error: "Missing required field: knowledgeBaseIds" });
    return;
  }

  // Validate all KBs exist
  const validKbs = body.knowledgeBaseIds.filter((id) => knowledgeBases.some((kb) => kb.id === id));
  const invalidKbs = body.knowledgeBaseIds.filter((id) => !knowledgeBases.some((kb) => kb.id === id));

  // Add knowledge base IDs to agent's capabilities/skills as tags
  agent.skills = [...new Set([...agent.skills, ...validKbs.map((id) => `kb:${id}`)])];
  agent.updatedAt = new Date().toISOString();
  await saveAgentToDb(agent);

  res.json({
    success: true,
    data: {
      agentId,
      boundKnowledgeBases: validKbs,
      invalidKnowledgeBases: invalidKbs,
      totalBound: validKbs.length,
    },
  });
}));

export default router;

