# SYLVA 软件开发指南

> **文档版本**: v1.0.0  
> **适用范围**: Sylva Platform 全栈开发  
> **最后更新**: 2026-05-19  
> **维护者**: SYLVA Software Line Architect

---

## 目录

1. [开发环境搭建](#1-开发环境搭建)
2. [IDE 配置与插件](#2-ide-配置与插件)
3. [前后端调试指南](#3-前后端调试指南)
4. [添加新 API 端点](#4-添加新-api-端点)
5. [添加新前端页面](#5-添加新前端页面)
6. [测试编写规范](#6-测试编写规范)
7. [代码风格配置](#7-代码风格配置)
8. [Git 提交规范](#8-git-提交规范)
9. [PR 模板与审查流程](#9-pr-模板与审查流程)
10. [常见问题与排错](#10-常见问题与排错)

---

## 1. 开发环境搭建

### 1.1 系统要求

| 组件 | 最低版本 | 推荐版本 | 说明 |
|------|---------|---------|------|
| Node.js | 18.0.0 | 20.12.0 LTS | 后端 Runtime + 前端构建 |
| npm | 9.0.0 | 10.5.0 | 包管理器 |
| Python | 3.10.0 | 3.12.0 | 形式化验证 / 数据处理脚本 |
| Docker | 24.0.0 | 26.0.0 | 容器化开发环境 |
| Docker Compose | 2.20.0 | 2.26.0 | 多服务编排 |
| Git | 2.40.0 | 2.44.0 | 版本控制 |
| Lean 4 | 4.7.0 | 4.8.0 | 学术线形式化验证 |
| PostgreSQL | 15.0 | 16.0 | 主数据库 |
| Redis | 7.0 | 7.2 | 缓存 / 消息队列 |
| MinIO / S3 | 兼容 S3 API | 最新 | 对象存储 |

### 1.2 Node.js 环境配置

**使用 nvm 管理 Node.js 版本** (推荐):

```bash
# Windows (使用 nvm-windows)
nvm install 20.12.0
nvm use 20.12.0

# Linux/macOS
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install 20.12.0
nvm use 20.12.0
nvm alias default 20.12.0
```

**验证安装**:

```bash
node --version   # v20.12.0
npm --version    # 10.5.0
```

**npm 镜像配置** (国内加速):

```bash
# 使用淘宝镜像
npm config set registry https://registry.npmmirror.com

# 或使用企业私有镜像
npm config set registry https://npm.your-company.com

# 临时使用
npm install --registry=https://registry.npmmirror.com
```

### 1.3 项目初始化

```bash
# 克隆仓库
git clone https://github.com/sylva-org/sylva-platform.git
cd sylva-platform

# 安装依赖
npm install

# 安装子项目依赖
npm run bootstrap

# 复制环境配置文件
cp .env.example .env.local
# 编辑 .env.local 填入实际配置

# 启动开发数据库
npm run db:start

# 运行数据库迁移
npm run db:migrate

# 填充种子数据
npm run db:seed

# 启动开发服务器
npm run dev
```

### 1.4 环境变量配置

```env
# .env.local —— 本地开发环境变量
NODE_ENV=development
PORT=3000
API_PREFIX=/api/v1

# 数据库
DATABASE_URL=postgresql://sylva:sylva@localhost:5432/sylva_dev
REDIS_URL=redis://localhost:6379/0

# LLM 服务
KIMI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
KIMI_BASE_URL=https://api.moonshot.cn/v1
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_BASE_URL=https://api.openai.com/v1

# 存储
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=sylva-dev

# 安全
JWT_SECRET=dev-jwt-secret-change-in-production
ENCRYPTION_KEY=dev-encryption-key-32-chars!!

# Agent 运行时
MAX_CONCURRENT_AGENTS=8
AGENT_TIMEOUT_SECONDS=300
SANDBOX_TYPE=process

# 日志
LOG_LEVEL=debug
LOG_FORMAT=json
```

### 1.5 多版本 Python 环境 (形式化验证)

```bash
# 使用 pyenv 或 conda 管理 Python
pyenv install 3.12.0
pyenv local 3.12.0

# 创建虚拟环境
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 安装学术线依赖
pip install -r requirements-academic.txt
# lean4 相关工具
elan self update
elan toolchain install stable
```

---

## 2. IDE 配置与插件

### 2.1 VS Code (推荐)

**必需插件清单**:

| 插件名 | 用途 | 配置要点 |
|--------|------|---------|
| ESLint | JavaScript/TypeScript 代码检查 | 启用 autoFixOnSave |
| Prettier - Code: formatter | 代码格式化 | 设为默认格式化工具 |
| TypeScript Hero | 自动 import / 排序 | 启用 organizeOnSave |
| Error Lens | 内联显示错误 | 无需额外配置 |
| GitLens | Git 历史与 blame | 按需配置 |
| Thunder Client | API 测试 (Postman 替代品) | 内置，无需额外安装 |
| Markdown All in One | Markdown 编辑增强 | 启用自动目录 |
| Mermaid Preview | Mermaid 图表预览 | 实时预览 |
| YAML | YAML 语法高亮与校验 | 关联 schema |
| Docker | Dockerfile / compose 支持 | 启用自动补全 |
| Python | Python 开发支持 | 选择正确的 Python 解释器 |
| Lean 4 | Lean 4 形式化验证 | 配置 lake 路径 |
| Better Comments | 彩色注释 | 配置 Sylva 专用标签 |
| indent-rainbow | 缩进可视化 | 使用默认配置 |
| Todo Tree | TODO/FIXME 标记聚合 | 自定义正则匹配 Sylva 标记 |
| Vitest | 测试运行器集成 | 自动发现测试文件 |

**VS Code: settings.json**:

```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit",
    "source.organizeImports": "explicit"
  },
  "editor.rulers": [80, 120],
  "editor.tabSize": 2,
  "editor.insertSpaces": true,
  "editor.detectIndentation": false,
  "typescript.preferences.importModuleSpecifier": "relative",
  "typescript.suggest.autoImports": true,
  "eslint.validate": [
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact"
  ],
  "files.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/.git": true,
    "**/coverage": true
  },
  "search.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/*.log": true
  },
  "terminal.integrated.defaultProfile.windows": "PowerShell",
  "terminal.integrated.defaultProfile.linux": "bash",
  "terminal.integrated.defaultProfile.osx": "zsh",
  "git.autofetch": true,
  "git.confirmSync": false,
  "workbench.colorTheme": "One Dark Pro",
  "workbench.iconTheme": "vscode-icons",
  "sylva.devMode": true,
  "sylva.agentDebugPanel": true
}
```

**VS Code: launch.json (调试配置)**:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Backend",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev:debug"],
      "envFile": "${workspaceFolder}/.env.local",
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen",
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "name": "Debug Frontend",
      "type": "chrome",
      "request": "launch",
      "url": "http://localhost:5173",
      "webRoot": "${workspaceFolder}/apps/web/src",
      "sourceMapPathOverrides": {
        "webpack:///src/*": "${webRoot}/*"
      }
    },
    {
      "name": "Debug Agent Worker",
      "type": "node",
      "request": "attach",
      "port": 9229,
      "restart": true,
      "localRoot": "${workspaceFolder}/packages/agent-worker",
      "remoteRoot": "/app",
      "sourceMaps": true
    },
    {
      "name": "Debug Test (Current File)",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npx",
      "runtimeArgs": ["vitest", "run", "--inspect", "${relativeFile}"],
      "envFile": "${workspaceFolder}/.env.local",
      "console": "integratedTerminal"
    }
  ],
  "compounds": [
    {
      "name": "Debug Full Stack",
      "configurations": ["Debug Backend", "Debug Frontend"],
      "stopAll": true
    }
  ]
}
```

### 2.2 WebStorm / IntelliJ IDEA

**推荐配置**:
- **Code: Style**: 导入 `.idea/codeStyles/Project.xml`
- **ESLint**: 设为 "Automatic ESLint configuration"
- **Prettier**: 启用 "On save" 和 "On reformat"
- **TypeScript**: 严格模式启用，目标 ES2022
- **File Watchers**: 配置 `tsc --noEmit` 于文件保存时运行
- **Run Configurations**: 导入 `.idea/runConfigurations/*.xml`

### 2.3 Neovim (终端党)

**推荐插件栈**:
```lua
-- lazy.nvim 配置
return {
  { "neovim/nvim-lspconfig" },
  { "williamboman/mason.nvim" },
  { "williamboman/mason-lspconfig.nvim" },
  { "jose-elias-alvarez/null-ls.nvim" },
  { "MunifTanjim/prettier.nvim" },
  { "mfussenegger/nvim-dap" },
  { "rcarriga/nvim-dap-ui" },
  { "nvim-telescope/telescope.nvim" },
  { "folke/trouble.nvim" },
  { "nvim-treesitter/nvim-treesitter" },
}
```

### 2.4 终端工具推荐

| 工具 | 用途 | 安装命令 |
|------|------|---------|
| `httpie` | 现代化 curl 替代 | `pip install httpie` |
| `jq` | JSON 处理 | `apt install jq` / `brew install jq` |
| `bat` | cat 增强版 (语法高亮) | `apt install bat` / `brew install bat` |
| `ripgrep` | 极速代码搜索 | `apt install ripgrep` / `brew install ripgrep` |
| `fzf` | 模糊搜索 | `apt install fzf` / `brew install fzf` |
| `tldr` | 简化版 man page | `pip install tldr` |
| `ngrok` | 本地隧道暴露 | `npm install -g ngrok` |
| `websocat` | WebSocket CLI 工具 | `cargo install websocat` |

---

## 3. 前后端调试指南

### 3.1 后端调试

#### 3.1.1 断点设置

**Node.js 断点类型**:

```typescript
// packages/backend/src/services/agent.service.ts
export class AgentService {
  async spawnAgent(config: AgentConfig): Promise<Agent> {
    // [BREAKPOINT 1] 检查输入参数
    console.log("[DEBUG] Spawn config:", config);
    
    // [BREAKPOINT 2] 资源分配前
    const resources = await this.resourcePool.allocate(config.requirements);
    debugger; // 显式断点 —— 检查资源分配结果
    
    // [BREAKPOINT 3] Agent 实例化
    const agent = new Agent({
      id: generateUUID(),
      config,
      resources,
      sandbox: this.sandboxFactory.create(config.sandboxType)
    });
    
    // [BREAKPOINT 4] 启动验证
    await agent.initialize();
    if (!agent.isHealthy()) {
      throw new AgentInitializationError(`Agent ${agent.id} failed health check`);
    }
    
    return agent;
  }
}
```

**条件断点**:
```
// 在 VS Code: 中设置条件断点:
// 右键点击行号 → "Add Conditional Breakpoint"
config.numWriters > 8 && config.priority === 'HIGH'
```

**日志断点 (不中断执行)**:
```
// VS Code: → Log Message: "Spawn requested: {config.id}, writers={config.numWriters}"
```

#### 3.1.2 日志查看

**日志分级系统**:

| 级别 | 用途 | 输出示例 |
|------|------|---------|
| `FATAL` | 系统崩溃级错误 | 数据库连接断开、内存溢出 |
| `ERROR` | 业务级错误 | Agent 执行失败、API 调用超时 |
| `WARN` | 需要注意但非致命 | 重试次数过多、资源紧张 |
| `INFO` | 重要业务事件 | 工作流启动、阶段完成 |
| `DEBUG` | 开发调试信息 | 函数入参、中间计算结果 |
| `TRACE` | 最细粒度追踪 | SQL 语句、HTTP 请求/响应体 |

**结构化日志格式**:

```json
{
  "timestamp": "2026-05-19T14:32:01.847Z",
  "level": "INFO",
  "service": "agent-writing",
  "traceId": "trace-abc123",
  "spanId": "span-xyz789",
  "agentId": "agent-writer-001",
  "workflowId": "wf-20260519-001",
  "message": "Phase 3 parallel writing completed",
  "metadata": {
    "numDrafts": 8,
    "avgTokenCount": 4520,
    "durationMs": 12450,
    "slowestAgent": "writer-gamma"
  }
}
```

**日志查看命令**:

```bash
# 实时查看日志
tail -f logs/sylva-backend.log | jq '. | select(.level == "ERROR")'

# 按服务过滤
jq '. | select(.service == "agent-writing")' logs/sylva-backend.log

# 按时间范围过滤
jq '. | select(.timestamp > "2026-05-19T10:00:00Z")' logs/sylva-backend.log

# 查看特定工作流
jq '. | select(.workflowId == "wf-20260519-001")' logs/sylva-backend.log

# 使用 Loki (生产环境)
logcli query '{service="agent-writing"} |= "Phase 3"' --from="2026-05-19T10:00:00Z"
```

**日志文件位置**:

```
logs/
├── sylva-backend.log        # 主后端日志
├── sylva-agent.log          # Agent 执行日志
├── sylva-llm.log            # LLM 调用日志
├── sylva-audit.log          # 审核机制日志
├── sylva-access.log         # HTTP 访问日志
└── archive/                 # 按日期归档
    ├── sylva-backend-2026-05-18.log.gz
    └── ...
```

#### 3.1.3 性能分析

```bash
# CPU 火焰图
npm run profile:cpu

# 内存泄漏检测
node --inspect --heapsnapshot-near-heap-limit=3 dist/server.js

# 打开 Chrome DevTools → Memory → Heap Snapshot
# 对比前后快照定位泄漏

# 异步追踪
NODE_OPTIONS='--trace-event-categories node.async_hooks' npm run dev
```

### 3.2 前端调试

#### 3.2.1 React 组件调试

```typescript
// apps/web/src/components/AgentDashboard.tsx
export const AgentDashboard: React.FC<Props> = ({ workflowId }) => {
  const { data, error, isLoading } = useWorkflow(workflowId);
  
  // React DevTools: 检查 hooks 状态
  useEffect(() => {
    console.log("[AgentDashboard] workflow data updated:", data);
    // 在 React DevTools Profiler 中查看渲染原因
  }, [data]);
  
  if (isLoading) return <LoadingSpinner />;
  if (error) {
    // 断点: 查看 error 完整结构
    debugger;
    return <ErrorBoundary error={error} />;
  }
  
  return (
    <div data-testid="agent-dashboard">
      {/* 检查 props 传递 */}
      <AgentList agents={data.agents} />
      <WorkflowTimeline stages={data.stages} />
    </div>
  );
};
```

#### 3.2.2 网络请求调试

**Redux DevTools / TanStack Query DevTools**:
```typescript
// 启用 Query 调试面板
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

function App() {
  return (
    <>
      <Router />
      <ReactQueryDevtools initialIsOpen={false} />
    </>
  );
}
```

**网络拦截与 Mock**:
```typescript
// 开发环境 MSW (Mock Service Worker)
// apps/web/src/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('/api/v1/agents', () => {
    return HttpResponse.json({
      agents: [
        { id: 'agent-001', status: 'running', task: 'writing-phase-3' },
        { id: 'agent-002', status: 'idle', task: null },
      ]
    });
  }),
  
  http.post('/api/v1/workflows', async ({ request }) => {
    const body = await request.json();
    console.log('[MSW] Workflow creation:', body);
    return HttpResponse.json({ id: 'wf-mock-001', status: 'created' });
  }),
];
```

### 3.3 API 测试

#### 3.3.1 curl 命令集合

```bash
# ============================================
# SYLVA API 测试 — curl 命令集合
# ============================================

