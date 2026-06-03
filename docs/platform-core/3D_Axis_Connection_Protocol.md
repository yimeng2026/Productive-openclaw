# 3D Axis Connection Protocol (3DACP) — 千界花园 XYZ 轴统一接口协议

> **目标**：统一 x（平台/部署）、y（功能/业务）、z（抽象/协议）三个轴的接口协议，实现任意两个层级之间的自由连接。

---

## 1. 三维坐标体系定义

```
                 z轴（协议抽象层）
                    ↑
                    │ WebSocket
                    │ SSE
                    │ REST
                    │ Internal Bus
                    │
         ┌──────────┼──────────┐
         │          │          │
    y轴  │  Agents  │  Groups  │  Dialogs   ... 功能模块
  （业务）│  Skills  │Knowledge│  Monitor  │
         │          │          │
         └──────────┼──────────┘
                    │
         ───────────┼───────────→ x轴（平台层）
                    │         Frontend
                    │         Backend
                    │         AgentZero
                    │         External API
```

| 轴 | 维度 | 当前问题 | 统一目标 |
|---|---|---|---|
| **x轴** | 平台/部署 | Frontend、Backend、AgentZero 各自用不同通信方式 | 全部走统一消息总线，任何平台可注册为节点 |
| **y轴** | 功能/业务 | Agents/Groups/Dialogs/Skills 等模块接口格式不统一 | 所有功能模块暴露统一契约接口 |
| **z轴** | 协议/抽象 | REST/SSE/WebSocket/Internal 混用，没有分层隔离 | 协议自适应，上层只关心消息语义 |

---

## 2. 核心设计原则

### 2.1 任意连接 = 全图路由

任意两个坐标点 `(x₁, y₁, z₁)` ↔ `(x₂, y₂, z₂)` 的通信，遵循统一消息格式：

```typescript
interface AxisMessage {
  // 三维坐标定位
  source: { x: PlatformId; y: ModuleId; z: ProtocolLevel };
  target: { x: PlatformId; y: ModuleId; z: ProtocolLevel };

  // 消息语义（与协议无关）
  header: {
    msgId: string;           // UUID
    correlationId?: string;   // 用于请求-响应关联
    timestamp: number;
    priority: number;        // 0-9，0最高
    ttl: number;             // 存活时间(ms)
  };

  // 载荷
  payload: {
    action: string;          // 动作动词：create|read|update|delete|invoke|stream
    entity: string;          // 实体名：agent|group|dialog|skill|...
    data: unknown;           // 具体数据
    metadata: Record<string, unknown>;
  };

  // 协议适配层自动填充
  transport: {
    protocol: 'rest' | 'sse' | 'ws' | 'internal' | 'bridge';
    encoding: 'json' | 'msgpack' | 'protobuf';
    compressed: boolean;
  };
}
```

### 2.2 协议自适应层（z轴解耦）

```
┌─────────────────────────────────────┐
│  业务层：只发 AxisMessage            │  ← y轴模块不关心怎么传
├─────────────────────────────────────┤
│  路由层：AxisRouter                  │  ← 根据 target 选择路径
├─────────────────────────────────────┤
│  协议层：ProtocolAdapter             │  ← 根据距离选择协议
│   ├─ RESTAdapter    (跨网络)         │
│   ├─ SSEAdapter     (服务端推送)    │
│   ├─ WSAdapter      (双向实时)      │
│   ├─ InternalAdapter (同进程)       │
│   └─ BridgeAdapter  (跨平台桥接)    │
├─────────────────────────────────────┤
│  传输层：HTTP / TCP / IPC / SharedMemory │
└─────────────────────────────────────┘
```

**自适应规则**（距离 → 协议）：

| 源-目标距离 | 自动选择协议 | 原因 |
|---|---|---|
| 同进程 | `internal` | 零拷贝，函数调用 |
| 同机不同进程 | `ws` 或 `ipc` | 低延迟双向 |
| 内网不同机 | `ws` | 可靠双向，可穿透NAT |
| 公网 | `rest` / `sse` | 防火墙友好 |
| 流式数据 | `sse` / `ws` | 实时推送 |

### 2.3 平台注册发现（x轴解耦）

每个平台实例启动时向 **AxisRegistry** 注册：

