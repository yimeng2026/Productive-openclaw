# SYLVA Platform 后端运行链路文档

> 版本：v1.0 | 日期：2026-05-30 | 状态：生产就绪

---

## 1. 入口文件与启动顺序

### 1.1 入口层级

```
┌─────────────────────────────────────────┐
│  最外层入口：index.ts                     │  ← node dist/index.js
│  └── 导入并调用 bootApp()                │
├─────────────────────────────────────────┤
│  启动逻辑：app.ts                         │  ← 环境解析 + 错误处理
│  └── bootApp() → startServer()           │
├─────────────────────────────────────────┤
│  服务器构建：server.ts                    │  ← Express + 路由 + 协议层
│  └── startServer(port)                   │
│      ├── 构建 Express app                │
│      ├── 注册 40+ 路由                   │
│      ├── 初始化 3DACP Axis Gateway       │
│      ├── 启动 HTTP listener              │
│      ├── 启动 WebSocket server           │
│      └── 初始化 Coordinator Bridges      │
└─────────────────────────────────────────┘
```

### 1.2 启动顺序（精确时序）

```
[0ms]  index.ts  ──→ bootApp()
        │
[1ms]  app.ts    ──→ 解析 PORT（默认 3001）
        │         ──→ 注册 process.on('uncaughtException')
        │         ──→ 注册 process.on('unhandledRejection')
        │         ──→ 注册 SIGTERM / SIGINT 优雅退出
        │         ──→ 调用 startServer(PORT)
        │
[5ms]  server.ts ──→ 创建 Express app
        │         ──→ CORS 中间件（origin: process.env.CORS_ORIGIN || localhost:3000）
        │         ──→ JSON body parser
        │         ──→ Request logging 中间件
        │         ──→ 【自动配置】runAutoConfig()（非阻塞）
        │         ──→ 注册 40+ 路由（v1 + v2 双版本）
        │         ──→ 【3DACP Axis Gateway】初始化（可选，非阻塞）
        │         ──→ 静态文件服务（Electron 嵌入模式）
        │         ──→ SPA fallback（未匹配路由 → index.html）
        │         ──→ app.listen(port) ──→ HTTP 就绪
        │         ──→ initWebSocket(server, "/ws") ──→ WS 就绪
        │         ──→ initMegaProviderBridge() ──→ 非阻塞
        │         ──→ initSkillBridge() ──→ 非阻塞
        │         ──→ initMessageBus() ──→ 非阻塞
        │
[complete]  logger.info("Sylva Platform backend ready")
```

---

## 2. 路由注册全景图

### 2.1 已注册路由列表（40+ 条）

