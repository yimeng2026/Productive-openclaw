# OpenClaw 运行时优化文档

> **定位**: 本文档描述 Sylva Platform 中 OpenClaw 引擎的核心运行时优化机制。这些优化共同解决了大规模 Agent 集群运行时的上下文爆炸、事件风暴、状态漂移和记忆退化四大问题。
> 
> **作者**: SYLVA | **版本**: 0.1 | **日期**: 2026-05-18

---

## 目录

1. [上下文硬截断机制（>70% Flush）](#1-上下文硬截断机制70-flush)
2. [Agent 完成事件批量处理](#2-agent-完成事件批量处理)
3. [状态持久化到文件](#3-状态持久化到文件)
4. [Ollama 自动监测](#4-ollama-自动监测)
5. [记忆压缩（HOT→WARM→COOL→COLD）](#5-记忆压缩hotwarmcoolcold)
6. [离散时间采样](#6-离散时间采样)
7. [图结构维护](#7-图结构维护)
8. [优化协同效应](#8-优化协同效应)

---

## 1. 上下文硬截断机制（>70% Flush）

### 1.1 问题背景

OpenClaw 中每个 Agent Session 的上下文窗口是有限的（通常 100K ~ 1M tokens）。当上下文接近上限时，系统被迫在尾部截断，导致：
- **信息丢失**：最新的任务指令可能被挤出
- **状态断裂**：Agent 忘记自己正在执行的任务
- **级联失败**：一个 session 崩溃后，依赖它的子 agent 全部失效

### 1.2 优化机制：主动硬截断（Proactive Flush）

**核心策略**：在上下文占用率达到 **70%** 时，**主动触发一次硬截断**，而非等到 100% 被动截断。

```
┌─────────────────────────────────────────────────────────────┐
│  上下文窗口（100%）                                          │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  保留区域（最近 N 轮对话 + 系统提示 + 任务锚点）      │    │
│  │  ~30% 容量                                            │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │  可选摘要区（滚动摘要，保留任务语义骨架）              │    │
│  │  ~20% 容量                                            │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │  ██ 截断区（早期对话，完全丢弃）                      │    │
│  │  ~50% 容量 ← 触发 flush 的阈值                        │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 代码实现思路

```typescript
interface ContextFlushConfig {
  flushThreshold: number;      // 0.7 (70%)
  reserveRatio: number;        // 0.3 (保留最近30%)
  summaryRatio: number;        // 0.2 (摘要占20%)
  anchorTokens: string[];      // 不可截断的锚点token
}

class ContextManager {
  private context: Message[];
  private maxTokens: number;
  private config: ContextFlushConfig;

  constructor(config: ContextFlushConfig) {
    this.config = config;
    this.maxTokens = this.detectModelLimit();
    this.context = [];
  }

  async append(message: Message): Promise<void> {
    this.context.push(message);
    
    const currentUsage = await this.estimateTokenUsage();
    
    // 主动截断触发点：> 70%
    if (currentUsage > this.maxTokens * this.config.flushThreshold) {
      await this.performHardFlush();
    }
  }

  private async performHardFlush(): Promise<void> {
    const reserveLimit = this.maxTokens * this.config.reserveRatio;
    const summaryLimit = this.maxTokens * this.config.summaryRatio;
    
    // Step 1: 分离锚点消息（系统提示、任务定义等不可丢弃）
    const anchors = this.extractAnchors(this.context);
    const anchorTokens = await this.countTokens(anchors);
    
    // Step 2: 分离最近对话（必须保留）
    const recentMessages = this.extractRecent(this.context, reserveLimit - anchorTokens);
    
    // Step 3: 对中间段生成语义摘要
    const middleMessages = this.getMiddleSegment(this.context, anchors.length, recentMessages.length);
    const summary = await this.compressToSummary(middleMessages, summaryLimit);
    
    // Step 4: 重建上下文
    this.context = [
      ...anchors,
      { role: 'system', content: `[历史摘要] ${summary}` },
      ...recentMessages
    ];
    
    // Step 5: 记录 flush 事件（用于调试和审计）
    this.emitFlushEvent({
      truncatedCount: middleMessages.length,
      summaryLength: summary.length,
      timestamp: Date.now()
    });
  }

  private async compressToSummary(
    messages: Message[], 
    budget: number
  ): Promise<string> {
    // 实现：调用 LLM 或本地压缩算法生成任务级摘要
    // 保留：任务目标、已完成的子任务、待处理项、关键决策点
    const prompt = this.buildSummaryPrompt(messages);
    return await llm.summarize(prompt, { maxTokens: budget });
  }

  private extractAnchors(messages: Message[]): Message[] {
    return messages.filter(m => 
      this.config.anchorTokens.some(token => 
        m.content.includes(token)
      )
    );
  }
}
```

### 1.4 关键设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 阈值 70% | 非 50% 或 90% | 预留 30% 缓冲，允许一轮大回复不越界 |
| 锚点保留 | 正则匹配 + 语义标记 | 避免系统提示和任务定义被截断 |
| 摘要生成 | 异步 LLM 调用 | 在 flush 间隙完成，不阻塞主流程 |
| 事件记录 | flush 元数据写入日志 | 用于诊断上下文退化问题 |

---

## 2. Agent 完成事件批量处理

### 2.1 问题背景

在大规模 Agent 集群中，单个任务可能产生 **数十个完成事件**（子 agent 依次完成）。如果每个事件都立即处理：
- **事件风暴**：主线程被事件处理淹没
- **UI 抖动**：界面频繁刷新，用户体验差
- **网络开销**：每个事件触发一次状态同步请求

### 2.2 优化机制：事件攒批（Event Batching）

**核心策略**：Agent 完成事件不立即处理，而是进入一个**环形缓冲区**，攒够 **5 个** 或等待 **5 秒** 后批量处理。

```
┌─────────────────────────────────────────────────┐
│              完成事件环形缓冲区                    │
│                  (容量 = 5)                      │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐            │
│  │ A1 │→│ A2 │→│ A3 │→│ A4 │→│ A5 │            │
│  └────┘ └────┘ └────┘ └────┘ └────┘            │
│       ↑                                         │
│   触发批量处理                                   │
│   ├─ 数量达到 5 个                               │
│   ├─ 超时 5000ms                                 │
│   └─ 紧急事件（父 agent 依赖）                    │
└─────────────────────────────────────────────────┘
```

### 2.3 代码实现思路

```typescript
interface CompletionEvent {
  sessionId: string;
  agentId: string;
  result: any;
  timestamp: number;
  priority: 'normal' | 'urgent';
  dependents: string[];  // 依赖此 agent 完成的其他 agent
}

class CompletionEventBatcher {
  private buffer: CompletionEvent[] = [];
  private readonly BATCH_SIZE = 5;
  private readonly TIMEOUT_MS = 5000;
  private timer: NodeJS.Timeout | null = null;
  private processing = false;

  async enqueue(event: CompletionEvent): Promise<void> {
    // 紧急事件：立即触发批量处理
    if (event.priority === 'urgent' || event.dependents.length > 0) {
      this.buffer.push(event);
      await this.flush();
      return;
    }

    this.buffer.push(event);

    // 达到批次大小，立即处理
    if (this.buffer.length >= this.BATCH_SIZE) {
      await this.flush();
      return;
    }

    // 启动超时计时器
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.TIMEOUT_MS);
    }
  }

  private async flush(): Promise<void> {
    if (this.processing || this.buffer.length === 0) return;
    
    this.processing = true;
    
    // 清空计时器
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // 取出当前批次
    const batch = [...this.buffer];
    this.buffer = [];

    try {
      // 批量处理：去重、排序、合并相关事件
      const optimizedBatch = this.optimizeBatch(batch);
      
      // 并行处理所有事件
      await Promise.all(
        optimizedBatch.map(event => this.processEvent(event))
      );

      // 通知 UI 层一次刷新（而非多次）
      this.emitBatchComplete(optimizedBatch);
      
    } catch (error) {
      // 失败回滚：将未处理事件重新入队
      this.buffer.unshift(...batch.filter(e => !e.processed));
      this.scheduleRetry();
    } finally {
      this.processing = false;
    }
  }

  private optimizeBatch(batch: CompletionEvent[]): CompletionEvent[] {
    // 1. 去重：同一 agent 的多个完成事件只保留最新
    const latestByAgent = new Map<string, CompletionEvent>();
    for (const event of batch) {
      const existing = latestByAgent.get(event.agentId);
      if (!existing || event.timestamp > existing.timestamp) {
        latestByAgent.set(event.agentId, event);
      }
    }

    // 2. 拓扑排序：依赖者在前，被依赖者在后
    const sorted = this.topologicalSort([...latestByAgent.values()]);

    // 3. 合并同一父 agent 的子结果
    return this.mergeSiblingResults(sorted);
  }

  private topologicalSort(events: CompletionEvent[]): CompletionEvent[] {
    const graph = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();

    for (const e of events) {
      graph.set(e.agentId, new Set());
      inDegree.set(e.agentId, 0);
    }

    for (const e of events) {
      for (const dep of e.dependents) {
        if (graph.has(dep)) {
          graph.get(dep)!.add(e.agentId);
          inDegree.set(e.agentId, (inDegree.get(e.agentId) || 0) + 1);
        }
      }
    }

    // Kahn 算法
    const queue = events.filter(e => (inDegree.get(e.agentId) || 0) === 0);
    const result: CompletionEvent[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);
      
      for (const neighbor of graph.get(current.agentId) || []) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          const next = events.find(e => e.agentId === neighbor);
          if (next) queue.push(next);
        }
      }
    }

    return result;
  }

  private async processEvent(event: CompletionEvent): Promise<void> {
    event.processed = true;
    // 分发到对应 handler
    await this.dispatcher.dispatch(event);
  }
}
```

### 2.4 批量窗口调优

| 参数 | 默认值 | 调优策略 |
|------|--------|----------|
| `BATCH_SIZE` | 5 | 高频任务可调大，低延迟要求可调小 |
| `TIMEOUT_MS` | 5000 | 实时性要求高的场景调小 |
| 紧急事件 | 立即 flush | 依赖链中的关键节点优先 |

---

## 3. 状态持久化到文件

### 3.1 问题背景

OpenClaw 的 Agent 状态默认保存在**内存**中：
- Session 重启后，所有 Agent 状态丢失
- 子 agent 的结果依赖父 session 的上下文
- 长时间运行任务（如夜间集群任务）存在崩溃风险

### 3.2 优化机制：文件级状态持久化

**核心策略**：Agent 的关键状态**实时写入文件系统**，不依赖上下文记忆。Session 重启后可从文件恢复。

```
┌──────────────────────────────────────────────────────────┐
│                  状态持久化架构                           │
│                                                          │
│  Agent Session ──→ 状态变更 ──→ 同步写入文件              │
│       │                        (.jsonl / .sqlite)        │
│       │                              │                   │
│       │                              ▼                   │
│       └────────────←── 恢复读取 ──┬─ state/               │
│                                   ├─ agent-{id}.state     │
│                                   ├─ workflow-{id}.log    │
│                                   └─ checkpoint/          │
│                                      └─ checkpoint-*.json │
└──────────────────────────────────────────────────────────┘
```

### 3.3 代码实现思路

```typescript
interface PersistedState {
  agentId: string;
  sessionId: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  taskDescription: string;
  progress: number;           // 0-100
  result?: any;
  error?: string;
  checkpoint: number;         // 版本号
  dependencies: string[];     // 依赖的 agent IDs
  dependents: string[];       // 依赖此 agent 的 IDs
  lastUpdated: number;
  contextSnapshot?: string;   // 上下文摘要（可选）
}

class FileStateManager {
  private stateDir: string;
  private db: SQLiteDatabase;
  private writeQueue: PersistedState[] = [];
  private flushInterval: NodeJS.Timeout;

  constructor(workspacePath: string) {
    this.stateDir = path.join(workspacePath, '.openclaw', 'state');
    fs.mkdirSync(this.stateDir, { recursive: true });
    
    this.db = new SQLiteDatabase(path.join(this.stateDir, 'agents.db'));
    this.initSchema();
    
    // 每秒批量 flush 到 SQLite
    this.flushInterval = setInterval(() => this.flushQueue(), 1000);
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_states (
        agent_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL,
        task_description TEXT,
        progress REAL DEFAULT 0,
        result TEXT,
        error TEXT,
        checkpoint INTEGER DEFAULT 0,
        dependencies TEXT,  -- JSON array
        dependents TEXT,    -- JSON array
        last_updated INTEGER,
        context_snapshot TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_session ON agent_states(session_id);
      CREATE INDEX IF NOT EXISTS idx_status ON agent_states(status);
    `);
  }

  async saveState(state: PersistedState): Promise<void> {
    // 更新内存缓存
    this.writeQueue.push(state);
    
    // 重要状态变更立即同步（如 completed / failed）
    if (['completed', 'failed'].includes(state.status)) {
      await this.flushQueue();
    }
  }

  private async flushQueue(): Promise<void> {
    if (this.writeQueue.length === 0) return;

    const batch = [...this.writeQueue];
    this.writeQueue = [];

    // 事务写入 SQLite
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO agent_states 
      (agent_id, session_id, status, task_description, progress, 
       result, error, checkpoint, dependencies, dependents, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      for (const state of batch) {
        stmt.run(
          state.agentId,
          state.sessionId,
          state.status,
          state.taskDescription,
          state.progress,
          JSON.stringify(state.result),
          state.error,
          state.checkpoint,
          JSON.stringify(state.dependencies),
          JSON.stringify(state.dependents),
          Date.now()
        );
      }
    })();

    // 同时写入 JSONL 日志（用于审计和调试）
    const logLine = JSON.stringify({
      type: 'state_change',
      data: batch,
      timestamp: Date.now()
    }) + '\n';
    
    fs.appendFileSync(
      path.join(this.stateDir, 'workflow.log'),
      logLine
    );
  }

  async recoverSession(sessionId: string): Promise<PersistedState[]> {
    // Session 重启后，从数据库恢复所有相关 agent 状态
    const rows = this.db.prepare(
      'SELECT * FROM agent_states WHERE session_id = ?'
    ).all(sessionId);

    return rows.map(row => ({
      agentId: row.agent_id,
      sessionId: row.session_id,
      status: row.status,
      taskDescription: row.task_description,
      progress: row.progress,
      result: JSON.parse(row.result || 'null'),
      error: row.error,
      checkpoint: row.checkpoint,
      dependencies: JSON.parse(row.dependencies || '[]'),
      dependents: JSON.parse(row.dependents || '[]'),
      lastUpdated: row.last_updated
    }));
  }

  async createCheckpoint(sessionId: string): Promise<string> {
    const checkpointId = `checkpoint-${Date.now()}`;
    const states = await this.recoverSession(sessionId);
    
    const checkpoint = {
      id: checkpointId,
      sessionId,
      timestamp: Date.now(),
      states,
      contextVersion: this.getContextVersion()
    };

    const filepath = path.join(this.stateDir, 'checkpoint', `${checkpointId}.json`);
    fs.writeFileSync(filepath, JSON.stringify(checkpoint, null, 2));
    
    return checkpointId;
  }

  async restoreCheckpoint(checkpointId: string): Promise<PersistedState[]> {
    const filepath = path.join(this.stateDir, 'checkpoint', `${checkpointId}.json`);
    const checkpoint = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    
    // 恢复到数据库
    for (const state of checkpoint.states) {
      await this.saveState({ ...state, checkpoint: state.checkpoint + 1 });
    }
    
    return checkpoint.states;
  }
}
```

### 3.4 持久化策略矩阵

| 状态类型 | 存储方式 | 同步策略 | 保留策略 |
|----------|----------|----------|----------|
| Agent 运行时状态 | SQLite | 1秒批量 + 关键事件立即同步 | 7天滚动 |
| 工作流日志 | JSONL 追加 | 实时写入 | 30天归档 |
| 检查点 | JSON 文件 | 显式触发 | 最近 10 个 |
| 任务结果 | SQLite + 文件 | 完成后立即写入 | 永久保留 |

---

## 4. Ollama 自动监测

### 4.1 问题背景

当使用本地 Ollama 作为 LLM 后端时：
- Ollama 服务可能意外停止（OOM、端口冲突、手动关闭）
- 模型文件可能被删除或损坏
- 新模型发布后，需要自动拉取更新
- Agent 在不知情的情况下向死掉的 Ollama 发送请求

### 4.2 优化机制：健康探测 + 自动恢复

**核心策略**：定时探测 Ollama 健康状态，异常时自动重启服务或切换备用后端。

```
┌────────────────────────────────────────────────────────────┐
│                   Ollama 自动监测流程                       │
│                                                            │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐          │
│  │ 健康探测  │────→│ 状态判定  │────→│ 恢复动作  │          │
│  └──────────┘     └──────────┘     └──────────┘          │
│       │                │                │                 │
│       ▼                ▼                ▼                 │
│  • HTTP /api/tags    • healthy      • 无需动作          │
│  • 模型列表检查      • degraded     • 重启 Ollama       │
│  • 响应时间 < 5s    • unhealthy    • 切换备用后端       │
│  • 内存使用检查      • model_missing • 拉取缺失模型      │
│                                                            │
│  探测周期: 30s │ 超时阈值: 10s │ 连续失败 3 次触发恢复   │
└────────────────────────────────────────────────────────────┘
```

### 4.3 代码实现思路

```typescript
interface OllamaConfig {
  baseUrl: string;
  defaultModel: string;
  fallbackModels: string[];   // 降级模型列表
  fallbackBackend?: string;   // 备用后端（如 OpenAI）
  autoPull: boolean;          // 自动拉取缺失模型
  maxRetries: number;
  probeIntervalMs: number;
}

interface OllamaHealth {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'model_missing';
  latency: number;
  models: string[];
  memoryUsage: number;
  lastError?: string;
  consecutiveFailures: number;
}

class OllamaMonitor {
  private config: OllamaConfig;
  private health: OllamaHealth;
  private probeTimer: NodeJS.Timeout;
  private isRecovering = false;

  constructor(config: OllamaConfig) {
    this.config = config;
    this.health = {
      status: 'unknown',
      latency: 0,
      models: [],
      memoryUsage: 0,
      consecutiveFailures: 0
    };
  }

  start(): void {
    // 初始探测
    this.probe();
    
    // 周期性探测
    this.probeTimer = setInterval(
      () => this.probe(),
      this.config.probeIntervalMs
    );
  }

  private async probe(): Promise<void> {
    if (this.isRecovering) return;

    try {
      const startTime = Date.now();
      
      // 1. 探测 Ollama 服务是否存活
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000)
      });

      const latency = Date.now() - startTime;
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const availableModels = data.models?.map((m: any) => m.name) || [];

      // 2. 检查默认模型是否存在
      const modelMissing = !availableModels.includes(this.config.defaultModel);

      // 3. 检查系统资源
      const memoryUsage = await this.getSystemMemoryUsage();

      // 4. 更新健康状态
      if (modelMissing) {
        this.health.status = 'model_missing';
      } else if (latency > 5000 || memoryUsage > 0.9) {
        this.health.status = 'degraded';
      } else {
        this.health.status = 'healthy';
      }

      this.health.latency = latency;
      this.health.models = availableModels;
      this.health.memoryUsage = memoryUsage;
      this.health.consecutiveFailures = 0;

    } catch (error) {
      this.health.status = 'unhealthy';
      this.health.lastError = error instanceof Error ? error.message : 'Unknown error';
      this.health.consecutiveFailures++;

      // 连续失败超过阈值，触发恢复
      if (this.health.consecutiveFailures >= 3) {
        await this.recover();
      }
    }
  }

  private async recover(): Promise<void> {
    if (this.isRecovering) return;
    this.isRecovering = true;

    try {
      switch (this.health.status) {
        case 'unhealthy':
          // 尝试重启 Ollama 服务
          await this.restartOllama();
          break;

        case 'model_missing':
          // 自动拉取缺失模型
          if (this.config.autoPull) {
            await this.pullModel(this.config.defaultModel);
          } else {
            // 切换到备用模型
            await this.switchToFallbackModel();
          }
          break;

        case 'degraded':
          // 降低并发或切换到备用后端
          await this.switchToFallbackBackend();
          break;
      }
    } finally {
      this.isRecovering = false;
    }
  }

  private async restartOllama(): Promise<void> {
    const platform = process.platform;
    
    try {
      if (platform === 'win32') {
        // Windows: 通过任务管理器重启
        await exec('taskkill /F /IM ollama.exe');
        await exec('start ollama serve');
      } else if (platform === 'darwin' || platform === 'linux') {
        // macOS/Linux: 通过 launchctl / systemctl
        await exec('pkill ollama');
        await exec('ollama serve &');
      }
      
      // 等待服务恢复
      await this.waitForHealthy(30000);
      
    } catch (error) {
      // 重启失败，切换到备用后端
      await this.switchToFallbackBackend();
    }
  }

  private async pullModel(modelName: string): Promise<void> {
    const response = await fetch(`${this.config.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: false })
    });

    if (!response.ok) {
      throw new Error(`Failed to pull model: ${modelName}`);
    }
  }

  private async switchToFallbackModel(): Promise<void> {
    // 按优先级尝试备用模型
    for (const model of this.config.fallbackModels) {
      if (this.health.models.includes(model)) {
        // 更新当前使用的模型
        this.emitModelSwitch({ from: this.config.defaultModel, to: model });
        return;
      }
    }
    
    // 所有本地模型都不可用，切换到云后端
    await this.switchToFallbackBackend();
  }

  private async switchToFallbackBackend(): Promise<void> {
    if (!this.config.fallbackBackend) {
      throw new Error('No fallback backend configured');
    }
    
    this.emitBackendSwitch({
      from: `ollama:${this.config.defaultModel}`,
      to: this.config.fallbackBackend
    });
  }

  private async waitForHealthy(timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        await this.probe();
        if (this.health.status === 'healthy') {
          return true;
        }
      } catch {
        // 继续等待
      }
      
      await sleep(1000);
    }
    
    return false;
  }

  getHealth(): OllamaHealth {
    return { ...this.health };
  }
}
```

### 4.4 恢复策略优先级

```
模型不可用 
  → 尝试备用模型（本地）
    → 尝试自动拉取（网络允许）
      → 切换到云备用后端（OpenAI/Claude）
        → 进入降级模式（仅使用缓存/历史结果）