# --- 认证 ---
# 获取 JWT Token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"dev","password":"dev123"}' | jq -r '.token')

# --- Agent 管理 ---
# 列出所有 Agent
curl http://localhost:3000/api/v1/agents \
  -H "Authorization: Bearer $TOKEN" | jq

# 创建 Agent (Writer)
curl -X POST http://localhost:3000/api/v1/agents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "role": "writer",
    "model": "kimi-k2.5",
    "specialization": "rigorous",
    "maxTokens": 8000,
    "temperature": 0.3
  }' | jq

# 获取 Agent 状态
curl http://localhost:3000/api/v1/agents/agent-001 \
  -H "Authorization: Bearer $TOKEN" | jq

# --- 工作流 ---
# 创建工作流 (论文写作)
curl -X POST http://localhost:3000/api/v1/workflows \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "paper_writing",
    "config": {
      "topic": "基于描述复杂度的计算熵间隙与P≠NP等价性",
      "numWriters": 8,
      "numReviewers": 16,
      "qualityThreshold": 0.75,
      "maxIterations": 5,
      "outputFormat": "markdown"
    }
  }' | jq

# 获取工作流状态
curl http://localhost:3000/api/v1/workflows/wf-20260519-001 \
  -H "Authorization: Bearer $TOKEN" | jq

