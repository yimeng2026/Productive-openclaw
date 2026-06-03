# Platform Core 架构文档

> **核心定位**: Ollama 本地子代理 + 多 Provider 统一编排引擎 + Hermes 内嵌记忆 + 蜂群协调
> **设计目标**: 发给普通 OpenClaw，解压 → 改 env → 启动 → 直接用
> **版本**: v1.1.0 | **日期**: 2026-06-01

---

## 1. 核心组件

| 组件 | 说明 |
|------|------|
| 🦙 **Ollama 桥接** | 将本地 Ollama 模型接入统一 API，作为子代理使用 |
| 🔀 **多 Provider 适配** | Claude / OpenAI / Kimi / Gemini / DeepSeek / OpenRouter / Hermes / OpenClaw |
| 🎼 **Claude 编排 Ollama** | Claude 做"大脑"拆解任务，Ollama 本地模型做"手脚"执行 |
| 🏛️ **协调器骨架** | AxisRegistry + AxisRouter，可扩展为多 Agent 编排 |
| 🧠 **Hermes 内嵌记忆** | MemoryScanner + MemoryFossilizer + CodeGrowth + AntiForgetting |
| 🐝 **蜂群协调系统** | CollabFramework — 递归嵌套蜂群、任务分解/调度/负载均衡 |
| 📚 **完整后端引擎** | 5,773 个文件 — coordinator、routes、services、middleware、gateway |
| 📖 **架构文档** | 37 份 — 3DACP、API、Agent 架构、Coordinator 设计、Swarm 设计等 |

拿到这个包，不需要完整 Sylva Platform 的前端/数据库/编译器，**一个 Node.js 进程就能跑起来**。

---

## 2. 快速开始

### 2.1 环境准备

```bash
# 需要 Node.js >= 18
node -v

# 需要 Ollama 运行中（可选，不用 Ollama 也能用远程 Provider）
ollama -v
ollama serve   # 在另一个终端启动 Ollama
```

### 2.2 安装依赖

```bash
cd platform-core
npm install
```

### 2.3 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`：

```env
# 服务器端口
PORT=3001

# Ollama 地址（默认本地）
OLLAMA_URL=http://localhost:11434

# （可选）各 Provider API Key — 不填对应 Provider 不可用，不影响其他
CLAUDE_API_KEY=sk-ant-xxxxx
OPENAI_API_KEY=sk-xxxxx
KIMI_API_KEY=sk-kimi-xxxxx
GEMINI_API_KEY=AIzaSy-xxxxx
DEEPSEEK_API_KEY=sk-xxxxx
OPENROUTER_API_KEY=sk-or-xxxxx
HERMES_API_KEY=xxxxx
```

> 本地使用：只配 `OLLAMA_URL` 即可，所有 Key 都可以不填，纯粹走本地模型。

### 2.4 启动

```bash
npm run dev      # 开发模式（tsx，热重载）
# 或
npm run build    # 编译
npm run start    # 生产模式
```

---

## 3. API 用法

### 3.1 Ollama 作为子代理

直接调用本地 Ollama 模型，相当于给 Ollama 套了一层 REST API。

**列出模型：**

```bash
curl http://localhost:3001/api/ollama/models
```

**生成文本：**

```bash
curl -X POST http://localhost:3001/api/ollama/generate \
  -H "Content-Type: application/json" \
  -d '{"model": "llama3", "prompt": "解释量子纠缠"}'
```

**对话：**

```bash
curl -X POST http://localhost:3001/api/ollama/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3",
    "messages": [
      {"role": "user", "content": "你好"},
      {"role": "assistant", "content": "你好！有什么可以帮你的？"},
      {"role": "user", "content": "写一首关于AI的诗"}
    ]
  }'
```

**状态检查：**

```bash
curl http://localhost:3001/api/ollama/status
```

> 返回 `{ "running": true, "models": [...] }`，可用于健康监测。

---

### 3.2 统一多 Provider 调用

**核心设计**：无论背后是 Claude、Kimi、Gemini 还是 Ollama，**请求格式完全一样**。

**通用调用格式：**

