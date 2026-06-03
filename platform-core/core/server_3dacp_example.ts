/**
 * server.ts 3DACP 集成示例
 * 展示如何将 AxisGateway 接入现有的 Express 应用
 */

import express from 'express';
import { AxisRegistry, createPresetInternalNodes, createPresetExternalNodes } from './coordinator/AxisRegistry';
import { AxisRoutingTable, AxisRouter } from './coordinator/AxisRouter';
import {
  RestAdapter,
  SseAdapter,
  WsAdapter,
  InternalAdapter,
  BridgeAdapter,
  ExternalAdapter,
} from './coordinator/ProtocolAdapter';
import { createAxisRouter, registerService, type GatewayContext } from './middleware/AxisGateway';
import { AxisMessage } from './coordinator/AxisMessage';
import { TransformLayer, createDialogMetadata, createAgentMetadata, createGroupMetadata } from './coordinator/TransformLayer';
import { ServiceAdapter } from './coordinator/ServiceAdapter';

// ──────────── 示例：接入现有 Service ────────────

// 假设现有 Service（实际项目中从对应文件导入）
// import { DialogService } from './services/DialogService';
// import { AgentService } from './services/AgentService';
// import { GroupService } from './services/GroupService';

// 占位 Service 示例
const DialogService = {
  createDialog: async (data: unknown) => ({ id: 'dlg-1', ...(data as object) }),
  getDialog: async (data: unknown) => data,
  sendMessage: async (data: unknown) => ({ message: 'ok', ...(data as object) }),
  sendMessageStream: async (data: unknown, onChunk: (c: unknown) => void) => {
    onChunk({ type: 'start' });
    onChunk({ type: 'content', text: 'Hello' });
    onChunk({ type: 'end' });
  },
};

const AgentService = {
  createAgent: async (data: unknown) => ({ id: 'agent-1', ...(data as object) }),
  getAgent: async (data: unknown) => data,
  updateAgent: async (data: unknown) => data,
  deleteAgent: async (data: unknown) => ({ deleted: true }),
  listAgents: async (data: unknown) => ({ agents: [], ...(data as object) }),
};

const GroupService = {
  createGroup: async (data: unknown) => ({ id: 'grp-1', ...(data as object) }),
  getGroup: async (data: unknown) => data,
  orchestrate: async (data: unknown) => ({ result: 'done', ...(data as object) }),
  orchestrateStream: async (data: unknown, onChunk: (c: unknown) => void) => {
    onChunk({ step: 1 });
    onChunk({ step: 2 });
    onChunk({ step: 3, done: true });
  },
};

// ──────────── 初始化 3DACP ────────────

export function initialize3DACP(app: express.Application): GatewayContext {
  // 1. 注册中心
  const registry = new AxisRegistry({
    enableHealthCheck: true,
    healthCheckInterval: 10000,
    onNodeChange: (node, event) => {
      console.log(`[Registry] Node ${node.id} ${event}`);
    },
  });

  // 注册预设节点
  for (const node of createPresetInternalNodes()) {
    registry.register(node);
  }
  for (const node of createPresetExternalNodes()) {
    registry.register(node);
  }

  console.log(`[3DACP] Registered ${registry.getStats().totalNodes} nodes`);

  // 2. 路由表
  const routingTable = new AxisRoutingTable();

  // 3. 协议适配器
  const adapters = new Map<AxisMessage['transport']['protocol'], any>();
  adapters.set('rest', new RestAdapter());
  adapters.set('sse', new SseAdapter());
  adapters.set('ws', new WsAdapter());
  adapters.set('internal', new InternalAdapter());
  adapters.set('bridge', new BridgeAdapter());
  adapters.set('bridge', new ExternalAdapter()); // External 也走 bridge 协议层

  // 4. 路由器
  const router = new AxisRouter({
    routingTable,
    adapters,
    registry: {
      queryNode: async (id) => registry.get(id),
      queryByModule: async (moduleId) => registry.getByModule(moduleId),
      queryCapabilities: async (platformId) => registry.getCapabilities(platformId),
    },
    logger: (msg) => console.log(`[AxisRouter] ${msg}`),
  });

  // 5. 转换层 — 将现有 Service 封装为 ModuleHandler
  const transformLayer = new TransformLayer({
    services: {
      dialog: DialogService,
      agent: AgentService,
      group: GroupService,
    },
    metadata: {
      dialog: createDialogMetadata(),
      agent: createAgentMetadata(),
      group: createGroupMetadata(),
    },
  });

  // 6. Gateway 上下文
  const gateway: GatewayContext = {
    router,
    registry,
    handlers: transformLayer.getHandlers(),
  };

  // 7. 注册 AxisGateway 路由
  const axisRouter = createAxisRouter(gateway);
  app.use('/axis', axisRouter);

  console.log('[3DACP] AxisGateway mounted at /axis');
  console.log(`[3DACP] Registered handlers: ${Array.from(gateway.handlers.keys()).join(', ')}`);

  return gateway;
}

// ──────────── Express 应用入口 ────────────

const app: express.Application = express();
app.use(express.json());

// 初始化 3DACP
const gateway = initialize3DACP(app);

// 现有路由保留（向后兼容）
// app.use('/api', existingRouter);

// 健康检查
app.get('/health', (req, res) => {
  const stats = gateway.registry.getStats();
  res.json({
    status: 'ok',
    nodes: stats.totalNodes,
    healthy: stats.healthy,
    degraded: stats.degraded,
    down: stats.down,
  });
});

// 启动
const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`[Server] Listening on port ${PORT}`);
  console.log(`[3DACP] ${gateway.registry.getStats().totalNodes} nodes ready`);
});

export default app;
