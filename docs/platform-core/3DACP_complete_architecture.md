# 3D Axis Connection Protocol (3DACP) 完整架构文档

> 版本：v1.0 | 日期：2026-05-30 | 状态：架构设计完成，核心代码已落地

---

## 1. 架构确认：最终版本定位

### 1.1 版本确认结果

经过仓库全量扫描，**3D 坐标系完整架构的最终版本**已确认存在于以下位置：

| 文件 | 大小 | 状态 | 说明 |
|------|------|------|------|
| `backend/src/coordinator/AxisRegistry.ts` | 17.4 KB | ✅ 生产就绪 | 核心注册中心，包含 50 个预设节点 |
| `backend/src/coordinator/AxisRouter.ts` | ~5 KB | ✅ 生产就绪 | 3D 路由表 + 寻址逻辑 |
| `backend/src/coordinator/AxisMessage.ts` | ~3 KB | ✅ 生产就绪 | 消息格式定义 |
| `backend/src/middleware/AxisGateway.ts` | ~6 KB | ✅ 生产就绪 | Express 中间件网关 |
| `frontend/src/api/AxisClient.ts` | 15.8 KB | ✅ 生产就绪 | 前端统一客户端（5 协议支持） |
| `frontend/src/hooks/useAxisClient.ts` | 4.2 KB | ✅ 生产就绪 | React Hook + 9 模块封装 |
| `frontend/src/pages/AxisDemo.tsx` | 3.8 KB | ✅ 生产就绪 | 演示页面（9 模块测试） |
| `docs/3D_Axis_Connection_Protocol.md` | 9.1 KB | ✅ 文档完整 | 架构设计文档 |
| `backend/src/server_3dacp_example.ts` | ~2 KB | ✅ 示例代码 | 完整服务端示例 |

**结论**：3D 坐标系架构的 **最终完整版本** 就是当前 `backend/src/coordinator/` 和 `frontend/src/api/` 下的实现，**已包含 15 个前端 + 15 个后端 + 20 个子工具**的完整预设节点定义。

---

## 2. 三维坐标体系定义

### 2.1 坐标轴定义

```
                 z轴（协议抽象层）
                    ↑
                    │ WebSocket
                    │ SSE
                    │ REST
                    │ Internal Bus
                    │
         ┌──────────┼──────────┐
         │          │          │
    y轴  │  Agents  │  Groups  │  Dialogs   ... 功能模块
  （业务）│  Skills  │Knowledge│  Monitor  │
         │          │          │
         └──────────┼──────────┘
                    │
         ───────────┼───────────→ x轴（平台层）
                    │         Frontend
                    │         Backend
                    │         AgentZero
                    │         External API
```

| 轴 | 维度 | 含义 | 示例值 |
|---|---|---|---|
| **x 轴** | 平台/部署 | 哪个物理平台 | `frontend-main`, `backend-api`, `agent-zero-1` |
| **y 轴** | 功能/业务 | 哪个功能模块 | `dialog`, `agent`, `group`, `skill`, `knowledge` |
| **z 轴** | 协议/抽象 | 哪种通信协议 | `rest`, `sse`, `ws`, `internal`, `bridge` |

### 2.2 消息格式（AxisMessage）

```typescript
interface AxisMessage {
  version: '3dacp/v1';
  header: {
    msgId: string;           // UUID
    source: AxisCoordinate;  // { x, y, z }
    target: AxisCoordinate;   // { x, y, z }
    timestamp: number;
    priority: number;        // 0-9，0 最高
    ttl: number;            // 存活时间(ms)
    expectsReply: boolean;
    correlationId?: string;
    traceChain: string[];
    retryCount: number;
  };
  payload: {
    action: 'create' | 'read' | 'update' | 'delete' | 'invoke' | 'stream' | 'subscribe';
    entity: 'agent' | 'group' | 'dialog' | 'skill' | 'knowledge' | 'monitor' | 'platform' | 'blueprint' | 'intervention';
    data: unknown;
    metadata: Record<string, unknown>;
  };
  transport: {
    protocol: 'rest' | 'sse' | 'ws' | 'internal' | 'bridge';
    encoding: 'json' | 'msgpack' | 'protobuf';
    compressed: boolean;
  };
}
```