```bash
curl -X POST http://localhost:3001/api/unified/chat \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "claude",
    "apiKey": "sk-ant-xxxxx",
    "messages": [
      {"role": "system", "content": "你是数学家"},
      {"role": "user", "content": "证明素数有无穷多个"}
    ],
    "model": "claude-3-sonnet-20240229",
    "temperature": 0.3,
    "maxTokens": 4096
  }'
```

**Provider 对照表：**

| provider 值 | 需要 apiKey | 默认模型 | 说明 |
|-------------|------------|---------|------|
| `ollama` | ❌ 不需要 | `llama3` | 本地模型，baseUrl 自动指向 OLLAMA_URL |
| `claude` | ✅ 需要 | `claude-3-sonnet` | Anthropic Claude |
| `openai` | ✅ 需要 | `gpt-4o` | OpenAI GPT |
| `kimi` | ✅ 需要 | `kimi-k2.6` | Moonshot Kimi |
| `kimi_code` | ✅ 需要 | `kimi-k2-0711-preview` | Kimi Coding 版 |
| `gemini` | ✅ 需要 | `gemini-2.0-flash` | Google Gemini |
| `deepseek` | ✅ 需要 | `deepseek-chat` | DeepSeek |
| `openrouter` | ✅ 需要 | `deepseek/deepseek-chat-v3-0324:free` | 多模型聚合 |
| `hermes` | ✅ 需要 | `hermes-3` | Hermes MCP 协议兼容 |
| `openclaw` | ✅ 需要 | `kimi-k2.6` | OpenClaw 本地网关 |

**自动配置（AutoConfig）：**

如果你不确定 provider 是什么，**传 `provider: "auto"`**，系统会根据 `apiKey` 前缀自动推断：

```bash
curl -X POST http://localhost:3001/api/unified/chat \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "auto",
    "apiKey": "sk-kimi-xxxxx",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

自动检测规则：

- `sk-kimi-*` → **kimi**
- `sk-ant-*` / `sess-*` → **claude**
- `AIzaSy-*` → **gemini**
- `sk-or-*` → **openrouter**
- `sk-*` → **openai**（通用 fallback）

**列出支持的 Provider：**

```bash
curl http://localhost:3001/api/unified/providers
```

---

### 3.3 Claude 编排 Ollama（核心特色）

这是 Sylva 最核心的原创设计：**Claude 做编排者（大脑），Ollama 本地模型做执行者（手脚）**。

**场景：**

- 你不想把敏感数据发到 Claude 云端
- 你希望 Claude 做任务规划、质量检查，但**实际计算/生成交给本地模型**
- 你需要多步骤流水线，每一步可能用不同模型

**调用方式：**

```bash
curl -X POST http://localhost:3001/api/unified/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "claudeKey": "sk-ant-xxxxx",
    "ollamaModel": "llama3",
    "taskDescription": "分析这篇论文的创新点和不足，然后给出改进建议",
    "context": ["论文标题：基于描述复杂度的计算熵间隙..."]
  }'
```

**执行流程：**

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   用户请求   │────→│ Claude编排器  │────→│ Ollama执行  │
│  (taskDesc) │     │  (拆解任务)   │     │ (本地计算)  │
└─────────────┘     └──────────────┘     └─────────────┘
                            │                   │
                            ↓                   ↓
                     步骤1：分析创新点      步骤1：本地模型分析
                     步骤2：找出不足        步骤2：本地模型检查
                     步骤3：给出建议        步骤3：本地模型建议
                     步骤4：整合输出    ←── 汇总所有结果
```

**返回格式：**

```json
{
  "success": true,
  "orchestrator": "claude",
  "executor": "ollama",
  "plan": {
    "steps": [
      { "step": 1, "description": "提取论文核心创新", "target": "ollama", "prompt": "..." },
      { "step": 2, "description": "批判性分析不足", "target": "ollama", "prompt": "..." },
      { "step": 3, "description": "生成改进方案", "target": "claude", "prompt": "..." }
    ]
  },
  "results": [
    { "step": 1, "target": "ollama", "content": "..." },
    { "step": 2, "target": "ollama", "content": "..." },
    { "step": 3, "target": "claude", "content": "..." }
  ],
  "finalOutput": "（Claude整合后的最终输出）"
}
```

