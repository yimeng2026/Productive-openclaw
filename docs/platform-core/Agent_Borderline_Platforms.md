# SYLVA 模糊地带平台 — 独立处理方案

> **原则**: 边界模糊的平台不强行归类，单独定义处理规则
> **触发条件**: 平台同时具备"连接 LLM API"和"独立运行时"双重特征

---

## 一、模糊地带平台清单

### 1.1 Agent-Zero — 执行引擎 + LLM 管理器

| 属性 | 值 | 判定 |
|------|-----|------|
| 核心功能 | Agent 任务执行引擎 | **独立运行时** |
| 内部机制 | 使用 litellm 管理多模型 | **连接 LLM API** |
| API Key 管理 | 通过 litellm 配置 | **有 API 连接能力** |
| 对外暴露 | HTTP API (FastAPI) | **可被连接** |

**判定: 双重身份**
- 作为 **Peer Level 独立引擎** 运行时：不直接暴露 LLM 管理细节
- 作为 **Level B 接入层** 被 Sylva 调用时：由 Sylva 管理 Provider，Agent-Zero 只接收统一格式的请求

**处理规则**:
```
模式 A: 独立运行（Peer Level）
    → Agent-Zero 自己管理 litellm 配置
    → 直接连接 LLM API
    → Sylva 只通过 bridge 获取状态和结果

模式 B: Sylva 托管（Level C 消费方）
    → Sylva 的 Mega Provider Hub 统一管理所有 Provider
    → Agent-Zero 只接收 Sylva 路由后的请求
    → Agent-Zero 内部不直接管理 API Key
```

**Agent-Zero 配置分离**:
```yaml
# agent-zero 独立模式配置
agent_zero:
  mode: standalone
  litellm:
    models:
      - model: openai/gpt-4
        api_key: ${OPENAI_API_KEY}
      - model: ollama/qwen2.5:7b
        api_base: http://localhost:11434

# agent-zero Sylva 托管模式配置
agent_zero:
  mode: managed
  provider_hub:
    endpoint: http://localhost:3001/api/providers
    api_key: ${SYLVA_API_KEY}
  # 不直接配置 litellm，由 Sylva 统一管理
```

---

### 1.2 Ollama — 本地 LLM 服务端

| 属性 | 值 | 判定 |
|------|-----|------|
| 核心功能 | 本地运行 LLM，提供 API 服务 | **API 提供方** |
| 对外暴露 | `http://localhost:11434/v1` | **OpenAI 兼容端点** |
| 被连接方式 | 作为 Provider 接入 Mega Hub | **Level A** |
| 特殊之处 | 既是服务端也是客户端（Ollama app） | **双重角色** |

**判定: 以"被连接"为主**
- Ollama 的核心价值是提供本地 LLM API 端点
- 虽然 Ollama app 有客户端 UI，但那不是核心
- **归类: Level A (Provider)**

**特殊处理**:
```typescript
// Ollama 在 ProviderConfig 中有特殊标记
const ollamaConfig: ProviderConfig = {
  id: 'ollama',
  type: 'local_engine',           // 本地引擎
  apiFormat: 'openai',             // OpenAI 兼容
  baseUrl: 'http://localhost:11434/v1',
  authType: 'none',                // 本地无需认证
  features: {
    localInference: true,           // 本地推理标记
    offline: true,                  // 可离线运行
    quantization: true,             // 支持量化模型
  },
  routing: {
    priority: 10,                  // 默认优先级较低（备用）
    fallbackOnly: false,           // 可作为主 Provider
  }
};
```

---

### 1.3 Skills (搜索类) — 工具技能

| 属性 | 值 | 判定 |
|------|-----|------|
| 核心功能 | 执行特定任务（搜索/天气/OCR） | **独立工具** |
| 内部机制 | 调用搜索 API（Brave/DDG/Exa） | **连接外部 API** |
| 是否连接 LLM | ❌ 否，连接的是搜索/媒体 API | **非 LLM** |
| 对外暴露 | 统一 Skill 接口 | **可被 Agent 调用** |

**判定: Peer Level 工具层**
- Skills 连接的是搜索/媒体/数据 API，不是 LLM Chat API
- 它们被 Agent 调用时，Agent 已经通过 Level A/B/C 完成了 LLM 连接
- **归类: Peer Level (Skills)**

**特殊处理 — 技能级 Provider 配置**:
```typescript
// Skills 有独立的 Provider 体系
interface SkillProviderConfig {
  id: string;                       // 如: brave-search, weather, image-ocr
  type: 'search' | 'media' | 'ocr' | 'data' | 'communication' | 'ops';
  
  // === 连接信息 ===
  baseUrl?: string;                // 搜索 API 端点
  authType: 'api_key' | 'none' | 'oauth';
  credentials: CredentialField[];  // 独立的凭证体系
  
  // === 与 LLM 的区别 ===
  isLLMProvider: false;            // 明确标记：不是 LLM Provider
  capabilities: string[];           // 技能能力列表
}

// Skills 的 Provider 体系与 LLM Provider 体系隔离
// Agent 使用时:
// 1. 先通过 Level A/B/C 连接 LLM
// 2. LLM 决定需要调用 Skill
// 3. 通过 SkillBridge 连接 Skill Provider（独立体系）
```

