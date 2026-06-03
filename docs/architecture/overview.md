# Productive OpenClaw — 架构总览

> **版本**: 2.0.0 | **日期**: 2026-06-03

---

## 1. 架构概览

Productive OpenClaw 是 OpenClaw 的扩展架构与优化补丁系统，整合了 **SRIA 递归推理引擎**（Python）、**SMIM 多Agent基础设施**、**Platform Core TypeScript 后端**以及 **OpenClaw 运行时补丁**，构建为一个完整的本地 AI 生产力平台。

### 1.1 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                  Productive OpenClaw v2.0                     │
├──────────────────────────────────────────────────────────────┤
│  Patches Layer     │  自动补丁应用到 OpenClaw                │
├──────────────────────────────────────────────────────────────┤
│  Platform Core     │  TypeScript 后端服务引擎                 │
│  (Node.js/Express) │  · Ollama 桥接                         │
│                    │  · 多Provider统一API                    │
│                    │  · Claude编排Ollama                     │
│                    │  · 3DACP协调器协议                      │
│                    │  · Hermes记忆引擎                       │
├──────────────────────────────────────────────────────────────┤
│  SRIA-SMIM Engine  │  Python 核心推理引擎                    │
│  (Python 3.9+)     │  · 硬件自适应检测                       │
│                    │  · 意图分类与模型路由                    │
│                    │  · Agent集群并行执行                     │
│                    │  · SQLite监控与诊断                     │
├──────────────────────────────────────────────────────────────┤
│  OpenClaw Core     │  基础 OpenClaw 实例                     │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 核心设计理念

1. **分层解耦**: Patches / Platform Core / SRIA-SMIM / OpenClaw Core 四层独立演进
2. **统一适配**: 10+ Provider 统一接口，自动检测与路由
3. **硬件自适应**: 根据硬件配置自动选择最优运行模式
4. **记忆持久化**: 四级记忆压缩 + Hermes记忆引擎，防止信息遗忘
5. **协同优化**: 上下文截断 + 事件批量 + 状态持久化 + Ollama监测 + 记忆压缩 + 离散采样 + 图维护，七大优化协同工作

---

## 2. 模块架构

### 2.1 SRIA-SMIM Python引擎模块

```
SRIA_SMIM_Final.py
├── 自动安装器 (AutoInstaller)
│   ├── 检测 Python 版本
│   ├── 安装 pip 依赖
│   ├── 检测 Ollama 安装
│   └── 下载默认模型
│
├── 硬件探测器 (HardwareDetector)
│   ├── CPU 核心数/频率
│   ├── RAM 总量/可用
│   ├── GPU 检测 (CUDA/ROCm/Metal)
│   └── 磁盘空间
│
├── 配置管理器 (ConfigManager)
│   ├── minimal 配置
│   ├── balanced 配置
│   ├── performance 配置
│   └── 自定义配置
│
├── 模型路由器 (ModelRouter)
│   ├── 快速模型 (Qwen2.5-1.5B/3B)
│   ├── 平衡模型 (Qwen2.5-7B)
│   ├── 深度模型 (DeepSeek-R1-14B)
│   └── 云端回退 (Kimi API)
│
├── 意图分类器 (IntentClassifier)
│   ├── trivial (问候/简单问答)
│   ├── standard (一般任务)
│   ├── coding (代码生成)
│   ├── math (数学推理)
│   ├── physics (物理推导)
│   └── deep (深度研究)
│
├── Agent 集群 (AgentCluster)
│   ├── 任务分发器
│   ├── 并行执行器
│   ├── 结果聚合器
│   └── 负载均衡器
│
├── 监控器 (Monitor)
│   ├── SQLite 数据库
│   ├── 性能统计
│   ├── 错误追踪
│   └── 健康检查
│
└── CLI 界面 (RichInterface)
    ├── 彩色输出
    ├── 进度条
    ├── 状态面板
    └── 交互提示
```

### 2.2 Platform Core 后端模块

```
platform-core/
├── server.ts                    # 入口服务器
├── app.ts                       # Express 应用配置
├── core/
│   ├── routes/                  # API 路由层
│   │   ├── ollama.ts            # Ollama 桥接路由
│   │   └── unified.ts           # 统一 Provider 路由
│   ├── services/                # 业务逻辑层
│   │   ├── UnifiedAPIClient.ts  # 统一 API 客户端
│   │   ├── AutoConfigEngine.ts  # 自动配置引擎
│   │   └── OllamaOrchestrator.ts # Claude编排Ollama
│   ├── coordinator/             # 3DACP 协调器
│   │   ├── AxisRouter.ts        # 消息路由
│   │   ├── AxisRegistry.ts      # 服务注册（50节点）
│   │   ├── AxisMessage.ts       # 消息格式
│   │   └── ProtocolAdapter/     # 协议适配器
│   ├── gateway/                 # 统一适配器层
│   ├── middleware/              # AxisGateway 中间件
│   ├── hermes/                  # Hermes 记忆引擎
│   │   ├── memory-engine/       # MemoryScanner/Fossilizer
│   │   └── acp-protocol/        # ACP 协议实现
│   └── swarm/                   # 蜂群协调系统
│       └── collab-framework/    # CollabFramework
└── docs/                        # 架构文档（37份）
```

---

## 3. 配置矩阵

### 3.1 Minimal（低配电脑）