```

---

## 5. 记忆压缩（HOT→WARM→COOL→COLD）

### 5.1 问题背景

Agent 的"记忆"（上下文、学习到的偏好、历史决策）随时间无限增长：
- 短期记忆（当前 session）→ 容易溢出
- 中期记忆（最近几天）→ 检索效率下降
- 长期记忆（全部历史）→ 存储成本高昂

人类记忆的启发：**不是所有记忆都需要同等的清晰度和可访问性**。

### 5.2 优化机制：四级记忆分层

**核心策略**：将记忆按**访问频率**和**重要性**分为四级，每级有不同的压缩率和保留策略。

```
┌──────────────────────────────────────────────────────────────────┐
│                       记忆温度分层架构                              │
│                                                                  │
│   ┌───────────┐  高频率访问 │ 零压缩   │ 内存存储                │
│   │   HOT     │  最近 1 轮对话 │ 完整保留 │ 实时可用              │
│   ├───────────┤                                                  │
│   │   WARM    │  最近 5 轮对话 │ 轻压缩   │ 内存 + 文件           │
│   │           │  保留关键细节  │ 丢弃重复 │ 快速检索              │
│   ├───────────┤                                                  │
│   │   COOL    │  最近 50 轮对话│ 中压缩   │ 文件存储              │
│   │           │  保留语义骨架  │ 合并相似 │ 按需加载              │
│   ├───────────┤                                                  │
│   │   COLD    │  全部历史    │ 重压缩   │ 归档存储              │
│   │           │  仅保留范式   │ 高度摘要 │ 慢速检索/近似匹配      │
│   └───────────┘                                                  │
│                                                                  │
│   迁移规则：                                                     │
│   HOT → WARM: 新消息入队时，旧消息降级                           │
│   WARM → COOL: 每 5 轮对话，触发批量压缩                         │
│   COOL → COLD: 每日归档，生成"日记摘要"                         │
│   COLD → COOL: 检索命中时，临时提升温度                          │
└──────────────────────────────────────────────────────────────────┘
```

### 5.3 代码实现思路

```typescript
interface MemoryEntry {
  id: string;
  content: string;
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
  importance: number;        // 0-1，由语义分析或用户标记决定
  embeddings?: number[];   // 向量嵌入，用于相似度检索
  temperature: 'HOT' | 'WARM' | 'COOL' | 'COLD';
}

