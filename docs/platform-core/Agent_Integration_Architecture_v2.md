# SYLVA Agent 统一集成架构 v2.0

> **设计目标**: 平台按等级管理，Agent 线性选择平台，协调框架统一升级，与 Agent-Zero 深度配合
> **日期**: 2026-05-22
> **版本**: v2.0

---

## 一、设计原则

1. **等级隔离**: Level A/B/C 严格分层，Agent 创建时线性选择，不跨级混用
2. **协调统一**: 不管什么 Agent/Agent群组，走同一套协调框架
3. **Agent-Zero 原生**: 协调框架与 Agent-Zero 深度配合，不是外挂
4. **模块化**: 每个组件可独立替换、热插拔
5. **去学术化**: 形式化数学、论文写作等非运行时模块移除出核心路径

---

## 二、平台等级管理

### 2.1 等级定义

```
Level A: LLM API Provider (31个)
    ↓ HTTP/HTTPS (API Key + Stream)
Level B: Unified Access Layer (3个)
    - Mega Provider Hub
    - Sylva ModelRouter  
    - Agent-Zero litellm adapter
    ↓ Unified ProviderConfig Interface
Level C: API Consumer / Runtime (9个)
    - OpenClaw Gateway ← 主运行时
    - Kimi Desktop
    - Sylva Backend
    - StepClaw
    - MiniMax Agent
    - ModelScope
    - QClaw
    - ChatClaw Backend
    - BloomGarden Backend
    ↓ Agent Request (Task + Context)
Peer Level: Orchestration & Coordination (统一协调层)
    - Unified Swarm Coordinator (NEW)
    - Agent-Zero Core (深度集成)
    - Hermes Memory (只读接口)
    - Skill Registry (只读接口)
```

### 2.2 Agent 创建时的线性选择流程

```
用户创建 Agent
    ↓
[Step 1: 选择 Level A Provider]
    → 显示所有可用 Provider (按类型分组)
    → 用户选择 1-N 个 (如: OpenAI + Ollama)
    → 系统验证 API Key / 健康状态
    ↓
[Step 2: 选择 Level B 接入层]
    → 自动推荐 (默认 Mega Provider Hub)
    → 用户确认或切换
    → 配置路由策略 (priority/cost/latency/balanced)
    ↓
[Step 3: 选择 Level C 运行时]
    → 自动绑定当前运行时 (OpenClaw / Sylva / StepClaw)
    → 配置运行参数 (max_tokens, temperature, system_prompt)
    ↓
[Step 4: 绑定 Peer Level 协调层]
    → 自动注册到 Unified Swarm Coordinator
    → 配置群组归属 (可选)
    → 配置与 Agent-Zero 的协作模式
    ↓
Agent 就绪，可以:
    - 独立运行
    - 加入 Swarm 群组
    - 与 Agent-Zero 协作
```

---

## 三、统一协调框架 (Unified Swarm Coordinator)

### 3.1 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│              Unified Swarm Coordinator v2.0                     │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Agent Registry │  │  Task Router  │  │  State Manager │      │
│  │  (所有Agent)   │  │  (任务分发)   │  │  (状态同步)   │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                 │                  │
│  ┌──────┴─────────────────┴─────────────────┴──────┐          │
│  │              Unified Message Bus              │          │
│  │         (Local / Redis / WebSocket)           │          │
│  └─────────────────────────────────────────────────┘          │
│         │                 │                 │                  │
│  ┌──────┴──────┐  ┌────────┴────────┐  ┌──────┴──────┐          │
│  │  Agent-Zero │  │   CollabMode   │  │  Fallback  │          │
│  │   Bridge    │  │  (sequential/  │  │  Handler   │          │
│  │             │  │   parallel/    │  │             │          │
│  │             │  │   hierarchical/│  │             │          │
│  │             │  │   dynamic)     │  │             │          │
│  └─────────────┘  └────────────────┘  └─────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 核心模块

#### Agent Registry (Agent 注册中心)