- CPU: 2-4 核
- RAM: 4-8 GB
- GPU: 无
- 模型: Qwen2.5-0.5B / Qwen2.5-1.5B
- 并发: 1 个 Agent
- 特性: 基础问答，无深度推理

### 3.2 Balanced（主流电脑）

- CPU: 4-8 核
- RAM: 8-16 GB
- GPU: 可选（4GB VRAM）
- 模型: Qwen2.5-7B / Qwen2.5-14B
- 并发: 2-3 个 Agent
- 特性: 标准推理，数学物理支持

### 3.3 Performance（高端电脑）

- CPU: 8+ 核
- RAM: 16+ GB
- GPU: 8+ GB VRAM
- 模型: DeepSeek-R1-14B / Qwen2.5-72B
- 并发: 4-8 个 Agent
- 特性: 全功能，深度研究，并行分析

---

## 4. 数据流

### 4.1 用户消息处理流

```
用户输入
    │
    ▼
意图分类（trivial/standard/coding/math/physics/deep）
    │
    ├──────────────┬──────────────┬─────────────────┐
    ▼              ▼              ▼                 ▼
  简单问答      一般任务       代码/数学/物理      深度研究
    │              │              │                 │
    ▼              ▼              ▼                 ▼
快速模型      平衡模型        深度模型          深度+云端
(1.5B)        (7B)           (14B)            回退
    │              │              │                 │
    └──────────────┴──────────────┴─────────────────┘
                              │
                              ▼
              ┌───────────────────────────┐
              │    Platform Core 结果聚合   │
              │  · 3DACP消息路由           │
              │  · Hermes记忆持久化        │
              │  · 蜂群协调                │
              └───────────────────────────┘
                              │
                              ▼
                          返回用户
```

### 4.2 Agent 集群执行流

```
用户问题
    │
    ▼
分发器 ───────────┬───────────┬──────────┐
    │             │           │          │
    ▼             ▼           ▼          ▼
 Agent A       Agent B    Agent C    Agent D
 (并行分析)    (并行分析)  (并行分析)  (并行分析)
    │             │           │          │
    └─────────────┴───────────┴──────────┘
                              │
                              ▼
                       结果聚合器
                              │
                              ▼
                        综合答案
```

---

## 5. Agent 集群模式

### 5.1 并行分析模式

```
用户问题 → 分发器 → [Agent A, Agent B, Agent C]
                    ↓
              结果聚合器 → 综合答案
```

### 5.2 流水线模式

```
用户问题 → Agent A (分析) → Agent B (推理) → Agent C (验证)
                                                  ↓
                                            最终答案
```

### 5.3 专家委员会模式

```
用户问题 → [数学专家, 物理专家, 代码专家]
                    ↓
              协调器 → 综合答案（标注各专家贡献）
```

---

## 6. 数学物理特化模式

### 6.1 增强提示模板

```python
MATH_PROMPT = """
你是一位专业数学家。请遵循以下原则：
1. 所有数学推导必须逐步展示
2. 使用 LaTeX 格式表示公式
3. 明确标注假设和前提条件
4. 验证每一步的正确性
5. 如果存在多种解法，比较它们的优劣
"""

PHYSICS_PROMPT = """
你是一位理论物理学家。请遵循以下原则：
1. 所有物理量必须标注单位
2. 区分理论预测和实验验证
3. 明确标注近似条件和适用范围
4. 引用相关物理定律和方程
5. 讨论结果的物理意义
"""
```

### 6.2 特化路由规则

- 检测到数学关键词 → 启用数学模式 → 路由到深度模型
- 检测到物理关键词 → 启用物理模式 → 路由到深度模型
- 数学+物理混合 → 启用双模型协作 → 快速模型预处理 + 深度模型推理

---

## 7. 质量保障

### 7.1 代码质量

- 类型提示覆盖率 > 95%
- 单元测试覆盖率 > 80%
- 文档字符串覆盖率 > 90%
- 无 pylint/flake8/ESLint 警告

### 7.2 运行时质量

- 内存泄漏检测
- 响应时间监控
- 错误率统计
- 自动恢复机制

### 7.3 消费者质量

- 启动时间 < 5 秒
- 首次响应 < 10 秒
- 错误率 < 1%
- 用户满意度 > 90%

---

## 8. 消费者体验设计

### 8.1 首次启动

1. 欢迎画面（ASCII 艺术 + 版本信息）
2. 自动检测硬件配置
3. 推荐配置方案
4. 一键安装依赖
5. 快速测试（"你好，世界"）

### 8.2 日常使用

1. 实时状态栏（模型状态/内存使用/响应时间）
2. 输入提示（自动补全/历史记录）
3. 响应动画（思考中.../推理中...）
4. 结果格式化（代码高亮/公式渲染/表格对齐）

### 8.3 错误处理

1. 友好错误提示（非技术语言）
2. 自动修复建议
3. 一键回退到安全模式
4. 详细日志（供高级用户查看）

---

## 相关文档

- [项目总览](../../README.md)
- [总体架构](../../ARCHITECTURE.md)
- [SRIA-SMIM引擎详情](sria-smim.md)
- [Platform Core详情](platform-core.md)
- [3DACP协议](../3dacp/protocol.md)
- [OpenClaw优化方案](../openclaw-opt/optimization.md)
- [版本历史](../../CHANGELOG.md)

---

*Architecture Reference for Productive OpenClaw v2.0*