# 取消工作流
curl -X DELETE http://localhost:3000/api/v1/workflows/wf-20260519-001 \
  -H "Authorization: Bearer $TOKEN"

# --- 审核机制 ---
# 触发审核
curl -X POST http://localhost:3000/api/v1/audit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "电磁波干涉中的能量去向是什么？",
    "initialResponse": "能量在干涉相消处被存储或返回...",
    "triggerConditions": ["dimension_issue", "boundary_fuzzy"]
  }' | jq

# 获取审核报告
curl http://localhost:3000/api/v1/audit/audit-20260519-001/report \
  -H "Authorization: Bearer $TOKEN" | jq

# --- 记忆系统 ---
# 查询记忆
curl "http://localhost:3000/api/v1/memory?query=电磁波干涉&layer=warm&topK=5" \
  -H "Authorization: Bearer $TOKEN" | jq

# 写入记忆
curl -X POST http://localhost:3000/api/v1/memory \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "二维干涉图样中，相消区域的能量转移到副瓣",
    "layer": "warm",
    "tags": ["physics", "interference", "energy-conservation"],
    "source": "audit-20260519-001"
  }'

# --- 流式接口 (WebSocket) ---
# 使用 websocat 测试 WebSocket
echo '{"action": "subscribe", "channel": "workflow:wf-001"}' | \
  websocat ws://localhost:3000/ws \
  -H "Authorization: Bearer $TOKEN"
```

#### 3.3.2 Postman / Thunder Client 集合

**Postman Collection 结构**:

```
Sylva Platform API
├── 📁 Authentication
│   ├── POST /auth/login
│   ├── POST /auth/register
│   └── POST /auth/refresh
├── 📁 Agents
│   ├── GET /agents
│   ├── POST /agents
│   ├── GET /agents/:id
│   ├── DELETE /agents/:id
│   └── POST /agents/:id/signal
├── 📁 Workflows
│   ├── GET /workflows
│   ├── POST /workflows
│   ├── GET /workflows/:id
│   ├── DELETE /workflows/:id
│   └── GET /workflows/:id/stream
├── 📁 Audit
│   ├── POST /audit
│   ├── GET /audit/:id
│   └── GET /audit/:id/report
├── 📁 Memory
│   ├── GET /memory
│   ├── POST /memory
│   └── DELETE /memory/:id
├── 📁 Files
│   ├── POST /files/upload
│   ├── GET /files/:id
│   └── DELETE /files/:id
└── 📁 Admin
    ├── GET /admin/metrics
    ├── GET /admin/health
    └── POST /admin/maintenance
```

**Postman 环境变量**:

```json
{
  "name": "Sylva Local Dev",
  "values": [
    { "key": "baseUrl", "value": "http://localhost:3000", "type": "default" },
    { "key": "apiVersion", "value": "v1", "type": "default" },
    { "key": "token", "value": "", "type": "secret" },
    { "key": "workflowId", "value": "", "type": "default" },
    { "key": "agentId", "value": "", "type": "default" }
  ]
}
```

**Pre-request Script** (自动认证):
```javascript
// 如果 token 过期，自动刷新
pm.sendRequest({
  url: `${pm.environment.get("baseUrl")}/api/${pm.environment.get("apiVersion")}/auth/refresh`,
  method: 'POST',
  header: { 'Authorization': `Bearer ${pm.environment.get("token")}` }
}, function (err, res) {
  if (res.code === 200) {
    pm.environment.set("token", res.json().token);
  }
});
```

#### 3.3.3 自动化 API 测试脚本

```typescript
// tests/api/workflow.api.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createAuthenticatedClient } from './helpers/client';

describe('Workflow API', () => {
  let client;
  let workflowId;

  beforeAll(async () => {
    client = await createAuthenticatedClient();
  });

  it('should create a paper writing workflow', async () => {
    const response = await client.post('/workflows', {
      type: 'paper_writing',
      config: {
        topic: 'Test Topic',
        numWriters: 2,
        qualityThreshold: 0.5
      }
    });

    expect(response.status).toBe(201);
    expect(response.data).toHaveProperty('id');
    expect(response.data.status).toBe('created');
    
    workflowId = response.data.id;
  });

  it('should get workflow status', async () => {
    const response = await client.get(`/workflows/${workflowId}`);
    
    expect(response.status).toBe(200);
    expect(response.data.id).toBe(workflowId);
    expect(response.data).toHaveProperty('phases');
  });

  it('should stream workflow progress', async () => {
    const events = [];
    const stream = await client.stream(`/workflows/${workflowId}/stream`);
    
    for await (const event of stream) {
      events.push(event);
      if (events.length >= 3) break;
    }
    
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toHaveProperty('type');
  });
});
```

---

## 4. 添加新 API 端点

### 4.1 五步流程

```
Step 1: 定义接口契约 (OpenAPI Schema)
    ↓
Step 2: 实现路由处理器 (Route Handler)
    ↓
Step 3: 实现业务逻辑 (Service Layer)
    ↓
Step 4: 编写集成测试 (Integration Test)
    ↓
Step 5: 注册路由与文档 (Registration)
```

#### Step 1: 定义接口契约

```typescript
// packages/backend/src/schemas/agent.schema.ts
import { z } from 'zod';

export const CreateAgentSchema = z.object({
  role: z.enum(['writer', 'reviewer', 'editor', 'fact_checker', 'coordinator']),
  model: z.string().min(1),
  specialization: z.string().optional(),
  maxTokens: z.number().int().min(1000).max(200000).default(8000),
  temperature: z.number().min(0).max(2).default(0.7),
  timeoutSeconds: z.number().int().min(10).max(3600).default(300),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  sandboxConfig: z.object({
    type: z.enum(['process', 'gvisor', 'firecracker']),
    cpuLimit: z.string().optional(),
    memoryLimit: z.string().optional()
  }).optional()
});

export const AgentResponseSchema = z.object({
  id: z.string().uuid(),
  role: z.string(),
  model: z.string(),
  status: z.enum(['pending', 'initializing', 'ready', 'running', 'completed', 'failed', 'terminated']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).optional()
});

export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;
export type AgentResponse = z.infer<typeof AgentResponseSchema>;
```

#### Step 2: 实现路由处理器

```typescript
// packages/backend/src/routes/agent.routes.ts
import { Router } from 'express';
import { validateBody, validateParams } from '../middleware/validation';
import { CreateAgentSchema, AgentIdSchema } from '../schemas/agent.schema';
import { AgentService } from '../services/agent.service';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/async-handler';