```typescript
interface AgentRegistration {
  id: string;                    // 全局唯一ID
  name: string;                  // 显示名称
  
  // === 平台等级绑定 ===
  levelA: string[];              // 绑定的 Provider IDs
  levelB: string;                // 接入层 (mega | sylva | agentzero)
  levelC: string;                // 运行时 (openclaw | sylva | stepclaw | ...)
  
  // === Agent-Zero 集成 ===
  agentZeroProfile?: string;      // Agent-Zero 配置文件名
  agentZeroMode: 'native' | 'bridge' | 'none';  // 原生/桥接/无
  
  // === 群组信息 ===
  swarmId?: string;              // 所属群组ID
  role: 'leader' | 'worker' | 'solo';  // 角色
  
  // === 状态 ===
  status: 'idle' | 'running' | 'error' | 'paused';
  health: 'healthy' | 'degraded' | 'unhealthy';
  
  // === 能力 ===
  skills: string[];               // 可用技能ID列表
  capabilities: string[];        // LLM 能力 (streaming, vision, toolUse...)
  
  // === 资源 ===
  maxConcurrentTasks: number;
  priority: number;              // 调度优先级
}
```

#### Unified Task Router (统一任务路由器)

```typescript
interface TaskRequest {
  id: string;
  type: 'chat' | 'code' | 'search' | 'analysis' | 'custom';
  
  // === 目标指定 ===
  targetAgent?: string;           // 指定单个Agent
  targetSwarm?: string;           // 指定Swarm群组
  
  // === 内容 ===
  prompt: string;
  context?: any;                  // 上下文
  attachments?: string[];         // 附件路径
  
  // === 约束 ===
  requireStreaming?: boolean;
  requireVision?: boolean;
  requireToolUse?: boolean;
  maxLatencyMs?: number;
  
  // === 策略 ===
  executionMode: 'solo' | 'swarm';  // 单Agent / 群组
  swarmMode?: SwarmMode;           // sequential | parallel | hierarchical | dynamic
  
  // === 回调 ===
  onProgress?: (delta: string) => void;
  onComplete?: (result: TaskResult) => void;
  onError?: (error: Error) => void;
}

type SwarmMode = 
  | 'sequential'     // 串行: Agent A → Agent B → Agent C
  | 'parallel'       // 并行: Agent A + Agent B + Agent C (同时)
  | 'hierarchical'   // 层级: Leader 分发 → Workers 执行 → Leader 聚合
  | 'dynamic';        // 动态: 根据负载实时调整
```

#### State Manager (状态同步)

```typescript
interface SwarmState {
  id: string;
  name: string;
  
  // === 成员 ===
  agents: AgentRegistration[];
  leader?: string;              // 领导者Agent ID
  
  // === 任务状态 ===
  activeTasks: Map<string, TaskState>;
  completedTasks: TaskResult[];
  failedTasks: TaskError[];
  
  // === 共享记忆 ===
  sharedContext: string;         // 群组共享上下文
  sharedMemory: MemoryEntry[];    // 群组共享记忆
  
  // === 配置 ===
  mode: SwarmMode;
  maxDepth: number;              // 最大嵌套深度
  syncIntervalMs: number;        // 同步间隔
}
```

---

## 四、Agent-Zero 深度集成

### 4.1 集成架构

```
┌─────────────────────────────────────────────────────────────────┐
│                   Agent-Zero Deep Integration                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐      ┌──────────────────┐               │
│  │  Sylva Backend   │◄────►│  Agent-Zero API  │               │
│  │  (Node.js)       │      │  (Python/FastAPI)│               │
│  └────────┬─────────┘      └────────┬─────────┘               │
│           │                         │                          │
│           │  HTTP/WebSocket         │                          │
│           │  ┌─────────────────────┐│                          │
│           │  │  AgentZeroBridge    ││                          │
│           │  │  (双向同步)          ││                          │
│           │  │                     ││                          │
│           │  │  • Agent 状态同步   ││                          │
│           │  │  • 任务双向路由     ││                          │
│           │  │  • 记忆共享        ││                          │
│           │  │  • 技能调用        ││                          │
│           │  └─────────────────────┘│                          │
│           │                         │                          │
│  ┌────────▼─────────┐      ┌────────▼─────────┐               │
│  │  Unified Swarm   │      │  Agent-Zero      │               │
│  │  Coordinator     │◄────►│  Core (agent.py) │               │
│  │  (TypeScript)    │      │  (Python)        │               │
│  └──────────────────┘      └──────────────────┘               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 集成点

#### 4.2.1 Agent 状态双向同步

```typescript
// Sylva → Agent-Zero: Agent 注册
async function registerAgentToZero(agent: AgentRegistration): Promise<void> {
  await fetch('http://localhost:8000/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: agent.id,
      name: agent.name,
      model: agent.levelA[0],  // 主模型
      system_prompt: agent.systemPrompt,
      skills: agent.skills,
    }),
  });
}