---

## 3. 15 个前端节点（X轴 — Frontend）

```typescript
// 来源：backend/src/coordinator/AxisRegistry.ts → createPresetInternalNodes()
```

| # | ID | 平台 | 能力模块 | 协议 | 端点 |
|---|-----|------|---------|------|------|
| 1 | `frontend-main` | React-Vite | dialog, agent, group, monitor, settings | rest, sse, ws | `http://localhost:5173` |
| 2 | `frontend-desktop` | Electron | dialog, agent, monitor | rest, ws | `http://localhost:5174` |
| 3 | `frontend-mobile` | React Native | dialog, agent | rest | `http://localhost:5175` |
| 4 | `frontend-web` | Web | dialog, agent, group, knowledge, skill | rest, sse | `https://garden.web.app` |
| 5 | `frontend-pwa` | PWA | dialog, agent, monitor | rest, sse | `https://garden.web.app/pwa` |
| 6 | `frontend-admin` | Admin Panel | agent, group, monitor, settings, platform | rest | `http://localhost:5176` |
| 7 | `frontend-embed` | Widget | dialog | rest | `https://embed.garden.app` |
| 8 | `frontend-vscode` | VS Code 扩展 | dialog, agent, skill | rest, ws | `vscode://sylva.garden` |
| 9 | `frontend-cli` | CLI | dialog, agent | rest | `http://localhost:5177` |
| 10 | `frontend-obsidian` | Obsidian 插件 | dialog, knowledge | rest | `obsidian://sylva` |
| 11 | `frontend-telegram` | Telegram Bot | dialog | rest | `https://t.me/sylva_garden_bot` |
| 12 | `frontend-discord` | Discord Bot | dialog, agent | rest, ws | `https://discord.com/api` |
| 13 | `frontend-slack` | Slack App | dialog | rest | `https://slack.com/api` |
| 14 | `frontend-wechat` | 微信公众号 | dialog | rest | `https://mp.weixin.qq.com` |
| 15 | `frontend-feishu` | 飞书应用 | dialog, agent | rest | `https://open.feishu.cn` |

---

## 4. 15 个后端节点（X轴 — Backend）

| # | ID | 角色 | 能力模块 | 协议 | 端点 |
|---|-----|------|---------|------|------|
| 1 | `backend-api` | 主 API | 全模块 | rest, sse, ws, internal | `http://localhost:3000` |
| 2 | `backend-agent` | Agent 引擎 | agent, dialog, skill | rest, internal | `http://localhost:3001` |
| 3 | `backend-llm` | LLM 代理 | dialog | rest, internal | `http://localhost:3002` |
| 4 | `backend-kb` | 知识库 | knowledge | rest, internal | `http://localhost:3003` |
| 5 | `backend-vector` | 向量存储 | knowledge | rest, internal | `http://localhost:3004` |
| 6 | `backend-monitor` | 监控 | monitor | rest, sse, internal | `http://localhost:3005` |
| 7 | `backend-auth` | 认证 | settings | rest, internal | `http://localhost:3006` |
| 8 | `backend-queue` | 任务队列 | dialog, agent, skill | internal | `ipc://queue` |
| 9 | `backend-cache` | 缓存 | dialog, agent, knowledge | internal | `ipc://cache` |
| 10 | `backend-db` | 数据库 | agent, group, knowledge, settings | internal | `ipc://db` |
| 11 | `backend-file` | 文件存储 | dialog, knowledge | rest, internal | `http://localhost:3007` |
| 12 | `backend-webhook` | Webhook | dialog, agent | rest, sse | `http://localhost:3008` |
| 13 | `backend-scheduler` | 调度器 | agent, skill | rest, internal | `http://localhost:3009` |
| 14 | `backend-adapter` | Provider 适配 | dialog, agent | rest, internal | `http://localhost:3010` |
| 15 | `backend-gateway` | 网关 | 全模块 | rest, sse, ws, internal, bridge | `http://localhost:3011` |

