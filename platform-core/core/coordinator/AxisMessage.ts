/**
 * 3D Axis Connection Protocol — Core Message Format
 * 任意两点 (x₁,y₁,z₁) ↔ (x₂,y₂,z₂) 的统一通信原语
 */

// ───────────────────────── 坐标类型 ─────────────────────────

export type PlatformId = string;   // x轴：如 'frontend-local', 'backend-prod', 'agent-zero-1'
export type ModuleId = string;      // y轴：如 'agent', 'group', 'dialog', 'skill', 'monitor'
export type ProtocolLevel = 'rest' | 'sse' | 'ws' | 'internal' | 'bridge';
export type ActionVerb = 'create' | 'read' | 'update' | 'delete' | 'invoke' | 'stream' | 'subscribe' | 'unsubscribe';

export interface AxisCoordinate {
  x: PlatformId;    // 平台/部署
  y: ModuleId;       // 功能模块
  z: ProtocolLevel; // 协议层（可省略，由路由层自适应）
}

// ───────────────────────── 消息头 ─────────────────────────

export interface AxisMessageHeader {
  /** 全局唯一消息ID */
  msgId: string;
  /** 请求-响应关联ID（RPC模式） */
  correlationId?: string;
  /** 发起方坐标 */
  source: AxisCoordinate;
  /** 目标坐标 */
  target: AxisCoordinate;
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 优先级 0-9，0为最高 */
  priority: number;
  /** 存活时间（毫秒），过期丢弃 */
  ttl: number;
  /** 是否需要响应 */
  expectsReply: boolean;
  /** 重试次数 */
  retryCount: number;
  /** 追踪链（用于分布式追踪） */
  traceChain: string[];
}

// ───────────────────────── 载荷 ─────────────────────────

export interface AxisMessagePayload {
  /** 动作动词 */
  action: ActionVerb;
  /** 实体名 */
  entity: ModuleId;
  /** 具体数据（schema 由 ModuleContract 定义） */
  data: unknown;
  /** 扩展元数据 */
  metadata: Record<string, unknown>;
}

// ───────────────────────── 传输层 ─────────────────────────

export interface AxisMessageTransport {
  /** 实际使用的协议（由 ProtocolAdapter 层自动填充） */
  protocol: ProtocolLevel;
  /** 编码方式 */
  encoding: 'json' | 'msgpack';
  /** 是否压缩 */
  compressed: boolean;
}

// ───────────────────────── 完整消息 ─────────────────────────

export interface AxisMessage {
  version: '3dacp/v1';
  header: AxisMessageHeader;
  payload: AxisMessagePayload;
  transport: AxisMessageTransport;
}

// ───────────────────────── 响应消息 ─────────────────────────