interface CompressionConfig {
  hot: { maxItems: number; maxTokens: number };
  warm: { maxItems: number; compressionRatio: number };
  cool: { maxItems: number; compressionRatio: number };
  cold: { retentionDays: number; archivePath: string };
}

class TieredMemorySystem {
  private hot: MemoryEntry[] = [];      // 内存
  private warm: MemoryEntry[] = [];     // 内存 + 文件缓存
  private cool: Map<string, MemoryEntry> = new Map();  // 文件存储
  private cold: VectorStore;             // 向量数据库
  private config: CompressionConfig;
  private compressor: LLMCompressor;

  constructor(config: CompressionConfig, coldStore: VectorStore) {
    this.config = config;
    this.cold = coldStore;
    this.compressor = new LLMCompressor();
  }

  // ─── 写入记忆 ───
  async store(content: string, importance = 0.5): Promise<void> {
    const entry: MemoryEntry = {
      id: this.generateId(),
      content,
      timestamp: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now(),
      importance,
      temperature: 'HOT'
    };

    // 写入 HOT 层
    this.hot.unshift(entry);
    
    // 触发层级迁移
    await this.migrateIfNeeded();
  }

  // ─── 读取记忆 ───
  async retrieve(query: string, limit = 5): Promise<MemoryEntry[]> {
    // 1. 在 HOT 层搜索（完全匹配）
    const hotMatches = this.hot.filter(e => 
      e.content.toLowerCase().includes(query.toLowerCase())
    );
    
    // 2. 在 WARM 层搜索
    const warmMatches = this.warm.filter(e =>
      e.content.toLowerCase().includes(query.toLowerCase())
    );
    
    // 3. 在 COOL 层搜索（基于时间窗口）
    const coolMatches = [...this.cool.values()].filter(e =>
      this.isRecent(e, '7d')
    );
    
    // 4. 在 COLD 层搜索（向量相似度）
    const coldMatches = await this.cold.similaritySearch(query, limit);
    
    // 合并结果，按相关性排序
    const results = [
      ...hotMatches.map(e => ({ ...e, score: 1.0 })),
      ...warmMatches.map(e => ({ ...e, score: 0.8 })),
      ...coolMatches.map(e => ({ ...e, score: 0.6 })),
      ...coldMatches.map(e => ({ ...e, score: 0.4 }))
    ]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

    // 访问计数 + 温度提升
    for (const entry of results) {
      entry.accessCount++;
      entry.lastAccessed = Date.now();
      await this.promoteIfNeeded(entry);
    }

    return results;
  }

