# The Zeroth 深度技术架构逆向分析

> 来源：the-zeroth.com 官网 + llms.txt 文档索引 + 产品页面抓取
> 日期：2026-05-25
> 调研人：Sylva
> 状态：基于公开信息逆向推演，非官方文档

---

## 一、产品定位确认

**The Zeroth = 商业闭源多Agent桌面编排平台**

| 属性 | 详情 |
|------|------|
| 产品名 | The Zeroth（平台）/ The One（桌面客户端） |
| 官网 | https://the-zeroth.com |
| 版本 | v0.1.0（2026-05-17发布，极早期） |
| 客户端大小 | 155.7 MB（Windows x64安装包） |
| 定价 | $20/$60/$200 月费，按LLM API用量分档 |
| 开源状态 | ❌ 商业闭源，未找到公开GitHub仓库 |
| 技术栈推测 | Electron桌面应用 + 云端账户系统 + LLM代理层 |

---

## 二、官方文档结构（基于 llms.txt 逆向）

```
the-zeroth.com/docs/
├── Start
│   ├── Install The One          ← 桌面应用安装
│   └── First Blueprint            ← 首次工作流
├── Concepts
│   ├── Agent Presets              ← Agent预设系统
│   └── Blueprints                 ← 蓝图编排系统
├── Workflows
│   ├── Local Execution            ← 本地工作区执行
│   ├── Runtime Orchestration      ← 运行时动态编排
│   └── Observation                ← 观测与人工干预
└── Reference
    └── Billing and LLM Capacity   ← 计费与额度
```

**文档特点**：
- 中英双语（en/zh）
- 9个核心章节，结构精简
- 提供 `llms.txt` 供LLM消费（说明开发者友好）
- 强调"透明（transparent）"和"本地（local）"

---

## 三、五大核心系统逆向推演

### 3.1 Agent Presets（Agent预设系统）

**官方描述**："Reusable agent roles with prompts, tools, MCP servers, profiles, and skills."

**可复用Agent角色 = 预设模板**，包含：
```json
{
  "preset": {
    "identity": "architect | developer | manager | verifier",
    "model": "模型配置（temperature/top_p/max_tokens）",
    "prompts": {
      "system": "系统提示词",
      "task": "任务模板",
      "handoff": "交接模板"
    },
    "tools": ["allowed_tool_1", "allowed_tool_2"],
    "mcpServers": ["mcp_server_id"],
    "profiles": ["profile_doc_1.md", "profile_doc_2.md"],
    "skills": ["skill_package_1", "skill_package_2"]
  }
}
```

**关键洞察**：
- 不是简单prompt，是**完整Agent配置模板**（身份+模型+工具+MCP+文档+技能）
- "Long-form cognition"：挂载profile文档替代 stuffed system prompt
- "Tool and MCP surface"：每个Agent只暴露应该使用的工具（最小权限）

**与我们现有系统的映射**：
```
The Zeroth Agent Preset    →    Sylva Platform 扩展方向
─────────────────────────────────────────────────────────
identity/role              →    AgentConfig.name + role字段
model config               →    AgentConfig.modelId + temperature/maxTokens
prompts.system             →    AgentConfig.systemPrompt（已有）
prompts.task               →    【新增】任务模板系统
prompts.handoff            →    【新增】交接模板系统
tools                      →    【新增】工具白名单系统
mcpServers                 →    【新增】MCP服务注册
profiles                   →    【新增】Profile文档挂载
skills                     →    【新增】技能包系统
```

---

### 3.2 Blueprints（蓝图编排系统）

**官方描述**："Visual workflow graphs that bind nodes to agent presets."

**Blueprint = 有向图**，核心元素：
```json
{
  "blueprint": {
    "id": "bp-001",
    "name": "Code Review Pipeline",
    "version": "1.0",
    "nodes": [
      {
        "id": "node-1",
        "type": "agent",
        "presetId": "reviewer-preset",
        "position": {"x": 100, "y": 100},
        "config": {
          "autoStart": true,
          "timeout": 300000
        }
      },
      {
        "id": "node-2",
        "type": "agent",
        "presetId": "developer-preset",
        "position": {"x": 300, "y": 100}
      },
      {
        "id": "node-3",
        "type": "condition",
        "condition": "review.passed == true"
      }
    ],
    "edges": [
      {
        "id": "edge-1",
        "source": "node-1",
        "target": "node-2",
        "type": "handoff",
        "handoffSchema": "structured-v1"
      },
      {
        "id": "edge-2",
        "source": "node-1",
        "target": "node-3",
        "type": "condition",
        "condition": "review.foundIssues == true"
      }
    ],
    "entrypoints": ["node-1"],
    "variables": {
      "workspace": "/path/to/repo",
      "branch": "feature/xyz"
    }
  }
}
```