| 路由 | 文件 | 版本 | 说明 |
|------|------|------|------|
| `/api/health` | `routes/health.ts` | v1/v2 | 健康检查 |
| `/api/agents` | `routes/agents.ts` | v1 | Agent 基础 CRUD |
| `/api/agents/v2` `/api/v2/agents` | `routes/agentsV2.ts` | v2 | Agent v2 接口 |
| `/api/agents-runtime` | `routes/agentsRuntime.ts` | v1/v2 | Agent 运行时 |
| `/api/dialog` | `routes/dialog.ts` | v1/v2 | 对话中心（真实 API） |
| `/api/channels` | `routes/channels.ts` | v1/v2 | 消息渠道 |
| `/api/models` | `routes/models.ts` | v1/v2 | 模型管理 |
| `/api/platforms` | `routes/platforms.ts` | v1/v2 | 平台配置 |
| `/api`（platformDetails） | `routes/platformDetails.ts` | v1 | 平台详情（Hermes/AgentZero/Ollama/Mega-Hub/Model-Router） |
| `/api/apikeys` | `routes/apikeys.ts` | v1/v2 | API 密钥管理 |
| `/api/skills` | `routes/skills.ts` | v1/v2 | 技能管理 |
| `/api/tasks` | `routes/tasks.ts` | v1/v2 | 任务管理 |
| `/api/monitor` | `routes/monitor.ts` | v1/v2 | 监控中心 |
| `/api/workspaces` | `routes/workspaces.ts` | v1/v2 | 工作空间 |
| `/api/knowledge-bases` | `routes/knowledge-bases.ts` | v1/v2 | 知识库 |
| `/api/handoff` | `routes/handoff.ts` | v1/v2 | 跨战车交接 |
| `/api/coordinator` | `routes/coordinator.ts` | v1/v2 | 协调器 |
| `/api/agentZero` | `routes/agentZero.ts` | v1/v2 | AgentZero 代理 |
| `/api/auth` | `routes/auth.ts` | v1/v2 | 认证 |
| `/api/memories` | `routes/memories.ts` | v1/v2 | 记忆管理 |
| `/api/settings` | `routes/settings.ts` | v1/v2 | 设置 |
| `/api/security` | `routes/security.ts` | v1/v2 | 安全 |
| `/api/uploads` | `routes/uploads.ts` | v1/v2 | 文件上传 |
| `/api/scheduler` | `routes/scheduler.ts` | v1/v2 | 调度器 |
| `/api/search` | `routes/search.ts` | v1/v2 | 搜索 |
| `/api/ollama` | `routes/ollama.ts` | v1/v2 | Ollama 本地模型 |
| `/api/registry` | `routes/registry.ts` | v1/v2 | 注册表 |
| `/api/backup` | `routes/backup.ts` | v1/v2 | 备份 |
| `/api/imports` | `routes/imports.ts` | v1/v2 | 导入 |
| `/api/webhooks` | `routes/webhooks.ts` | v1/v2 | Webhook |
| `/api/external` | `routes/external.ts` | v1/v2 | 外部集成 |
| `/api/google-chat` | `routes/googleChat.ts` | v1/v2 | Google Chat |
| `/api/unified` | `routes/unified.ts` | v1/v2 | 统一接口 |
| `/api/ai-search` | `routes/aiSearch.ts` | v1/v2 | AI 搜索 |
| `/api/hierarchical` | `routes/hierarchical.ts` | v1/v2 | **分层协调（新增）** |
| `/api/workspace` | `routes/workspace.ts` | v1/v2 | **工作空间管理（新增）** |
| `/api/unified-api` | `routes/unified-api.ts` | v1/v2 | **统一 API 协议（新增）** |
| `/api/integrations` | `routes/integrations.ts` | v1/v2 | **外部集成（新增）** |
| `/api/blueprints` | `routes/blueprints.ts` | v1/v2 | **蓝图构建器（新增）** |
| `/api/process` | `routes/process.ts` | v1/v2 | 进程管理 |
| `/api/logs` | `routes/logs.ts` | v1/v2 | 日志 |
| `/api/events` | `routes/events.ts` | v1/v2 | 事件 |
| `/api/groups` | `routes/groups.ts` | v1/v2 | 群组 |
| `/axis` | `middleware/AxisGateway.ts` | — | **3DACP 统一入口（新增）** |
| `/ws` | `websocket.ts` | — | WebSocket 服务器 |

### 2.2 端点处理流程（以 `/api/agents` 为例）

```
HTTP Request → app.use("/api/agents", agentsRouter)
                    │
                    ▼
            ┌───────────────┐
            │  CORS 检查     │  ← 允许 localhost:3000
            │  JSON 解析     │  ← express.json()
            │  请求日志      │  ← logger.info()
            └───────┬───────┘
                    │
                    ▼
            ┌───────────────┐
            │ agentsRouter  │  ← Express Router
            │  ├── GET  /   │  ← listAgents()
            │  ├── GET /:id │  ← getAgent()
            │  ├── POST /   │  ← createAgent()
            │  ├── PUT /:id │  ← updateAgent()
            │  └── DEL /:id │  ← deleteAgent()
            └───────┬───────┘
                    │
                    ▼
            ┌───────────────┐
            │ AgentRepository│  ← SQLite Repository 层
            │  ├── getAll()  │
            │  ├── getById() │
            │  ├── create()  │
            │  ├── update()  │
            │  └── delete()  │
            └───────┬───────┘
                    │
                    ▼
            ┌───────────────┐
            │   sqlite.ts   │  ← Database 连接池
            │  (getDb())    │
            └───────┬───────┘
                    │
                    ▼
            ┌───────────────┐
            │  sylva.db     │  ← SQLite 文件
            └───────────────┘
```