  // ─── 层级迁移逻辑 ───
  private async migrateIfNeeded(): Promise<void> {
    // HOT → WARM: 超过容量限制
    while (this.hot.length > this.config.hot.maxItems) {
      const oldest = this.hot.pop()!;
      oldest.temperature = 'WARM';
      
      // 轻压缩：合并相邻的相似消息
      const compressed = await this.lightCompress(oldest);
      this.warm.unshift(compressed);
    }

    // WARM → COOL: 超过容量或时间阈值
    while (this.warm.length > this.config.warm.maxItems) {
      const oldest = this.warm.pop()!;
      oldest.temperature = 'COOL';
      
      // 中压缩：提取语义骨架，生成摘要
      const compressed = await this.mediumCompress(oldest);
      this.cool.set(compressed.id, compressed);
    }

    // COOL → COLD: 每日归档
    const now = Date.now();
    for (const [id, entry] of this.cool) {
      if (now - entry.timestamp > 24 * 60 * 60 * 1000) {
        entry.temperature = 'COLD';
        
        // 重压缩：生成高度摘要 + 向量嵌入
        const archived = await this.heavyCompress(entry);
        await this.cold.addDocument({
          id: archived.id,
          content: archived.content,
          embedding: archived.embeddings!,
          metadata: {
            timestamp: archived.timestamp,
            importance: archived.importance,
            originalLength: archived.content.length
          }
        });
        
        this.cool.delete(id);
      }
    }
  }