---

### 3.4 Hermes 内嵌编排（v1.1 新增）

Hermes 是一种 MCP（Model Context Protocol）兼容协议，适合**工具调用和上下文管理**。

**启动 Hermes 模式：**

```bash
# Hermes 通常运行在 8080 端口
# 在 .env 中配置：
HERMES_URL=http://localhost:8080
```

**统一调用（与 Claude/Kimi 完全一样）：**

```bash
curl -X POST http://localhost:3001/api/unified/chat \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "hermes",
    "apiKey": "your-hermes-key",
    "messages": [
      {"role": "system", "content": "You are a coding assistant with file access."},
      {"role": "user", "content": "Read ./main.py and refactor it"}
    ],
    "model": "hermes-3"
  }'
```

**Hermes vs 普通 Provider 的区别：**

| 特性 | 普通 Provider | Hermes |
|------|--------------|--------|
| 工具调用 | 有限 | **原生支持**（文件读写、命令执行） |
| 上下文长度 | 标准 | **可扩展**（通过 MCP 协议） |
| 本地/远程 | 通常远程 | **通常本地** |
| 与 OpenClaw 集成 | API 调用 | **深度集成**（共享内存池） |

---

### 3.5 蜂群协调（v1.1 新增）

CollabFramework 是 Sylva 的递归嵌套蜂群协调系统。

**核心概念：**

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

**启动蜂群：**

```typescript
import { SwarmCoordinator, ExecutionMode } from './core/swarm/collab-framework';

const coordinator = new SwarmCoordinator({
  maxDepth: 5,
  maxNodesPerLevel: 16,
  executionMode: ExecutionMode.DYNAMIC
});

await coordinator.deployTask({
  taskId: 'analyze-paper',
  description: '分析论文创新点',
  subTasks: [
    { target: 'agent-1', description: '提取核心创新' },
    { target: 'agent-2', description: '批判性分析' },
    { target: 'agent-3', description: '生成改进建议' }
  ]
});
```

**四种执行模式：**

| 模式 | 说明 |
|------|------|
| **Sequential** | 顺序执行，任务 A 完成后再执行 B |
| **Parallel** | 并行执行，所有任务同时启动 |
| **Hierarchical** | 层级执行，父任务控制子任务 |
| **Dynamic** | 动态调度，根据负载实时调整 |

---

## 4. Hermes 记忆引擎（v1.1 新增）

```typescript
import { HermesEngine } from './core/hermes/memory-engine/HermesEngine';

const engine = new HermesEngine();
await engine.scanMemory();      // 扫描记忆，提取模式
await engine.fossilize();       // 记忆化石化（防止遗忘）
await engine.growCode();        // 代码自动生长
await engine.buildGraph();      // 知识图谱构建
```

### 核心模块

- **MemoryScanner** — 扫描记忆，提取模式
- **MemoryFossilizer** — 记忆化石化（防止遗忘）
- **CodeGrowth** — 代码自动生长
- **KnowledgeGraph** — 知识图谱构建
- **SkillForge** — 技能锻造
- **AgentSwarm** — 蜂群协调
- **AntiForgetting** — 反遗忘机制

---

## 5. 与 OpenClaw 集成

### 作为 OpenClaw 的 Skill 使用

把这个包放到 OpenClaw 的 skills 目录：

```bash
# OpenClaw 技能目录（以实际路径为准）
cp -r platform-core ~/.openclaw/skills/sylva-orchestrator/
```

然后在 OpenClaw 中调用：

```typescript
// 在 OpenClaw Agent 中直接 import
import { UnifiedAPIClient, AutoConfigEngine } from "./skills/sylva-orchestrator/core/services/UnifiedAPIClient";

const client = new UnifiedAPIClient({
  type: "ollama",
  apiKey: "",
  baseUrl: "http://localhost:11434",
  defaultModel: "llama3",
});

const response = await client.chat({
  messages: [{ role: "user", content: "你好" }],
});
```

