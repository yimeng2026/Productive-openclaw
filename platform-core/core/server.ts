import express from "express";
import cors from "cors";
import path from "path";
import { logger } from "./utils/logger";
import { initWebSocket } from "./websocket";
import { runAutoConfig } from "./services/autoConfigService";

import healthRouter from "./routes/health";
import agentsRouter from "./routes/agents";
import agentsV2Router from "./routes/agentsV2";
import agentsRuntimeRouter from "./routes/agentsRuntime";
import aiSearchRouter from "./routes/aiSearch";
import authRouter from "./routes/auth";
import backupRouter from "./routes/backup";
import channelsRouter from "./routes/channels";
import modelsRouter from "./routes/models";
import platformsRouter from "./routes/platforms";
import apiKeysRouter from "./routes/apikeys";
import skillsRouter from "./routes/skills";
import workspacesRouter from "./routes/workspaces";
import knowledgeBasesRouter from "./routes/knowledge-bases";
import handoffRouter from "./routes/handoff";
import coordinatorRouter from "./routes/coordinator";
import agentZeroRouter from "./routes/agentZero";
import processRouter from "./routes/process";
import logsRouter from "./routes/logs";
import platformDetailsRouter from "./routes/platformDetails";
import eventsRouter from "./routes/events";
import groupsRouter from "./routes/groups";
import tasksRouter from "./routes/tasks";
import monitorRouter from "./routes/monitor";
import memoriesRouter from "./routes/memories";
import settingsRouter from "./routes/settings";
import securityRouter from "./routes/security";
import uploadsRouter from "./routes/uploads";
import schedulerRouter from "./routes/scheduler";
import searchRouter from "./routes/search";
import ollamaRouter from "./routes/ollama";
import registryRouter from "./routes/registry";
import importsRouter from "./routes/imports";
import webhooksRouter from "./routes/webhooks";
import externalRouter from "./routes/external";
import googleChatRouter from "./routes/googleChat";
import unifiedRouter from "./routes/unified";
import hierarchicalRouter from "./routes/hierarchical"; // ← 新增: 分层协调API
import workspaceRouter from "./routes/workspace"; // ← 新增: 工作空间管理
import unifiedApiRouter from "./routes/unified-api"; // ← 新增: 统一API协议
import integrationsRouter from "./routes/integrations"; // ← 新增: 外部集成
import blueprintsRouter from "./routes/blueprints"; // ← 新增: 蓝图构建器
import dialogRouter from "./routes/dialog";
import swarmRouter from "./routes/swarm"; // ← 新增: 蜂群管理
import { initMegaProviderBridge, initSkillBridge } from "./coordinator/bridges";
import { initMessageBus } from "./coordinator/unified";

export { logger };

// Keep server reference alive to prevent process exit
let activeServer: ReturnType<typeof express.prototype.listen> | null = null;