// Agent-Zero → Sylva: 状态更新
// Agent-Zero 通过 WebSocket 推送状态变更
interface AgentZeroStateUpdate {
  agentId: string;
  status: 'idle' | 'running' | 'error';
  currentTask?: string;
  output?: string;
}
```

#### 4.2.2 任务双向路由

```typescript
// 场景1: Sylva 发起任务 → Agent-Zero 执行
async function routeTaskToZero(task: TaskRequest): Promise<TaskResult> {
  const response = await fetch('http://localhost:8000/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      task_id: task.id,
      agent_id: task.targetAgent,
      prompt: task.prompt,
      context: task.context,
    }),
  });
  return response.json();
}

// 场景2: Agent-Zero 发起任务 → Sylva 路由到其他 Agent
// Agent-Zero 调用 Sylva 的 Swarm Coordinator API
async function routeTaskFromZero(task: ZeroTask): Promise<TaskResult> {
  return unifiedCoordinator.routeTask({
    ...task,
    source: 'agent-zero',
  });
}
```

#### 4.2.3 记忆共享

```typescript
// Hermes 记忆 → Agent-Zero 上下文注入
async function syncMemoryToZero(agentId: string): Promise<void> {
  const memories = await hermes.query({ agentId, limit: 10 });
  await fetch(`http://localhost:8000/api/agents/${agentId}/context`, {
    method: 'POST',
    body: JSON.stringify({ memories }),
  });
}

// Agent-Zero 产出 → Hermes 记忆存储
async function storeZeroOutput(agentId: string, output: string): Promise<void> {
  await hermes.store({
    agentId,
    content: output,
    tags: ['agent-zero', 'output'],
  });
}
```

#### 4.2.4 技能调用互通

```typescript
// Sylva Skills → Agent-Zero 可用
// Agent-Zero 可以通过 API 调用 Sylva 的 Skills
interface SkillBridge {
  // Sylva 暴露 Skill 调用端点
  async callSkill(skillId: string, params: any): Promise<any>;
  
  // Agent-Zero 暴露 Agent 能力端点
  async callAgent(agentId: string, prompt: string): Promise<string>;
}
```

---

## 五、模块划分

### 5.1 核心模块

```
@sylva/unified-coordinator/
├── src/
│   ├── core/
│   │   ├── AgentRegistry.ts         ← Agent 注册中心
│   │   ├── TaskRouter.ts            ← 任务路由器
│   │   ├── StateManager.ts          ← 状态管理
│   │   └── MessageBus.ts            ← 消息总线
│   ├── bridges/
│   │   ├── AgentZeroBridge.ts       ← Agent-Zero 桥接
│   │   ├── HermesBridge.ts          ← Hermes 记忆桥接
│   │   └── SkillBridge.ts           ← Skills 桥接
│   ├── modes/
│   │   ├── SequentialMode.ts        ← 串行执行
│   │   ├── ParallelMode.ts          ← 并行执行
│   │   ├── HierarchicalMode.ts     ← 层级执行
│   │   └── DynamicMode.ts           ← 动态执行
│   ├── types/
│   │   └── index.ts                 ← 类型定义
│   └── index.ts                     ← 统一入口
```

### 5.2 独立替换点

| 模块 | 替换方式 | 说明 |
|------|---------|------|
| AgentRegistry | 热插拔 | 支持运行时注册/注销 Agent |
| TaskRouter | 策略可配 | priority / cost / latency / balanced / round_robin |
| MessageBus | 后端可换 | Local → Redis → RabbitMQ |
| AgentZeroBridge | 版本适配 | 适配不同 Agent-Zero 版本 |
| ExecutionMode | 模式切换 | 串行/并行/层级/动态 无缝切换 |

---

## 六、Agent 创建 API

### 6.1 REST API

```typescript
// POST /api/v2/agents
interface CreateAgentRequest {
  name: string;
  
  // === Level A: Provider 选择 ===
  providers: {
    id: string;                    // Provider ID
    priority: number;              // 优先级
    model?: string;                // 指定模型
  }[];
  