**关键洞察**：
- **Node类型**：至少有两种（agent节点 + condition条件节点）
- **Edge类型**：handoff（交接）、condition（条件分支）、parallel（并行）
- **蓝图与工作区解耦**："The same blueprint can be launched from different local workspaces"
- 可视化拖拽设计，非YAML配置

**与我们现有系统的映射**：
```
The Zeroth Blueprint         →    Sylva Platform 扩展方向
─────────────────────────────────────────────────────────
blueprint.nodes[]            →    SwarmNode 递归树（已有基础）
blueprint.edges[]            →    【新增】边关系 + 路由逻辑
node.presetId                →    【新增】节点→预设绑定
edge.type = "handoff"        →    【新增】结构化交接协议
edge.type = "condition"      →    【新增】条件分支执行
entrypoints[]                →    【新增】多入口支持
variables{}                  →    【新增】蓝图级变量上下文
```

---

### 3.3 Runtime Orchestration（运行时编排）

**官方描述**："Let agents reshape workflow execution while a run is alive."

**核心能力（基于官网文本提取）**：

#### A. 结构化交接（Structured Handoff）
```json
{
  "handoff": {
    "objective": "当前目标描述",
    "completedActions": ["action-1", "action-2"],
    "blockers": ["issue-1"],
    "nextAssignee": "agent-preset-id",
    "expectedOutput": "预期输出格式",
    "context": {
      "files": ["/path/to/file"],
      "notes": "中间状态笔记"
    },
    "metadata": {
      "timestamp": "2026-05-25T10:30:00Z",
      "sourceAgent": "agent-001",
      "targetAgent": "agent-002"
    }
  }
}
```

#### B. 实时任务板（Live Task Board）
- 并行工作变成**可检查的任务状态**
- 不是消失进黑盒链
- 每个并行子任务有独立状态：pending → in_progress → completed → blocked

#### C. 执行形状重塑（Reshape Execution Shape）
- Agent可以在运行时**更新计划**
- **改变执行形状**（spawn parallel subtasks during the run）
- 启动后仍可编辑工作流

**与我们现有系统的映射**：
```
The Zeroth Runtime            →    Sylva Platform 扩展方向
─────────────────────────────────────────────────────────
Structured Handoff            →    【新增】HandoffPayload schema
Live Task Board               →    task-tracker Task实体
Reshape Execution             →    SwarmCoordinator动态调度（已有基础）
Parallel Subtasks             →    SwarmCoordinator.dispatchAll（已有）
Post-start Editing            →    【新增】运行时蓝图修改API
```

---

### 3.4 Observation（观测系统）

**官方描述**："Inspect agent communication, context, tool calls, and intermediate state."

**观测维度**：
```
Observation Layer
├── Agent-to-Agent Communication    ← 消息总线日志
├── Per-Agent Context               ← 每个Agent的挂载上下文
├── Tool Call Visibility            ← 工具调用透明展示（无隐藏执行）
├── Intermediate Outputs            ← 中间产物
└── Human Intervention              ← 人工干预入口
```

**人工干预能力**：
- "step in and talk to any agent when the direction needs correction"
- 在**精确故障点**介入
- 不是全局重启，是**点对点修正**

**与我们现有系统的映射**：
```
The Zeroth Observation        →    Sylva Platform 扩展方向
─────────────────────────────────────────────────────────
A2A Communication             →    SwarmMessageBus（已有）
Per-Agent Context             →    AgentContext（agent-zero已有）
Tool Call Visibility          →    LogsPanel + SSE（OpenClaw-4UG刚完成）
Intermediate Outputs          →    【新增】中间产物存储
Human Intervention            →    【新增】InterventionPanel
```

---

### 3.5 Local Execution（本地执行）

**官方描述**："Launch a blueprint against any workspace on your machine."

**关键特性**：
- 在**本地工作区**启动蓝图
- 不是云端沙盒，是**真实文件系统**
- Agent可以操作真实代码库

**技术栈推测**：
- 桌面应用（Electron/Tauri）→ 访问本地文件系统
- 内置/外接LLM代理层 → 处理模型调用
- 与工作区绑定 → 每个蓝图实例关联一个文件夹

---

## 四、完整技术架构推演图

