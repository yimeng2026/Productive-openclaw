/**
 * Sylva Platform Core — 独立服务器
 * 最小可用版本：Ollama子代理 + 多Provider编排
 * 发给普通OpenClaw即可运行
 */

import express from "express";
import cors from "cors";

// ═══════════════════════════════════════════════════════════════
// 核心适配层（路径相对于 server.ts 的同级 core/ 目录）
// ═══════════════════════════════════════════════════════════════
import {
  UnifiedAPIClient, UnifiedChatRequest,
  ProviderConfig, AutoConfigEngine,
} from "./core/services/UnifiedAPIClient";

// Ollama 本地服务
import {
  ollamaListModels, ollamaGenerate, ollamaChat, ollamaStatus
} from "./core/services/ollamaService";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

// CORS + JSON
app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: "50mb" }));

// ═══════════════════════════════════════════════════════════════
// 1. Ollama 子代理路由（本地模型桥接）
// ═══════════════════════════════════════════════════════════════
app.get("/api/ollama/models", async (_req, res) => {
  try {
    const data = await ollamaListModels();
    res.json({ success: true, provider: "ollama", data });
  } catch (err: any) {
    res.status(503).json({ success: false, error: err.message });
  }
});

app.get("/api/ollama/status", async (_req, res) => {
  try {
    const data = await ollamaStatus();
    res.json({ success: true, provider: "ollama", data });
  } catch (err: any) {
    res.status(503).json({ success: false, error: err.message });
  }
});

app.post("/api/ollama/generate", async (req, res) => {
  try {
    const { model, prompt, options } = req.body;
    const data = await ollamaGenerate(model || "llama3", prompt, options);
    res.json({ success: true, provider: "ollama", data });
  } catch (err: any) {
    res.status(503).json({ success: false, error: err.message });
  }
});