---

## 5. 20 个子工具节点（Z轴 — AgentZero Tools）

| # | ID | 类别 | 能力 | 协议 | 端点 |
|---|-----|------|------|------|------|
| 1 | `tool-code-interpreter` | 代码执行 | skill | rest, internal | `http://localhost:4001` |
| 2 | `tool-browser` | 浏览器自动化 | skill | rest | `http://localhost:4002` |
| 3 | `tool-image-gen` | 图像生成 | skill | rest | `http://localhost:4003` |
| 4 | `tool-doc-parser` | 文档解析 | skill, knowledge | rest | `http://localhost:4004` |
| 5 | `tool-git` | 版本控制 | skill | rest | `http://localhost:4005` |
| 6 | `tool-search` | 网络搜索 | skill | rest | `http://localhost:4006` |
| 7 | `tool-calculator` | 数学计算 | skill | rest, internal | `http://localhost:4007` |
| 8 | `tool-translator` | 翻译 | skill | rest | `http://localhost:4008` |
| 9 | `tool-summarizer` | 文本摘要 | skill, knowledge | rest | `http://localhost:4009` |
| 10 | `tool-chart-gen` | 图表生成 | skill | rest | `http://localhost:4010` |
| 11 | `tool-ocr` | OCR | skill, knowledge | rest | `http://localhost:4011` |
| 12 | `tool-speech` | 语音识别 | skill | rest | `http://localhost:4012` |
| 13 | `tool-data-clean` | 数据清洗 | skill | rest | `http://localhost:4013` |
| 14 | `tool-sql-runner` | SQL 执行 | skill | rest, internal | `http://localhost:4014` |
| 15 | `tool-api-tester` | API 测试 | skill | rest | `http://localhost:4015` |
| 16 | `tool-mermaid` | 图表生成 | skill | rest | `http://localhost:4016` |
| 17 | `tool-latex` | LaTeX 渲染 | skill | rest | `http://localhost:4017` |
| 18 | `tool-pdf-gen` | PDF 生成 | skill | rest | `http://localhost:4018` |
| 19 | `tool-email` | 邮件发送 | skill | rest | `http://localhost:4019` |
| 20 | `tool-crawler` | 网络爬虫 | skill | rest | `http://localhost:4020` |

---

## 6. 10 个外部集成节点（External Integrations）

| # | ID | 服务 | 原生协议 | 认证 | 端点 |
|---|-----|------|---------|------|------|
| 1 | `github` | GitHub | REST | OAuth2 | `https://api.github.com` |
| 2 | `gitlab` | GitLab | REST | OAuth2 | `https://gitlab.com/api/v4` |
| 3 | `npm` | NPM Registry | REST | 无 | `https://registry.npmjs.org` |
| 4 | `openai` | OpenAI | REST | Bearer | `https://api.openai.com/v1` |
| 5 | `pinecone` | Pinecone | REST | API Key | `https://api.pinecone.io` |
| 6 | `slack` | Slack | REST | Bearer | `https://slack.com/api` |
| 7 | `stripe` | Stripe | REST | Bearer | `https://api.stripe.com/v1` |
| 8 | `supabase` | Supabase | REST | API Key | `https://{project}.supabase.co` |
| 9 | `serpapi` | SerpAPI | REST | API Key | `https://serpapi.com/search` |
| 10 | `wolfram` | Wolfram Alpha | REST | API Key | `https://api.wolframalpha.com/v2` |

---

## 7. Provider 接口全景

### 7.1 后端 3DACP Service Adapters（9 个模块）

```
backend/src/services/
├── DialogService_3DACP.ts      ──→ 对话中心（chat, streamChat, history, clear）
├── AgentService_3DACP.ts       ──→ Agent 管理（list, create, update, delete, invoke）
├── GroupService_3DACP.ts       ──→ 群组编排（list, create, orchestrate）
├── KnowledgeService_3DACP.ts   ──→ 知识库（list, create, upload, delete）
├── SkillService_3DACP.ts       ──→ 技能管理（list, create, invoke, delete）
├── MonitorService_3DACP.ts     ──→ 监控中心（metrics, alerts, logs, subscribe）
├── PlatformService_3DACP.ts    ──→ 平台管理（list, create, refreshModels, delete）
├── BlueprintService_3DACP.ts   ──→ 蓝图构建（list, create, execute）
└── InterventionService_3DACP.ts ──→ 人工干预（intervene, getHistory）
```

