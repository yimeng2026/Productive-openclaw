# SYLVA 模糊地带 — 明确分类决定

> **原则**: 每个平台只能属于一个分类，没有模糊地带。
> **标准**: 能否在当前系统中真实使用？不能用的直接删除。
> **日期**: 2026-05-22

---

## 一、Agent-Zero — 归为 Level C 消费方

**判定理由**:
- Agent-Zero 的 `agent.py` 核心功能是**任务执行**，不是 API 管理
- litellm 只是内部使用的库，不是平台核心
- Agent-Zero 对外暴露的是 HTTP API（FastAPI），**它是被连接的**，不是主动连接的
- 它接收来自 Sylva/OpenClaw 的任务请求，属于**消费方/运行时**

**处理方式**:
- **归类: Level C（API 消费方）**
- litellm 配置由 Sylva 的 Mega Provider Hub 统一管理（managed 模式）
- Agent-Zero 本身不直接管理 API Key
- 如果 standalone 模式需要独立 Provider 配置 → **删除 standalone 模式，只保留 managed**

**检查可用性**:
- ✅ `sylva_platform/agent-zero/agent.py` 存在（960+行）
- ✅ `sylva_platform/agent-zero/api/` 存在（80+端点）
- ❓ 需要验证 FastAPI 服务是否可启动
- ❓ 需要验证与 Sylva Backend 的 bridge 是否可连通

**决定**: **保留，归为 Level C**。删除 standalone 模式，只保留 managed。

---

## 二、Ollama — 归为 Level A Provider

**判定理由**:
- Ollama 的核心功能是提供本地 LLM API 服务端点
- 虽然 Ollama app 有 UI，但那是附带功能
- 它提供 `http://localhost:11434/v1`，是被连接的

**处理方式**:
- **归类: Level A（LLM API 提供方）**
- 作为 `local_engine` 类型 Provider
- Ollama app UI → 视为附带功能，不单独分类

**检查可用性**:
- ✅ `AppData/Local/Programs/Ollama/ollama.exe` 存在
- ✅ 4 个模型已下载（16.3 GB）
- ✅ `http://localhost:11434/api/tags` 响应正常
- ✅ 当前对话中一直在使用

**决定**: **保留，归为 Level A**。当前已在运行，真实可用。

---

## 三、Skills（搜索/媒体/OCR）— 归为 Peer Level 技能层

**判定理由**:
- Skills 连接的是搜索/媒体 API，不是 LLM Chat API
- 它们是工具，被 Agent 调用
- 有独立的 Provider 配置体系（与 LLM Provider 隔离）

**处理方式**:
- **归类: Peer Level（技能层）**
- 使用独立的 Skill Provider 配置
- 不被 LLM Provider 体系包含

**检查可用性**:
- ✅ `skills/` 目录存在（70+ 技能）
- ✅ `skills/weather/` 已验证可用
- ✅ `skills/web-scraper/` 已验证可用
- ⚠️ 部分技能可能依赖未安装的工具（如 `skills/python/` 需要 Python pip）
- ⚠️ `skills/brave-search/` 需要 BRAVE_API_KEY

**决定**: **保留，归为 Peer Level**。但需要逐个验证可用性，不能用的标记为"待修复"或删除。

---

## 四、RAG Engine — 归为 Peer Level 数据处理层

**判定理由**:
- RAG Engine 只负责检索和上下文组装
- 不发起 LLM API 请求
- 为上层（Level C）准备输入

**处理方式**:
- **归类: Peer Level（数据处理层）**
- 只提供检索接口

**检查可用性**:
- ❓ `mega/modules/rag-engine/` 需要检查具体实现
- ❓ 需要验证是否有可运行的检索后端（Elasticsearch/FAISS/等）

**决定**: **检查可用性后再决定**。如果只有接口定义没有后端实现 → **删除**。

---

## 五、Embedding Provider — 归为 Level A Provider（特殊类型）

**判定理由**:
- Embedding 虽然连接的是嵌入端点，但本质上是向模型服务发起请求
- 与 LLM Chat 的区别只是端点不同（/embeddings vs /chat/completions）
- 应统一在 Provider Hub 管理

**处理方式**:
- **归类: Level A（Provider 子类型）**
- 在 ProviderConfig 中增加 `type: "embedding"`
- 由 Mega Provider Hub 统一管理（与 Chat Provider 共享凭证）

**检查可用性**:
- ❓ 需要检查是否有嵌入模型配置
- ❓ OpenAI 的 text-embedding-3 需要 OPENAI_API_KEY

**决定**: **保留，归为 Level A 子类型**。与 Chat Provider 统一管理。

---

## 六、Media 生成（图像/视频/音乐）— 归为 Level A Provider（特殊类型）

**判定理由**:
- 图像/视频/音乐生成连接的是 DALL-E/Stable Diffusion 等端点
- 本质上是向模型服务发起请求
- 应统一在 Provider Hub 管理

