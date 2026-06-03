# Handoff Gateway API 文档

> **版本**: 1.0.0  
> **最后更新**: 2026-05-20  
> **状态**: 设计阶段

---

## 目录

1. [认证](#认证)
2. [速率限制](#速率限制)
3. [REST API](#rest-api)
4. [WebSocket 事件协议](#websocket-事件协议)
5. [错误码](#错误码)
6. [示例](#示例)

---

## 认证

所有 API 请求需携带 **Bearer Token**：

```
Authorization: Bearer <token>
```

Token 通过 OpenClaw Gateway 的认证服务签发，有效期 24 小时，支持 refresh。

### 认证响应

| 状态码 | 含义 |
|--------|------|
| `401` | Token 缺失或无效 |
| `403` | Token 有效但权限不足（非群组所有者/管理员） |

---

## 速率限制

| 端点类型 | 限制 |
|----------|------|
| 群组创建/修改 | 10 req/min |
| 成员增删 | 30 req/min |
| 交接审批 | 60 req/min |
| 查询类（列表/详情） | 120 req/min |
| WebSocket 消息 | 100 msg/min per connection |

超限响应：
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 45
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1716192000
```

---

## REST API

### 基础路径
```
/api/v1/handoff
```

---

### 1. 群组管理

#### `POST /groups` — 创建群组

创建新的 Agent 协作群组，触发异步资产导入流程。

**请求体**:
```typescript
interface CreateGroupRequest {
  name: string;
  description?: string;
  taskType: "sequential" | "parallel" | "conditional";
  autonomyLevel: number;        // 0-10
  handoffRule: "auto" | "manual" | "conditional";
  members: {
    sourceId: string;           // Agent/群组 UUID
    type: "single_agent" | "sub_group";
    preserveOriginal: boolean;  // true = 不中断原 Agent
    importMode: "reference" | "copy";
  }[];
  assetConfig?: {
    defaultImportMode: "reference" | "copy" | "merge";
    assetTypes: ("memory" | "workfile" | "log" | "config")[];
  };
}
```

**响应**:
```typescript
interface CreateGroupResponse {
  group: AgentGroup;
  importJobId: string;          // 导入任务 UUID
  estimatedImportTime: number; // 预计秒数
}
```

**状态码**:
| 码 | 含义 |
|----|------|
| `201` | 创建成功，导入进行中 |
| `400` | 参数无效（如 autonomyLevel 越界、成员重复） |
| `409` | 成员 sourceId 不存在或处于 error 状态 |
| `422` | 嵌套深度超限（`maxNestingDepth`） |
| `429` | 速率限制 |

---

#### `GET /groups` — 群组列表

**查询参数**:
```
?status=active&taskType=sequential&search=dev-team&page=1&limit=20
```

**响应**:
```typescript
{
  data: AgentGroup[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

---

#### `GET /groups/:groupId` — 群组详情

**路径参数**: `groupId` — 群组 UUID

**响应**: `AgentGroup` 完整对象

**状态码**:
| 码 | 含义 |
|----|------|
| `200` | 成功 |
| `404` | 群组不存在 |

---

#### `PATCH /groups/:groupId` — 更新群组

**请求体**:
```typescript
interface UpdateGroupRequest {
  name?: string;
  description?: string;
  handoffRule?: "auto" | "manual" | "conditional";
  taskType?: "sequential" | "parallel" | "conditional";
  autonomyLevel?: number;
  status?: "active" | "idle" | "paused" | "error";
}
```

**状态码**:
| 码 | 含义 |
|----|------|
| `200` | 更新成功 |
| `400` | 非法状态转换 |
| `409` | 群组正在交接中，禁止修改 |

---

#### `DELETE /groups/:groupId` — 解散群组

**查询参数**:
```
?cleanupAssets=true&preserveMembers=false
```

- `cleanupAssets`: 是否清理已导入资产
- `preserveMembers`: false 时恢复原始 Agent 运行状态

**状态码**:
| 码 | 含义 |
|----|------|
| `204` | 解散成功 |
| `409` | 群组处于 active 状态，需先暂停 |

---

### 2. 成员管理

#### `POST /groups/:groupId/members` — 添加成员

**请求体**:
```typescript
interface AddMemberRequest {
  sourceId: string;
  type: "single_agent" | "sub_group";
  preserveOriginal: boolean;
  importMode: "reference" | "copy";
}
```

**响应**: `GroupMember`

**状态码**:
| 码 | 含义 |
|----|------|
| `201` | 添加成功 |
| `409` | 成员已存在；或源 Agent 属于其他活跃群组 |

---

#### `DELETE /groups/:groupId/members/:memberId` — 移除成员

**查询参数**:
```
?cleanupAssets=true
```

**状态码**:
| 码 | 含义 |
|----|------|
| `204` | 移除成功 |
| `400` | 不能移除最后一个成员 |

---

### 3. 交接管理

#### `GET /groups/:groupId/handoffs` — 交接历史

**查询参数**:
```
?status=completed&fromMember=xxx&page=1&limit=20
```

**响应**:
```typescript
{
  data: HandoffRecord[];
  total: number;
  page: number;
  limit: number;
}
```

---

#### `GET /groups/:groupId/handoffs/:recordId` — 交接详情

**响应**: `HandoffRecord`

---

#### `POST /handoffs/:recordId/review` — 审批交接

**请求体**:
```typescript
interface ReviewHandoffRequest {
  action: "approve" | "reject" | "rollback";
  comment?: string;
}
```

**响应**:
```typescript
interface ReviewHandoffResponse {
  record: HandoffRecord;
  result: "approved" | "rejected" | "rolled-back";
  executedAction: string;
}
```

**状态码**:
| 码 | 含义 |
|----|------|
| `200` | 审批处理完成 |
| `409` | 交接已超时或被自动处理 |
| `410` | 交接记录已过期/被清理 |

---

### 4. 资产导入

#### `GET /groups/:groupId/import/:jobId` — 导入进度

**响应**: `AssetImportProgress`

---

#### `POST /groups/:groupId/import/:jobId/retry` — 重试失败项

**请求体**:
```typescript
{
  failedAssetIds?: string[];  // 为空则重试所有失败项
  newImportMode?: "reference" | "copy" | "merge";
}
```

---

### 5. 快照与回滚

#### `POST /groups/:groupId/snapshots` — 创建手动快照

**请求体**:
```typescript
{
  memberIds?: string[];       // 为空则快照所有成员
  includeAssets: boolean;
  ttlMs?: number;             // 快照有效期
}
```

**响应**: `SnapshotMetadata`

---

#### `POST /handoffs/:recordId/rollback` — 执行回滚

**请求体**:
```typescript
interface RollbackRequest {
  recordId: string;
  reason?: string;
  preserveCurrent?: boolean;  // true = 保留当前状态为分支
}
```

**状态码**:
| 码 | 含义 |
|----|------|
| `200` | 回滚成功 |
| `409` | 原快照已过期，无法恢复 |
| `422` | 回滚目标状态与当前状态不兼容 |

---

### 6. 统计与配置

#### `GET /groups/:groupId/stats` — 群组统计

**响应**: `HandoffStats`

---

#### `GET /groups/:groupId/config` — 获取交接配置

**响应**: `HandoffConfig`

---

#### `PATCH /groups/:groupId/config` — 更新交接配置

**请求体**: 部分 `HandoffConfig` 字段

---

## WebSocket 事件协议

### 连接路径
```
/ws/handoff?token=<Bearer>&groupId=<optional>
```

### 订阅机制

客户端通过 `subscribe`/`unsubscribe` 消息控制接收范围：

```json
{
  "type": "subscribe",
  "channels": ["handoff.*", "group.abc-123.*"]
}
```

---

### 服务端 → 客户端 事件

#### `handoff.group_created`
新群组创建完成。

```json
{
  "type": "handoff.group_created",
  "payload": {
    "group": { /* AgentGroup */ }
  }
}
```

#### `handoff.member_joined`
新成员加入群组。

```json
{
  "type": "handoff.member_joined",
  "payload": {
    "groupId": "grp-001",
    "member": { /* GroupMember */ }
  }
}
```

#### `handoff.member_left`
成员离开群组。

```json
{
  "type": "handoff.member_left",
  "payload": {
    "groupId": "grp-001",
    "memberId": "mem-001",
    "reason": "user_removed"
  }
}
```

#### `handoff.asset_import_progress`
资产导入进度更新（流式推送，每 5% 或每 2 秒）。

```json
{
  "type": "handoff.asset_import_progress",
  "payload": {
    "jobId": "job-001",
    "groupId": "grp-001",
    "totalAssets": 42,
    "completedAssets": 28,
    "failedAssets": 1,
    "currentAsset": { /* ImportedAsset */ },
    "percent": 67,
    "status": "importing"
  }
}
```

#### `handoff.asset_import_complete`
资产导入全部完成。

```json
{
  "type": "handoff.asset_import_complete",
  "payload": {
    "groupId": "grp-001",
    "jobId": "job-001",
    "summary": {
      "total": 42,
      "completed": 40,
      "failed": 2
    }
  }
}
```

#### `handoff.status_change`
群组整体状态变更。

```json
{
  "type": "handoff.status_change",
  "payload": {
    "groupId": "grp-001",
    "status": "active",
    "reason": "import_complete"
  }
}
```

#### `handoff.member_status_change`
单个成员状态变更。

```json
{
  "type": "handoff.member_status_change",
  "payload": {
    "groupId": "grp-001",
    "memberId": "mem-001",
    "status": "migrating",
    "reason": "snapshot_in_progress"
  }
}
```

#### `handoff.handoff_initiated`
交接已发起（进入 pending）。

```json
{
  "type": "handoff.handoff_initiated",
  "payload": {
    "record": { /* HandoffRecord */ }
  }
}
```

#### `handoff.needs_review`
交接需要人工审批。

```json
{
  "type": "handoff.needs_review",
  "payload": {
    "record": { /* HandoffRecord */ },
    "deadline": "2026-05-20T16:05:00Z"
  }
}
```

#### `handoff.completed`
交接完成。

```json
{
  "type": "handoff.completed",
  "payload": {
    "record": { /* HandoffRecord */ }
  }
}
```

#### `handoff.rejected`
交接被拒绝。

```json
{
  "type": "handoff.rejected",
  "payload": {
    "record": { /* HandoffRecord */ },
    "reason": "insufficient_context"
  }
}
```

#### `handoff.rollback_complete`
回滚操作完成。

```json
{
  "type": "handoff.rollback_complete",
  "payload": {
    "recordId": "hnd-001",
    "restoredState": "snapshot-abc-123"
  }
}
```

#### `handoff.intervention`
人工干预结果。

```json
{
  "type": "handoff.intervention",
  "payload": {
    "recordId": "hnd-001",
    "action": "force_approve",
    "result": "context_truncated_but_approved"
  }
}
```

#### `handoff.nesting_limit_warning`
嵌套深度接近上限。

```json
{
  "type": "handoff.nesting_limit_warning",
  "payload": {
    "groupId": "grp-001",
    "currentDepth": 2,
    "maxDepth": 3
  }
}
```

#### `handoff.error`
通用错误事件。

```json
{
  "type": "handoff.error",
  "payload": {
    "groupId": "grp-001",
    "error": "Snapshot creation failed: ENOSPC",
    "code": "SNAPSHOT_FAILED",
    "details": { "memberId": "mem-001" }
  }
}
```

---

### 客户端 → 服务端 消息

```json
{
  "type": "handoff.ack",
  "payload": {
    "eventId": "evt-001",
    "receivedAt": 1716192000000
  }
}
```

---

## 错误码

### HTTP 错误码

| 错误码 | HTTP 状态 | 说明 | 恢复建议 |
|--------|-----------|------|----------|
| `GROUP_NOT_FOUND` | `404` | 群组不存在 | 检查 `groupId` |
| `MEMBER_NOT_FOUND` | `404` | 成员不存在 | 检查 `memberId` |
| `HANDOFF_NOT_FOUND` | `404` | 交接记录不存在 | 检查 `recordId` |
| `IMPORT_JOB_NOT_FOUND` | `404` | 导入任务不存在 | 检查 `jobId` |
| `INVALID_STATUS_TRANSITION` | `400` | 非法状态转换 | 查看允许的转换矩阵 |
| `DUPLICATE_MEMBER` | `409` | 成员已存在于群组 | 删除后重新添加 |
| `SOURCE_AGENT_BUSY` | `409` | 源 Agent 正参与其他群组 | 等待或强制迁移 |
| `NESTING_TOO_DEEP` | `422` | 嵌套深度超限 | 减少嵌套层级 |
| `SNAPSHOT_FAILED` | `500` | 快照创建失败 | 检查磁盘空间/权限 |
| `ASSET_IMPORT_FAILED` | `500` | 资产导入失败 | 查看具体资产错误 |
| `HANDOFF_TIMEOUT` | `504` | 交接超时 | 检查网络/Agent 状态 |
| `AUTO_APPROVE_EXPIRED` | `410` | 自动审批窗口已过 | 手动审批或重新发起 |
| `CONFLICT_UNRESOLVED` | `409` | 资产冲突未解决 | 手动选择解决策略 |
| `ROLLBACK_IMPOSSIBLE` | `409` | 快照已过期，无法回滚 | 创建新的基准快照 |

### WebSocket 错误码

| 错误码 | 说明 |
|--------|------|
| `WS_UNAUTHORIZED` | Token 无效 |
| `WS_INVALID_CHANNEL` | 订阅的通道不存在 |
| `WS_RATE_LIMITED` | 消息发送频率过高 |
| `WS_GROUP_NOT_SUBSCRIBED` | 未订阅该群组事件 |

---

## 示例

### 示例 1：创建顺序执行群组

```bash
curl -X POST https://api.sylva.local/api/v1/handoff/groups \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "论文写作流水线",
    "description": "从大纲到终稿的sequential写作群组",
    "taskType": "sequential",
    "autonomyLevel": 7,
    "handoffRule": "conditional",
    "members": [
      {
        "sourceId": "agent-outline-writer",
        "type": "single_agent",
        "preserveOriginal": true,
        "importMode": "reference"
      },
      {
        "sourceId": "agent-draft-writer",
        "type": "single_agent",
        "preserveOriginal": true,
        "importMode": "copy"
      },
      {
        "sourceId": "agent-proofreader",
        "type": "single_agent",
        "preserveOriginal": true,
        "importMode": "copy"
      }
    ],
    "assetConfig": {
      "defaultImportMode": "copy",
      "assetTypes": ["memory", "workfile"]
    }
  }'
```

**响应**:
```json
{
  "group": {
    "id": "grp-7a8b9c0d",
    "name": "论文写作流水线",
    "status": "idle",
    "members": [
      {
        "id": "mem-001",
        "type": "single_agent",
        "sourceId": "agent-outline-writer",
        "name": "大纲写手",
        "status": "migrating",
        "preserveOriginal": true,
        "avatarType": "writer",
        "color": "#3B82F6"
      },
      {
        "id": "mem-002",
        "type": "single_agent",
        "sourceId": "agent-draft-writer",
        "name": "草稿写手",
        "status": "migrating",
        "preserveOriginal": true,
        "avatarType": "writer",
        "color": "#10B981"
      },
      {
        "id": "mem-003",
        "type": "single_agent",
        "sourceId": "agent-proofreader",
        "name": "校对员",
        "status": "migrating",
        "preserveOriginal": true,
        "avatarType": "reviewer",
        "color": "#F59E0B"
      }
    ],
    "createdAt": 1716192000000,
    "updatedAt": 1716192000000,
    "handoffRule": "conditional",
    "taskType": "sequential",
    "autonomyLevel": 7,
    "importedAssets": []
  },
  "importJobId": "job-7a8b9c0d",
  "estimatedImportTime": 15
}
```

---

### 示例 2：WebSocket 接收导入进度

```bash
wscat -c "wss://api.sylva.local/ws/handoff?token=eyJhbGciOiJIUzI1NiIs...&groupId=grp-7a8b9c0d"
```

**接收消息流**:
```json
{"type": "handoff.asset_import_progress", "payload": {"jobId": "job-7a8b9c0d", "groupId": "grp-7a8b9c0d", "totalAssets": 42, "completedAssets": 5, "failedAssets": 0, "percent": 12, "status": "importing"}}
{"type": "handoff.asset_import_progress", "payload": {"jobId": "job-7a8b9c0d", "groupId": "grp-7a8b9c0d", "totalAssets": 42, "completedAssets": 21, "failedAssets": 0, "percent": 50, "status": "importing"}}
{"type": "handoff.asset_import_progress", "payload": {"jobId": "job-7a8b9c0d", "groupId": "grp-7a8b9c0d", "totalAssets": 42, "completedAssets": 40, "failedAssets": 2, "percent": 95, "status": "importing"}}
{"type": "handoff.asset_import_complete", "payload": {"groupId": "grp-7a8b9c0d", "jobId": "job-7a8b9c0d", "summary": {"total": 42, "completed": 40, "failed": 2}}}
{"type": "handoff.status_change", "payload": {"groupId": "grp-7a8b9c0d", "status": "active", "reason": "import_complete"}}
```

---

### 示例 3：审批需要人工确认的交接

```bash
curl -X POST https://api.sylva.local/api/v1/handoff/handoffs/hnd-3f4a5b6c/review \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  -H "Content-Type: application/json" \
  -d '{
    "action": "approve",
    "comment": "上下文完整，批准交接"
  }'
```

**响应**:
```json
{
  "record": {
    "id": "hnd-3f4a5b6c",
    "groupId": "grp-7a8b9c0d",
    "fromMemberId": "mem-001",
    "toMemberId": "mem-002",
    "status": "completed",
    "reason": "大纲完成，移交草稿阶段",
    "contextSnapshot": "snap-3f4a5b6c",
    "dataSize": "1.2MB",
    "duration": "340ms",
    "timestamp": "2026-05-20T16:05:34Z",
    "approvedBy": "user-admin-001"
  },
  "result": "approved",
  "executedAction": "forward_context_and_activate_next"
}
```

---

### 示例 4：执行回滚

```bash
curl -X POST https://api.sylva.local/api/v1/handoff/handoffs/hnd-3f4a5b6c/rollback \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "草稿质量不达标，回退到大纲阶段重新分配",
    "preserveCurrent": true
  }'
```

**响应**:
```json
{
  "record": { /* HandoffRecord with status rolled-back */ },
  "restoredSnapshot": "snap-3f4a5b6c",
  "preservedBranch": "snap-rollback-fallback-001"
}
```

---

### 示例 5：添加嵌套子群组

```bash
curl -X POST https://api.sylva.local/api/v1/handoff/groups/grp-parent/members \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  -H "Content-Type: application/json" \
  -d '{
    "sourceId": "grp-child-nested",
    "type": "sub_group",
    "preserveOriginal": true,
    "importMode": "reference"
  }'
```

---

## 附录：状态转换矩阵

### 群组状态

| 当前状态 → | active | idle | paused | error |
|------------|--------|------|--------|-------|
| **active** | — | ✓ (idle) | ✓ (pause) | ✗ (内部) |
| **idle** | ✓ (start) | — | ✓ (pause) | ✗ (内部) |
| **paused** | ✓ (resume) | ✓ | — | ✗ (内部) |
| **error** | ✓ (recover) | ✓ | ✓ | — |

### 成员状态

| 当前状态 → | active | idle | error | migrating |
|------------|--------|------|-------|-------------|
| **active** | — | ✓ | ✗ (内部) | ✓ (handoff) |
| **idle** | ✓ | — | ✗ (内部) | ✓ (handoff) |
| **error** | ✓ (recover) | ✓ | — | ✗ |
| **migrating** | ✓ (complete) | ✓ (abort) | ✗ (内部) | — |

### 交接记录状态

```
pending → auto-approved (定时器触发)
pending → needs-review (条件规则触发)
pending → rejected (人工或条件)
pending → timed-out (超时)
needs-review → completed (approve)
needs-review → rejected (reject)
auto-approved → completed (执行成功)
auto-approved → error (执行失败)
completed → rollback_complete (rollback API)
```