---

## 3. 环境变量清单

### 3.1 必需变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NODE_ENV` | `development` | 运行环境（development / production / test） |
| `PORT` | `3000` | HTTP 监听端口 |
| `DATABASE_URL` | `sqlite:sylva.db` | SQLite 数据库路径 |
| `JWT_SECRET` | — | JWT 签名密钥（生产必须 ≥32 字符） |

### 3.2 可选变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FRONTEND_URL` | `http://localhost:5173` | 前端 CORS 白名单 |
| `CORS_ORIGIN` | `http://localhost:3000` | CORS 源（server.ts 中使用） |
| `JWT_EXPIRES_IN` | `15m` | JWT 有效期 |
| `REFRESH_TOKEN_EXPIRES_IN` | `7d` | Refresh Token 有效期 |
| `BCRYPT_ROUNDS` | `12` | 密码哈希轮数 |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama 服务地址 |
| `LOG_LEVEL` | `info` | 日志级别（debug/info/warn/error） |
| `VERBOSE` | `false` | 详细日志 |
| `REQUEST_TIMEOUT` | `30000` | 请求超时（毫秒） |
| `MAX_FILE_SIZE` | `50` | 最大文件大小（MB） |
| `RATE_LIMIT_PER_MINUTE` | `100` | 每分钟请求限制 |
| `RATE_LIMIT_WHITELIST` | `127.0.0.1` | 限流白名单 |
| `WS_ENABLED` | `true` | WebSocket 开关 |
| `WS_HEARTBEAT_INTERVAL` | `30` | WS 心跳间隔（秒） |
| `ADMIN_EMAILS` | — | 管理员邮箱列表 |
| `ELECTRON_MODE` | — | Electron 嵌入模式（true/false） |

### 3.3 启动检查清单

```bash
# 1. 复制环境配置
cp backend/.env.example backend/.env

# 2. 编辑 .env（至少设置 JWT_SECRET）
# JWT_SECRET=your-32-char-secret-here

# 3. 安装依赖
npm install

# 4. 编译 TypeScript
npm run build
# 或开发模式
npx tsx backend/src/index.ts

# 5. 启动
node backend/dist/index.js
```

---

## 4. 数据库初始化步骤

### 4.1 初始化流程

```
首次启动 → database/init.ts 的 init() 被调用
    │
    ├──→ 1. initDatabase()（sqlite.ts）
    │       └── 创建基础连接 + 基础表（如不存在）
    │
    ├──→ 2. 检查 schema_migrations 表版本
    │       └── 当前版本 = 0（首次）
    │
    ├──→ 3. 执行 migrations[] 中所有版本
    │       └── v1: 读取 schema.sql → 按分号拆分 → 逐条执行
    │
    ├──→ 4. 幂等执行 schema.sql（非首次也执行，忽略已存在错误）
    │
    └──→ 5. 检查是否有数据（hasData() → AgentRepository.count()）
            ├── 无数据 → runSeed() → 注入 6 Agent + 3 Group + 8 Skill + 6 KB + 10 Task
            └── 有数据 → 跳过 seed
```

### 4.2 数据库 Schema 表结构