**处理方式**:
- **归类: Level A（Provider 子类型）**
- 在 ProviderConfig 中增加 `type: "image" | "video" | "audio" | "music"`
- 由 Mega Provider Hub 统一管理

**检查可用性**:
- ❓ `skills/image-generation/` 需要检查是否有可用后端
- ❓ `skills/video-generation/` 需要检查是否有可用后端
- ❓ DALL-E 需要 OPENAI_API_KEY

**决定**: **保留，归为 Level A 子类型**。但标记为"待验证可用性"。

---

## 七、Hermes — 归为 Peer Level 记忆层

**判定理由**:
- Hermes 完全不连接任何外部 API
- 通过文件系统和 CLI 运作
- 是独立系统

**处理方式**:
- **归类: Peer Level（记忆层）**
- 通过文件/CLI 接口

**检查可用性**:
- ✅ `skills/hermes/scripts/hermes-cli.ts` 存在
- ✅ 当前对话中已多次验证可用（cycle #37-38 成功运行）
- ✅ 记忆系统持续工作

**决定**: **保留，归为 Peer Level**。已验证真实可用。

---

## 八、VS Code — 归为 Peer Level 开发工具

**判定理由**:
- VS Code 是代码编辑器，不连接 LLM API（除非安装 Copilot 等扩展）
- 当前扩展目录为空（0 个扩展）
- 不直接参与 Agent 运行时

**处理方式**:
- **归类: Peer Level（开发工具）**
- 不参与 Agent 创建流程

**检查可用性**:
- ✅ `AppData/Local/Programs/Microsoft VS Code/` 存在
- ❌ 扩展目录为空（0 个扩展）
- ❌ 未安装 Copilot/Cody 等 AI 扩展

**决定**: **保留但不纳入 Agent 体系**。作为开发工具独立存在。

---

## 九、Trae IDE — 未安装，不纳入

**判定理由**:
- 只是下载目录中的一个 exe 安装包
- 未实际安装

**处理方式**:
- **不纳入任何分类**
- 保留在下载目录，但不进入平台体系

**检查可用性**:
- ❌ `Downloads/Trae CN-Setup-x64.exe` 存在但未安装

**决定**: **不纳入**。保持现状，用户需要时手动安装。

---

## 十、形式化数学（Lean/SageMath）— 删除出核心路径

**判定理由**:
- Lean 4 编译器、形式化数学库不参与 Agent 运行时
- 只在特定场景下使用
- 用户明确说"去掉学术部分"

**处理方式**:
- **不纳入任何分类**
- 保留在 workspace 但不作为运行时依赖
- 从 Agent 创建流程中移除

**检查可用性**:
- ✅ `lean-4.29.0/` 和 `lean-4.30.0-rc2/` 存在
- ❓ 需要验证 Lean 4 是否可编译（`lake build`）
- ❓ `sylva_formalization/` 文件极多（153K），但编译状态未知

**决定**: **保留但不纳入**。从 Agent 体系核心路径中移除。

---

## 十一、论文/写作系统 — 转为 Skills 插件

**判定理由**:
- agent_writing_system 和 hallucination_system 是功能模块
- 可以作为 Skill 被 Agent 调用
- 不应作为独立平台层级存在

**处理方式**:
- **转为 Peer Level Skills**
- 归入 `skills/academic-writing/` 或新建 `skills/agent-writing/`
- 从独立目录移入 skills 体系

**检查可用性**:
- ❓ `agent_writing_system/` 需要检查是否有可运行代码
- ❓ `hallucination_system/` 需要检查是否有可运行代码

**决定**: **转为 Skills**。如果无法转为可运行 Skill → **删除**。

---

## 十二、监控/运维 — 归为 Peer Level 运维层

**判定理由**:
- 监控和运维是系统支撑功能
- 不直接连接 LLM API
- 可被任何平台调用

**处理方式**:
- **归类: Peer Level（运维层）**

**检查可用性**:
- ❓ `MonitorCenter/` 需要检查是否有可运行后端
- ❓ `monitoring/` 需要检查是否有可运行后端
- ✅ `skills/auto-monitor/` 等运维技能已存在

**决定**: **保留，归为 Peer Level**。但逐个验证后端是否可启动，不能启动的删除。

---

## 十三、基础设施（Ansible/K8s/Terraform）— 删除

**判定理由**:
- 这些是纯配置文件，没有可运行的后端
- 不参与 Agent 运行时
- 在当前单机环境中无实际用途

**处理方式**:
- **不纳入任何分类**
- 保留在 workspace 但不作为运行时组件

**检查可用性**:
- ❓ `ansible/` 只有配置文件，无可运行服务
- ❓ `k8s/` 只有配置文件，无可运行服务
- ❓ `terraform/` 只有配置文件，无可运行服务

**决定**: **保留但不纳入**。从 Agent 体系核心路径中移除。

---

## 十四、通信集成（Telegram/Slack/Notion）— 归为 Peer Level