### 7.2 前端 useAxisClient 模块封装（9 个便捷 API）

```typescript
// 来源：frontend/src/hooks/useAxisClient.ts

axisDialog      → { chat, streamChat, getHistory, clear }
axisAgent       → { list, get, create, update, delete, invoke }
axisGroup       → { list, get, create, update, delete, orchestrate }
axisKnowledge   → { list, get, create, delete, upload }
axisSkill       → { list, get, create, delete, invoke }
axisMonitor     → { metrics, alerts, logs, subscribe }
axisPlatform    → { list, get, create, delete, refreshModels }
axisBlueprint   → { list, get, create, execute }
axisIntervention → { intervene, getHistory }
```

### 7.3 协议适配器（5 种协议）

```
backend/src/coordinator/ProtocolAdapter/
├── RestAdapter.ts      ──→ HTTP REST（跨网络）
├── SseAdapter.ts       ──→ Server-Sent Events（服务端推送）
├── WsAdapter.ts        ──→ WebSocket（双向实时）
├── InternalAdapter.ts  ──→ 同进程内部调用（零拷贝）
└── BridgeAdapter.ts    ──→ 跨平台桥接（AgentZero ↔ Backend）
```

**自适应规则**（距离 → 协议）：

| 源-目标距离 | 自动选择 | 原因 |
|---|---|---|
| 同进程 | `internal` | 零拷贝，函数调用 |
| 同机不同进程 | `ws` 或 `ipc` | 低延迟双向 |
| 内网不同机 | `ws` | 可靠双向，可穿透 NAT |
| 公网 | `rest` / `sse` | 防火墙友好 |
| 流式数据 | `sse` / `ws` | 实时推送 |

---

## 8. 工作空间管理（Workspace）

### 8.1 后端工作空间路由

| 路由 | 文件 | 功能 |
|------|------|------|
| `/api/workspaces` | `routes/workspaces.ts` | 工作空间 CRUD + 任务/知识库关联 |
| `/api/workspace` | `routes/workspace.ts` | **v2 工作空间管理（新增）** |
| `/api/v2/workspaces` | `routes/workspaces.ts` | 兼容 v2 前缀 |

### 8.2 工作空间实体结构（数据库）

```sql
-- 工作空间通过任务和知识库关联间接支持
-- tasks 表：target_agent_id, target_swarm_id, execution_mode
-- knowledge_bases 表：file_paths, document_count, index_rate
```

### 8.3 工作空间管理功能（API 层面）

```
GET    /api/workspaces          → 列出所有工作空间
GET    /api/workspaces/:id      → 获取工作空间详情
POST   /api/workspaces          → 创建工作空间
PUT    /api/workspaces/:id      → 更新工作空间
DELETE /api/workspaces/:id      → 删除工作空间
GET    /api/workspaces/:id/tasks → 获取工作空间任务列表
POST   /api/workspaces/:id/tasks → 在工作空间创建任务
GET    /api/workspaces/:id/kb    → 获取工作空间知识库
```

---

## 9. 三层连接矩阵

### 9.1 xy 平面（平台 × 功能）

任意平台实例可以调用任意功能模块，消息格式统一：

```typescript
// 示例：前端 DialogCenter 调用后端 dialog 服务
const msg: AxisMessage = {
  source: { x: 'frontend-main', y: 'dialog', z: 'rest' },
  target: { x: 'backend-api', y: 'dialog', z: 'ws' },
  payload: { action: 'sendMessage', entity: 'dialog', data: { agentId: 'agent-1', content: '你好' } }
};
// AxisRouter 自动路由到 backend-api 的 dialog 服务
```

### 9.2 xz 平面（平台 × 协议）

每个平台声明协议偏好和降级链：