| 表名 | 用途 | 核心字段 |
|------|------|---------|
| `schema_migrations` | 版本控制 | version, applied_at, description |
| `agents` | 智能体 | id, name, level_a/b/c, role, status, health, skills, capabilities, config |
| `tasks` | 任务 | id, type, target_agent_id, state, output, error, latency_ms, tokens_used |
| `groups` | 群组 | id, name, level, agent_ids, status, current_meeting |
| `skills` | 技能 | id, name, source, status, version, config, skill_md |
| `knowledge_bases` | 知识库 | id, name, type, document_count, index_rate, file_paths |
| `meetings` | 会议 | id, group_id, topic, participant_ids, result |
| `health_checks` | 健康检查 | id, agent_id, status, response_time_ms, score |

### 4.3 Seed 数据（首次启动自动注入）

| 实体 | 数量 | 说明 |
|------|------|------|
| Agent | 6 | 代码助手、数据分析、文档撰写、翻译、测试、架构师 |
| Group | 3 | 开发团队（1级）、数据处理组（2级）、核心架构组（3级） |
| Skill | 8 | 代码审查、代码生成、数据分析、文档撰写、翻译、测试、架构、依赖分析 |
| KnowledgeBase | 6 | 技术文档、产品知识库、API 手册、设计规范、会议纪要、向量知识库 |
| Task | 10 | 各种状态（pending/running/completed/failed/cancelled） |

---

## 5. 3DACP Axis Gateway 启动流程

```
server.ts 启动时（startServer 内部）
    │
    ├──→ 动态导入 AxisGateway 模块
    │       ├── AxisRegistry（注册中心）
    │       ├── AxisRouter（3D 路由）
    │       ├── ProtocolAdapter（5 协议适配器）
    │       └── 9 个 Service Adapter（dialog/agent/group/knowledge/skill/monitor/platform/blueprint/intervention）
    │
    ├──→ 注册预设内部节点（50 个：15 frontend + 15 backend + 20 tool）
    │
    ├──→ 注册预设外部节点（10 个：github/gitlab/npm/openai/pinecone/slack/stripe/supabase/serpapi/wolfram）
    │
    ├──→ 构建 AxisRouter + 绑定 handlers
    │
    └──→ app.use("/axis", gateway)  ← 挂载到 /axis 路径
```

---

## 6. 启动命令速查

```bash
# 开发模式（热重载）
npm run dev
# 等价于：npx tsx backend/src/index.ts

# 生产模式
npm run build
npm start
# 等价于：node backend/dist/index.js

# 仅启动后端（无前端）
npx tsx backend/src/app.ts

# 数据库重置（开发）
# 在代码中调用：await resetAndSeed()

# 健康检查
curl http://localhost:3001/api/health
curl http://localhost:3001/api/v2/health
```

---

## 7. 文件定位速查表

| 职责 | 文件路径 |
|------|---------|
| 最外层入口 | `backend/src/index.ts` |
| 启动逻辑 | `backend/src/app.ts` |
| 服务器构建 | `backend/src/server.ts` |
| 数据库初始化 | `backend/src/database/init.ts` |
| 数据库种子 | `backend/src/database/seed.ts` |
| Schema 定义 | `backend/src/database/schema.sql` |
| SQLite 连接 | `backend/src/database/sqlite.ts` |
| 环境变量示例 | `backend/.env.example` |
| 3DACP Gateway | `backend/src/middleware/AxisGateway.ts` |
| 3DACP Registry | `backend/src/coordinator/AxisRegistry.ts` |
| 3DACP Router | `backend/src/coordinator/AxisRouter.ts` |
| 日志工具 | `backend/src/utils/logger.ts` |
| WebSocket | `backend/src/websocket.ts` |
| 自动配置 | `backend/src/services/autoConfigService.ts` |
| 协调器 Bridges | `backend/src/coordinator/bridges.ts` |
| 消息总线 | `backend/src/coordinator/unified.ts` |

---

**文档版本**: v1.0 | **路径**: `sylva_platform/docs/backend_runtime_chain.md`
