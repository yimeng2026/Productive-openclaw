# 工作空间统一管理与统一API协议 — 优化方案

> 版本：v1.0
> 日期：2026-05-25
> 作者：Sylva
> 状态：方案确认，进入实现

---

## 一、需求精炼（从3次重复中提取核心）

### 需求A：工作空间统一管理

| 原话 | 技术映射 |
|------|---------|
| "组成新群组后原工作不能停" | 群组合并为**软合并**，子群组继续运行，状态不中断 |
| "继承旧群组的状态与工作文件" | 工作空间**挂载继承**：父群组workspace挂载子群组的task文件夹 |
| "工作空间以任务为子文件夹" | Workspace根目录下按 `tasks/{taskId}/` 组织 |
| "只能选择特定任务文件夹导入下载" | 前端文件选择器限定在 `tasks/` 子目录，非全workspace |
| "记忆库不单独列出，与工作文件一致" | 记忆作为 `.memory/` 隐藏文件夹存在于每个task文件夹内 |
| "随时可以从总工作空间导入" | 提供 `importTask(taskId, sourceGroupId)` API |

### 需求B：统一API协议

| 原话 | 技术映射 |
|------|---------|
| "选择三个层级的平台" | 平台选择器：Foundation(L0) → Platform(L1) → Provider(L2) |
| "统一API协议与接口" | `UnifiedAPIClient`：统一请求/响应格式，底层适配各provider |
| "OpenClaw与Hermes共用一套" | 两者都走 `UnifiedAPIClient`，区别仅在adapter层 |
| "输入API就自动配置" | `AutoConfigEngine`：输入key → 检测provider → 自动填充endpoint/model |
| "无需其他设置" | 零配置启动：key是唯一必填项，其余全部自动推断 |

---

## 二、架构设计：Workspace + API 双融合层

```
┌─────────────────────────────────────────────────────────────┐
│  前端层                                                      │
│  ├── AgentCreator.tsx — 三步创建Agent（平台→模型→API Key）    │
│  ├── WorkspaceBrowser.tsx — 任务级文件浏览器                 │
│  ├── TaskImporter.tsx — 从总workspace选择task导入            │
│  └── UnifiedAPIConfigPanel.tsx — 统一API配置面板             │
├─────────────────────────────────────────────────────────────┤
│  API 层                                                      │
│  ├── UnifiedAPIClient.ts — 统一请求格式                      │
│  ├── ProviderAdapter.ts — OpenClaw/Hermes/Kimi/Claude适配   │
│  ├── AutoConfigEngine.ts — 输入key自动推断配置              │
│  └── APIKeyVault.ts — 加密存储API Key                       │
├─────────────────────────────────────────────────────────────┤
│  协调层                                                      │
│  ├── GroupCoordinator.ts — 已有，扩展workspace挂载接口       │
│  ├── AgentGroup.ts — 已有，扩展taskWorkspace字段            │
│  └── WorkspaceManager.ts — 新增：workspace生命周期管理         │
├─────────────────────────────────────────────────────────────┤
│  工作空间层                                                  │
│  ├── WorkspaceRoot /                                        │
│  │   ├── tasks/                                             │
│  │   │   ├── task-001/ — 任务工作文件夹                      │
│  │   │   │   ├── files/ — 工作文件                          │
│  │   │   │   ├── .memory/ — 记忆库（隐藏，与文件一致）        │
│  │   │   │   └── handoff.json — 交接状态                    │
│  │   │   ├── task-002/                                     │
│  │   │   └── ...                                           │
│  │   └── shared/ — 跨任务共享文件                            │
│  ├── TaskWorkspace.ts — 单个任务workspace封装               │
│  └── SnapshotInheritance.ts — 已有，扩展workspace继承        │
├─────────────────────────────────────────────────────────────┤
│  存储层                                                      │
│  ├── SQLite — 元数据（task列表、继承关系、API配置）            │
│  └── 本地文件系统 — 实际文件内容                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、WorkspaceManager — 工作空间统一管理

```typescript
/**
 * WorkspaceManager — 工作空间管理器
 *
 * 核心原则：
 * - 每个 AgentGroup 有一个 WorkspaceRoot
 * - WorkspaceRoot 下按 tasks/{taskId}/ 组织
 * - 群组合并 = 父workspace挂载子群组的task文件夹（软链接/挂载）
 * - 记忆库 = .memory/ 隐藏文件夹，存在于每个task文件夹内
 * - 用户只能看到 tasks/ 下的内容，看不到 .memory/
 */