```
┌─────────────────────────────────────────────────────────────┐
│                    The One (Desktop App)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Blueprint  │  │   Preset    │  │   Observation       │  │
│  │   Builder   │  │   Manager   │  │     Dashboard       │  │
│  │  (Canvas)   │  │  (CRUD UI)  │  │  (Logs/State/Interv)│  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                     │             │
│  ┌──────▼────────────────▼─────────────────────▼──────────┐  │
│  │              Runtime Engine (本地运行时)                │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │  │
│  │  │   Blueprint  │  │   Handoff    │  │   Task       │  │  │
│  │  │   Executor   │  │   Protocol   │  │   Board      │  │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │  │
│  │         │                 │                 │          │  │
│  │  ┌──────▼─────────────────▼─────────────────▼──────────┐ │  │
│  │  │            Agent Worker Pool (本地进程)            │ │  │
│  │  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐         │ │  │
│  │  │  │Agent│ │Agent│ │Agent│ │Agent│ │Agent│ ...     │ │  │
│  │  │  │ #1  │ │ #2  │ │ #3  │ │ #4  │ │ #5  │         │ │  │
│  │  │  └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘         │ │  │
│  │  │     └───────┴───────┴───────┴───────┘             │ │  │
│  │  │              LLM Proxy Layer                      │ │  │
│  │  │         (OpenAI/Claude/Kimi/Local)                │ │  │
│  │  └───────────────────────────────────────────────────┘ │  │
│  └─────────────────────────────────────────────────────────┘  │
│                              │                                  │
│  ┌───────────────────────────▼───────────────────────────────┐  │
│  │              Local Workspace (文件系统)                    │  │
│  │              /path/to/project                             │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  Cloud Console    │
                    │  (账户/计费/同步)  │
                    └───────────────────┘
```

---

## 五、关键协议与数据格式推演

### 5.1 Blueprint JSON Schema（推测版）

```typescript
interface Blueprint {
  id: string;
  name: string;
  version: string;
  description?: string;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  entrypoints: string[];        // 入口节点ID数组
  variables?: Record<string, any>; // 蓝图级变量
  metadata?: {
    author: string;
    createdAt: string;
    updatedAt: string;
    tags: string[];
  };
}

interface BlueprintNode {
  id: string;
  type: 'agent' | 'condition' | 'parallel' | 'merge' | 'human-input';
  presetId?: string;            // agent类型时必填
  position: { x: number; y: number };
  config?: {
    autoStart?: boolean;
    timeout?: number;
    retries?: number;
    parallelLimit?: number;
  };
  condition?: string;            // condition类型时，JS表达式或自然语言条件
}

interface BlueprintEdge {
  id: string;
  source: string;               // 源节点ID
  target: string;               // 目标节点ID
  type: 'handoff' | 'condition' | 'parallel' | 'fallback';
  label?: string;
  condition?: string;           // condition类型时
  handoffConfig?: {
    schema: 'structured-v1';
    requiredFields: string[];
    timeout: number;
  };
}
```

### 5.2 Handoff Protocol Schema（推测版）

```typescript
interface HandoffPayload {
  version: 'v1';
  objective: string;            // 当前目标
  completedActions: Action[];   // 已完成动作
  blockers?: Blocker[];         // 阻塞项
  nextAssignee?: string;        // 下一个执行者（presetId或agentId）
  expectedOutput?: OutputSpec;  // 预期输出规格
  context: HandoffContext;      // 上下文传递
  metadata: HandoffMetadata;    // 元数据
}

interface Action {
  id: string;
  type: 'tool_call' | 'file_edit' | 'reasoning' | 'communication';
  description: string;
  timestamp: string;
  result?: any;
  status: 'success' | 'failure' | 'pending';
}

interface Blocker {
  id: string;
  severity: 'blocking' | 'warning' | 'info';
  description: string;
  suggestedResolution?: string;
}

interface HandoffContext {
  files?: string[];            // 相关文件路径
  notes?: string;                // 中间笔记
  memory?: Record<string, any>;  // 结构化记忆
  artifacts?: Artifact[];        // 中间产物
}

interface HandoffMetadata {
  timestamp: string;
  sourceAgent: string;
  targetAgent: string;
  blueprintId: string;
  runId: string;
  depth: number;
}
```

### 5.3 Agent Preset Schema（推测版）

