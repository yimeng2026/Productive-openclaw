# 千界花园平台连接矩阵统计 — 3DACP v1.1

> **更新**：纳入外部集成平台，统一接口协议覆盖全部连接

---

## 1. 平台分类统计

### 1.1 内部平台（XYZ 轴）— Agent 节点

| 轴 | 维度 | 数量 | 说明 |
|---|---|---|---|
| **X轴** | 前端平台 | 15 | 各种前端 UI/框架/运行时 |
| **Y轴** | 后端平台 | 15 | 各种后端服务/API/引擎 |
| **Z轴** | 子工具平台 | 20 | 各种子工具/微服务/插件 |
| **小计** | **内部平台** | **50** | **全部为 Agent 节点，xyz 自由相连** |

### 1.2 外部集成平台 — 非 Agent 节点

| 类型 | 示例 | 数量（估算） |
|---|---|---|
| **代码仓库** | GitHub, GitLab, Gitee, Bitbucket | 4 |
| **技能库/Plugin** | npm, PyPI, crates.io, Maven Central | 4 |
| **云服务** | AWS, Azure, GCP,阿里云 | 4 |
| **API 服务** | Stripe, Twilio, SendGrid, Firebase | 4 |
| **数据库** | PostgreSQL, MongoDB, Redis, Supabase | 4 |
| **向量数据库** | Pinecone, Weaviate, Chroma, Qdrant | 4 |
| **LLM API** | OpenAI, Anthropic, Google, DeepSeek | 4 |
| **搜索/知识** | SerpAPI, Wolfram, Wikipedia API | 3 |
| **监控/日志** | Datadog, Sentry, Grafana, Prometheus | 4 |
| **消息/协作** | Slack, Discord, Telegram,飞书 | 4 |
| **小计** | **外部集成平台** | **~35** |

### 1.3 总计

| 类别 | 数量 |
|---|---|
| 内部平台（Agent 节点） | 50 |
| 外部集成平台 | ~35 |
| **总计** | **~85** |

---

## 2. 连接矩阵

### 2.1 连接规则

```
规则 1: 任意内部平台（xyz）↔ 任意内部平台（xyz） = ✅ 自由相连
规则 2: 任意内部平台（xyz）↔ 任意外部集成平台 = ✅ 统一协议接入
规则 3: 外部集成平台 ↔ 外部集成平台 = ❌ 不直接相连（通过内部平台中转）
```

### 2.2 每个平台的可连接数

| 平台类型 | 可连接内部平台 | 可连接外部平台 | **总连接数** |
|---|---|---|---|
| X轴前端（15个） | 49（50-1） | ~35 | **~84** |
| Y轴后端（15个） | 49（50-1） | ~35 | **~84** |
| Z轴子工具（20个） | 49（50-1） | ~35 | **~84** |
| 外部集成（~35个） | 50（全部内部） | 0 | **50** |

### 2.3 总连接边数

```
内部 ↔ 内部: C(50, 2) = 50 × 49 / 2 = 1,225 条
内部 ↔ 外部: 50 × 35 = 1,750 条
外部 ↔ 外部: 0 条（不直连）
────────────────────────────────────
总计: 2,975 条连接边
```

---

## 3. 外部集成平台的接入策略

### 3.1 接入方式

外部集成平台不直接参与 3DACP 消息总线，而是通过 **ExternalAdapter** 桥接：