const router = Router();
const agentService = new AgentService();

/**
 * POST /api/v1/agents
 * 创建新 Agent 实例
 */
router.post(
  '/',
  authenticate,
  authorize(['agent:spawn']),
  validateBody(CreateAgentSchema),
  asyncHandler(async (req, res) => {
    const agent = await agentService.create(req.body, req.user);
    
    res.status(201).json({
      success: true,
      data: agent,
      meta: {
        requestId: req.id,
        timestamp: new Date().toISOString()
      }
    });
  })
);

/**
 * GET /api/v1/agents/:id
 * 获取 Agent 详情
 */
router.get(
  '/:id',
  authenticate,
  validateParams(AgentIdSchema),
  asyncHandler(async (req, res) => {
    const agent = await agentService.getById(req.params.id);
    
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'AGENT_NOT_FOUND',
          message: `Agent ${req.params.id} not found`
        }
      });
    }
    
    res.json({
      success: true,
      data: agent
    });
  })
);

/**
 * DELETE /api/v1/agents/:id
 * 终止 Agent 实例
 */
router.delete(
  '/:id',
  authenticate,
  authorize(['agent:control']),
  validateParams(AgentIdSchema),
  asyncHandler(async (req, res) => {
    await agentService.terminate(req.params.id, {
      graceful: req.query.graceful !== 'false',
      timeoutMs: parseInt(req.query.timeout) || 30000
    });
    
    res.status(204).send();
  })
);

export default router;
```

#### Step 3: 实现业务逻辑

```typescript
// packages/backend/src/services/agent.service.ts
import { AgentRepository } from '../repositories/agent.repository';
import { LLMRouter } from '../infrastructure/llm.router';
import { SandboxFactory } from '../infrastructure/sandbox.factory';
import { EventBus } from '../infrastructure/event.bus';
import { CreateAgentInput, AgentResponse } from '../schemas/agent.schema';

export class AgentService {
  constructor(
    private repo = new AgentRepository(),
    private llmRouter = new LLMRouter(),
    private sandboxFactory = new SandboxFactory(),
    private eventBus = new EventBus()
  ) {}

  async create(input: CreateAgentInput, user: User): Promise<AgentResponse> {
    // 1. 资源配额检查
    const currentCount = await this.repo.countByUser(user.id);
    if (currentCount >= user.agentQuota) {
      throw new QuotaExceededError(`Agent quota exceeded: ${currentCount}/${user.agentQuota}`);
    }

    // 2. 验证模型可用性
    const modelAvailable = await this.llmRouter.checkAvailability(input.model);
    if (!modelAvailable) {
      throw new ModelUnavailableError(`Model ${input.model} is currently unavailable`);
    }

    // 3. 创建沙箱环境
    const sandbox = this.sandboxFactory.create(input.sandboxConfig || { type: 'process' });
    await sandbox.initialize();

    // 4. 持久化 Agent 记录
    const agent = await this.repo.create({
      ...input,
      userId: user.id,
      status: 'pending',
      sandboxId: sandbox.id
    });

    // 5. 发布创建事件
    await this.eventBus.publish('agent.created', {
      agentId: agent.id,
      userId: user.id,
      role: input.role,
      timestamp: new Date().toISOString()
    });

    // 6. 异步初始化
    this.initializeAgentAsync(agent.id, sandbox);

    return this.mapToResponse(agent);
  }

  private async initializeAgentAsync(agentId: string, sandbox: Sandbox): Promise<void> {
    try {
      await this.repo.updateStatus(agentId, 'initializing');
      
      // 加载 Skill 和上下文
      await sandbox.loadSkills();
      await sandbox.injectContext({
        agentId,
        environment: process.env.NODE_ENV
      });
      
      // 健康检查
      const health = await sandbox.healthCheck();
      if (!health.healthy) {
        throw new AgentInitializationError(health.error);
      }
      
      await this.repo.updateStatus(agentId, 'ready');
      
      await this.eventBus.publish('agent.ready', { agentId });
    } catch (error) {
      await this.repo.updateStatus(agentId, 'failed');
      await this.eventBus.publish('agent.failed', { agentId, error: error.message });
    }
  }

  async getById(id: string): Promise<AgentResponse | null> {
    const agent = await this.repo.findById(id);
    return agent ? this.mapToResponse(agent) : null;
  }

  async terminate(id: string, options: TerminateOptions): Promise<void> {
    const agent = await this.repo.findById(id);
    if (!agent) throw new AgentNotFoundError(id);

    if (options.graceful) {
      await this.sendGracefulShutdownSignal(id, options.timeoutMs);
    }
    
    await this.sandboxFactory.destroy(agent.sandboxId);
    await this.repo.updateStatus(id, 'terminated');
    
    await this.eventBus.publish('agent.terminated', { agentId: id });
  }

  private mapToResponse(agent: AgentEntity): AgentResponse {
    return {
      id: agent.id,
      role: agent.role,
      model: agent.model,
      status: agent.status,
      createdAt: agent.createdAt.toISOString(),
      updatedAt: agent.updatedAt.toISOString(),
      metadata: {
        specialization: agent.specialization,
        sandboxType: agent.sandboxType
      }
    };
  }
}
```

#### Step 4: 编写集成测试

```typescript
// tests/integration/agent.routes.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp } from '../helpers/test-app';
import { createTestUser, generateToken } from '../helpers/auth';