export interface AxisMessageReply {
  version: '3dacp/v1';
  header: AxisMessageHeader;
  /** 结果状态 */
  status: 'ok' | 'error' | 'partial' | 'stream';
  /** 响应数据或错误信息 */
  data: unknown;
  /** 错误详情 */
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// ───────────────────────── 流式块 ─────────────────────────

export interface AxisStreamChunk {
  /** 所属流的消息ID */
  streamId: string;
  /** 块序号 */
  sequence: number;
  /** 是否最后一块 */
  isLast: boolean;
  /** 块数据 */
  chunk: unknown;
  /** 元数据（如 token 数、延迟等） */
  metadata?: Record<string, unknown>;
}

// ───────────────────────── 工厂函数 ─────────────────────────

let _msgIdCounter = 0;
function generateMsgId(): string {
  return `${Date.now().toString(36)}-${(++_msgIdCounter).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createAxisMessage(
  source: AxisCoordinate,
  target: AxisCoordinate,
  action: ActionVerb,
  entity: ModuleId,
  data: unknown,
  opts?: {
    correlationId?: string;
    priority?: number;
    ttl?: number;
    expectsReply?: boolean;
    metadata?: Record<string, unknown>;
  }
): AxisMessage {
  const now = Date.now();
  return {
    version: '3dacp/v1',
    header: {
      msgId: generateMsgId(),
      correlationId: opts?.correlationId,
      source,
      target,
      timestamp: now,
      priority: opts?.priority ?? 5,
      ttl: opts?.ttl ?? 30000,
      expectsReply: opts?.expectsReply ?? true,
      retryCount: 0,
      traceChain: [],
    },
    payload: {
      action,
      entity,
      data,
      metadata: opts?.metadata ?? {},
    },
    transport: {
      protocol: target.z ?? 'rest',
      encoding: 'json',
      compressed: false,
    },
  };
}

export function createReply(
  original: AxisMessage,
  status: 'ok' | 'error' | 'partial' | 'stream',
  data: unknown,
  error?: AxisMessageReply['error']
): AxisMessageReply {
  return {
    version: '3dacp/v1',
    header: {
      msgId: generateMsgId(),
      correlationId: original.header.msgId,
      source: original.header.target,
      target: original.header.source,
      timestamp: Date.now(),
      priority: original.header.priority,
      ttl: original.header.ttl,
      expectsReply: false,
      retryCount: 0,
      traceChain: [...original.header.traceChain, original.header.msgId],
    },
    status,
    data,
    error,
  };
}

// ───────────────────────── 验证 ─────────────────────────

export function validateAxisMessage(msg: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!msg || typeof msg !== 'object') {
    errors.push('Message must be an object');
    return { valid: false, errors };
  }

  const m = msg as Partial<AxisMessage>;

  if (m.version !== '3dacp/v1') errors.push(`Invalid version: ${m.version}`);
  if (!m.header) errors.push('Missing header');
  else {
    if (!m.header.msgId) errors.push('Missing header.msgId');
    if (!m.header.source?.x) errors.push('Missing header.source.x (PlatformId)');
    if (!m.header.source?.y) errors.push('Missing header.source.y (ModuleId)');
    if (!m.header.target?.x) errors.push('Missing header.target.x (PlatformId)');
    if (!m.header.target?.y) errors.push('Missing header.target.y (ModuleId)');
  }
  if (!m.payload) errors.push('Missing payload');
  else {
    if (!m.payload.action) errors.push('Missing payload.action');
    if (!m.payload.entity) errors.push('Missing payload.entity');
  }

  return { valid: errors.length === 0, errors };
}

// ───────────────────────── 快捷构造器 ─────────────────────────

export const AxisMessageBuilder = {
  from(source: AxisCoordinate) {
    return {
      to(target: AxisCoordinate) {
        return {
          create(entity: ModuleId, data: unknown, opts?: Parameters<typeof createAxisMessage>[5]) {
            return createAxisMessage(source, target, 'create', entity, data, opts);
          },
          read(entity: ModuleId, data: unknown, opts?: Parameters<typeof createAxisMessage>[5]) {
            return createAxisMessage(source, target, 'read', entity, data, opts);
          },
          update(entity: ModuleId, data: unknown, opts?: Parameters<typeof createAxisMessage>[5]) {
            return createAxisMessage(source, target, 'update', entity, data, opts);
          },
          delete(entity: ModuleId, data: unknown, opts?: Parameters<typeof createAxisMessage>[5]) {
            return createAxisMessage(source, target, 'delete', entity, data, opts);
          },
          invoke(entity: ModuleId, data: unknown, opts?: Parameters<typeof createAxisMessage>[5]) {
            return createAxisMessage(source, target, 'invoke', entity, data, opts);
          },
          stream(entity: ModuleId, data: unknown, opts?: Parameters<typeof createAxisMessage>[5]) {
            return createAxisMessage(source, target, 'stream', entity, data, { ...opts, expectsReply: true });
          },
          subscribe(entity: ModuleId, data: unknown, opts?: Parameters<typeof createAxisMessage>[5]) {
            return createAxisMessage(source, target, 'subscribe', entity, data, opts);
          },
        };
      },
    };
  },
};