```
┌─────────────────────────────────────────────────────┐
│                  内部 Agent 节点                     │
│  ┌─────────┐                                        │
│  │ Agent X │─── AxisMessage ───┐                    │
│  └─────────┘                    │                    │
│                                 ▼                    │
│  ┌─────────────────────────────────────────────┐    │
│  │         AxisRouter + ExternalAdapter         │    │
│  │  ┌─────────────┐    ┌─────────────────┐   │    │
│  │  │  Protocol    │    │  External Bridge │   │    │
│  │  │  Adapter     │───→│  (OpenAPI/stdio) │   │    │
│  │  │  (WS/SSE/REST)│    │  (MCP/OGP/ACP)   │   │    │
│  │  └─────────────┘    └─────────────────┘   │    │
│  └─────────────────────────────────────────────┘    │
│                                 │                    │
│                                 ▼                    │
│  ┌────────────────────────────────────────────────┐ │
│  │           外部集成平台（如 GitHub API）           │ │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐  │ │
│  │  │ REST   │ │ GraphQL│ │ Webhook│ │ OAuth  │  │ │
│  │  │  API   │ │  API   │ │        │ │        │  │ │
│  │  └────────┘ └────────┘ └────────┘ └────────┘  │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 3.2 外部协议封装

外部集成平台原有协议（REST/GraphQL/Webhook/OAuth）统一封装为 AxisMessage：

| 外部协议 | 封装方式 | 说明 |
|---|---|---|
| REST API | ExternalRESTAdapter | 将 AxisMessage 映射到 HTTP 请求 |
| GraphQL | ExternalGraphQLAdapter | 将 AxisMessage 映射到 GraphQL query/mutation |
| Webhook | ExternalWebhookAdapter | 将外部 webhook payload 转为 AxisMessage |
| stdio/MCP | ExternalMCPAdapter | 将 Model Context Protocol 封装为 AxisMessage |
| OAuth | ExternalAuthAdapter | 统一认证层，不直接参与消息路由 |

### 3.3 外部集成平台注册

外部集成平台在 AxisRegistry 中注册为特殊类型：

```typescript
interface ExternalPlatformNode extends PlatformNode {
  type: 'integration';
  /** 外部平台的原生协议 */
  nativeProtocol: 'rest' | 'graphql' | 'webhook' | 'mcp' | 'oauth';
  /** 外部平台的 API endpoint */
  apiEndpoint: string;
  /** 认证方式 */
  auth: {
    type: 'apikey' | 'oauth2' | 'basic' | 'bearer';
    /** 认证配置引用（在 Vault 中） */
    configRef: string;
  };
  /** 限流配置 */
  rateLimit: {
    requestsPerMinute: number;
    burstAllowance: number;
  };
  /** 可用操作映射 */
  operationMap: Record<string, {
    nativeEndpoint: string;
    method: string;
    inputTransform: string;  // transform 脚本路径
    outputTransform: string;
  }>;
}
```

---

## 4. 统一接口协议的核心覆盖

### 4.1 协议覆盖矩阵

| 平台类型 | 内部协议 | 外部协议 | 统一后 |
|---|---|---|---|
| X轴前端 | WS, SSE, REST | — | AxisMessage over WS/SSE/REST |
| Y轴后端 | REST, Internal Bus | — | AxisMessage over REST/Internal |
| Z轴子工具 | stdio, REST, WS | — | AxisMessage over WS/REST |
| 外部集成 | — | REST, GraphQL, Webhook, MCP | AxisMessage over ExternalAdapter |

### 4.2 任意连接示例

```
场景 1: 前端 DialogCenter (X轴) → 后端 DialogService (Y轴)
   AxisMessage { source: (frontend, dialog, ws), target: (backend, dialog, ws) }
   → WSAdapter 直连

场景 2: 后端 AgentService (Y轴) → GitHub API (外部)
   AxisMessage { source: (backend, agent, rest), target: (github, repo, external) }
   → ExternalRESTAdapter 转发到 GitHub REST API

场景 3: 子工具 CodeInterpreter (Z轴) → Pinecone (外部)
   AxisMessage { source: (tools, skill, rest), target: (pinecone, vector, external) }
   → ExternalRESTAdapter 转发到 Pinecone API

场景 4: 前端 Monitoring (X轴) → 子工具 Logger (Z轴)
   AxisMessage { source: (frontend, monitor, sse), target: (tools, monitor, sse) }
   → SSEAdapter 直连
```

---

## 5. 实施扩展

### 5.1 新增外部集成平台

接入一个新的外部平台只需三步：
1. 在 AxisRegistry 注册 ExternalPlatformNode
2. 配置 operationMap（将 AxisMessage action 映射到外部 API）
3. 系统自动通过 ExternalAdapter 桥接

### 5.2 新增内部平台

接入一个新的内部平台也只需三步：
1. 在 AxisRegistry 注册 PlatformNode
2. 声明支持的 ModuleContract
3. 接入 InternalBus 或 WSAdapter，自动加入 3DACP

---

**文档版本**: v1.1  
**更新**: 纳入外部集成平台统一接入  
**统计**: 50 内部 Agent 节点 + ~35 外部集成 = ~85 总平台，2,975 条连接边