---

### 1.4 RAG Engine — 检索增强生成

| 属性 | 值 | 判定 |
|------|-----|------|
| 核心功能 | 文档检索 + 上下文组装 | **数据处理** |
| 是否连接 LLM | ❌ 否，只负责检索和组装 | **不直接调用 LLM** |
| 与 LLM 关系 | 为 LLM 提供上下文输入 | **上游准备** |
| 对外暴露 | 检索接口 | **可被任何 LLM 消费方使用** |

**判定: Peer Level 数据处理层**
- RAG Engine 不发起 LLM API 请求
- 它准备上下文，由上层（Level C）发起 LLM 请求
- **归类: Peer Level (RAG)**

**特殊处理**:
```typescript
// RAG Engine 在 Agent 任务流中的位置
interface RAGPipeline {
  // Step 1: RAG Engine 检索
  const context = await ragEngine.retrieve({
    query: task.prompt,
    index: 'knowledge_base',
    topK: 5,
  });
  
  // Step 2: 组装增强提示
  const augmentedPrompt = `
    [上下文]\n${context}\n\n[用户问题]\n${task.prompt}
  `;
  
  // Step 3: 通过 Level A/B/C 发送给 LLM
  const response = await agent.llm.chat({
    prompt: augmentedPrompt,  // RAG 增强后的输入
  });
}
```

---

### 1.5 Embedding Provider — 嵌入向量

| 属性 | 值 | 判定 |
|------|-----|------|
| 核心功能 | 文本 → 向量 | **数据处理** |
| 内部机制 | 调用 Embedding API | **连接 Embedding API** |
| 是否 LLM Chat | ❌ 否，只生成向量 | **非 Chat API** |
| 被调用方式 | 通过统一的 Embedding 接口 | **可被任何组件调用** |

**判定: Peer Level 数据处理层**
- Embedding 虽然连接 API，但连接的是 Embedding 端点，不是 Chat/Completion
- 归类为 **Peer Level (Embedding)**，但使用独立的 Provider 配置

**特殊处理**:
```typescript
interface EmbeddingProviderConfig {
  id: string;
  type: 'embedding';
  
  // 独立的 Embedding 端点
  endpoint: string;                // 如: /v1/embeddings
  model: string;                   // 如: text-embedding-3
  
  // 与 Chat Provider 隔离
  isChatProvider: false;
  
  // 可被 RAG Engine / Memory Engine / 任何需要向量的组件调用
}
```

---

### 1.6 图像/媒体生成 Provider — 多模态

| 属性 | 值 | 判定 |
|------|-----|------|
| 核心功能 | 图像/视频/音乐/语音生成 | **媒体生成** |
| 内部机制 | 调用 ImageGen/VideoGen API | **连接媒体 API** |
| 是否 LLM Chat | ❌ 否，连接的是媒体端点 | **非 Chat API** |
| 被调用方式 | 通过统一的媒体接口 | **可被 Agent 调用** |

**判定: Peer Level 媒体层**
- 虽然连接 API，但连接的是 DALL-E/Stable Diffusion 等媒体端点
- **归类: Peer Level (Media)**，独立的 Provider 配置

---

### 1.7 Hermes — 记忆系统

| 属性 | 值 | 判定 |
|------|-----|------|
| 核心功能 | 记忆存储、模式提取、技能锻造 | **独立系统** |
| 是否连接 LLM | ❌ 否 | **不连接任何 API** |
| 与 LLM 关系 | 为 Agent 提供记忆上下文 | **辅助** |
| 对外暴露 | CLI + 文件接口 | **可被任何组件读取** |

**判定: Peer Level 记忆层**
- Hermes 是完全独立的系统，不连接任何外部 API
- 通过文件系统和 CLI 运作
- **归类: Peer Level (Memory)**

---

## 二、模糊地带处理原则

### 2.1 决策树

```
平台评估
    ↓
核心功能是否包含"直接向 LLM Chat API 发起请求"？
    ↓ 是
进入 Level A/B/C 分类
    ↓ 否
核心功能是否包含"向非 LLM API 发起请求"（搜索/媒体/嵌入/数据）？
    ↓ 是
    → Peer Level，但使用独立的 Skill/Media/Embedding Provider 配置
    ↓ 否
    → 纯 Peer Level（Hermes/记忆/协调/监控）
```

### 2.2 接口隔离

| 接口类型 | 连接目标 | 配置位置 |
|---------|---------|---------|
| **LLM Provider Interface** | Level A LLM API | `mega/providers/` (31个) |
| **Skill Provider Interface** | 搜索/数据/工具 API | `skills/*/config.yaml` (70+个) |
| **Media Provider Interface** | 图像/视频/音乐 API | `skills/media-*/config.yaml` |
| **Embedding Interface** | 嵌入向量 API | `mega/providers/embedding-*.md` |
| **Peer Interface** | 本地运行时 | `coordinator/bridges/*.ts` |

### 2.3 Agent 创建时的特殊处理