```typescript
interface AgentPreset {
  id: string;
  name: string;
  role: 'architect' | 'developer' | 'reviewer' | 'manager' | 'verifier' | string;
  identity: {
    displayName: string;
    avatar?: string;
    description: string;
  };
  model: {
    provider: string;            // openai | anthropic | moonshot | local
    modelId: string;
    temperature: number;
    maxTokens: number;
    topP?: number;
  };
  prompts: {
    system: string;
    taskTemplate?: string;
    handoffTemplate?: string;
  };
  tools: {
    whitelist: string[];         // 允许使用的工具ID
    blacklist?: string[];          // 禁止使用的工具ID
  };
  mcpServers: string[];          // 绑定的MCP服务器ID
  profiles: string[];            // 挂载的profile文档路径
  skills: string[];              // 技能包ID
  limits: {
    maxIterations: number;
    maxTokensPerRun: number;
    timeout: number;
  };
}
```

---

## 六、与 Sylva Platform 的集成路线图

### Phase 1: 基础协议层（P0，立即启动）

| 模块 | 实现内容 | 负责人 |
|------|---------|--------|
| **AgentPreset系统** | 扩展 `AgentConfig` → `AgentPreset`，增加identity/model/tools/mcp/skills/profiles | 咨询师 |
| **HandoffPayload协议** | 实现标准化交接schema，对接 `SwarmMessageBus` | OpenClaw-4UG |
| **Intervention API** | 后端路由：pause/resume/reassign/inject-message | 咨询师 |
| **InterventionPanel** | 前端组件：Agent状态显示+人工干预UI | OpenClaw-4UG |

### Phase 2: 蓝图引擎（P1，1-2周后）

| 模块 | 实现内容 |
|------|---------|
| **BlueprintEngine** | 蓝图序列化/反序列化、验证、执行 |
| **BlueprintBuilder数据层** | 节点+边存储、位置信息、版本管理 |
| **PresetManager** | 预设CRUD、导入导出、版本控制 |
| **PresetManager页面** | 前端预设管理UI |

### Phase 3: 可视化与打包（P2，远期）

| 模块 | 实现内容 |
|------|---------|
| **BlueprintBuilder画布** | React Flow或自研可视化编排画布 |
| **运行时蓝图修改** | 启动后编辑节点/边、动态注入 |
| **Electron封装** | 桌面应用打包，双击安装 |
| **自动安装脚本** | 检测Ollama/Docker/Node依赖，一键配置 |

---

## 七、竞品对比与差异化定位

| 维度 | The Zeroth | Sylva Platform (我们的方向) |
|------|-----------|---------------------------|
| 开源 | ❌ 闭源商业 | ✅ 自有代码，可定制 |
| 可视化 | ✅ 蓝图画布 | ⚠️ 代码级，待增强 |
| 本地执行 | ✅ 本地工作区 | ✅ 本地文件系统（已有） |
| Agent能力 | ✅ Linux+浏览器+代码 | ✅ 已有（agent-zero） |
| 人工干预 | ✅ 精确点介入 | ⚠️ 待实现 |
| 计费 | $20-200/月 | 自有API Key，无平台费 |
| 数据隐私 | ❌ 需上传云端账户 | ✅ 本地运行，数据不出境 |
| 可扩展性 | ❌ 受限于产品功能 | ✅ 代码级自由扩展 |

**我们的差异化优势**：
1. **完全本地可控** — 无需上传代码到第三方平台
2. **代码级自由** — 不受产品功能边界限制
3. **零平台费** — 使用自己的API Key，无中间商
4. **与现有生态融合** — OpenClaw + Lean + 数学形式化等独特能力

---

## 八、风险提示

1. **The Zeroth v0.1.0 极早期**：产品刚发布，可能存在大量bug和功能缺失
2. **闭源不可审计**：无法验证其数据处理、隐私保护实现
3. **供应商锁定风险**：blueprint格式、preset格式均为私有，迁移成本高
4. **LLM API中间层**：可能额外收取API调用费用（除了订阅费）

---

## 九、下一步行动

1. ✅ **已完成**：初步架构逆向分析（本文档）
2. ⏳ **进行中**：AgentPreset + HandoffPayload + Intervention 设计实现（已分配给咨询师和OpenClaw-4UG）
3. 📋 **待启动**：
   - BlueprintEngine 详细设计（等Phase 1完成）
   - 与现有 SwarmCoordinator 的协议对接
   - 运行时蓝图修改API设计
4. 🔮 **远期**：可视化蓝图画布（React Flow调研）

---

*本文档基于 the-zeroth.com 公开信息逆向推演，非官方技术文档。随着产品迭代，信息可能需要更新。*
