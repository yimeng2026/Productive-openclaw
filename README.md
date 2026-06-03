# Productive OpenClaw 🚀

> **OpenClaw 扩展架构与优化补丁系统**
> SRIA递归推理引擎 + SMIM多Agent基础设施 + 多Provider统一适配层

## 快速开始（5分钟）

### 方式一：作为 OpenClaw 扩展安装（推荐）

```bash
git clone git@github.com:yimeng2026/Productive-openclaw.git
cd Productive-openclaw
bash patches/install.sh
```

### 方式二：独立运行

```bash
# 1. 安装依赖
bash scripts/setup.sh

# 2. 开发模式启动
npm run dev
```

## 架构概览

```
┌─────────────────────────────────────────────────┐
│          Productive OpenClaw v2.0                │
├─────────────────────────────────────────────────┤
│  Patches Layer     │  自动补丁应用到 OpenClaw    │
├─────────────────────────────────────────────────┤
│  Platform Core     │  TypeScript 后端服务引擎     │
│  (Node.js/Express) │  · Ollama 桥接             │
│                    │  · 多Provider统一API        │
│                    │  · Claude编排Ollama         │
│                    │  · 3DACP协调器协议          │
│                    │  · Hermes记忆引擎           │
├─────────────────────────────────────────────────┤
│  SRIA-SMIM Engine  │  Python 核心推理引擎        │
│  (Python 3.9+)     │  · 硬件自适应检测           │
│                    │  · 意图分类与模型路由        │
│                    │  · Agent集群并行执行         │
│                    │  · SQLite监控与诊断          │
├─────────────────────────────────────────────────┤
│  OpenClaw Core     │  基础 OpenClaw 实例         │
└─────────────────────────────────────────────────┘
```

## 核心特性

### 🔥 OpenClaw 运行时优化

- 上下文硬截断机制（70%主动刷新）
- Agent完成事件批量处理
- 状态持久化到文件
- 记忆压缩（HOT→WARM→COOL→COLD四级）
- 离散时间采样

### 🦙 Ollama 桥接与多Provider适配

- 支持 10+ Provider：Claude / OpenAI / Kimi / Gemini / DeepSeek / OpenRouter / Hermes
- 自动Provider检测（根据API Key前缀）
- Claude编排Ollama（大脑+手脚模式）

### 🧠 SRIA 递归推理引擎

- 硬件自适应配置（Minimal/Balanced/Performance）
- 意图分类（数学/物理/代码/创意/分析）
- 动态模型路由
- 多Agent并行执行

### 🏛️ 3DACP 协调器协议

- AxisRouter 消息路由
- AxisRegistry 服务注册
- 蜂群协调框架

### 📚 Hermes 记忆引擎

- MemoryScanner 记忆扫描
- MemoryFossilizer 防遗忘
- CodeGrowth 代码自动生长
- KnowledgeGraph 知识图谱

## API 端点

### Ollama 桥接

- `GET /api/ollama/models` — 列出本地模型
- `POST /api/ollama/generate` — 文本生成
- `POST /api/ollama/chat` — 对话

### 统一多Provider

- `POST /api/unified/chat` — 统一对话接口
- `POST /api/unified/orchestrate` — Claude编排Ollama
- `GET /api/unified/providers` — 列出支持的Provider

## 项目结构

```
Productive-openclaw/
├── README.md                 # 本文件
├── ARCHITECTURE.md           # 总体架构文档
├── CHANGELOG.md              # 版本历史
├── patches/                  # OpenClaw 补丁层
│   └── install.sh            # 自动安装脚本
├── platform-core/            # Platform Core (TypeScript)
│   ├── server.ts             # 入口服务器
│   ├── core/                 # 后端引擎核心
│   │   ├── routes/           # API 路由层
│   │   ├── services/         # 业务逻辑层
│   │   ├── gateway/          # 统一适配器层
│   │   ├── coordinator/      # 六轴消息总线
│   │   ├── hermes/           # Hermes 记忆引擎
│   │   └── swarm/            # 蜂群协调系统
│   └── docs/                 # 架构文档
├── sria-smim/                # SRIA-SMIM 引擎 (Python)
│   └── SRIA_SMIM_Final.py    # 核心推理引擎
└── docs/                     # 统一文档中心
    ├── architecture/
    │   ├── overview.md       # 总体架构
    │   ├── sria-smim.md      # SRIA-SMIM引擎
    │   └── platform-core.md  # Platform Core
    ├── 3dacp/
    │   └── protocol.md       # 3DACP协议
    └── openclaw-opt/
        └── optimization.md   # OpenClaw优化方案
```

## 文档

- [总体架构](ARCHITECTURE.md)
- [SRIA-SMIM引擎文档](docs/architecture/sria-smim.md)
- [Platform Core文档](docs/architecture/platform-core.md)
- [3DACP协议](docs/3dacp/protocol.md)
- [OpenClaw优化方案](docs/openclaw-opt/optimization.md)

## 版本历史

参见 [CHANGELOG.md](CHANGELOG.md)

## License

MIT