  // ─── 压缩算法 ───
  private async lightCompress(entry: MemoryEntry): Promise<MemoryEntry> {
    // 轻压缩：合并相邻重复内容，保留时间戳
    return {
      ...entry,
      content: this.deduplicate(entry.content)
    };
  }

  private async mediumCompress(entry: MemoryEntry): Promise<MemoryEntry> {
    // 中压缩：LLM 生成语义摘要，保留关键实体和决策
    const summary = await this.compressor.summarize(entry.content, {
      preserve: ['decisions', 'entities', 'actions', 'errors'],
      maxLength: Math.floor(entry.content.length * this.config.warm.compressionRatio)
    });

    return {
      ...entry,
      content: summary
    };
  }

  private async heavyCompress(entry: MemoryEntry): Promise<MemoryEntry> {
    // 重压缩：提取"范式级"信息（模式、偏好、教训）
    const pattern = await this.compressor.extractPattern(entry.content);
    
    // 生成向量嵌入用于检索
    const embeddings = await this.embeddings.generate(entry.content);

    return {
      ...entry,
      content: pattern,
      embeddings
    };
  }

  // ─── 温度提升 ───
  private async promoteIfNeeded(entry: MemoryEntry): Promise<void> {
    const accessVelocity = entry.accessCount / 
      ((Date.now() - entry.timestamp) / 1000 / 60 / 60); // 每小时访问次数

    // 频繁访问的记忆自动升温
    if (entry.temperature === 'COLD' && accessVelocity > 0.1) {
      entry.temperature = 'COOL';
      // 从向量库中召回完整内容
      const fullContent = await this.cold.retrieveFull(entry.id);
      entry.content = fullContent;
      this.cool.set(entry.id, entry);
    }
  }
}
```

### 5.4 温度参数配置

| 层级 | 容量 | 压缩率 | 存储 | 检索延迟 |
|------|------|--------|------|----------|
| HOT | 5 轮对话 | 1:1 | 内存 | < 1ms |
| WARM | 50 轮对话 | 3:1 | 内存 | < 10ms |
| COOL | 500 轮对话 | 10:1 | 文件 | < 100ms |
| COLD | 无上限 | 50:1 | 向量库 | < 1s |

---

## 6. 离散时间采样

### 6.1 问题背景

Agent 集群运行中产生大量时间戳数据：
- 每个消息、每个事件都带精确到毫秒的时间戳
- 时间序列数据爆炸式增长
- 对时间粒度的需求实际是有限的（"今天做了什么" vs "14:23:07.123 做了什么"）

### 6.2 优化机制：离散时间桶

**核心策略**：不记录精确时间戳，而是将时间离散化为**固定间隔的桶**，大幅降低存储和计算开销。

```
连续时间 ──→ 离散时间桶

14:23:07.123  →  14:20 (5分钟桶)
14:23:45.678  →  14:20 (5分钟桶)
14:26:01.000  →  14:25 (5分钟桶)
14:28:59.999  →  14:25 (5分钟桶)
14:31:00.000  →  14:30 (5分钟桶)

存储优化：N 个事件 → 1 个桶（聚合统计）
```

### 6.3 代码实现思路

```typescript
type TimeBucketSize = '1m' | '5m' | '15m' | '1h' | '6h' | '1d' | '1w' | '1M';

interface TimeBucket {
  size: TimeBucketSize;
  startTime: number;        // 桶起始时间戳
  endTime: number;          // 桶结束时间戳
  events: string[];         // 事件 ID 列表（去重）
  eventCount: number;       // 聚合计数
  agentStates: Map<string, AgentStateSnapshot>;
  summary?: string;         // 桶级摘要（可选）
}