export async function startServer(port: number): Promise<void> {
  const app = express();

  // CORS
  app.use(cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }));

  // JSON body parser
  app.use(express.json());

  // Request logging
  app.use((req, _res, next) => {
    logger.info({ method: req.method, path: req.path }, "request");
    next();
  });

  // ═══════════════════════════════════════════════════════════════
  // 自动配置（启动时执行）
  // ═══════════════════════════════════════════════════════════════
  try {
    logger.info("[Startup] Running auto-configuration...");
    const autoConfig = await runAutoConfig();
    logger.info(autoConfig, "[Startup] Auto-config completed");
  } catch (err: any) {
    logger.warn({ error: err.message }, "[Startup] Auto-config failed (non-fatal)");
  }

  // ═══════════════════════════════════════════════════════════════
  // Routes (v1 + v2 for frontend compatibility)
  // ═══════════════════════════════════════════════════════════════

  // Health
  app.use("/api/health", healthRouter);
  app.use("/api/v2/health", healthRouter);

  // Agents
  app.use("/api/agents", agentsRouter);
  app.use("/api/agents/v2", agentsV2Router);
  app.use("/api/v2/agents", agentsV2Router);

  // Dialog (对话中心 — 新增真实 API 调用)
  app.use("/api/dialog", dialogRouter);
  app.use("/api/v2/dialog", dialogRouter);

  // Channels
  app.use("/api/channels", channelsRouter);
  app.use("/api/v2/channels", channelsRouter);

  // Models
  app.use("/api/models", modelsRouter);
  app.use("/api/v2/models", modelsRouter);

  // Platforms
  app.use("/api/platforms", platformsRouter);
  app.use("/api/v2/platforms", platformsRouter);

  // Platform Detail APIs (Hermes, Agent-Zero, Ollama, Mega-Hub, Model-Router)
  app.use("/api", platformDetailsRouter);

  // API Keys
  app.use("/api/apikeys", apiKeysRouter);
  app.use("/api/v2/apikeys", apiKeysRouter);

  // Skills
  app.use("/api/skills", skillsRouter);
  app.use("/api/v2/skills", skillsRouter);

  // Tasks (独立路由 + workspaces兼容)
  app.use("/api/tasks", tasksRouter);
  app.use("/api/v2/tasks", tasksRouter);

  // Monitor
  app.use("/api/monitor", monitorRouter);
  app.use("/api/v2/monitor", monitorRouter);

  // Workspaces (含任务、知识库)
  app.use("/api/workspaces", workspacesRouter);
  app.use("/api/v2/workspaces", workspacesRouter);

  // Knowledge Bases
  app.use("/api/knowledge-bases", knowledgeBasesRouter);
  app.use("/api/v2/knowledge-bases", knowledgeBasesRouter);

  // Handoff
  app.use("/api/handoff", handoffRouter);
  app.use("/api/v2/handoff", handoffRouter);

  // Coordinator
  app.use("/api/coordinator", coordinatorRouter);
  app.use("/api/v2/coordinator", coordinatorRouter);

  // AgentZero
  app.use("/api/agentZero", agentZeroRouter);
  app.use("/api/v2/agentZero", agentZeroRouter);

  // ═══════════════════════════════════════════════════════════════
  // 缺失路由补充挂载 (Quality Check Fix)
  // ═══════════════════════════════════════════════════════════════

  // Auth
  app.use("/api/auth", authRouter);
  app.use("/api/v2/auth", authRouter);

  // Memories
  app.use("/api/memories", memoriesRouter);
  app.use("/api/v2/memories", memoriesRouter);

  // Settings
  app.use("/api/settings", settingsRouter);
  app.use("/api/v2/settings", settingsRouter);

  // Security
  app.use("/api/security", securityRouter);
  app.use("/api/v2/security", securityRouter);

  // Uploads
  app.use("/api/uploads", uploadsRouter);
  app.use("/api/v2/uploads", uploadsRouter);

  // Scheduler
  app.use("/api/scheduler", schedulerRouter);
  app.use("/api/v2/scheduler", schedulerRouter);

  // Search
  app.use("/api/search", searchRouter);
  app.use("/api/v2/search", searchRouter);

  // Ollama
  app.use("/api/ollama", ollamaRouter);
  app.use("/api/v2/ollama", ollamaRouter);

  // Registry
  app.use("/api/registry", registryRouter);
  app.use("/api/v2/registry", registryRouter);

  // Backup
  app.use("/api/backup", backupRouter);
  app.use("/api/v2/backup", backupRouter);

  // Imports
  app.use("/api/imports", importsRouter);
  app.use("/api/v2/imports", importsRouter);

  // Webhooks
  app.use("/api/webhooks", webhooksRouter);
  app.use("/api/v2/webhooks", webhooksRouter);

  // External
  app.use("/api/external", externalRouter);
  app.use("/api/v2/external", externalRouter);

  // Google Chat
  app.use("/api/google-chat", googleChatRouter);
  app.use("/api/v2/google-chat", googleChatRouter);

  // Unified
  app.use("/api/unified", unifiedRouter);
  app.use("/api/v2/unified", unifiedRouter);

  // Agents Runtime
  app.use("/api/agents-runtime", agentsRuntimeRouter);
  app.use("/api/v2/agents-runtime", agentsRuntimeRouter);

  // AI Search
  app.use("/api/ai-search", aiSearchRouter);
  app.use("/api/v2/ai-search", aiSearchRouter);

  // Hierarchical Orchestration (分层协调 — 新增)
  app.use("/api/hierarchical", hierarchicalRouter);
  app.use("/api/v2/hierarchical", hierarchicalRouter);

  // Workspace (工作空间管理 — 新增)
  app.use("/api/workspace", workspaceRouter);
  app.use("/api/v2/workspace", workspaceRouter);

  // Unified API (统一API协议 — 新增)
  app.use("/api/unified-api", unifiedApiRouter);
  app.use("/api/v2/unified-api", unifiedApiRouter);

  // Integrations (外部集成 — 新增)
  app.use("/api/integrations", integrationsRouter);
  app.use("/api/v2/integrations", integrationsRouter);

  // Blueprints (蓝图构建器 — 新增)
  app.use("/api/blueprints", blueprintsRouter);
  app.use("/api/v2/blueprints", blueprintsRouter);

  // Process
  app.use("/api/process", processRouter);
  app.use("/api/v2/process", processRouter);

  // Logs
  app.use("/api/logs", logsRouter);
  app.use("/api/v2/logs", logsRouter);

  // Events
  app.use("/api/events", eventsRouter);
  app.use("/api/v2/events", eventsRouter);

  // Groups
  app.use("/api/groups", groupsRouter);
  app.use("/api/v2/groups", groupsRouter);

  // Swarm (蜂群管理)
  app.use("/api/swarm", swarmRouter);
  app.use("/api/v2/swarm", swarmRouter);

  // Fallback v2 catch-all for agentsV2
  app.use("/api/v2", agentsV2Router);

  // ═══════════════════════════════════════════════════════════════
  // 3DACP Axis Gateway (统一入口 — 新增)
  // ═══════════════════════════════════════════════════════════════
  try {
    const { createAxisRouter } = await import("./middleware/AxisGateway");
    const { AxisRegistry, createPresetInternalNodes, createPresetExternalNodes } = await import("./coordinator/AxisRegistry");
    const { AxisRoutingTable, AxisRouter } = await import("./coordinator/AxisRouter");
    const {
      RestAdapter, SseAdapter, WsAdapter, InternalAdapter, BridgeAdapter, ExternalAdapter,
    } = await import("./coordinator/ProtocolAdapter");

    const axisRegistry = new AxisRegistry({
      enableHealthCheck: true,
      healthCheckInterval: 10000,
      onNodeChange: (node, event) => logger.info(`[AxisRegistry] Node ${node.id} ${event}`),
    });

    for (const node of createPresetInternalNodes()) axisRegistry.register(node);
    for (const node of createPresetExternalNodes()) axisRegistry.register(node);
    logger.info(`[3DACP] Registered ${axisRegistry.getStats().totalNodes} nodes`);

    const adapters = new Map();
    adapters.set("rest", new RestAdapter());
    adapters.set("sse", new SseAdapter());
    adapters.set("ws", new WsAdapter());
    adapters.set("internal", new InternalAdapter());
    adapters.set("bridge", new BridgeAdapter());
    adapters.set("bridge", new ExternalAdapter());

    const axisRouter = new AxisRouter({
      routingTable: new AxisRoutingTable(),
      adapters,
      registry: {
        queryNode: async (id) => axisRegistry.get(id),
        queryByModule: async (moduleId) => axisRegistry.getByModule(moduleId),
        queryCapabilities: async (platformId) => axisRegistry.getCapabilities(platformId),
      },
      logger: (msg) => logger.info(`[AxisRouter] ${msg}`),
    });

    const {
      createDialogServiceAdapter,
    } = await import("./services/DialogService_3DACP");
    const {
      createAgentServiceAdapter,
    } = await import("./services/AgentService_3DACP");
    const {
      createGroupServiceAdapter,
    } = await import("./services/GroupService_3DACP");
    const {
      createKnowledgeServiceAdapter,
    } = await import("./services/KnowledgeService_3DACP");
    const {
      createSkillServiceAdapter,
    } = await import("./services/SkillService_3DACP");
    const {
      createMonitorServiceAdapter,
    } = await import("./services/MonitorService_3DACP");
    const {
      createPlatformServiceAdapter,
    } = await import("./services/PlatformService_3DACP");
    const {
      createBlueprintServiceAdapter,
    } = await import("./services/BlueprintService_3DACP");
    const {
      createInterventionServiceAdapter,
    } = await import("./services/InterventionService_3DACP");

    const handlers = new Map<string, any>();
    handlers.set("dialog", createDialogServiceAdapter());
    handlers.set("agent", createAgentServiceAdapter());
    handlers.set("group", createGroupServiceAdapter());
    handlers.set("knowledge", createKnowledgeServiceAdapter());
    handlers.set("skill", createSkillServiceAdapter());
    handlers.set("monitor", createMonitorServiceAdapter());
    handlers.set("platform", createPlatformServiceAdapter());
    handlers.set("blueprint", createBlueprintServiceAdapter());
    handlers.set("intervention", createInterventionServiceAdapter());

    const gateway = createAxisRouter({ router: axisRouter, registry: axisRegistry, handlers });
    app.use("/axis", gateway);
    logger.info("[3DACP] AxisGateway mounted at /axis");
    logger.info(`[3DACP] Registered handlers: blueprint, intervention (+ ${handlers.size} more)`);
  } catch (err: any) {
    logger.warn({ error: err.message }, "[3DACP] AxisGateway init failed (non-fatal)");
  }

  // ═══════════════════════════════════════════════════════════════
  // 静态前端文件（支持 Electron 嵌入模式）
  // ═══════════════════════════════════════════════════════════════
  const isElectron = process.env.ELECTRON_MODE === "true";
  const publicPath = isElectron
    ? path.join(__dirname, "../../frontend/build")
    : path.join(process.cwd(), "public");

  if (isElectron) {
    logger.info(`[Electron] Serving frontend from: ${publicPath}`);
  }

  app.use(express.static(publicPath));

  // SPA fallback
  app.use((req, res) => {
    if (req.path.startsWith("/api") || req.path === "/ws") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const indexPath = path.join(publicPath, "index.html");
    if (require("fs").existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send(`Frontend not built. Expected: ${indexPath}`);
    }
  });

  return new Promise<void>((resolve, reject) => {
    activeServer = app.listen(port, () => {
      logger.info(`HTTP server listening on port ${port}`);

      // Initialize WebSocket server (room-based, heartbeat, cleanup)
      initWebSocket(activeServer!, "/ws");

      // Initialize coordinator bridges (non-blocking, fire-and-forget)
      initMegaProviderBridge().catch((err) => logger.warn({ err }, "MegaProviderBridge init failed"));
      initSkillBridge().catch((err) => logger.warn({ err }, "SkillBridge init failed"));

      // Initialize MessageBus (non-blocking, fire-and-forget)
      initMessageBus().catch((err) => logger.warn({ err }, "MessageBus init failed"));

      resolve();
    });

    activeServer!.on("error", (err) => {
      logger.error({ err }, "Server error");
      reject(err);
    });
  });
}

// ═══════════════════════════════════════════════════════════════
//  自启动（当直接运行此文件时）
// ═══════════════════════════════════════════════════════════════
if (require.main === module) {
  const PORT = parseInt(process.env.PORT || "3001", 10);
  startServer(PORT).then(() => {
    logger.info(`[Startup] Sylva Platform backend running on port ${PORT}`);
  }).catch((err) => {
    logger.error({ err }, "[Startup] Failed to start");
    process.exit(1);
  });
}