export interface WorkspaceRoot {
  groupId: string;
  basePath: string;              // 绝对路径，如 /workspace/groups/{groupId}/
  tasks: Map<string, TaskWorkspace>;
  sharedPath: string;            // 跨任务共享文件夹
}

export interface TaskWorkspace {
  taskId: string;
  groupId: string;
  path: string;                  // 绝对路径
  files: TaskFile[];             // 工作文件列表
  memory: TaskMemory;            // 记忆库（与文件一致，不单独列出）
  handoffState: HandoffState;    // 交接状态
  createdAt: number;
  updatedAt: number;
}

export interface TaskFile {
  id: string;
  name: string;
  path: string;                  // 相对task文件夹的路径
  size: number;
  mimeType: string;
  createdAt: number;
  modifiedAt: number;
  contentHash: string;
}

export interface TaskMemory {
  // 记忆不单独列出，就是 .memory/ 文件夹下的文件
  entries: MemoryEntry[];
  embeddingStore?: string;       // 向量存储引用（如果启用）
}

export interface MemoryEntry {
  id: string;
  type: 'conversation' | 'context' | 'skill' | 'preference';
  content: string;
  timestamp: number;
  sourceAgentId?: string;
  taskId?: string;
}

export class WorkspaceManager {
  private workspaces = new Map<string, WorkspaceRoot>();
  private baseDir: string;

  constructor(baseDir: string = './workspace') {
    this.baseDir = baseDir;
  }

  // ═══════════════════════════════════════════════════════
  // 1. 创建与销毁
  // ═══════════════════════════════════════════════════════

  /** 为AgentGroup创建工作空间 */
  createWorkspace(groupId: string, templateTaskIds?: string[]): WorkspaceRoot;

  /** 销毁工作空间（可选保留文件） */
  destroyWorkspace(groupId: string, preserveFiles: boolean = true): boolean;

  // ═══════════════════════════════════════════════════════
  // 2. 任务级文件操作（用户可见层）
  // ═══════════════════════════════════════════════════════

  /** 创建任务工作文件夹 */
  createTaskWorkspace(groupId: string, taskId: string, initialFiles?: FileUpload[]): TaskWorkspace;

  /** 列出某群组的所有任务文件夹 */
  listTaskWorkspaces(groupId: string): TaskWorkspace[];

  /** 读取任务文件夹内文件 */
  readTaskFile(groupId: string, taskId: string, filePath: string): Buffer;

  /** 写入文件到任务文件夹 */
  writeTaskFile(groupId: string, taskId: string, filePath: string, content: Buffer): TaskFile;

  /** 删除任务文件夹内文件 */
  deleteTaskFile(groupId: string, taskId: string, filePath: string): boolean;

  // ═══════════════════════════════════════════════════════
  // 3. 群组合并 = 工作空间挂载继承（核心）
  // ═══════════════════════════════════════════════════════

  /**
   * 继承子群组的任务工作空间
   *
   * 实现：父workspace创建指向子群组task文件夹的挂载点
   * 子群组原工作不停，父群组可以访问子群组的task文件
   */
  inheritTasksFromChild(
    parentGroupId: string,
    childGroupId: string,
    taskIds?: string[]  // 不传 = 继承全部
  ): { inheritedTasks: string[]; errors: string[] };

  /**
   * 从总workspace导入特定任务
   *
   * 用户说"随时可以从总工作空间导入"
   * 实现：copy或mount，不是move（保留原群组文件）
   */
  importTaskFromGroup(
    targetGroupId: string,
    sourceGroupId: string,
    taskId: string,
    mode: 'copy' | 'mount' = 'mount'
  ): TaskWorkspace;

  /** 获取群组的完整workspace视图（含继承的挂载点） */
  getUnifiedWorkspaceView(groupId: string): {
    ownTasks: TaskWorkspace[];
    inheritedTasks: Array<{ fromGroupId: string; tasks: TaskWorkspace[] }>;
  };

  // ═══════════════════════════════════════════════════════
  // 4. 记忆库（不单独列出，与工作文件一致）
  // ═══════════════════════════════════════════════════════