class DiscreteTimeSampler {
  private bucketSize: TimeBucketSize;
  private buckets: Map<string, TimeBucket> = new Map();
  private readonly BUCKET_MS: Record<TimeBucketSize, number> = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '1w': 7 * 24 * 60 * 60 * 1000,
    '1M': 30 * 24 * 60 * 60 * 1000
  };

  constructor(bucketSize: TimeBucketSize = '5m') {
    this.bucketSize = bucketSize;
  }

  // ─── 事件采样 ───
  sample(event: AgentEvent): TimeBucket {
    const bucketKey = this.getBucketKey(event.timestamp);
    
    let bucket = this.buckets.get(bucketKey);
    
    if (!bucket) {
      bucket = this.createBucket(event.timestamp);
      this.buckets.set(bucketKey, bucket);
    }

    // 聚合存储，不保存原始时间戳
    if (!bucket.events.includes(event.id)) {
      bucket.events.push(event.id);
      bucket.eventCount++;
    }

    // 更新 agent 状态快照（保留最新）
    bucket.agentStates.set(event.agentId, {
      agentId: event.agentId,
      status: event.status,
      progress: event.progress,
      lastEvent: event.type
    });

    return bucket;
  }

  private getBucketKey(timestamp: number): string {
    const bucketMs = this.BUCKET_MS[this.bucketSize];
    const bucketStart = Math.floor(timestamp / bucketMs) * bucketMs;
    return `${this.bucketSize}:${bucketStart}`;
  }

  private createBucket(timestamp: number): TimeBucket {
    const bucketMs = this.BUCKET_MS[this.bucketSize];
    const startTime = Math.floor(timestamp / bucketMs) * bucketMs;
    
    return {
      size: this.bucketSize,
      startTime,
      endTime: startTime + bucketMs,
      events: [],
      eventCount: 0,
      agentStates: new Map()
    };
  }

  // ─── 查询接口 ───
  queryRange(startTime: number, endTime: number): TimeBucket[] {
    const results: TimeBucket[] = [];
    const bucketMs = this.BUCKET_MS[this.bucketSize];
    
    // 计算覆盖的桶范围
    let current = Math.floor(startTime / bucketMs) * bucketMs;
    
    while (current < endTime) {
      const key = `${this.bucketSize}:${current}`;
      const bucket = this.buckets.get(key);
      
      if (bucket) {
        results.push(bucket);
      }
      
      current += bucketMs;
    }

    return results;
  }

  // ─── 多级采样（自动降级）───
  async aggregateToLargerBuckets(targetSize: TimeBucketSize): Promise<Map<string, TimeBucket>> {
    const targetMs = this.BUCKET_MS[targetSize];
    const sourceMs = this.BUCKET_MS[this.bucketSize];
    const ratio = targetMs / sourceMs;

    const aggregated = new Map<string, TimeBucket>();

    for (const [key, bucket] of this.buckets) {
      const parentStart = Math.floor(bucket.startTime / targetMs) * targetMs;
      const parentKey = `${targetSize}:${parentStart}`;

      let parent = aggregated.get(parentKey);
      
      if (!parent) {
        parent = {
          size: targetSize,
          startTime: parentStart,
          endTime: parentStart + targetMs,
          events: [],
          eventCount: 0,
          agentStates: new Map()
        };
        aggregated.set(parentKey, parent);
      }

      // 合并统计
      parent.eventCount += bucket.eventCount;
      
      // 合并去重事件
      for (const eventId of bucket.events) {
        if (!parent.events.includes(eventId)) {
          parent.events.push(eventId);
        }
      }

      // 合并 agent 状态（保留每个 agent 的最新状态）
      for (const [agentId, state] of bucket.agentStates) {
        const existing = parent.agentStates.get(agentId);
        if (!existing || state.progress > existing.progress) {
          parent.agentStates.set(agentId, state);
        }
      }
    }

    return aggregated;
  }

  // ─── 存储优化统计 ───
  getStorageStats(): { buckets: number; totalEvents: number; compressionRatio: number } {
    let totalEvents = 0;
    for (const bucket of this.buckets.values()) {
      totalEvents += bucket.eventCount;
    }

    // 假设每个原始事件存储需要 ~200 bytes（含时间戳、ID、内容）
    // 每个桶存储需要 ~500 bytes（固定开销）+ 事件列表
    const originalSize = totalEvents * 200;
    const bucketSize = this.buckets.size * 500 + totalEvents * 16; // 16 bytes per ID reference
    
    return {
      buckets: this.buckets.size,
      totalEvents,
      compressionRatio: originalSize / bucketSize
    };
  }
}
```

### 6.4 桶大小选择策略

| 场景 | 桶大小 | 理由 |
|------|--------|------|
| 实时监控 | 1m | 需要近实时状态 |
| 日常运维 | 5m | 平衡精度与存储 |
| 日报生成 | 1h | 按小时汇总足够 |
| 历史分析 | 1d | 长期趋势不需要细粒度 |
| 年度归档 | 1w | 极粗粒度，仅保留趋势 |

---

## 7. 图结构维护

### 7.1 问题背景

Agent 集群不是线性结构，而是复杂的**依赖网络**：
- 父 Agent 启动 N 个子 Agent
- 子 Agent 之间可能共享依赖
- 一个 Agent 的失败可能级联影响多个下游 Agent
- 需要快速识别"关键路径"和"瓶颈节点"

### 7.2 优化机制：实时依赖图

**核心策略**：维护一个**有向无环图（DAG）**，表示 Agent 间的调用关系和依赖关系。支持拓扑排序、关键路径分析和级联故障检测。

```
┌──────────────────────────────────────────────────────────────────┐
│                    Agent 依赖图 (DAG)                              │
│                                                                  │
│                         ┌─────────┐                             │
│                         │  Root   │                             │
│                         │ Agent   │                             │
│                         └────┬────┘                             │
│              ┌───────────────┼───────────────┐                 │
│              ▼               ▼               ▼                 │
│        ┌─────────┐     ┌─────────┐     ┌─────────┐             │
│        │ Agent A │     │ Agent B │     │ Agent C │             │
│        │ (并行)  │     │ (并行)  │     │ (并行)  │             │
│        └────┬────┘     └────┬────┘     └────┬────┘             │
│             │              │               │                   │
│             ▼              ▼               ▼                   │
│        ┌─────────┐     ┌─────────┐     ┌─────────┐           │
│        │ Agent D │◄────┤ Agent E │     │ Agent F │           │
│        │ (依赖A) │     │ (依赖B) │     │ (依赖C) │           │
│        └────┬────┘     └────┬────┘     └────┬────┘           │
│             │              │               │                   │
│             └──────────────┼───────────────┘                   │
│                            ▼                                   │
│                      ┌─────────┐                               │
│                      │ Agent G │  ← 关键路径节点               │
│                      │ (汇总)  │                               │
│                      └─────────┘                               │
│                                                                  │
│   边类型:                                                          │
│   ──► 调用关系 (spawns)                                           │
│   ──▶ 数据依赖 (depends_on)                                        │
│   ══► 共享资源 (shares)                                           │
└──────────────────────────────────────────────────────────────────┘
```

### 7.3 代码实现思路

```typescript
interface AgentNode {
  id: string;
  agentType: string;
  status: AgentStatus;
  startTime?: number;
  endTime?: number;
  result?: any;
  error?: string;
  depth: number;              // 在图中的层级深度
}

interface AgentEdge {
  from: string;               // source agent ID
  to: string;               // target agent ID
  type: 'spawns' | 'depends_on' | 'shares' | 'notifies';
  data?: any;                // 传递的数据摘要
}

interface DependencyGraph {
  nodes: Map<string, AgentNode>;
  edges: AgentEdge[];
  adjacencyList: Map<string, Set<string>>;   // 出边
  reverseAdjacency: Map<string, Set<string>>; // 入边
}

class AgentGraphManager {
  private graph: DependencyGraph = {
    nodes: new Map(),
    edges: [],
    adjacencyList: new Map(),
    reverseAdjacency: new Map()
  };