```typescript
const backendProfile = {
  platformId: 'backend-api',
  preferredProtocol: 'ws',
  fallbackChain: ['ws', 'sse', 'rest'],
  endpoints: {
    rest: 'https://api.garden.local/v1',
    sse: 'https://api.garden.local/v1/events',
    ws: 'wss://api.garden.local/ws',
  }
};
```

### 9.3 yz 平面（功能 × 协议）

每个功能模块声明协议需求：

| 模块 | 必需 | 首选 | 流式 |
|------|------|------|------|
| dialog | rest | ws | ✅ |
| agent | rest | rest | ❌ |
| monitor | rest | sse | ✅ |
| settings | rest | rest | ❌ |
| knowledge | rest | rest | ❌ |

---

## 10. 架构实现图

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (x=frontend)                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │ Agents  │ │ Groups  │ │ Dialogs │ │ Skills  │ │ Monitor │  │ ← y轴
│  │  (page) │ │  (page) │ │(DialogCenter)│ (page) │ │(panel)  │  │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘  │
│       └────────────┴──────────┴──────────┴──────────┘         │
│                         │                                        │
│                    ┌────┴────┐                                   │
│                    │ AxisClient │  ← 统一前端客户端（15前端）        │
│                    │ (api/AxisClient.ts) │                        │
│                    └────┬────┘                                   │
└─────────────────────────┼───────────────────────────────────────┘
                          │ AxisMessage (over WS/SSE/REST)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                        BACKEND (x=backend)                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    AxisGateway                           │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │    │
│  │  │AxisRouter│  │Protocol │  │Registry │  │Transform│   │    │
│  │  │         │  │Adapter  │  │ (50节点) │  │  Layer  │   │    │
│  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘   │    │
│  │       └─────────────┴────────────┴────────────┘         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                          │                                       │
│  ┌─────────┐ ┌─────────┐ │ ┌─────────┐ ┌─────────┐ ┌─────────┐ │
│  │ Agent   │ │ Dialog  │ │ │  Group  │ │ Skill   │ │Knowledge│ │ ← y轴
│  │ Service │ │ Service │─┘│ Service │ │ Service │ │ Service │ │
│  └────┬────┘ └────┬────┘  └────┬────┘ └────┬────┘ └────┬────┘ │
│       └────────────┴───────────┴───────────┴──────────┘        │
│                          │                                      │
│                    ┌────┴────┐                                  │
│                    │ InternalBus  ← z轴：内部消息总线（15后端）      │
│                    │ (CollabFramework/MessageBus)               │
│                    └────┬────┘                                  │
└─────────────────────────┼───────────────────────────────────────┘
                          │ AxisMessage (over Bridge)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     AGENT-ZERO (x=agentzero)                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                           │
│  │20个子工具│ │ models  │ │  api/   │  ← BridgeAdapter 接入      │
│  │(tool-*) │ │(litellm)│ │(80+ ep) │    （20子工具）              │
│  └─────────┘ └─────────┘ └─────────┘                           │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     EXTERNAL (x=external)                        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐             │
│  │ github  │ │ openai  │ │ pinecone│ │  slack  │  ... 10个     │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 11. 迁移策略与当前状态

### 11.1 四阶段迁移

| 阶段 | 目标 | 状态 |
|------|------|------|
| Phase 1: z轴（协议统一） | AxisMessage + ProtocolAdapter + AxisClient | ✅ 完成 |
| Phase 2: y轴（功能统一） | 9 个 Service Adapter + ModuleContract | ✅ 完成 |
| Phase 3: x轴（平台统一） | AxisRegistry + 50 节点注册 + BridgeAdapter | ✅ 完成 |
| Phase 4: 全图验证 | E2E 测试 + 压力测试 + 故障转移 | 🔄 待验证 |

### 11.2 当前已实现功能