  /** 读取任务的记忆库 */
  readTaskMemory(groupId: string, taskId: string): TaskMemory;

  /** 追加记忆条目 */
  appendMemory(groupId: string, taskId: string, entry: Omit<MemoryEntry, 'id'>): MemoryEntry;

  /** 记忆搜索（简单文本搜索，未来可接向量检索） */
  searchMemory(groupId: string, taskId: string, query: string): MemoryEntry[];

  // ═══════════════════════════════════════════════════════
  // 5. 交接状态持久化
  // ═══════════════════════════════════════════════════════

  /** 保存交接状态到任务文件夹 */
  saveHandoffState(groupId: string, taskId: string, state: HandoffState): void;

  /** 读取交接状态 */
  loadHandoffState(groupId: string, taskId: string): HandoffState | null;
}
```

---

## 四、UnifiedAPIClient — 统一API协议

```typescript
/**
 * UnifiedAPIClient — 统一API客户端
 *
 * 核心原则：
 * - 所有provider走同一套请求/响应格式
 * - 输入API key自动识别provider、填充endpoint、选择model
 * - OpenClaw和Hermes在adapter层区别，上层无感知
 */

// ── 统一请求/响应格式 ─────────────────────────────────────────

export interface UnifiedChatRequest {
  messages: UnifiedMessage[];
  model?: string;               // 可选，自动选择
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: UnifiedTool[];
}

export interface UnifiedMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: UnifiedToolCall[];
  toolCallId?: string;
}

export interface UnifiedTool {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface UnifiedToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface UnifiedChatResponse {
  id: string;
  model: string;
  content: string;
  toolCalls?: UnifiedToolCall[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason: string;
}

// ── Provider识别与配置 ─────────────────────────────────────────

export type ProviderType = 'openclaw' | 'hermes' | 'kimi' | 'claude' | 'openai' | 'ollama';

export interface ProviderConfig {
  type: ProviderType;
  apiKey: string;
  baseUrl?: string;             // 自动推断，可覆盖
  defaultModel?: string;        // 自动推断，可覆盖
  organization?: string;
  timeoutMs?: number;
}

export interface AutoDetectedConfig {
  type: ProviderType;
  baseUrl: string;
  defaultModel: string;
  availableModels: string[];
  detectedBy: 'key_prefix' | 'key_format' | 'user_hint' | 'manual';
}

// ── 核心类 ────────────────────────────────────────────────────

export class UnifiedAPIClient {
  private adapter: ProviderAdapter;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.adapter = this.createAdapter(config.type);
  }

  /** 统一聊天接口 */
  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse>;

  /** 流式聊天接口 */
  async chatStream(request: UnifiedChatRequest): AsyncGenerator<UnifiedChatResponse, void>;

  /** 列出可用模型 */
  async listModels(): Promise<string[]>;

  /** 验证API key有效性 */
  async validateKey(): Promise<{ valid: boolean; error?: string }>;

  private createAdapter(type: ProviderType): ProviderAdapter {
    switch (type) {
      case 'openclaw': return new OpenClawAdapter(this.config);
      case 'hermes': return new HermesAdapter(this.config);
      case 'kimi': return new KimiAdapter(this.config);
      case 'claude': return new ClaudeAdapter(this.config);
      case 'openai': return new OpenAIAdapter(this.config);
      case 'ollama': return new OllamaAdapter(this.config);
      default: throw new Error(`Unknown provider type: ${type}`);
    }
  }
}

// ── AutoConfigEngine — 输入key自动配置 ─────────────────────────

export class AutoConfigEngine {
  /**
   * 输入API key，自动检测provider并返回完整配置
   *
   * 检测策略：
   * 1. key前缀匹配（如 sk-kimi- → Kimi）
   * 2. key格式匹配（如长度、字符分布）
   * 3. 验证请求试探（fallback）
   */
  static async detectProvider(apiKey: string, userHint?: ProviderType): Promise<AutoDetectedConfig>;