describe('POST /api/v1/agents', () => {
  let app;
  let token;

  beforeAll(async () => {
    app = await createTestApp();
    const user = await createTestUser({ roles: ['agent_operator'] });
    token = generateToken(user);
  });

  afterAll(async () => {
    await app.cleanup();
  });

  it('creates a writer agent successfully', async () => {
    const response = await app.request
      .post('/api/v1/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        role: 'writer',
        model: 'kimi-k2.5',
        specialization: 'rigorous',
        maxTokens: 8000,
        temperature: 0.3
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      role: 'writer',
      model: 'kimi-k2.5',
      status: 'pending'
    });
    expect(response.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns 400 for invalid role', async () => {
    const response = await app.request
      .post('/api/v1/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        role: 'invalid_role',
        model: 'kimi-k2.5'
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 for unauthorized user', async () => {
    const readonlyUser = await createTestUser({ roles: ['readonly'] });
    const readonlyToken = generateToken(readonlyUser);

    const response = await app.request
      .post('/api/v1/agents')
      .set('Authorization', `Bearer ${readonlyToken}`)
      .send({
        role: 'writer',
        model: 'kimi-k2.5'
      });

    expect(response.status).toBe(403);
  });

  it('enforces agent quota', async () => {
    // 创建用户并设置低配额
    const limitedUser = await createTestUser({ 
      roles: ['agent_operator'],
      agentQuota: 2
    });
    const limitedToken = generateToken(limitedUser);

    // 创建 2 个 Agent (达到配额)
    for (let i = 0; i < 2; i++) {
      await app.request
        .post('/api/v1/agents')
        .set('Authorization', `Bearer ${limitedToken}`)
        .send({ role: 'writer', model: 'kimi-k2.5' });
    }

    // 第 3 个应该被拒绝
    const response = await app.request
      .post('/api/v1/agents')
      .set('Authorization', `Bearer ${limitedToken}`)
      .send({ role: 'writer', model: 'kimi-k2.5' });

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('QUOTA_EXCEEDED');
  });
});
```

#### Step 5: 注册路由与文档

```typescript
// packages/backend/src/app.ts
import express from 'express';
import agentRoutes from './routes/agent.routes';
import workflowRoutes from './routes/workflow.routes';
import auditRoutes from './routes/audit.routes';
import memoryRoutes from './routes/memory.routes';

const app = express();

// ... 中间件配置 ...

// API 路由注册
app.use('/api/v1/agents', agentRoutes);
app.use('/api/v1/workflows', workflowRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/memory', memoryRoutes);

// OpenAPI 文档自动注册
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
```

```yaml
# openapi/components/schemas/Agent.yaml
Agent:
  type: object
  required:
    - id
    - role
    - model
    - status
  properties:
    id:
      type: string
      format: uuid
      description: Agent 唯一标识
    role:
      type: string
      enum: [writer, reviewer, editor, fact_checker, coordinator]
      description: Agent 角色
    model:
      type: string
      description: 使用的 LLM 模型
    status:
      type: string
      enum: [pending, initializing, ready, running, completed, failed, terminated]
      description: 当前状态
    createdAt:
      type: string
      format: date-time
    updatedAt:
      type: string
      format: date-time
    metadata:
      type: object
      additionalProperties: true
```

### 4.2 新端点检查清单

```markdown
## 新 API 端点发布检查清单

### 功能完整性
- [ ] Schema 定义完整 (输入校验 + 输出序列化)
- [ ] 路由处理器实现
- [ ] Service 层业务逻辑
- [ ] Repository 数据访问
- [ ] 错误处理 (业务错误 + 系统错误)
- [ ] 事件发布 (创建/更新/删除)

### 安全性
- [ ] 认证中间件
- [ ] 授权检查 (RBAC)
- [ ] 输入校验 (防止注入)
- [ ] 速率限制 (Rate Limiting)
- [ ] 敏感数据脱敏

### 可观测性
- [ ] 结构化日志
- [ ] 分布式追踪 (Trace ID)
- [ ] 性能指标 (延迟、吞吐量)
- [ ] 错误告警

### 测试
- [ ] 单元测试 (Service 层)
- [ ] 集成测试 (API 端点)
- [ ] 错误场景测试
- [ ] 并发安全测试
- [ ] 性能基准测试

### 文档
- [ ] OpenAPI Schema 更新
- [ ] API 变更日志
- [ ] Postman 集合更新
- [ ] 开发者文档更新
```

---

## 5. 添加新前端页面

### 5.1 四步流程

```
Step 1: 定义路由与布局
    ↓
Step 2: 创建页面组件
    ↓
Step 3: 实现数据获取与状态管理
    ↓
Step 4: 添加导航与权限控制
```

#### Step 1: 定义路由与布局

```typescript
// apps/web/src/router/index.tsx
import { createBrowserRouter } from 'react-router-dom';
import { MainLayout } from '../layouts/MainLayout';
import { DashboardPage } from '../pages/Dashboard';
import { WorkflowPage } from '../pages/Workflow';
import { AuditPage } from '../pages/Audit';
import { AgentDetailPage } from '../pages/AgentDetail';  // 新增

export const router = createBrowserRouter([
  {
    path: '/',
    element: <MainLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'workflows', element: <WorkflowPage /> },
      { path: 'workflows/:id', element: <WorkflowDetailPage /> },
      { path: 'audit', element: <AuditPage /> },
      { 
        path: 'agents/:agentId',  // 新增路由
        element: <AgentDetailPage />,
        loader: agentDetailLoader,
        errorElement: <AgentErrorBoundary />
      },
    ]
  },
  {
    path: '/login',
    element: <LoginPage />
  }
]);

// 路由加载器 —— 预取数据
async function agentDetailLoader({ params }) {
  const [agent, metrics] = await Promise.all([
    api.get(`/agents/${params.agentId}`),
    api.get(`/agents/${params.agentId}/metrics`)
  ]);
  return { agent: agent.data, metrics: metrics.data };
}
```

#### Step 2: 创建页面组件

```typescript
// apps/web/src/pages/AgentDetail/index.tsx
import React, { Suspense } from 'react';
import { useLoaderData, useParams } from 'react-router-dom';
import { Card, Tabs, Badge, Timeline } from '../../components/ui';
import { AgentMetricsChart } from './components/AgentMetricsChart';
import { AgentLogsViewer } from './components/AgentLogsViewer';
import { AgentTaskHistory } from './components/AgentTaskHistory';
import { useAgentRealtime } from '../../hooks/useAgentRealtime';
import './AgentDetail.css';

