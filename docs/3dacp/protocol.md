# 3D Axis Connection Protocol (3DACP) 协议文档

> **版本**: v1.0 | **日期**: 2026-05-30 | **状态**: 架构设计完成，核心代码已落地

---

## 1. 协议概述

3DACP（三维轴连接协议）是 Productive OpenClaw 的核心消息路由协议。它通过三维坐标系（平台 × 功能 × 协议）为系统内所有服务节点提供统一的消息寻址和路由机制。

### 1.1 设计目标

- **统一寻址**: 任意平台、任意功能模块、任意协议之间的统一消息格式
- **解耦通信**: 发送方无需知道接收方的物理位置，只需指定逻辑坐标
- **协议自适应**: 根据源-目标距离自动选择最优通信协议
- **可扩展性**: 新平台/功能/协议的接入只需注册新节点

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

## 3. 节点注册中心

### 3.1 前端节点（X轴 — Frontend）

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

### 3.2 后端节点（X轴 — Backend）

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

### 3.3 子工具节点（Z轴 — AgentZero Tools）

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

## 4. 核心组件

### 4.1 AxisRouter — 消息路由

AxisRouter 负责根据消息的目标坐标，在注册中心查找目标节点，并选择最优路径转发消息。

**路由流程：**

1. 解析消息的 `target` 坐标（x, y, z）
2. 在 AxisRegistry 中查找匹配的节点
3. 根据源-目标距离选择最优协议
4. 通过对应的 ProtocolAdapter 发送消息

### 4.2 AxisRegistry — 服务注册

AxisRegistry 维护系统中所有节点的注册信息，支持：

- **节点注册/注销**: 动态添加/移除服务节点
- **健康检查**: 30秒心跳超时机制
- **负载均衡**: `selectBestNode()` 基于权重+延迟评分
- **服务发现**: 根据坐标查询可用节点

### 4.3 协议适配器

```
ProtocolAdapter/
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

## 5. 三层连接矩阵

### 5.1 xy 平面（平台 × 功能）

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

### 5.2 xz 平面（平台 × 协议）

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

### 5.3 yz 平面（功能 × 协议）

每个功能模块声明协议需求：

| 模块 | 必需 | 首选 | 流式 |
|------|------|------|------|
| dialog | rest | ws | ✅ |
| agent | rest | rest | ❌ |
| monitor | rest | sse | ✅ |
| settings | rest | rest | ❌ |
| knowledge | rest | rest | ❌ |

---

## 6. Service Adapters（9 个业务模块）

```
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

---

## 7. 蜂群协调框架

CollabFramework 基于 3DACP 协议实现递归嵌套蜂群协调。

### 核心概念

```
Swarm（蜂群）
├── SwarmNode（节点）
│   ├── agent（叶子节点）
│   └── sub-swarm（内部节点，可嵌套）
│       └── SwarmNode...
└── SwarmCoordinator（协调器）
    ├── 任务分解
    ├── 任务调度
    ├── 结果聚合
    └── 负载均衡
```

### 四种执行模式

| 模式 | 说明 |
|------|------|
| **Sequential** | 顺序执行，任务 A 完成后再执行 B |
| **Parallel** | 并行执行，所有任务同时启动 |
| **Hierarchical** | 层级执行，父任务控制子任务 |
| **Dynamic** | 动态调度，根据负载实时调整 |

---

## 8. 迁移策略

### 8.1 四阶段迁移

| 阶段 | 目标 | 状态 |
|------|------|------|
| Phase 1: z轴（协议统一） | AxisMessage + ProtocolAdapter + AxisClient | ✅ 完成 |
| Phase 2: y轴（功能统一） | 9 个 Service Adapter + ModuleContract | ✅ 完成 |
| Phase 3: x轴（平台统一） | AxisRegistry + 50 节点注册 + BridgeAdapter | ✅ 完成 |
| Phase 4: 全图验证 | E2E 测试 + 压力测试 + 故障转移 | 🔄 待验证 |

### 8.2 已完成功能

| 功能 | 状态 |
|------|------|
| 3D 消息格式 | ✅ |
| 5 协议适配器 | ✅ |
| 路由表 + 寻址 | ✅ |
| 注册中心（50 节点） | ✅ |
| 健康检查 | ✅ |
| 负载均衡 | ✅ |
| 流式支持 | ✅ |
| 外部集成（10 个） | ✅ |

---

## 9. API 示例

### 9.1 发送 3DACP 消息

```bash
curl -X POST http://localhost:3001/axis \
  -H "Content-Type: application/json" \
  -d '{
    "version": "3dacp/v1",
    "header": {
      "msgId": "test-1",
      "source": { "x": "frontend-main", "y": "dialog", "z": "rest" },
      "target": { "x": "backend-api", "y": "dialog", "z": "rest" },
      "timestamp": 1717065600000,
      "priority": 5,
      "ttl": 30000,
      "expectsReply": true,
      "traceChain": []
    },
    "payload": {
      "action": "read",
      "entity": "dialog",
      "data": { "agentId": "agent-1" },
      "metadata": {}
    },
    "transport": {
      "protocol": "rest",
      "encoding": "json",
      "compressed": false
    }
  }'
```

### 9.2 检查注册状态

```bash
# 检查 3DACP 注册状态
curl http://localhost:3001/axis/registry

# 检查节点统计
curl http://localhost:3001/axis/stats
# 预期：totalNodes: 50 (15+15+20) + 10 external = 60
```

---

## 相关文档

- [总体架构](../architecture/overview.md)
- [SRIA-SMIM 引擎](../architecture/sria-smim.md)
- [Platform Core](../architecture/platform-core.md)
- [OpenClaw 优化方案](../openclaw-opt/optimization.md)

---

*文档版本: v1.0 | 3D Axis Connection Protocol (3DACP)*