  /**
   * 三层级平台选择后的自动配置
   *
   * Level 1: Foundation（OpenClaw / Hermes / 自定义）
   * Level 2: Platform（Kimi / Claude / OpenAI / Ollama）
   * Level 3: Provider（具体模型）
   */
  static async autoConfig(
    apiKey: string,
    level1: 'openclaw' | 'hermes' | 'custom',
    level2?: string,
    level3?: string
  ): Promise<ProviderConfig>;
}

// ── Provider适配器基类 ─────────────────────────────────────────

abstract class ProviderAdapter {
  protected config: ProviderConfig;

  abstract chat(req: UnifiedChatRequest): Promise<UnifiedChatResponse>;
  abstract chatStream(req: UnifiedChatRequest): AsyncGenerator<UnifiedChatResponse>;
  abstract listModels(): Promise<string[]>;
  abstract validateKey(): Promise<{ valid: boolean; error?: string }>;

  // 统一转换：UnifiedRequest -> ProviderNativeRequest
  protected abstract toNativeRequest(req: UnifiedChatRequest): any;
  // 统一转换：ProviderNativeResponse -> UnifiedResponse
  protected abstract fromNativeResponse(res: any): UnifiedChatResponse;
}

// ── 各Provider适配器（示意） ────────────────────────────────────

class OpenClawAdapter extends ProviderAdapter {
  // OpenClaw特殊：需要连接本地gateway，exec/process等工具
  // 但聊天接口仍走UnifiedAPIClient统一格式
  protected toNativeRequest(req: UnifiedChatRequest): any {
    return {
      ...req,
      // OpenClaw原生格式转换
      provider: 'openclaw',
    };
  }
  protected fromNativeResponse(res: any): UnifiedChatResponse {
    return {
      id: res.messageId || res.id,
      model: res.model || 'unknown',
      content: res.content || res.text || '',
      usage: res.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: res.finishReason || 'stop',
    };
  }
  async chat(req: UnifiedChatRequest): Promise<UnifiedChatResponse> { /* ... */ }
  async chatStream(req: UnifiedChatRequest): AsyncGenerator<UnifiedChatResponse> { /* ... */ }
  async listModels(): Promise<string[]> { /* ... */ }
  async validateKey(): Promise<{ valid: boolean; error?: string }> { /* ... */ }
}

class HermesAdapter extends ProviderAdapter {
  // Hermes特殊：MCP协议、记忆宫殿、分层记忆
  // 但聊天接口仍走UnifiedAPIClient统一格式
  protected toNativeRequest(req: UnifiedChatRequest): any {
    return {
      ...req,
      // Hermes原生格式转换
      provider: 'hermes',
    };
  }
  protected fromNativeResponse(res: any): UnifiedChatResponse {
    return {
      id: res.id || res.message_id,
      model: res.model || 'unknown',
      content: res.content || res.text || '',
      usage: res.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: res.finish_reason || 'stop',
    };
  }
  async chat(req: UnifiedChatRequest): Promise<UnifiedChatResponse> { /* ... */ }
  async chatStream(req: UnifiedChatRequest): AsyncGenerator<UnifiedChatResponse> { /* ... */ }
  async listModels(): Promise<string[]> { /* ... */ }
  async validateKey(): Promise<{ valid: boolean; error?: string }> { /* ... */ }
}

// Kimi / Claude / OpenAI / Ollama 适配器同理...
```

---

## 五、API端点设计

```yaml
# ========== Workspace API ==========

# 工作空间管理
POST   /api/workspace/:groupId                  # 创建工作空间
DELETE /api/workspace/:groupId                   # 销毁工作空间
GET    /api/workspace/:groupId/tasks             # 列出所有任务文件夹
POST   /api/workspace/:groupId/tasks             # 创建任务文件夹
GET    /api/workspace/:groupId/tasks/:taskId     # 获取任务workspace详情
GET    /api/workspace/:groupId/tasks/:taskId/files/:path  # 读取文件
POST   /api/workspace/:groupId/tasks/:taskId/files/:path  # 写入文件
DELETE /api/workspace/:groupId/tasks/:taskId/files/:path  # 删除文件

# 群组合并 = 工作空间继承
POST   /api/workspace/:groupId/inherit            # 继承子群组任务
  body: { sourceGroupId: string, taskIds?: string[] }

# 从总workspace导入
POST   /api/workspace/:groupId/import             # 导入特定任务
  body: { sourceGroupId: string, taskId: string, mode: 'copy'|'mount' }

# 记忆库（与文件一致，不单独列出）
GET    /api/workspace/:groupId/tasks/:taskId/memory       # 读取记忆
POST   /api/workspace/:groupId/tasks/:taskId/memory         # 追加记忆
GET    /api/workspace/:groupId/tasks/:taskId/memory/search  # 搜索记忆

# ========== Unified API ==========

# API配置
POST   /api/unified-api/config                    # 配置统一API
  body: { apiKey: string, provider?: string, model?: string }
GET    /api/unified-api/config                    # 获取当前配置
DELETE /api/unified-api/config                    # 清除配置

# 自动检测
POST   /api/unified-api/detect                    # 自动检测provider
  body: { apiKey: string, hint?: string }

# 聊天（统一接口）
POST   /api/unified-api/chat                      # 非流式聊天
POST   /api/unified-api/chat/stream               # 流式聊天（SSE）
GET    /api/unified-api/models                    # 列出可用模型
POST   /api/unified-api/validate                  # 验证API key

# ========== Agent创建流程（三步） ==========

# Step 1: 选择层级平台
GET    /api/platforms/levels                     # 获取三级平台列表
  response: {
    level1: [{ id: 'openclaw', name: 'OpenClaw', description: '...' }, { id: 'hermes', name: 'Hermes', ... }],
    level2: [{ id: 'kimi', name: 'Kimi', ... }, { id: 'claude', name: 'Claude', ... }],
    level3: [{ id: 'k2.6', name: 'K2.6', ... }, ...]
  }

# Step 2: 输入API Key（自动配置）
POST   /api/agents/create/step2                   # 输入key自动配置
  body: { level1: string, level2?: string, apiKey: string }
  response: { autoDetected: { type, baseUrl, defaultModel, availableModels }, config: ProviderConfig }

# Step 3: 确认创建
POST   /api/agents/create/step3                   # 最终确认创建
  body: { presetId?: string, config: ProviderConfig, name: string }
```

---

## 六、实现优先级

### Phase 1: WorkspaceManager（2-3h）
- [ ] `WorkspaceManager.ts` — 核心类
- [ ] `TaskWorkspace.ts` — 任务workspace封装
- [ ] `workspace.ts` 路由 — REST端点
- [ ] 前端 `WorkspaceBrowser.tsx` — 任务级文件浏览器

### Phase 2: UnifiedAPIClient（2-3h）
- [ ] `UnifiedAPIClient.ts` — 统一客户端
- [ ] `AutoConfigEngine.ts` — 自动检测
- [ ] `ProviderAdapter.ts` + 各provider适配器
- [ ] `unified-api.ts` 路由 — REST端点
- [ ] 前端 `AgentCreator.tsx` — 三步创建流程

### Phase 3: 融合（1-2h）
- [ ] GroupCoordinator扩展workspace挂载接口
- [ ] AgentGroup扩展taskWorkspace字段
- [ ] SnapshotInheritance扩展workspace继承
- [ ] 前端TaskImporter.tsx（从总workspace导入）

---

## 七、结论

**两个需求的核心不是"新增功能"，是"统一抽象层"：**

1. **WorkspaceManager** = 在已有文件系统之上加一个**任务级抽象**，让用户只能看到任务文件夹，记忆库作为隐藏文件夹存在其中。

2. **UnifiedAPIClient** = 在已有多个provider之上加一个**统一抽象**，让用户输入key即自动配置，OpenClaw和Hermes在adapter层区别，上层完全无感知。

**已有代码复用率 > 80%：**
- `SnapshotInheritance.ts` — 扩展workspace继承即可
- `GroupCoordinator.ts` — 扩展workspace挂载接口即可
- `AgentGroup.ts` — 扩展taskWorkspace字段即可
- `handoff.ts` 路由 — 扩展workspace相关端点即可
- 前端三大件 — 新增WorkspaceBrowser + AgentCreator两个组件

**不需要重写的部分：**
- ❌ 文件系统操作 → Node.js fs 已有
- ❌ API请求底层 → fetch/axios 已有
- ❌ 加密存储 → 已有 APIKeyVault
- ❌ 群组合并逻辑 → 已有 AgentZeroPolicyBridge + CoordinatorHierarchy

**Phase 1+2+3 预计总工时：~7h，可并行。**

---

*方案确认，进入实现。*