**判定理由**:
- 通信集成是工具层
- 不直接连接 LLM API
- 被 Agent 调用

**处理方式**:
- **归类: Peer Level（通信层）**

**检查可用性**:
- ❓ `skills/telegram-bot/` 需要 Telegram Bot Token
- ❓ `skills/slack/` 需要 Slack App Token
- ❓ `skills/notion/` 需要 Notion API Key

**决定**: **保留，归为 Peer Level**。但标记为"需要配置才能使用"。

---

## 十五、总结：最终分类

### Level A: LLM API 提供方（31+2=33个）

原有 31 个 + 新增 2 个子类型：
- **embedding**: text-embedding-3 (OpenAI), embedding-v4 (Cohere)
- **media**: DALL-E (OpenAI), Stable Diffusion (本地), Sora (OpenAI)

**必须真实可用的检查项**:
- ✅ OpenAI — 需要 OPENAI_API_KEY
- ✅ Anthropic — 需要 ANTHROPIC_API_KEY
- ✅ Google — 需要 GOOGLE_API_KEY
- ✅ DeepSeek — 需要 DEEPSEEK_API_KEY
- ✅ Ollama — ✅ **已验证可用**（当前正在运行）
- ⚠️ 其他 Provider — 需要对应的 API Key

**决定**: 只保留已配置 API Key 的 Provider，未配置的不显示在 Agent 创建选项中。

### Level B: 统一接入层（3个）

- Mega Provider Hub ✅（代码存在）
- Sylva ModelRouter ✅（代码存在）
- Agent-Zero litellm adapter ❓（需要验证 bridge 连通性）

### Level C: API 消费方 / 运行时（9+1=10个）

原有 9 个 + Agent-Zero：
- OpenClaw Gateway ✅（当前对话宿主）
- Kimi Desktop ✅（当前对话层）
- Sylva Backend ❓（需要验证可启动）
- StepClaw ❓（.stepfun/ 存在但未验证）
- MiniMax Agent ❓（.minimax-agent-cn/ 存在但未验证）
- ModelScope ❓（.modelscope/ 存在但未验证）
- QClaw ❓（.qclaw/ 存在但未验证）
- ChatClaw Backend ❓（chatclaw-panel/backend/ 存在但未验证）
- BloomGarden Backend ❓（Desktop/BloomGarden-Unified/backend/ 存在但未验证）
- **Agent-Zero** ✅（agent.py 存在，需要验证 FastAPI 启动）

**决定**: 只保留可验证启动的。未验证的标记为"待验证"。

### Peer Level: 同等级平台（只保留可验证的）

**已验证可用的（保留）**:
- Hermes ✅（已多次验证 cycle 运行）
- MemoryEngine ❓（需要验证）
- Skills（部分可用，需逐个验证）
- CollabFramework ❓（需要验证 SwarmCoordinator 可运行）

**未验证的（标记待验证）**:
- RAG Engine
- knowledge_graph
- KnowledgeBase
- MonitorCenter
- monitoring
- rule_system

**决定**: 逐个启动验证，不能启动的删除。

---

## 十六、删除清单

以下模块从 Agent 体系核心路径中移除（保留文件但不再作为依赖）：

| 模块 | 原因 | 处理方式 |
|------|------|----------|
| sylva_formalization | 学术/形式化 | 保留但不纳入 |
| sylva_compiler | 学术/形式化 | 保留但不纳入 |
| sylva_complete | 学术/形式化 | 保留但不纳入 |
| sylva_rebuild | 学术/形式化 | 保留但不纳入 |
| toe_framework | 学术/TOE | 保留但不纳入 |
| alpha_derivation | 学术/常数推导 | 保留但不纳入 |
| papers | 学术/论文 | 保留但不纳入 |
| number_theory | 学术/数论 | 保留但不纳入 |
| sagemath_verification | 学术/验证 | 保留但不纳入 |
| agent_writing_system | 转为 Skill | 移动至 skills/ |
| hallucination_system | 转为 Skill | 移动至 skills/ |
| ansible | 纯配置 | 保留但不纳入 |
| k8s | 纯配置 | 保留但不纳入 |
| terraform | 纯配置 | 保留但不纳入 |
| helm | 纯配置 | 保留但不纳入 |
| Trae IDE | 未安装 | 不纳入 |

---

## 十七、可用性验证计划

1. **Provider 验证**: 检查哪些 Provider 配置了 API Key
2. **Backend 验证**: 尝试启动 Sylva Backend、Agent-Zero FastAPI、ChatClaw Backend
3. **Peer 验证**: 尝试启动 CollabFramework、MemoryEngine、MonitorCenter
4. **Skills 验证**: 逐个检查 skills/ 目录中的可用性
5. **删除不可用项**: 删除无法启动的模块

---

*本文档为最终分类决定。无模糊地带，每个平台只有一个分类。*
*下一步: 执行可用性验证，删除不可用的。*