  // ─── 节点操作 ───
  addNode(node: AgentNode): void {
    this.graph.nodes.set(node.id, node);
    
    if (!this.graph.adjacencyList.has(node.id)) {
      this.graph.adjacencyList.set(node.id, new Set());
    }
    if (!this.graph.reverseAdjacency.has(node.id)) {
      this.graph.reverseAdjacency.set(node.id, new Set());
    }
  }

  updateNodeStatus(agentId: string, status: AgentStatus): void {
    const node = this.graph.nodes.get(agentId);
    if (node) {
      const oldStatus = node.status;
      node.status = status;
      
      if (status === 'completed' || status === 'failed') {
        node.endTime = Date.now();
      }

      // 状态变更时，触发级联检查
      this.propagateStatusChange(agentId, oldStatus, status);
    }
  }

  // ─── 边操作 ───
  addEdge(edge: AgentEdge): void {
    this.graph.edges.push(edge);
    
    this.graph.adjacencyList.get(edge.from)!.add(edge.to);
    this.graph.reverseAdjacency.get(edge.to)!.add(edge.from);
  }

  // ─── 拓扑排序 ───
  topologicalSort(agentIds?: string[]): string[] {
    const ids = agentIds || [...this.graph.nodes.keys()];
    const inDegree = new Map<string, number>();
    
    for (const id of ids) {
      inDegree.set(id, 0);
    }
    
    for (const id of ids) {
      for (const neighbor of this.graph.adjacencyList.get(id) || []) {
        if (ids.includes(neighbor)) {
          inDegree.set(neighbor, (inDegree.get(neighbor) || 0) + 1);
        }
      }
    }

    const queue = ids.filter(id => (inDegree.get(id) || 0) === 0);
    const result: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      for (const neighbor of this.graph.adjacencyList.get(current) || []) {
        if (ids.includes(neighbor)) {
          const newDegree = (inDegree.get(neighbor) || 0) - 1;
          inDegree.set(neighbor, newDegree);
          if (newDegree === 0) {
            queue.push(neighbor);
          }
        }
      }
    }

    // 检测环
    if (result.length !== ids.length) {
      const cycleNodes = ids.filter(id => !result.includes(id));
      throw new Error(`Cycle detected in agent graph: ${cycleNodes.join(', ')}`);
    }

    return result;
  }

  // ─── 关键路径分析 ───
  findCriticalPath(): string[] {
    // 使用动态规划找最长路径（耗时最长或阻塞最严重的路径）
    const nodes = [...this.graph.nodes.values()];
    const topoOrder = this.topologicalSort();
    
    // 计算每个节点的"权重"（预计耗时 + 下游依赖数）
    const weight = new Map<string, number>();
    const path = new Map<string, string[]>();

    for (const id of topoOrder) {
      const node = this.graph.nodes.get(id)!;
      const duration = (node.endTime || Date.now()) - (node.startTime || Date.now());
      const downstreamCount = this.getDownstreamCount(id);
      
      weight.set(id, duration + downstreamCount * 1000); // 依赖数加权
      path.set(id, [id]);

      // 找前驱中的最大权重路径
      const predecessors = this.graph.reverseAdjacency.get(id) || new Set();
      let maxPredWeight = 0;
      let bestPred = '';

      for (const pred of predecessors) {
        const predWeight = weight.get(pred) || 0;
        if (predWeight > maxPredWeight) {
          maxPredWeight = predWeight;
          bestPred = pred;
        }
      }

      if (bestPred) {
        weight.set(id, (weight.get(id) || 0) + maxPredWeight);
        path.set(id, [...path.get(bestPred)!, id]);
      }
    }

    // 找权重最大的终点
    let maxWeight = 0;
    let criticalEnd = '';
    
    for (const [id, w] of weight) {
      const downstream = this.graph.adjacencyList.get(id) || new Set();
      if (downstream.size === 0 && w > maxWeight) { // 终点节点
        maxWeight = w;
        criticalEnd = id;
      }
    }

    return path.get(criticalEnd) || [];
  }

  // ─── 级联失败检测 ───
  getAffectedAgents(failedAgentId: string): string[] {
    const affected = new Set<string>();
    const queue = [failedAgentId];
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      
      // 找到所有直接依赖 current 的 agent
      const dependents = this.graph.reverseAdjacency.get(current) || new Set();
      
      for (const dependent of dependents) {
        if (!affected.has(dependent)) {
          affected.add(dependent);
          queue.push(dependent);
        }
      }
    }
    
    // 排除根节点本身
    affected.delete(failedAgentId);
    
    return [...affected];
  }

  // ─── 并行度分析 ───
  getParallelGroups(): string[][] {
    // 按层级分组，同一层级无依赖关系的 agent 可以并行
    const groups: string[][] = [];
    const visited = new Set<string>();
    let currentLevel = this.getRootAgents();

    while (currentLevel.length > 0) {
      groups.push(currentLevel);
      
      for (const id of currentLevel) {
        visited.add(id);
      }

      // 找下一层级：所有前驱都已被访问的节点
      const nextLevel: string[] = [];
      for (const [id, node] of this.graph.nodes) {
        if (visited.has(id)) continue;
        
        const predecessors = this.graph.reverseAdjacency.get(id) || new Set();
        const allPredsVisited = [...predecessors].every(p => visited.has(p));
        
        if (allPredsVisited) {
          nextLevel.push(id);
        }
      }

      currentLevel = nextLevel;
    }

    return groups;
  }

  // ─── 状态传播 ───
  private propagateStatusChange(
    agentId: string, 
    oldStatus: AgentStatus, 
    newStatus: AgentStatus
  ): void {
    if (newStatus === 'failed') {
      // 级联标记下游 agent 为 blocked
      const affected = this.getAffectedAgents(agentId);
      
      for (const id of affected) {
        const node = this.graph.nodes.get(id);
        if (node && node.status === 'pending') {
          node.status = 'blocked';
          this.emitGraphEvent({
            type: 'agent_blocked',
            agentId: id,
            blockedBy: agentId,
            reason: 'dependency_failed'
          });
        }
      }
    }

    if (newStatus === 'completed') {
      // 检查是否有被阻塞的 agent 可以解除阻塞
      const dependents = this.graph.reverseAdjacency.get(agentId) || new Set();
      
      for (const dependent of dependents) {
        const node = this.graph.nodes.get(dependent);
        if (node && node.status === 'blocked') {
          // 检查所有依赖是否都已完成
          const allDepsCompleted = this.checkAllDependenciesCompleted(dependent);
          if (allDepsCompleted) {
            node.status = 'ready';
            this.emitGraphEvent({
              type: 'agent_ready',
              agentId: dependent,
              unblockedBy: agentId
            });
          }
        }
      }
    }
  }

  private checkAllDependenciesCompleted(agentId: string): boolean {
    const dependencies = this.graph.reverseAdjacency.get(agentId) || new Set();
    
    for (const dep of dependencies) {
      const depNode = this.graph.nodes.get(dep);
      if (!depNode || depNode.status !== 'completed') {
        return false;
      }
    }
    
    return true;
  }

  private getRootAgents(): string[] {
    return [...this.graph.nodes.keys()].filter(id => {
      const preds = this.graph.reverseAdjacency.get(id) || new Set();
      return preds.size === 0;
    });
  }

  private getDownstreamCount(agentId: string): number {
    const visited = new Set<string>();
    const queue = [agentId];
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = this.graph.adjacencyList.get(current) || new Set();
      
      for (const child of children) {
        if (!visited.has(child)) {
          visited.add(child);
          queue.push(child);
        }
      }
    }
    
    return visited.size - 1; // 排除自身
  }

  // ─── 图导出 ───
  exportToMermaid(): string {
    const lines = ['graph TD'];
    
    for (const [id, node] of this.graph.nodes) {
      const label = `${node.agentType}<br/>${node.status}`;
      const color = this.getStatusColor(node.status);
      lines.push(`    ${id}["${label}"]`);
      lines.push(`    style ${id} fill:${color}`);
    }
    
    for (const edge of this.graph.edges) {
      const arrow = edge.type === 'depends_on' ? '-->' : '-.->';
      lines.push(`    ${edge.from} ${arrow}|${edge.type}| ${edge.to}`);
    }
    
    return lines.join('\n');
  }

  private getStatusColor(status: AgentStatus): string {
    const colors: Record<AgentStatus, string> = {
      'idle': '#gray',
      'running': '#blue',
      'completed': '#green',
      'failed': '#red',
      'blocked': '#orange',
      'pending': '#yellow',
      'ready': '#lightblue'
    };
    return colors[status] || '#gray';
  }

  private emitGraphEvent(event: any): void {
    // 发布图结构变更事件
    eventBus.emit('graph:change', event);
  }
}
```

### 7.4 图分析应用场景

| 分析类型 | 用途 | 触发时机 |
|----------|------|----------|
| 拓扑排序 | 确定 Agent 启动顺序 | 工作流初始化 |
| 关键路径 | 识别瓶颈，优化资源分配 | 工作流执行中 |
| 级联影响 | 失败时快速定位受影响范围 | Agent 失败时 |
| 并行分组 | 最大化并发执行 | 每层执行前 |
| 环路检测 | 防止死锁配置 | 图结构变更时 |

---

## 8. 优化协同效应

上述七项优化并非独立工作，而是形成一套**协同系统**：

```
┌─────────────────────────────────────────────────────────────────────┐
│                        优化协同效应图                                │
│                                                                     │
│  ┌──────────────┐                                                   │
│  │ 离散时间采样  │──→ 减少存储 ──→ 记忆压缩更高效                     │
│  └──────────────┘         │                                         │
│                           ▼                                         │
│  ┌──────────────┐    ┌──────────┐    ┌──────────────┐            │
│  │ 上下文硬截断  │──→ │ 释放空间  │──→ │ 记忆升温加载  │            │
│  └──────────────┘    └──────────┘    └──────────────┘            │
│         │                                 │                         │
│         ▼                                 ▼                         │
│  ┌──────────────┐                   ┌──────────────┐               │
│  │ 摘要存入文件  │──────────────────→│ 状态持久化   │               │
│  │ (状态持久化)  │                   │ (SQLite/JSON)│               │
│  └──────────────┘                   └──────────────┘               │
│                                              │                      │
│                                              ▼                      │
│  ┌──────────────┐                   ┌──────────────┐               │
│  │ 图结构维护    │←──────────────────│ 恢复时重建   │               │
│  │ (依赖关系)    │                   │ (DAG 重建)   │               │
│  └──────┬───────┘                   └──────────────┘               │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────┐                                                   │
│  │ 批量处理事件  │──→ 减少主线程负载 ──→ Ollama 探测更稳定           │
│  └──────────────┘                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### 协同效应示例