export const AgentDetailPage: React.FC = () => {
  const { agentId } = useParams();
  const initialData = useLoaderData() as AgentDetailLoaderData;
  
  // 实时状态订阅 (WebSocket)
  const { agent, isConnected } = useAgentRealtime(agentId, initialData.agent);
  
  const statusColor = {
    pending: 'gray',
    initializing: 'blue',
    ready: 'green',
    running: 'orange',
    completed: 'green',
    failed: 'red',
    terminated: 'gray'
  }[agent.status];

  return (
    <div className="agent-detail-page">
      {/* 页面头部 */}
      <header className="page-header">
        <div className="header-left">
          <h1>Agent {agent.id}</h1>
          <Badge color={statusColor}>
            {agent.status}
            {isConnected && <span className="live-indicator">●</span>}
          </Badge>
        </div>
        <div className="header-actions">
          <button onClick={handlePause} disabled={agent.status !== 'running'}>
            暂停
          </button>
          <button onClick={handleResume} disabled={agent.status !== 'paused'}>
            恢复
          </button>
          <button onClick={handleTerminate} className="danger">
            终止
          </button>
        </div>
      </header>

      {/* 概览卡片 */}
      <div className="overview-grid">
        <Card title="基本信息">
          <dl>
            <dt>角色</dt><dd>{agent.role}</dd>
            <dt>模型</dt><dd>{agent.model}</dd>
            <dt>专长</dt><dd>{agent.specialization || '无'}</dd>
            <dt>创建时间</dt><dd>{formatDate(agent.createdAt)}</dd>
          </dl>
        </Card>
        
        <Card title="资源使用">
          <AgentMetricsChart metrics={initialData.metrics} />
        </Card>
        
        <Card title="当前任务">
          <AgentCurrentTask agent={agent} />
        </Card>
      </div>

      {/* 详细标签页 */}
      <Tabs defaultActiveKey="logs">
        <Tabs.TabPane tab="执行日志" key="logs">
          <Suspense fallback={<LogsSkeleton />}>
            <AgentLogsViewer agentId={agentId} />
          </Suspense>
        </Tabs.TabPane>
        <Tabs.TabPane tab="任务历史" key="history">
          <AgentTaskHistory agentId={agentId} />
        </Tabs.TabPane>
        <Tabs.TabPane tab="配置详情" key="config">
          <AgentConfigView config={agent.config} />
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
};
```

#### Step 3: 数据获取与状态管理

```typescript
// apps/web/src/hooks/useAgentRealtime.ts
import { useEffect, useState, useCallback } from 'react';
import { useWebSocket } from './useWebSocket';

export function useAgentRealtime(agentId: string, initialAgent: Agent) {
  const [agent, setAgent] = useState(initialAgent);
  const { lastMessage, isConnected } = useWebSocket(`ws://api/agents/${agentId}/stream`);

  useEffect(() => {
    if (!lastMessage) return;
    
    const event = JSON.parse(lastMessage.data);
    
    switch (event.type) {
      case 'status_change':
        setAgent(prev => ({ ...prev, status: event.payload.status }));
        break;
      case 'metrics_update':
        setAgent(prev => ({ 
          ...prev, 
          metrics: { ...prev.metrics, ...event.payload }
        }));
        break;
      case 'task_complete':
        setAgent(prev => ({
          ...prev,
          completedTasks: [...prev.completedTasks, event.payload.task]
        }));
        break;
    }
  }, [lastMessage]);

  const sendSignal = useCallback((signal: AgentSignal) => {
    // 通过 API 发送控制信号
  }, [agentId]);

  return { agent, isConnected, sendSignal };
}
```

#### Step 4: 添加导航与权限控制

```typescript
// apps/web/src/components/Navigation/Sidebar.tsx
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

const navigationItems = [
  { path: '/', label: '仪表盘', icon: 'Dashboard', requiredRole: null },
  { path: '/workflows', label: '工作流', icon: 'Workflow', requiredRole: 'researcher' },
  { path: '/audit', label: '审核中心', icon: 'Audit', requiredRole: 'reviewer' },
  { path: '/agents', label: 'Agent 管理', icon: 'Robot', requiredRole: 'agent_operator' },
  { path: '/admin', label: '系统管理', icon: 'Settings', requiredRole: 'admin' },
];

export const Sidebar: React.FC = () => {
  const { user, hasRole } = useAuth();
  
  const visibleItems = navigationItems.filter(item => 
    !item.requiredRole || hasRole(item.requiredRole)
  );

  return (
    <nav className="sidebar">
      {visibleItems.map(item => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) => 
            `nav-item ${isActive ? 'active' : ''}`
          }
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
};
```

### 5.2 前端页面检查清单

```markdown
## 新前端页面发布检查清单

### 功能
- [ ] 路由配置正确
- [ ] 页面组件实现
- [ ] 数据获取逻辑
- [ ] 错误边界处理
- [ ] 加载状态处理
- [ ] 空状态处理
- [ ] 响应式布局

### 交互
- [ ] 用户操作反馈 (Toast / Notification)
- [ ] 表单校验与错误提示
- [ ] 确认对话框 (危险操作)
- [ ] 键盘快捷键
- [ ] 无障碍支持 (ARIA)

### 性能
- [ ] 代码分割 (lazy loading)
- [ ] 图片优化
- [ ] 避免不必要重渲染 (React.memo)
- [ ] 虚拟列表 (大数据量)

### 测试
- [ ] 组件单元测试
- [ ] 交互测试 (用户事件)
- [ ] 视觉回归测试 (截图对比)
- [ ] 响应式测试
```

---

## 6. 测试编写规范

### 6.1 测试目录结构

```
tests/
├── unit/                          # 单元测试
│   ├── services/
│   │   ├── agent.service.test.ts
│   │   └── workflow.service.test.ts
│   ├── utils/
│   │   ├── text-processor.test.ts
│   │   └── scoring-engine.test.ts
│   └── infrastructure/
│       ├── llm-router.test.ts
│       └── memory-tier.test.ts
├── integration/                   # 集成测试
│   ├── api/
│   │   ├── agent.routes.test.ts
│   │   └── workflow.routes.test.ts
│   └── database/
│       └── agent.repository.test.ts
├── e2e/                          # E2E 测试
│   ├── workflow-creation.spec.ts
│   └── agent-lifecycle.spec.ts
└── fixtures/                     # 测试数据
    ├── agents.ts
    ├── workflows.ts
    └── users.ts
```

### 6.2 Jest / Vitest 配置

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      },
      exclude: [
        'node_modules/**',
        'tests/**',
        '**/*.d.ts',
        '**/index.ts',
        '**/*.config.*'
      ]
    },
    
    setupFiles: ['./tests/setup.ts'],
    
    // 并行执行
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false
      }
    },
    
    // 测试超时
    testTimeout: 30000,
    hookTimeout: 30000
  }
});
```

```typescript
// tests/setup.ts
import { beforeAll, afterAll, afterEach } from 'vitest';
import { setupTestDatabase } from './helpers/database';
import { mockExternalServices } from './helpers/mocks';

// 全局测试前置
beforeAll(async () => {
  await setupTestDatabase();
  mockExternalServices();
});

// 每个测试后清理
afterEach(async () => {
  // 清理数据库状态
  await clearTestData();
  // 重置 mock
  vi.restoreAllMocks();
});

// 测试套件结束后
afterAll(async () => {
  await teardownTestDatabase();
});
```

### 6.3 单元测试示例

```typescript
// tests/unit/services/scoring-engine.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScoringEngine } from '../../../src/services/scoring.engine';

describe('ScoringEngine', () => {
  let engine: ScoringEngine;
  
  beforeEach(() => {
    engine = new ScoringEngine({
      dimensions: {
        innovation: { weight: 0.25 },
        rigor: { weight: 0.30 },
        readability: { weight: 0.20 },
        completeness: { weight: 0.25 }
      }
    });
  });

  describe('evaluate', () => {
    it('returns overall score weighted by dimension', async () => {
      const draft = createMockDraft({
        innovation: 0.8,
        rigor: 0.9,
        readability: 0.7,
        completeness: 0.85
      });
      
      const result = await engine.evaluate(draft);
      
      // 期望: 0.8*0.25 + 0.9*0.30 + 0.7*0.20 + 0.85*0.25 = 0.8325
      expect(result.overall).toBeCloseTo(0.8325, 4);
    });

    it('marks draft as acceptable when overall >= 0.75', async () => {
      const draft = createMockDraft({ overall: 0.8 });
      
      const result = await engine.evaluate(draft);
      
      expect(result.verdict).toBe('ACCEPT');
    });

    it('requires revision when overall between 0.5 and 0.75', async () => {
      const draft = createMockDraft({ overall: 0.6 });
      
      const result = await engine.evaluate(draft);
      
      expect(result.verdict).toBe('REVISE');
      expect(result.feedback).toBeDefined();
    });

    it('rejects draft when overall < 0.5', async () => {
      const draft = createMockDraft({ overall: 0.3 });
      
      const result = await engine.evaluate(draft);
      
      expect(result.verdict).toBe('REJECT');
    });
  });

  describe('aggregateScores', () => {
    it('removes outlier scores when evaluator count > 3', () => {
      const scores = [0.3, 0.8, 0.82, 0.85, 0.9];
      
      const result = engine.aggregateScores(scores);
      
      // 去掉 0.3 和 0.9，剩余 [0.8, 0.82, 0.85]
      expect(result).toBeCloseTo((0.8 + 0.82 + 0.85) / 3, 4);
    });

    it('keeps all scores when evaluator count <= 3', () => {
      const scores = [0.7, 0.8, 0.9];
      
      const result = engine.aggregateScores(scores);
      
      expect(result).toBeCloseTo(0.8, 2);
    });

    it('handles tied scores gracefully', () => {
      const scores = [0.5, 0.5, 0.5, 0.5];
      
      const result = engine.aggregateScores(scores);
      
      expect(result).toBe(0.5);
    });
  });

  describe('edge cases', () => {
    it('throws when dimension weights do not sum to 1', () => {
      expect(() => new ScoringEngine({
        dimensions: { a: { weight: 0.5 }, b: { weight: 0.3 } }
      })).toThrow('Dimension weights must sum to 1');
    });

    it('handles empty evaluator list', () => {
      expect(() => engine.aggregateScores([])).toThrow('Cannot aggregate empty scores');
    });

    it('handles NaN in dimension scores', async () => {
      const draft = createMockDraft({ innovation: NaN });
      
      await expect(engine.evaluate(draft)).rejects.toThrow('Invalid score value');
    });
  });
});
```

### 6.4 测试数据工厂

```typescript
// tests/fixtures/factories.ts
import { faker } from '@faker-js/faker';

export function createMockDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: faker.string.uuid(),
    title: faker.lorem.sentence(),
    content: faker.lorem.paragraphs(5),
    author: faker.string.uuid(),
    status: 'draft',
    createdAt: faker.date.recent(),
    scores: {
      innovation: faker.number.float({ min: 0, max: 1, precision: 0.01 }),
      rigor: faker.number.float({ min: 0, max: 1, precision: 0.01 }),
      readability: faker.number.float({ min: 0, max: 1, precision: 0.01 }),
      completeness: faker.number.float({ min: 0, max: 1, precision: 0.01 })
    },
    ...overrides
  };
}

export function createMockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: faker.string.uuid(),
    role: faker.helpers.arrayElement(['writer', 'reviewer', 'editor']),
    model: faker.helpers.arrayElement(['kimi-k2.5', 'kimi-k2.6', 'gpt-4o']),
    status: faker.helpers.arrayElement(['ready', 'running', 'completed']),
    ...overrides
  };
}

export function createMockWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: `wf-${faker.date.recent().toISOString().slice(0,10).replace(/-/g,'')}-${faker.string.alphanumeric(3)}`,
    type: 'paper_writing',
    status: faker.helpers.arrayElement(['created', 'running', 'completed', 'failed']),
    config: {
      topic: faker.lorem.sentence(),
      numWriters: faker.number.int({ min: 2, max: 16 }),
      qualityThreshold: 0.75
    },
    ...overrides
  };
}
```

### 6.5 Mock 策略

```typescript
// tests/helpers/mocks.ts
import { vi } from 'vitest';

export function mockLLMService() {
  vi.mock('../../src/infrastructure/llm.service', () => ({
    LLMService: vi.fn().mockImplementation(() => ({
      generate: vi.fn().mockResolvedValue({
        text: 'Mocked LLM response',
        usage: { promptTokens: 100, completionTokens: 200 }
      }),
      stream: vi.fn().mockImplementation(async function* () {
        yield { text: 'Chunk 1', done: false };
        yield { text: 'Chunk 2', done: false };
        yield { text: 'Final', done: true };
      })
    }))
  }));
}

export function mockDatabase() {
  vi.mock('../../src/repositories', () => ({
    AgentRepository: vi.fn().mockImplementation(() => ({
      create: vi.fn().mockImplementation(data => Promise.resolve({ ...data, id: 'mock-id' })),
      findById: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true)
    }))
  }));
}
```

---

## 7. 代码风格配置

### 7.1 ESLint 配置

```javascript
// eslint.config.js (Flat Config)
import js from '@eslint/js';
import ts from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  ...ts.configs.strictTypeChecked,
  prettier,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json'
      }
    },
    plugins: {
      import: importPlugin
    },
    rules: {
      // TypeScript 严格规则
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      
      // Import 排序
      'import/order': ['error', {
        groups: [
          'builtin',
          'external',
          'internal',
          'parent',
          'sibling',
          'index'
        ],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true }
      }],
      'import/no-duplicates': 'error',
      'import/no-unresolved': 'error',
      
      // 通用代码质量
      'no-console': ['warn', { allow: ['error', 'warn', 'debug'] }],
      'no-debugger': 'warn',
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always'],
      'curly': ['error', 'all'],
      
      // 命名规范
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'interface',
          format: ['PascalCase'],
          prefix: ['I']
        },
        {
          selector: 'typeAlias',
          format: ['PascalCase']
        },
        {
          selector: 'class',
          format: ['PascalCase']
        },
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase']
        },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE'],
          leadingUnderscore: 'allow'
        }
      ]
    }
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  }
];
```

### 7.2 Prettier 配置

```json
// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "useTabs": false,
  "printWidth": 100,
  "trailingComma": "es5",
  "bracketSpacing": true,
  "arrowParens": "always",
  "endOfLine": "lf",
  "quoteProps": "as-needed",
  "jsxSingleQuote": false,
  "overrides": [
    {
      "files": "*.md",
      "options": {
        "proseWrap": "always",
        "printWidth": 80
      }
    },
    {
      "files": "*.json",
      "options": {
        "tabWidth": 2
      }
    },
    {
      "files": "*.yaml",
      "options": {
        "tabWidth": 2,
        "singleQuote": false
      }
    }
  ]
}
```

### 7.3 TypeScript 严格配置

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    
    // 严格类型检查
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    
    // 额外检查
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    
    // 模块与解析
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    
    // 实验性功能
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 7.4 代码风格检查清单

```markdown
## 代码风格自查清单 (提交前)

### TypeScript
- [ ] 无 `any` 类型 (除非在测试文件)
- [ ] 所有函数有显式返回类型声明
- [ ] 使用 `===` 而非 `==`
- [ ] 使用 `??` 而非 `||` 进行空值合并
- [ ] 使用 `?.` 可选链而非深层守卫
- [ ] 接口名使用 PascalCase + I 前缀
- [ ] 枚举名使用 PascalCase

### 命名
- [ ] 类名: PascalCase
- [ ] 函数/方法: camelCase
- [ ] 常量: UPPER_SNAKE_CASE
- [ ] 私有属性: _leadingUnderscore
- [ ] 布尔变量: is/has/should/can 前缀
- [ ] 文件路径与导入使用 kebab-case

### 文档
- [ ] 公共 API 有 JSDoc 注释
- [ ] 复杂算法有 inline 注释说明
- [ ] TODO/FIXME 标记有 issue 编号
- [ ] 类型定义文件同步更新

### 性能
- [ ] 无未使用的 import
- [ ] 无 console.log (生产代码)
- [ ] 避免深层嵌套 (最大 4 层)
- [ ] 循环中使用常量缓存
```

---

## 8. Git 提交规范

### 8.1 Conventional Commits

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**类型定义**:

| Type | 用途 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(agent): 添加 Agent 实时指标推送` |
| `fix` | Bug 修复 | `fix(workflow): 修复并行写作时的竞态条件` |
| `docs` | 文档更新 | `docs(api): 更新 OpenAPI Schema 描述` |
| `style` | 代码风格 (无功能变更) | `style(frontend): 统一组件命名规范` |
| `refactor` | 重构 | `refactor(llm): 重构路由算法为策略模式` |
| `perf` | 性能优化 | `perf(memory): 优化 HOT 层查询缓存` |
| `test` | 测试相关 | `test(audit): 添加 L4 创新重构测试用例` |
| `chore` | 构建/工具链 | `chore(deps): 升级 TypeScript 至 5.4` |
| `ci` | CI/CD | `ci: 添加性能基准测试流水线` |
| `revert` | 回滚 | `revert: 撤销 feat(agent) 实时推送` |

**Scope 定义**:

| Scope | 范围 |
|-------|------|
| `agent` | Agent 运行时相关 |
| `workflow` | 工作流引擎 |
| `writing` | 写作系统 |
| `audit` | 审核-创新机制 |
| `memory` | 记忆系统 |
| `llm` | LLM 适配器 |
| `api` | REST/WebSocket API |
| `frontend` | Web 前端 |
| `infra` | 基础设施 |
| `security` | 安全相关 |
| `deps` | 依赖更新 |

**完整示例**:

```
feat(audit): 实现 L3 跨域关联引擎

- 添加 DomainMapper 类用于领域间映射
- 实现 AnalogyConstructor 类比构造器
- 集成 ConceptNet 和领域知识图谱
- 添加 12 个跨域关联测试用例

BREAKING CHANGE: AuditResult 接口新增 `crossDomainInsights` 字段
Closes #234
Refs #156
```

### 8.2 提交前检查脚本

```bash
#!/bin/bash
# .git/hooks/pre-commit (或 husky)

# 1. 代码风格检查
echo "Running ESLint..."
npx eslint . --ext .ts,.tsx --max-warnings=0 || exit 1

# 2. 格式化检查
echo "Running Prettier..."
npx prettier --check "src/**/*.{ts,tsx,json,md}" || exit 1

# 3. TypeScript 类型检查
echo "Running TypeScript compiler..."
npx tsc --noEmit || exit 1

# 4. 单元测试
echo "Running unit tests..."
npm run test:unit -- --run || exit 1

# 5. 提交信息格式检查
echo "Validating commit message..."
commit_msg=$(cat "$1")
if ! echo "$commit_msg" | grep -qE '^(feat|fix|docs|style|refactor|perf|test|chore|ci|revert)(\([a-z-]+\))?: .{1,100}$'; then
  echo "Error: Commit message does not follow Conventional Commits format"
  echo "Expected: <type>(<scope>): <description>"
  exit 1
fi

echo "All checks passed!"
```

### 8.3 分支策略

```mermaid
graph LR
    A[main] --> B[develop]
    B --> C[feature/agent-metrics]
    B --> D[feature/audit-l3]
    B --> E[fix/workflow-race]
    C --> B
    D --> B
    E --> B
    B --> F[release/v1.2.0]
    F --> A
    A --> G[hotfix/security-patch]
    G --> A
    G --> B
```

**分支命名规范**:

| 分支类型 | 命名格式 | 示例 |
|----------|---------|------|
| Feature | `feature/<scope>-<description>` | `feature/agent-realtime-metrics` |
| Bug Fix | `fix/<scope>-<description>` | `fix/workflow-concurrency-bug` |
| Hotfix | `hotfix/<description>` | `hotfix/jwt-verification-bypass` |
| Release | `release/v<version>` | `release/v1.2.0` |
| Documentation | `docs/<description>` | `docs/api-authentication` |
| Refactor | `refactor/<scope>-<description>` | `refactor/llm-router-strategy` |

---

## 9. PR 模板与审查流程

### 9.1 PR 模板

```markdown
<!-- .github/pull_request_template.md -->

## 变更概述

<!-- 用一句话概括这次 PR 做了什么 -->

## 变更类型

- [ ] feat: 新功能
- [ ] fix: Bug 修复
- [ ] docs: 文档更新
- [ ] style: 代码风格调整
- [ ] refactor: 重构
- [ ] perf: 性能优化
- [ ] test: 测试相关
- [ ] chore: 构建/工具链

## 关联 Issue

<!-- 使用关键字自动关闭 issue: Closes #123, Fixes #456, Resolves #789 -->

## 变更详情

### 主要变更
1. 
2. 
3. 

### 技术决策
<!-- 如果有架构或技术选择，说明原因 -->

### 破坏性变更
<!-- 如果有 BREAKING CHANGE，列出影响及迁移指南 -->

## 测试

- [ ] 单元测试通过
- [ ] 集成测试通过
- [ ] 手动测试验证
- [ ] 性能基准对比

## 检查清单

- [ ] 代码遵循项目风格规范
- [ ] 新增代码有适当注释和文档
- [ ] 无未使用的 import 或变量
- [ ] 无 console.log / debugger (生产代码)
- [ ] 错误处理完善
- [ ] 安全性考虑 (输入校验、权限检查)
- [ ] 向后兼容性 (如适用)

## 审查者关注

<!-- 提醒审查者特别关注的部分 -->
```

### 9.2 PR 审查检查清单

```markdown
## 审查者检查清单

### 功能性
- [ ] 变更与 PR 描述一致
- [ ] 边界条件处理正确
- [ ] 错误场景有适当处理
- [ ] 并发安全性 (如适用)

### 代码质量
- [ ] 命名清晰、表意准确
- [ ] 函数职责单一
- [ ] 无重复代码 (DRY)
- [ ] 复杂度合理 (圈复杂度 < 15)
- [ ] 适当的抽象层级

### 测试
- [ ] 新功能有对应测试
- [ ] 测试覆盖边界情况
- [ ] 测试名称描述清晰
- [ ] 无脆弱测试 (flaky tests)

### 安全性
- [ ] 无注入漏洞 (SQL/NoSQL/Command)
- [ ] 输入校验充分
- [ ] 权限检查到位
- [ ] 敏感数据未泄露

### 性能
- [ ] 无 N+1 查询
- [ ] 大数据量处理考虑分页
- [ ] 缓存策略合理
- [ ] 异步操作无阻塞

### 文档
- [ ] API 文档更新 (OpenAPI)
- [ ] README 更新 (如需要)
- [ ] 变更日志更新 (CHANGELOG.md)
```

### 9.3 审查流程

```mermaid
sequenceDiagram
    participant Author as PR 作者
    participant CI as CI Pipeline
    participant Reviewer1 as 审查者 A
    participant Reviewer2 as 审查者 B
    participant Maintainer as 维护者

    Author->>CI: 推送 PR
    CI->>CI: 运行检查 (lint/test/build)
    CI-->>Author: 检查结果

    alt CI 失败
        Author->>Author: 修复问题
        Author->>CI: 更新 PR
    else CI 通过
        Author->>Reviewer1: 请求审查
        Author->>Reviewer2: 请求审查
        
        Reviewer1->>Reviewer1: 代码审查
        Reviewer2->>Reviewer2: 代码审查
        
        Reviewer1-->>Author: 提出意见
        Reviewer2-->>Author: 提出意见
        
        Author->>Author: 修改代码
        Author->>Reviewer1: 回复审查意见
        Author->>Reviewer2: 回复审查意见
        
        Reviewer1-->>Author: Approve
        Reviewer2-->>Author: Approve
        
        Author->>Maintainer: 请求合并
        Maintainer->>Maintainer: 最终检查
        Maintainer-->>Author: Merge / 请求补充
    end
```

---

## 10. 常见问题与排错

### 10.1 环境配置问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| `node-gyp rebuild` 失败 | 缺少 Python / C++ 构建工具 | Windows: 安装 `windows-build-tools`; macOS: `xcode-select --install` |
| `PORT 3000 already in use` | 端口被占用 | `lsof -i :3000` 找到进程并 kill，或修改 `.env.local` |
| 数据库连接超时 | PostgreSQL 未启动 | `npm run db:start` 或检查 `docker ps` |
| Redis 连接拒绝 | Redis 未启动 | `redis-server` 或 `docker-compose up redis` |
| 权限错误 (EACCES) | npm 全局目录权限 | `sudo chown -R $(whoami) ~/.npm` |
| Lean 4  lake build 失败 | elan 工具链问题 | `elan self update && elan toolchain install stable` |

### 10.2 运行时问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| Agent 启动后立刻失败 | 沙箱初始化错误 | 检查 sandbox type 配置; 查看 `sylva-agent.log` |
| LLM 请求超时 | 后端服务不可用 | 检查 LLM 服务状态; 查看 Circuit Breaker 是否熔断 |
| 内存泄漏 | 事件监听器未清理 | 检查 `removeEventListener` / `off()` 调用 |
| WebSocket 断开 | 代理/防火墙拦截 | 检查 Nginx 配置 `proxy_read_timeout` |
| 工作流卡住 | 阶段转换逻辑错误 | 检查 WorkflowStateMachine 状态定义 |
| 审核结果不一致 | 并发修改 | 添加分布式锁或乐观锁 |

### 10.3 调试技巧

```bash
# 快速查看最近错误
npm run logs -- --level=ERROR --lines=50

# 追踪特定工作流
npm run logs -- --workflow=wf-20260519-001 --follow

# 性能火焰图
npm run profile:cpu -- --duration=60

# 数据库查询分析
npm run db:analyze -- --slow-queries --threshold=100ms

# Agent 执行追踪
npm run trace -- --agent=agent-001 --output=trace.html

# 内存快照对比
npm run profile:memory -- --baseline=baseline.heapsnapshot --compare=current.heapsnapshot
```

---

> **"好的代码是写给人看的，只是顺便能在机器上运行。"**  
> —— Harold Abelson (SICP)

> **"SYLVA 的代码规范不是为了约束创造力，而是为了在 3 AM 的调试中救你一命。"**  
> —— SYLVA Software Line Architect