```typescript
// Agent 创建时，模糊地带平台的配置方式
interface CreateAgentRequest {
  // === Level A/B/C: LLM 连接 ===
  providers: LLMProviderConfig[];    // 线性选择 LLM Provider
  
  // === Peer Level: 独立配置（不混入 LLM 体系）===
  peers: {
    // Agent-Zero: 选择运行模式
    agentZero?: {
      mode: 'standalone' | 'managed';  // 独立 / Sylva托管
      config?: string;                    // 配置文件路径
    };
    
    // Skills: 选择启用技能（独立 Provider 体系）
    skills?: {
      enabled: string[];                  // 启用的技能ID
      skillProviders?: SkillProviderConfig[]; // 技能级 Provider 配置
    };
    
    // RAG: 配置检索源
    rag?: {
      enabled: boolean;
      indexes: string[];                  // 检索索引
    };
    
    // Embedding: 配置向量模型
    embedding?: {
      provider: string;                   // 嵌入 Provider ID
      model: string;
    };
    
    // Hermes: 记忆集成
    hermes?: {
      enabled: boolean;
      syncInterval: number;               // 同步间隔(ms)
    };
  };
}
```

---

## 三、平台全景图（含模糊地带）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           用户层                                            │
│   Kimi Desktop / Sylva Panel / VS Code / CLI                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Level C: API 消费方 / 运行时                          │
│   OpenClaw / Sylva Backend / StepClaw / MiniMax / ChatClaw / BloomGarden  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Level B: 统一接入层                                 │
│   Mega Provider Hub / Sylva ModelRouter / Agent-Zero(litellm in managed)   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Level A: LLM API 提供方                              │
│   OpenAI / Anthropic / Google / DeepSeek / 阿里云 / 智谱 / Ollama / ...      │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                        Peer Level: 同等级平台（模糊地带单独处理）             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ 记忆系统    │  │ 执行引擎    │  │ 协调框架    │  │ 数据处理    │         │
│  │ Hermes      │  │ Agent-Zero  │  │ Collab      │  │ RAG Engine  │         │
│  │ MemoryEngine│  │ (独立/托管) │  │ Framework   │  │             │         │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ 技能工具    │  │ 媒体生成    │  │ 嵌入向量    │  │ 监控运维    │         │
│  │ Skills (70+)│  │ Media (4+)  │  │ Embedding   │  │ Monitor (12)│         │
│  │ 独立Provider│  │ 独立Provider│  │ 独立Provider│  │ 独立运行时  │         │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 四、配置示例

### 4.1 Agent-Zero 模糊处理

```yaml
# config/agents/code-reviewer.yaml
agent:
  name: "CodeReviewer"
  
  # === Level A/B/C: LLM 连接 ===
  llm:
    providers:
      - id: openai
        model: gpt-4
        priority: 1
      - id: ollama
        model: qwen2.5:7b-custom
        priority: 2
    accessLayer: mega
    routing: balanced
  
  # === Agent-Zero: 模糊地带处理 ===
  agentZero:
    # 选项1: 独立模式（Agent-Zero 自己管理 litellm）
    mode: standalone
    config: "agent-zero/configs/code-reviewer.yaml"
    # → Agent-Zero 直接连接 LLM API，Sylva 通过 bridge 获取结果
    
    # 选项2: 托管模式（由 Sylva 统一管理）
    # mode: managed
    # → Sylva 的 Mega Hub 管理所有 Provider
    # → Agent-Zero 只接收统一格式的请求，不直接管理 API
  
  # === Peer Level: 其他同等级平台 ===
  peers:
    skills:
      enabled: [git-analysis, code-lint, security-scan]
    hermes:
      enabled: true
      syncInterval: 60000
    rag:
      enabled: true
      indexes: [codebase, docs]
```

### 4.2 Skills 模糊处理

```yaml
# skills/brave-search/config.yaml
skill:
  id: brave-search
  type: search
  
  # === Skill 级 Provider（与 LLM Provider 隔离）===
  provider:
    id: brave
    baseUrl: https://api.search.brave.com
    authType: api_key_header
    credentials:
      - name: apiKey
        envVar: BRAVE_API_KEY
        required: true
    
  # 明确标记: 这不是 LLM Provider
  isLLMProvider: false
  
  # 可被任何 LLM 消费方调用
  exposedTo: [openclaw, sylva, agent-zero, stepclaw]
```

---

## 五、实施检查清单

- [ ] Agent-Zero Bridge 支持 `mode: standalone | managed`
- [ ] Mega Provider Hub 区分 `llmProviders` 和 `skillProviders`
- [ ] Agent 创建 API 中 `peers` 字段与 `providers` 字段隔离
- [ ] Skills 使用独立的 Provider 配置体系
- [ ] Embedding/Media 使用独立的 Provider 配置体系
- [ ] Hermes 只通过文件/CLI 接口，不混入 HTTP API 体系
- [ ] RAG Engine 只提供检索接口，不直接连接 LLM
- [ ] 模糊地带平台在文档中有明确标注

---

*本文档为 SYLVA Agent 集成架构 v2.0 的补充文档。*
*处理边界模糊的平台，不强行归类，单独定义规则。*