```typescript
interface PlatformNode {
  id: PlatformId;           // 如 "frontend-local", "backend-prod", "agent-zero-1"
  type: 'frontend' | 'backend' | 'agentzero' | 'external';
  capabilities: ModuleId[];   // 支持的功能模块
  protocols: ProtocolLevel[]; // 支持的协议层
  endpoint: string;          // 接入点URL
  health: { status: 'up'|'down'; lastSeen: number; latency: number };
  metadata: Record<string, unknown>;
}
```

注册中心维护一张 **3D 路由表**，消息根据 target 坐标自动寻址：

```
消息 target = { x: "agent-zero-1", y: "dialog", z: "ws" }
    ↓
AxisRouter 查表
    ↓
"agent-zero-1" 当前在线，支持 ws，endpoint = "ws://192.168.1.5:8081"
    ↓
交给 WSAdapter 发送
```

---

## 3. 三层连接矩阵

### 3.1 xy 平面连接（平台 × 功能）

所有功能模块在所有平台上暴露统一接口：

```typescript
// 统一模块接口契约
interface ModuleContract {
  moduleId: ModuleId;
  actions: ActionContract[];
  events: EventContract[];
  streams: StreamContract[];
}

// 示例：Dialog 模块契约
const DialogContract: ModuleContract = {
  moduleId: 'dialog',
  actions: [
    { name: 'create', input: DialogCreateSchema, output: DialogSchema },
    { name: 'sendMessage', input: MessageSchema, output: MessageSchema },
    { name: 'getHistory', input: PaginationSchema, output: MessageListSchema },
    { name: 'attachFile', input: FileSchema, output: AttachmentSchema },
  ],
  events: [
    { name: 'messageReceived', payload: MessageSchema },
    { name: 'agentTyping', payload: AgentTypingSchema },
  ],
  streams: [
    { name: 'responseStream', chunk: StreamChunkSchema },
  ],
};
```

**效果**：前端 DialogCenter 调用 `dialog.sendMessage` 时，不 care 后端是 Express 还是 AgentZero —— 消息格式一样，路由层自动送达。

### 3.2 xz 平面连接（平台 × 协议）

每个平台支持多协议接入，客户端选择最优路径：

```typescript
interface PlatformProtocolProfile {
  platformId: PlatformId;
  preferredProtocol: ProtocolLevel;     // 首选协议
  fallbackChain: ProtocolLevel[];       // 降级链
  protocolEndpoints: Record<ProtocolLevel, string>;
}

// 示例
const BackendProfile: PlatformProtocolProfile = {
  platformId: 'backend-main',
  preferredProtocol: 'ws',
  fallbackChain: ['ws', 'sse', 'rest'],
  protocolEndpoints: {
    rest: 'https://api.garden.local/v1',
    sse: 'https://api.garden.local/v1/events',
    ws: 'wss://api.garden.local/ws',
  },
};
```

**效果**：前端 `api/client.ts` 不再写死 fetch，而是根据目标平台自动选最优协议。

### 3.3 yz 平面连接（功能 × 协议）

每个功能模块声明自己的协议需求，系统自动匹配：

```typescript
interface ModuleProtocolRequirement {
  moduleId: ModuleId;
  required: ProtocolLevel[];   // 必须要有
  preferred: ProtocolLevel;     // 最好有
  streaming: boolean;          // 是否需要流式
}

// Dialog 模块：需要流式，首选 WebSocket
const DialogProtocolReq: ModuleProtocolRequirement = {
  moduleId: 'dialog',
  required: ['rest'],
  preferred: 'ws',
  streaming: true,
};

// Settings 模块：不需要流式，REST 足够
const SettingsProtocolReq: ModuleProtocolRequirement = {
  moduleId: 'settings',
  required: ['rest'],
  preferred: 'rest',
  streaming: false,
};
```

**效果**：创建 Dialog 时自动走 WebSocket，修改 Settings 时走 REST —— 不需要程序员手动选择。

---

## 4. 架构实现图

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (x=frontend)                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │ Agents  │ │ Groups  │ │ Dialogs │ │ Skills  │ │ Monitor │  │ ← y轴
│  │  (page) │ │  (page) │ │(DialogCenter)│ (page) │ │(panel)  │  │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘  │
│       └────────────┴──────────┴──────────┴──────────┘         │
│                         │                                        │
│                    ┌────┴────┐                                   │
│                    │ AxisClient │  ← 统一前端客户端                │
│                    │ (api/client.ts v2) │                       │
│                    └────┬────┘                                   │
└─────────────────────────┼───────────────────────────────────────┘
                          │ AxisMessage (over WS/SSE/REST)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                        BACKEND (x=backend)                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    AxisGateway                           │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │    │