1. **上下文截断 + 状态持久化**：截断时，被丢弃的早期对话已作为摘要持久化到文件，可随时从 COLD 层召回。

2. **记忆压缩 + 离散时间采样**：时间桶天然适合记忆的分层存储——同一桶内的记忆在降级时一起处理。

3. **图结构 + 批量处理**：图的分层并行分组决定了每批可以安全攒多少事件（同一层无依赖的 Agent 事件可放心攒批）。

4. **状态持久化 + Ollama 监测**：Ollama 恢复后，从持久化状态重建 Agent 图，自动恢复断点续作。

---

## 附录 A: 配置文件示例

```yaml
# openclaw.optimization.yaml

context:
  flush_threshold: 0.7
  reserve_ratio: 0.3
  summary_ratio: 0.2
  anchor_tokens:
    - "[Subagent Task]"
    - "[Subagent Context]"
    - "任务目标："
    - "CRITICAL"

events:
  batch_size: 5
  timeout_ms: 5000
  urgent_patterns:
    - "error"
    - "failed"
    - "CRITICAL"

persistence:
  backend: sqlite
  state_dir: "./.openclaw/state"
  checkpoint_interval: 300  # 5分钟
  retention_days: 7

memory:
  tiers:
    hot:
      max_messages: 5
      max_tokens: 8000
    warm:
      max_messages: 50
      compression_ratio: 0.33
    cool:
      max_messages: 500
      compression_ratio: 0.1
    cold:
      retention_days: 365
      vector_store: "./.openclaw/vectors"

time:
  default_bucket: "5m"
  aggregation_levels:
    - "1h"   # 用于日报
    - "1d"   # 用于月报

graph:
  cycle_detection: strict    # strict | warn | off
  max_depth: 10            # 最大嵌套层级
  critical_path_analysis: true

ollama:
  base_url: "http://localhost:11434"
  default_model: "llama3.2"
  fallback_models:
    - "qwen2.5"
    - "phi4"
  fallback_backend: "openai"   # 云备用
  auto_pull: true
  probe_interval: 30
  max_retries: 3
```

---

## 附录 B: 术语表

| 术语 | 定义 |
|------|------|
| **Flush** | 主动将上下文中的旧消息清除并替换为摘要 |
| **Batch** | 将多个事件攒在一起批量处理，减少系统开销 |
| **Checkpoint** | Agent 执行过程中的保存点，用于崩溃恢复 |
| **Tiered Memory** | 按访问频率分层的记忆系统 |
| **Time Bucket** | 离散时间区间，用于聚合时间序列数据 |
| **DAG** | 有向无环图，描述 Agent 间的调用和依赖关系 |
| **Critical Path** | 决定整体耗时的最长依赖链 |
| **Cascade Failure** | 一个节点失败导致下游节点连锁失败 |

---

> **备注**: 本文档中的伪代码使用 TypeScript 语法描述核心逻辑，实际实现可能因运行时环境（Node.js / Electron / Python）而异。所有数值参数均为可配置项，应根据实际工作负载和硬件资源调整。