  // === Level B: 接入层 (可选，默认自动) ===
  accessLayer?: 'mega' | 'sylva' | 'agentzero';
  routingStrategy?: 'priority' | 'cost' | 'latency' | 'balanced';
  
  // === Level C: 运行时 (可选，默认当前) ===
  runtime?: 'openclaw' | 'sylva' | 'stepclaw';
  
  // === Agent-Zero 集成 ===
  agentZero?: {
    enabled: boolean;
    mode: 'native' | 'bridge';
    profile?: string;              // Agent-Zero 配置文件
    skills?: string[];             // 启用技能
  };
  
  // === 群组 ===
  swarm?: {
    swarmId?: string;              // 加入现有群组
    createNew?: boolean;           // 创建新群组
    role?: 'leader' | 'worker';
  };
  
  // === 能力 ===
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  skills?: string[];               // 启用 Skills
  
  // === 资源 ===
  maxConcurrentTasks?: number;
}

// 响应
interface CreateAgentResponse {
  agent: AgentRegistration;
  swarm?: SwarmState;
  healthCheck: boolean;
  providerStatus: Record<string, boolean>;  // 各 Provider 健康状态
}
```

### 6.2 CLI 命令

```bash
# 创建基础 Agent
sylva agent create --name "CodeReviewAgent" \
  --provider openai:gpt-4 \
  --provider ollama:qwen2.5:7b-custom \
  --routing balanced \
  --agentzero native \
  --skills code-review,git-analysis \
  --system-prompt "You are a code review expert..."

# 创建 Swarm 群组
sylva swarm create --name "DevTeam" \
  --mode hierarchical \
  --agents "CodeReviewAgent,TestAgent,DocAgent" \
  --leader "CodeReviewAgent"

# 查看 Agent 状态
sylva agent status

# 发送任务到 Swarm
sylva task send --swarm "DevTeam" \
  --prompt "Review this PR and write tests" \
  --mode parallel
```

---

## 七、去学术化清单

| 模块 | 原位置 | 处理方式 |
|------|--------|----------|
| sylva_formalization | workspace/ | **保留但隔离** — 不作为运行时依赖 |
| sylva_compiler | workspace/ | **保留但隔离** — 不作为运行时依赖 |
| sylva_complete | workspace/ | **保留但隔离** — 不作为运行时依赖 |
| sylva_rebuild | workspace/ | **保留但隔离** — 不作为运行时依赖 |
| sylva_academic | sylva_platform/ | **保留但隔离** — 不作为运行时依赖 |
| toe_framework | workspace/ | **保留但隔离** — 不作为运行时依赖 |
| alpha_derivation | workspace/ | **保留但隔离** — 不作为运行时依赖 |
| papers | workspace/ | **保留但隔离** — 不作为运行时依赖 |
| number_theory | workspace/ | **保留但隔离** — 不作为运行时依赖 |
| sagemath_verification | workspace/ | **保留但隔离** — 不作为运行时依赖 |
| agent_writing_system | workspace/ | **保留** — 转为 Skills 插件 |
| hallucination_system | workspace/ | **保留** — 转为 Skills 插件 |

**核心运行时只依赖**: mega, sylva_platform (backend/frontend/agent-zero), skills, CollabFramework, memory, knowledge_graph

---

## 八、实施路线图

### Phase 1: 基础架构 (1-2天)
1. 创建 `@sylva/unified-coordinator` 包
2. 实现 AgentRegistry + TaskRouter + StateManager
3. 实现 MessageBus (Local 版)

### Phase 2: Agent-Zero 集成 (1-2天)
1. 实现 AgentZeroBridge (双向 HTTP/WebSocket)
2. 状态同步机制
3. 任务双向路由

### Phase 3: 协调模式 (2-3天)
1. SequentialMode
2. ParallelMode
3. HierarchicalMode
4. DynamicMode

### Phase 4: 平台等级管理 (1-2天)
1. Agent 创建 API (Level A/B/C 线性选择)
2. Provider 健康检查集成
3. 运行时绑定

### Phase 5: 测试验证 (1天)
1. 单 Agent 运行
2. Swarm 群组运行
3. Agent-Zero 协作运行
4. 热插拔测试

---

*本文档定义了 SYLVA Agent 统一集成架构 v2.0。*
*去学术化、等级管理、协调统一、Agent-Zero 深度配合。*