│  │  │AxisRouter│  │Protocol │  │Registry │  │Transform│   │    │
│  │  │         │  │Adapter  │  │         │  │  Layer  │   │    │
│  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘   │    │
│  │       └─────────────┴────────────┴────────────┘         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                          │                                       │
│  ┌─────────┐ ┌─────────┐ │ ┌─────────┐ ┌─────────┐ ┌─────────┐ │
│  │ Agent   │ │ Dialog  │ │ │  Group  │ │ Skill   │ │Knowledge│ │ ← y轴
│  │ Service │ │ Service │─┘│ Service │ │ Service │ │ Service │ │
│  └────┬────┘ └────┬────┘  └────┬────┘ └────┬────┘ └────┬────┘ │
│       └────────────┴───────────┴───────────┴──────────┘        │
│                          │                                      │
│                    ┌────┴────┐                                  │
│                    │ InternalBus  ← z轴：内部消息总线             │
│                    │ (CollabFramework/MessageBus)               │
│                    └────┬────┘                                  │
└─────────────────────────┼───────────────────────────────────────┘
                          │ AxisMessage (over Bridge)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     AGENT-ZERO (x=agentzero)                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                           │
│  │ agent.py│ │ models  │ │  api/   │  ← 通过 BridgeAdapter 接入 │
│  │(core)   │ │(litellm)│ │(80+ ep) │                           │
│  └─────────┘ └─────────┘ └─────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. 关键实现文件

| 文件 | 职责 | 负责人 |
|---|---|---|
| `AxisMessage.ts` | 消息格式定义 + 验证 | Architect (SYLVA) |
| `AxisRouter.ts` | 3D 路由表 + 寻址逻辑 | Architect (SYLVA) |
| `AxisRegistry.ts` | 平台节点注册/发现/健康检查 | Backend Core (咨询师) |
| `ProtocolAdapter/` | REST/SSE/WS/Internal/Bridge 适配器 | Backend Core (咨询师) |
| `AxisClient.ts` | 前端统一客户端 (api/client.ts v2) | Frontend (OpenClaw-5PW) |
| `ModuleContract/` | 各功能模块的接口契约定义 | Architect (SYLVA) |
| `TransformLayer.ts` | 旧接口 → AxisMessage 兼容转换 | Backend Core (咨询师) |

---

## 6. 迁移策略

### Phase 1: 协议层统一（z轴）
1. 实现 AxisMessage 格式 + 验证
2. 实现 ProtocolAdapter 五协议适配器
3. 后端 Gateway 层接入 AxisRouter
4. 前端 api/client.ts 重写为 AxisClient

### Phase 2: 功能层统一（y轴）
1. 为每个功能模块编写 ModuleContract
2. 后端 Service 层统一暴露 AxisMessage 接口
3. 前端 pages 统一通过 AxisClient 调用

### Phase 3: 平台层统一（x轴）
1. AxisRegistry 注册中心上线
2. AgentZero 通过 BridgeAdapter 接入
3. 50+ 平台实例全部注册为 PlatformNode
4. 自动路由 + 健康检查 + 负载均衡

### Phase 4: 全图验证
1. xy/xz/yz 三个平面的 E2E 测试
2. 任意两点通信压力测试
3. 协议降级、故障转移测试

---

## 7. 接口协议统一的核心收益

| 场景 | 改造前 | 改造后 |
|---|---|---|
| 前端新增一个功能模块 | 重写 api 调用、错误处理、loading 状态 | 声明 ModuleContract，自动接入 |
| 后端新增一个服务 | 新增路由、handler、类型定义 | 暴露 AxisMessage 接口，自动注册 |
| 接入新的 LLM Provider | 新增 Adapter 类 | 已有的 OpenAICompatibleAdapter 直接复用 |
| 前端 ↔ AgentZero 直连 | 必须绕过后端 | AxisRouter 自动路由，可直连可中转 |
| 协议升级（如 REST→WS） | 全量重写调用代码 | 改 ProtocolAdapter 配置，业务层无感知 |

---

**文档版本**: v1.0  
**牵头人**: TOE Sʏʟᴠᴀ  
**状态**: 架构设计完成，待分配实现