app.post("/api/ollama/chat", async (req, res) => {
  try {
    const { model, messages, options } = req.body;
    const data = await ollamaChat(model || "llama3", messages, options);
    res.json({ success: true, provider: "ollama", data });
  } catch (err: any) {
    res.status(503).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// 2. 统一多Provider路由（子代理调度中心）
// ═══════════════════════════════════════════════════════════════
/**
 * POST /api/unified/chat
 *  body: { provider: string, apiKey: string, messages: [...], model?: string, temperature?: number }
 *  provider 可选: ollama | claude | openai | kimi | kimi_code | gemini | deepseek | openrouter | hermes | openclaw
 */
app.post("/api/unified/chat", async (req, res) => {
  try {
    const { provider, apiKey, messages, model, temperature, maxTokens } = req.body;

    if (!provider || !apiKey || !messages || !Array.isArray(messages)) {
      res.status(400).json({ success: false, error: "Missing provider/apiKey/messages" });
      return;
    }

    // 自动检测配置
    const detected = await AutoConfigEngine.detectProvider(apiKey, provider);
    const config: ProviderConfig = {
      type: detected.type,
      apiKey,
      baseUrl: detected.baseUrl,
      defaultModel: model || detected.defaultModel,
      timeoutMs: 30000,
    };

    const client = new UnifiedAPIClient(config);
    const request: UnifiedChatRequest = {
      messages,
      model: config.defaultModel,
      temperature: temperature ?? 0.7,
      maxTokens: maxTokens || 4096,
      stream: false,
    };

    const response = await client.chat(request);

    res.json({
      success: true,
      provider: detected.type,
      model: response.model,
      content: response.content,
      usage: response.usage,
      finishReason: response.finishReason,
    });
  } catch (err: any) {
    console.error("[/api/unified/chat] error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/unified/orchestrate
 * Claude 编排 Ollama — 让Claude作为编排者，Ollama作为执行者
 *  body: { claudeKey, ollamaModel, taskDescription, context }
 */
app.post("/api/unified/orchestrate", async (req, res) => {
  try {
    const { claudeKey, ollamaModel, taskDescription, context = [] } = req.body;
    if (!claudeKey || !ollamaModel || !taskDescription) {
      res.status(400).json({ success: false, error: "Missing claudeKey/ollamaModel/taskDescription" });
      return;
    }

    // Step 1: Claude 编排 — 分析任务、拆解步骤
    const claudeConfig: ProviderConfig = {
      type: "claude",
      apiKey: claudeKey,
      defaultModel: "claude-3-sonnet-20240229",
      timeoutMs: 30000,
    };
    const claude = new UnifiedAPIClient(claudeConfig);

    const planRequest: UnifiedChatRequest = {
      messages: [
        { role: "system", content: "你是一个任务编排专家。请将用户请求拆解为可执行的子任务，并指定每个子任务适合哪种模型（本地Ollama/远程API）。只返回JSON格式的执行计划。" },
        { role: "user", content: `任务：${taskDescription}\n上下文：${JSON.stringify(context)}\n\n请返回执行计划JSON：{\"steps\":[{\"step\":1,\"description\":\"...\",\"target\":\"ollama|claude|kimi|...\",\"prompt\":\"...\"}]}` },
      ],
      model: "claude-3-sonnet-20240229",
      temperature: 0.3,
      maxTokens: 4096,
      stream: false,
    };

    const planResponse = await claude.chat(planRequest);
    let plan;
    try {
      plan = JSON.parse(planResponse.content);
    } catch {
      plan = { steps: [{ step: 1, description: taskDescription, target: "ollama", prompt: taskDescription }] };
    }

    // Step 2: 执行每个步骤
    const results = [];
    for (const step of plan.steps || []) {
      if (step.target === "ollama") {
        const ollamaConfig: ProviderConfig = {
          type: "ollama",
          apiKey: "", // Ollama 不需要 key
          baseUrl: OLLAMA_URL,
          defaultModel: ollamaModel,
          timeoutMs: 60000,
        };
        const ollamaClient = new UnifiedAPIClient(ollamaConfig);
        const stepResponse = await ollamaClient.chat({
          messages: [{ role: "user", content: step.prompt || step.description }],
          model: ollamaModel,
          temperature: 0.7,
          maxTokens: 4096,
          stream: false,
        });
        results.push({ step: step.step, target: "ollama", content: stepResponse.content });
      } else {
        // 回退到 Claude
        const stepResponse = await claude.chat({
          messages: [{ role: "user", content: step.prompt || step.description }],
          model: claudeConfig.defaultModel!,
          temperature: 0.7,
          maxTokens: 4096,
          stream: false,
        });
        results.push({ step: step.step, target: "claude", content: stepResponse.content });
      }
    }

    // Step 3: Claude 整合结果
    const summaryRequest: UnifiedChatRequest = {
      messages: [
        { role: "system", content: "你是一个结果整合专家。请将多步骤的执行结果整合为一份完整、连贯的最终输出。" },
        { role: "user", content: `原始任务：${taskDescription}\n执行结果：\n${JSON.stringify(results, null, 2)}\n\n请整合。` },
      ],
      model: "claude-3-sonnet-20240229",
      temperature: 0.3,
      maxTokens: 4096,
      stream: false,
    };
    const summary = await claude.chat(summaryRequest);

    res.json({
      success: true,
      orchestrator: "claude",
      executor: "ollama",
      plan,
      results,
      finalOutput: summary.content,
    });
  } catch (err: any) {
    console.error("[/api/unified/orchestrate] error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/unified/providers
 * 列出所有支持的 Provider
 */
app.get("/api/unified/providers", (_req, res) => {
  res.json({
    success: true,
    providers: [
      { id: "ollama", name: "Ollama (本地)", requiresKey: false, description: "本地LLM，无需API Key" },
      { id: "claude", name: "Claude (Anthropic)", requiresKey: true, description: "Anthropic Claude系列" },
      { id: "openai", name: "OpenAI", requiresKey: true, description: "GPT-4/GPT-4o" },
      { id: "kimi", name: "Kimi", requiresKey: true, description: "Moonshot Kimi" },
      { id: "kimi_code", name: "Kimi Code", requiresKey: true, description: "Kimi Coding版本" },
      { id: "gemini", name: "Gemini", requiresKey: true, description: "Google Gemini" },
      { id: "deepseek", name: "DeepSeek", requiresKey: true, description: "DeepSeek" },
      { id: "openrouter", name: "OpenRouter", requiresKey: true, description: "多模型聚合平台" },
      { id: "hermes", name: "Hermes", requiresKey: true, description: "Hermes MCP协议" },
      { id: "openclaw", name: "OpenClaw", requiresKey: true, description: "OpenClaw本地网关" },
    ],
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. 协调器健康检查
// ═══════════════════════════════════════════════════════════════
app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    service: "productive-openclaw-platform-core",
    version: "2.0.0",
    ollamaUrl: OLLAMA_URL,
    features: ["ollama-bridge", "multi-provider", "claude-orchestrate", "auto-config", "3dacp-gateway", "unified-coordinator"],
  });
});

// ═══════════════════════════════════════════════════════════════
// 启动
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`╔══════════════════════════════════════════════╗`);
  console.log(`║   Productive OpenClaw Platform Core v2.0.0    ║`);
  console.log(`║   Ollama子代理 + 多Provider编排 + 3DACP网关   ║`);
  console.log(`╠══════════════════════════════════════════════╣`);
  console.log(`║   🦙 Ollama桥接:  http://localhost:${PORT}/api/ollama    ║`);
  console.log(`║   🔀 统一API:     http://localhost:${PORT}/api/unified   ║`);
  console.log(`║   🎼 编排API:     http://localhost:${PORT}/api/unified/orchestrate ║`);
  console.log(`║   ❤️  健康检查:   http://localhost:${PORT}/api/health    ║`);
  console.log(`╚══════════════════════════════════════════════╝`);
  console.log(`\n支持的Provider: ollama | claude | openai | kimi | gemini | deepseek | openrouter | hermes`);
  console.log(`用法: npm install && npm run dev`);
});
