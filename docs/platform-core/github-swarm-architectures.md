# GitHub Agent Swarm 架构设计文档

> **版本**: v1.0  
> **日期**: 2026-05-24  
> **作者**: SYLVA Platform Team  
> **参考**: swarms (kyegomez/swarms), ruflo (GitHub), LobeHub Multi-Repo Swarm

---

## 目录

1. [概述](#1-概述)
2. [架构清单](#2-架构清单)
3. [后端实现](#3-后端实现)
   - 3.1 HierarchicalSwarm
   - 3.2 AgentRearrange
   - 3.3 ForestSwarm
   - 3.4 HeavySwarm
   - 3.5 SwarmRouter
   - 3.6 RufloSwarm
   - 3.7 MultiRepoSwarm
4. [前端实现](#4-前端实现)
5. [类型定义](#5-类型定义)
6. [与现有系统的集成](#6-与现有系统的集成)
7. [状态机汇总](#7-状态机汇总)
8. [性能与扩展性](#8-性能与扩展性)

---

## 1. 概述

本文档定义了 7 种来自 GitHub 开源生态的 Agent Swarm 架构在 **SYLVA Platform** 中的完整实现。这些架构涵盖了从简单的层级调度到复杂的跨仓库协调的全谱系能力，为不同场景下的多 Agent 协作提供了标准化的策略选择。

### 设计原则

- **统一接口**: 所有策略实现 `BaseExecutionMode` 接口，与现有 `UnifiedCoordinator` 无缝集成
- **状态机驱动**: 每个策略都有明确定义的状态机，支持暂停/恢复/停止
- **可配置**: 所有策略参数均可通过配置对象自定义
- **可监控**: 提供运行时状态查询接口，支持健康检查
- **可扩展**: 新策略可通过注册机制动态加入

---

## 2. 架构清单

| 架构 | 来源 | 文件 | 特点 | 适用场景 |
|------|------|------|------|----------|
| **HierarchicalSwarm** | swarms | `HierarchicalSwarm.ts` | Supervisor 管理 Worker 队列，动态任务分发 | 复杂任务分解 |
| **AgentRearrange** | swarms | `AgentRearrange.ts` | einsum 风格流定义，支持条件/循环/分叉 | 复杂工作流定义 |
| **ForestSwarm** | swarms | `ForestSwarm.ts` | 多叉树 Agent 选择，UCB 探索-利用平衡 | 探索性任务 |
| **HeavySwarm** | swarms | `HeavySwarm.ts` | 5 阶段流水线，严格质量门控 | 高质量要求任务 |
| **SwarmRouter** | swarms | `SwarmRouter.ts` | 动态策略切换，自适应路由 | 通用路由入口 |
| **RufloSwarm** | GitHub ruflo | `RufloSwarm.ts` | Queen/Worker 自学习，经验记忆防遗忘 | 长期知识积累 |
| **MultiRepoSwarm** | LobeHub | `MultiRepoSwarm.ts` | 跨仓库协调，共享全局内存 | 分布式协作 |

---

## 3. 后端实现

所有策略位于 `sylva_platform/backend/src/swarm-strategies/`。

### 3.1 HierarchicalSwarm

**核心算法**: Supervisor 选举 → 任务分解 → Worker 队列分发 → 结果聚合

**状态机**:
```
idle → supervisor_electing → queue_building → dispatching → workers_executing → supervisor_aggregating → completed/failed
                      ↓ (失败可重试/替换 Worker)
```

**关键配置**:
- `supervisorStrategy`: Supervisor 选举策略（static/round_robin/capability_based/health_based）
- `maxWorkers`: Worker 池大小限制
- `maxRetries`: 自动重试次数
- `aggregationStrategy`: 结果聚合策略

**集成点**: 与 `UnifiedCoordinator` 通过 `BaseExecutionMode` 接口集成，支持检查点续传。

### 3.2 AgentRearrange

**核心算法**: einsum 流解析 → 拓扑排序 → 节点执行（条件/循环/分叉/汇合）

**流语法**:
```
a → b           // 串行
a → b,c         // 并行分叉
b,c → d         // 汇合
a → ?b:c        // 条件分支
a → *5→b        // 循环
```

**状态机**:
```
idle → parsing → building_graph → executing → evaluating_condition/waiting_for_join → completed/failed
```

**关键配置**:
- `maxConcurrency`: 最大并发节点数
- `allowLoops`: 是否允许循环
- `executionOrder`: 执行顺序策略

### 3.3 ForestSwarm

**核心算法**: Agent 树构建 → 任务关键词提取 → UCB 子节点选择 → 回溯/剪枝

**状态机**:
```
idle → tree_building → root_selection → traversing → evaluating → executing_leaf
                                                      ↓ (失败)
                                              backtracking → traversing
```

**关键配置**:
- `selectionStrategy`: 选择策略（best_score/round_robin/random/ucb）
- `maxDepth`: 树最大深度
- `explorationConstant`: UCB 探索参数（默认 √2）
- `enablePruning`: 剪枝开关

### 3.4 HeavySwarm

**核心算法**: 5 阶段流水线（Research→Analysis→Draft→Review→Validate），每阶段有质量门控

**阶段定义**:

| 阶段 | 职责 | 质量门控阈值 | 失败策略 |
|------|------|-------------|---------|
| Research | 信息收集 | 0.6 | retry |
| Analysis | 深度分析 | 0.65 | rollback |
| Draft | 内容生成 | 0.7 | rollback |
| Review | 质量审查 | 0.75 | rollback |
| Validate | 最终验证 | 0.8 | rollback |

**状态机**:
```
idle → pipeline_initializing → phase_research → phase_analysis → phase_draft → phase_review → phase_validate → completed
                                      ↓ (未通过门控)
                              rollback → 上一阶段
```

**关键配置**:
- `enableAutoRollback`: 自动回退
- `maxRollbacks`: 最大回退次数
- `phases`: 各阶段独立配置

### 3.5 SwarmRouter

**核心算法**: 任务分析 → 策略评分 → 路由决策 → 策略执行 → 性能反馈

**评分维度**:
1. 标签匹配（任务关键词 vs 策略标签）
2. 复杂度匹配
3. 需求匹配（分解/质量）
4. 历史性能（自适应模式）
5. Agent 能力匹配

**状态机**:
```
idle → analyzing_task → selecting_strategy → routing → executing → recording_metrics → completed/failed
```

**关键配置**:
- `selectionMode`: auto/manual/adaptive
- `defaultStrategy`: 默认策略
- `enableABTest`: A/B 测试

### 3.6 RufloSwarm

**核心算法**: Queen 选举 → 经验加载 → Worker 招募 → 计划制定 → 执行 → 学习 → 记忆更新

**记忆结构**:
```typescript
interface QueenMemory {
  experiences: ExperienceEntry[];      // 经验条目
  knowledgeBase: Map<string, string>;  // 全局知识
  skillScores: Map<string, number>;    // 技能评分
  agentPerformance: Map<string, AgentPerf>; // Agent 表现
}
```

**状态机**:
```
idle → queen_electing → memory_loading → workers_recruiting → planning → dispatching → workers_executing → collecting → learning → memory_updating → completed
```

**关键配置**:
- `queenElection`: Queen 选举策略
- `maxExperiences`: 最大经验数
- `enableExperienceReuse`: 经验复用
- `reviewIntervalMs`: 定期回顾间隔

### 3.7 MultiRepoSwarm

**核心算法**: 仓库发现 → 任务分析 → 仓库选择 → 分发执行 → 同步 → 冲突解决

**共享内存模型**:
- 写入带版本号的全局内存
- 支持 TTL 过期
- 冲突解决策略：last_write_wins / version_vector / timestamp_order

**状态机**:
```
idle → repos_discovering → memory_initializing → task_analyzing → repo_selecting → dispatching → executing → syncing → conflict_resolving → completed
```

**关键配置**:
- `taskDistribution`: 任务分配策略
- `consistencyLevel`: eventual / strong
- `conflictResolution`: 冲突解决策略

---

## 4. 前端实现

### 4.1 文件位置

- **组件**: `sylva_platform/frontend/src/pages/AgentCollab.tsx`
- **类型**: `sylva_platform/frontend/src/types/index.ts`

### 4.2 动态重组面板

在 **管理 (Governance)** Tab 中新增 **动态重组 (Dynamic Reorganization)** 面板：

1. **策略选择器**: 10 种策略的网格选择器（含原有 3 种 + 7 种新策略）
2. **配置面板**: 每种策略的独立配置表单
3. **实时预览**: 策略切换动画 + 可视化流程图
4. **动画效果**: Framer Motion 驱动的切换动画

### 4.3 策略可视化

| 策略 | 预览效果 |
|------|----------|
| hierarchical-swarm | Queen → 3 Workers 层级图 |
| agent-rearrange | einsum 流式节点链 |
| forest-swarm | 根节点 → 分支树形图 |
| heavy-swarm | 5 阶段流水线时间轴 |
| swarm-router | 中心 Router → 5 策略扇形图 |
| ruflo | Queen → Memory Workers + 经验计数 |
| multi-repo | 3 Repo 方块 + Sync 脉冲 |

---

## 5. 类型定义

### 5.1 后端类型扩展

```typescript
// coordinator/modes/types.ts
export type SwarmMode =
  | "sequential"
  | "parallel"
  | "hierarchical"
  | "dynamic"
  | "hierarchical-swarm"
  | "agent-rearrange"
  | "forest-swarm"
  | "heavy-swarm"
  | "swarm-router"
  | "ruflo"
  | "multi-repo";
```

### 5.2 前端类型扩展

```typescript
// types/index.ts
export type SwarmStrategyType =
  | 'sequential'
  | 'parallel'
  | 'hierarchical'
  | 'hierarchical-swarm'
  | 'agent-rearrange'
  | 'forest-swarm'
  | 'heavy-swarm'
  | 'swarm-router'
  | 'ruflo'
  | 'multi-repo';

export interface CollaborationGroup {
  id: string;
  name: string;
  type: SwarmStrategyType;
  // ...
  strategyConfig?: Record<string, unknown>;
}
```

---

## 6. 与现有系统的集成

### 6.1 UnifiedCoordinator 集成

所有新策略通过 `BaseExecutionMode` 接口与 `UnifiedCoordinator` 集成：

```typescript
import { HierarchicalSwarm } from "../swarm-strategies/HierarchicalSwarm";

// 在 UnifiedCoordinator 中实例化
const swarm = new HierarchicalSwarm({
  supervisorStrategy: "capability_based",
  maxWorkers: 10,
});

const result = await swarm.execute(task, agents, context);
```

### 6.2 TaskRouter 集成

`TaskRouter` 的 `selectSwarmAgents` 方法已兼容所有新策略模式，无需修改。

### 6.3 状态管理器集成

`StateManager` 的 `createSwarm` 方法接受 `SwarmMode` 类型，新策略自动可用。

### 6.4 WebSocket 推送

通过 `MessageBus` 广播策略切换事件：

```typescript
bus.broadcast("swarm.strategy_change", {
  swarmId: "sw-1",
  oldStrategy: "parallel",
  newStrategy: "hierarchical-swarm",
  reason: "task complexity increased",
});
```

---

## 7. 状态机汇总

| 策略 | 状态数 | 支持暂停 | 支持回退 | 支持检查点 |
|------|--------|----------|----------|-----------|
| HierarchicalSwarm | 10 | ✓ | ✓ (Worker 替换) | ✓ |
| AgentRearrange | 8 | ✓ | ✗ | ✗ |
| ForestSwarm | 9 | ✓ | ✓ (回溯) | ✗ |
| HeavySwarm | 9 | ✓ | ✓ (阶段回退) | ✓ |
| SwarmRouter | 7 | ✓ | ✓ (策略回退) | ✗ |
| RufloSwarm | 10 | ✓ | ✗ | ✗ |
| MultiRepoSwarm | 10 | ✓ | ✓ (仓库切换) | ✓ |

---

## 8. 性能与扩展性

### 8.1 性能特征

| 策略 | 典型延迟 | 并发能力 | 内存占用 |
|------|---------|---------|---------|
| HierarchicalSwarm | 15-30s | Worker 池大小 | 中等 |
| AgentRearrange | 10-60s | 取决于图结构 | 取决于节点数 |
| ForestSwarm | 20-45s | 分支因子 | 较高（树结构） |
| HeavySwarm | 30-120s | 阶段可并行化 | 高（保存中间产物） |
| SwarmRouter | 5-10s + 子策略 | 取决于路由目标 | 低（轻量路由层） |
| RufloSwarm | 15-30s | Worker 池大小 | 高（经验存储） |
| MultiRepoSwarm | 10-20s + 网络延迟 | 仓库数 × 每仓并发 | 高（共享内存） |

### 8.2 扩展性建议

1. **HierarchicalSwarm**: 当 Worker 数 > 20 时，考虑嵌套 Swarm
2. **AgentRearrange**: 流图节点数建议 < 50，避免拓扑排序 O(V+E) 过高
3. **ForestSwarm**: 树深度建议 < 8，分支因子 < 5
4. **HeavySwarm**: 总超时建议 < 10 分钟，避免阶段无限回退
5. **SwarmRouter**: 策略注册数建议 < 20，保持路由决策 O(n)
6. **RufloSwarm**: 经验条目数建议 < 1000，定期清理过期经验
7. **MultiRepoSwarm**: 仓库数建议 < 10，共享内存条目 < 10000

---

## 附录 A: 文件清单

### 后端

```
sylva_platform/backend/src/swarm-strategies/
├── index.ts                      # 统一出口
├── HierarchicalSwarm.ts          # Supervisor-Worker 层级调度
├── AgentRearrange.ts             # einsum 风格流重组
├── ForestSwarm.ts                # 多叉树 Agent 选择器
├── HeavySwarm.ts                 # 5 阶段流水线
├── SwarmRouter.ts                # 动态策略路由器
├── RufloSwarm.ts                 # Queen/Worker 自学习
└── MultiRepoSwarm.ts             # 跨仓库协调器
```

### 前端

```
sylva_platform/frontend/src/
├── types/index.ts               # 扩展 SwarmStrategyType, CollaborationGroup
└── pages/AgentCollab.tsx        # 动态重组面板 + 策略可视化
```

### 文档

```
sylva_platform/docs/
└── github-swarm-architectures.md  # 本设计文档
```

---

*End of Document*