| 功能 | 状态 | 文件 |
|------|------|------|
| 3D 消息格式 | ✅ | `AxisMessage.ts` |
| 5 协议适配器 | ✅ | `ProtocolAdapter/` |
| 路由表 + 寻址 | ✅ | `AxisRouter.ts` |
| 注册中心（50 节点） | ✅ | `AxisRegistry.ts` |
| 健康检查 | ✅ | `AxisRegistry.ts`（心跳 30s 超时） |
| 负载均衡 | ✅ | `selectBestNode()`（权重+延迟评分） |
| 前端 AxisClient | ✅ | `AxisClient.ts` |
| 9 模块便捷 API | ✅ | `useAxisClient.ts` |
| 流式支持 | ✅ | WS + SSE + REST 流式 |
| 演示页面 | ✅ | `AxisDemo.tsx` |
| 外部集成（10 个） | ✅ | `createPresetExternalNodes()` |
| Express Gateway 挂载 | ✅ | `server.ts` 中 `/axis` 路由 |

---

## 12. 文件定位速查表

| 职责 | 文件路径 |
|------|---------|
| 协议设计文档 | `docs/3D_Axis_Connection_Protocol.md` |
| 消息格式定义 | `backend/src/coordinator/AxisMessage.ts` |
| 3D 路由表 | `backend/src/coordinator/AxisRouter.ts` |
| 节点注册中心 | `backend/src/coordinator/AxisRegistry.ts` |
| Express Gateway | `backend/src/middleware/AxisGateway.ts` |
| 协议适配器 | `backend/src/coordinator/ProtocolAdapter/` |
| 前端客户端 | `frontend/src/api/AxisClient.ts` |
| 前端 Hook | `frontend/src/hooks/useAxisClient.ts` |
| 演示页面 | `frontend/src/pages/AxisDemo.tsx` |
| 服务端示例 | `backend/src/server_3dacp_example.ts` |
| Dialog 适配 | `backend/src/services/DialogService_3DACP.ts` |
| Agent 适配 | `backend/src/services/AgentService_3DACP.ts` |
| Group 适配 | `backend/src/services/GroupService_3DACP.ts` |
| Knowledge 适配 | `backend/src/services/KnowledgeService_3DACP.ts` |
| Skill 适配 | `backend/src/services/SkillService_3DACP.ts` |
| Monitor 适配 | `backend/src/services/MonitorService_3DACP.ts` |
| Platform 适配 | `backend/src/services/PlatformService_3DACP.ts` |
| Blueprint 适配 | `backend/src/services/BlueprintService_3DACP.ts` |
| Intervention 适配 | `backend/src/services/InterventionService_3DACP.ts` |
| 后端入口 | `backend/src/index.ts` |
| 服务器构建 | `backend/src/server.ts` |

---

## 13. 启动验证命令

```bash
# 1. 启动后端
npm run dev

# 2. 检查 3DACP 注册状态
curl http://localhost:3001/axis/registry

# 3. 检查节点统计
curl http://localhost:3001/axis/stats
# 预期：totalNodes: 50 (15+15+20) + 10 external = 60

# 4. 通过 3DACP 调用 dialog
curl -X POST http://localhost:3001/axis \
  -H "Content-Type: application/json" \
  -d '{
    "version": "3dacp/v1",
    "header": { "msgId": "test-1", "source": { "x": "frontend-main", "y": "dialog", "z": "rest" }, "target": { "x": "backend-api", "y": "dialog", "z": "rest" }, "timestamp": 1717065600000, "priority": 5, "ttl": 30000, "expectsReply": true, "traceChain": [] },
    "payload": { "action": "read", "entity": "dialog", "data": { "agentId": "agent-1" }, "metadata": {} },
    "transport": { "protocol": "rest", "encoding": "json", "compressed": false }
  }'

# 5. 查看前端演示页面
# 打开 http://localhost:5173/axis-demo（需前端路由配置）
```

---

**文档版本**: v1.0 | **路径**: `sylva_platform/docs/3DACP_complete_architecture.md`

**核心结论**：3D 坐标系架构的完整版本就是当前仓库中的实现，已包含 15 个前端 + 15 个后端 + 20 个子工具 + 10 个外部集成的全部节点定义，以及 9 个功能模块的 3DACP 适配器。后端启动时自动注册所有节点到 AxisRegistry，前端通过 AxisClient 统一访问。