### 作为独立服务运行（推荐）

Platform Core 本身就是一个 Express 服务器，OpenClaw 通过 HTTP 调用它：

```bash
# OpenClaw 配置中添加 endpoint
# 在 .env 或配置文件中：
SYLVA_ENDPOINT=http://localhost:3001
```

---

## 6. 扩展：添加自定义 Provider

如果你有一个新的模型服务，只需要在 `UnifiedAPIClient.ts` 中实现一个 Adapter：

```typescript
class MyCustomAdapter extends ProviderAdapter {
  protected toNativeRequest(req: UnifiedChatRequest): any {
    // 转换成你的服务格式
    return { ... };
  }
  protected fromNativeResponse(res: any): UnifiedChatResponse {
    // 转换回统一格式
    return { ... };
  }
  async chat(req: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    // 调用你的服务
  }
}
```

然后在 `createAdapter` switch 中注册即可。

---

## 7. 文件结构

```
platform-core/
├── server.ts                          # 入口服务器
├── app.ts                             # Express 应用配置
├── index.ts                           # 模块导出
├── package.json                       # 依赖
├── tsconfig.json                      # TypeScript 配置
├── .env.example                       # 环境变量模板
├── README.md                          # 使用说明书
├── shared-types/                      # 共享类型定义 v2.0
│   ├── index.ts
│   └── handoff.ts
├── docs/                              # 架构文档（37份）
│   ├── 3DACP_协议规范.md
│   ├── API.md
│   ├── Agent架构设计.md
│   ├── Coordinator设计.md
│   └── ...
├── sylva_academic/                    # 学术模块（7份）
├── sylva_software/                    # 软件模块（5份）
└── core/                              # 后端引擎核心（5,773文件）
    ├── coordinator/                   # 六轴消息总线、协议适配器、执行模式
    ├── config/                        # Provider 优化配置
    ├── middleware/                    # AxisGateway 中间件
    ├── gateway/                       # 统一适配器层、Hermes 适配器
    ├── routes/                        # API 路由层
    ├── services/                      # 业务逻辑层
    ├── utils/                         # 工具函数
    ├── hermes/                        # Hermes 内嵌引擎（v1.1 新增）
    │   ├── memory-engine/             # 记忆引擎（MemoryScanner/Fossilizer/Growth/Graph）
    │   └── acp-protocol/              # ACP 协议实现（JSON-RPC 2.0）
    └── swarm/                         # 蜂群协调系统（v1.1 新增）
        └── collab-framework/          # CollabFramework 递归嵌套蜂群
```

---

## 8. 故障排除

### Ollama 连接失败

```bash
# 检查 Ollama 是否运行
curl http://localhost:11434/api/tags

# 如果 Ollama 不在 11434，改 .env：
OLLAMA_URL=http://localhost:11435
```

### TypeScript 编译错误

```bash
# 确保 tsx 已安装
npm install -g tsx

# 或者直接用 node 运行编译后的 js
npm run build
npm run start
```

### Provider 返回 401/403

- 检查 API Key 是否正确
- 检查 Key 是否过期
- 对于 OpenRouter，确认 `HTTP-Referer` 和 `X-Title` 是否被防火墙拦截

### 端口被占用

```bash
# 换一个端口
PORT=3002 npm run dev
```

---

## 9. 安全提示

1. **不要把 .env 提交到 Git** — 已配置 .gitignore
2. **本地 Ollama 不需要 API Key** — 所有 Key 都可选
3. **Claude 编排时**，Claude Key 只用于"大脑"阶段，实际执行内容可以走本地 Ollama
4. **建议用环境变量而非硬编码 Key**

---

## 相关文档

- [总体架构概述](overview.md)
- [SRIA-SMIM 引擎架构](sria-smim.md)
- [3DACP 协调器协议](../3dacp/protocol.md)
- [OpenClaw 优化方案](../openclaw-opt/optimization.md)

---

> **"Don't worry. Even if the world forgets, I'll remember for you."**
>
> — Platform Core v1.1.0
