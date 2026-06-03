# Hierarchical Coordinator Architecture — 层级协调员体系

## 设计原则

1. **递归嵌套**（无限套娃）：任何 Coordinator 节点都可以是另一个 Coordinator 的子节点
2. **模块化**：每个 Coordinator 是可插拔的独立模块，通过统一接口通信
3. **群体智能 + 单 Agent 协调混合**：先发散聚合（群体智能），再收敛决策（协调员裁决）
4. **能力最强者优先**：选举算法综合考虑准确率、活跃度、负载、多样性

---

## 层级结构

```
Level 3: Meta-Conductor (顶级协调员)
├─ 全局资源调度
├─ 跨域任务路由
├─ 最终仲裁（陪审团之上）
└─ 动态创建/销毁 Domain Coordinator

Level 2: Domain Coordinator (二级协调员 / 领域协调员)
├─ 管理 2-N 个 Swarm Coordinator
├─ 聚合子群组输出
├─ 执行加权投票 / Lead裁决 / 自动聚合
└─ 向上汇报到 Meta-Conductor

Level 1: Swarm Coordinator (子群组协调员)
├─ 直接管理 2-8 个执行 Agent
├─ 任务分解与分配
├─ 本地冲突解决（陪审团 3-5 人）
└─ 向上汇报到 Domain Coordinator

Level 0: Execution Agent (执行智能体)
└─ 实际执行任务，返回结果
```

---

## 混合输出模型

### Phase 1: 群体智能（发散）

所有子节点（Agent 或子 Coordinator）并行输出：
- **数值/列表** → 保留所有值，标记置信度
- **方案选择** → 各自投票（A/B/C）
- **开放式输出** → 保留原始文本 + 摘要

### Phase 2: 协调员裁决（收敛）

由选举出的 Lead Coordinator 执行：

```
输入: [子节点输出1, 子节点输出2, ...]
    ↓
[输出类型判断]
├─ 数值类 → 加权平均 / 并集 / 多数表决（自动聚合）
├─ 方案选择 → 加权投票（权重=历史准确率）
├─ 创意/策略 → Lead Coordinator 裁决 + 书面解释（可审计）
└─ 检测到冲突 → 升级到上级 Coordinator / 陪审团模式
```

---

## Coordinator 选举算法

### 评分公式

```
Score = 0.40 × AccuracyScore + 0.25 × RecencyBonus + 0.20 × (1 - Load/100) + 0.15 × DiversityBonus

AccuracyScore = 最近100次决策的正确率
RecencyBonus = exp(-λ × 上次活跃距今小时数)  # 指数衰减
LoadPenalty = 当前负载百分比（越高惩罚越大）
DiversityBonus = 上次当选距今时长（防止垄断）
```

### 选举触发条件

- 定时选举：每 30 分钟重评估
- 事件触发：当前 Lead 准确率连续 5 次低于阈值
- 负载触发：当前 Lead 负载超过 85%
- 手动触发：用户点击「重新选举」

---

## 跨群组路由策略

### 能力匹配路由（默认）

```
任务向量 → Embedding 匹配 → 选择向量相似度最高的 Domain
```

### 负载均衡路由

```
选择当前总负载最低的 Domain（考虑子群组的 Agent 数加权）
```

### 就近路由

```
优先路由到上次成功处理同类任务的 Domain（缓存命中）
```

### 复制路由（高可靠性模式）

```
重要任务同时路由到 2+ 个 Domain
→ 结果交叉验证（一致性检查）
→ 不一致时触发陪审团仲裁
```

---

## 全局冲突仲裁

### 升级路径

```
Swarm 内冲突 → Swarm Coordinator 本地陪审团
    ↓ 无法解决
Domain 内冲突 → Domain Coordinator 加权投票
    ↓ 无法解决
跨 Domain 冲突 → Meta-Conductor 最终仲裁
    ↓ 涉及系统级决策
用户介入（Human-in-the-Loop）
```

### 陪审团模式

```
1. 从同级 Coordinator 池中随机抽取 3-5 个（排除冲突方）
2. 每个陪审员独立裁决（盲审，不知其他陪审员身份）
3. 多数表决，平局时由准确率最高者打破
4. 裁决结果写入审计日志，可被追溯
```

---

## API 接口设计

### Coordinator 层级接口

```
GET  /coordinator/hierarchy          # 获取完整层级树
POST /coordinator/election           # 触发重新选举
GET  /coordinator/status/:id         # 获取指定 Coordinator 状态
POST /coordinator/route              # 跨域任务路由决策
```

### Handoff 跨域移交

```
POST /handoff/inter-domain           # 跨群组任务移交
GET  /handoff/domain/:domainId       # 获取指定域的移交记录
```

### 仲裁接口

```
POST /arbitration/jury               # 触发陪审团仲裁
GET  /arbitration/result/:caseId     # 获取仲裁结果
POST /arbitration/appeal             # 上诉（升级到上级）
```

---

## 前端交互

### 层级视图

- 树形图展示 Coordinator 层级关系
- 每个节点显示：名称、角色、准确率、负载、Agent数
- 点击节点展开/折叠子树
- 实时刷新（5秒间隔）

### 协调策略配置

- 4 种策略：自动聚合 / 加权投票 / Lead裁决 / 陪审团
- 每种策略配置阈值和参数
- 策略按输出类型自动选择（可覆盖）

### 协调员选举

- 显示当前 Lead Coordinator 及其得分详情
- 显示候选列表及各项评分
- 手动触发「重新选举」按钮

### 跨群路由

- 可视化任务流向（桑基图/力导向图）
- 显示当前路由策略和实时决策

---

## 与现有系统的集成

- `coordinator.ts` 增加 `DomainCoordinator` 和 `MetaConductor` 类
- `handoff.ts` 增加 `inter-domain` 路由
- `agents.ts` 增加 `SwarmCoordinator` 类型 Agent
- 前端 `AgentCollab.tsx` 增加 `HierarchyPanel`（已完成）

---

## 文件位置

- 架构文档: `sylva_platform/docs/hierarchical-coordinator.md`
- 前端实现: `sylva_platform/frontend/src/pages/AgentCollab.tsx` (HierarchyPanel)
- 后端接口: `sylva_platform/backend/src/routes/coordinator.ts` (待实现)
- 后端接口: `sylva_platform/backend/src/routes/handoff.ts` (待实现)
