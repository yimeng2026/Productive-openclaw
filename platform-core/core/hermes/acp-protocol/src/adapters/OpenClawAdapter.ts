// ============================================================
// OpenClaw Adapter
// ============================================================
// Native protocol frame format:
//   Frame: type(1byte) + header_len(4bytes) + JSON_header + file_content
//   type: "req" | "res" | "event" | "tick" | "final"
//
// Field mapping (UnifiedMessage ↔ OpenClawFrame):
//   msg.id                 → header.id
//   msg.taskId             → header.taskId
//   msg.from               → header.from
//   msg.to                 → header.to
//   msg.type               → frame.type (bidirectional mapping)
//   msg.payload.subtask    → header.fn   (only for task_request → req)
//   msg.payload            → header.payloadJson (serialized)
//   msg.priority           → header.priority
//   msg.timestamp          → header.timestamp
//   msg.deadline           → header.deadline
//   msg.retryCount         → header.retryCount
//   auth token             → header.auth ("Bearer <token>")
//   endpoint               → ws://127.0.0.1:18679

import {
  CrossPlatformMessage,
  AgentAddress,
  MessageType,
  TaskRequestPayload,
  TaskResultPayload,
  HeartbeatPayload,
  ErrorPayload,
  RetryPayload,
  MessagePayload,
} from '../types';
import {
  PlatformAdapter,
  messageTypeCategory,
  createMinimalSubTask,
  createMinimalTaskResult,
} from './types';

/** OpenClaw 1-byte frame type. */
export type OpenClawFrameType = 'req' | 'res' | 'event' | 'tick' | 'final';

/** JSON header carried inside every OpenClaw frame. */
export interface OpenClawHeader {
  id: string;
  taskId: string;
  from: AgentAddress;
  to: AgentAddress;
  /** Injected when payload.subtask is present (task_request → req). */
  fn?: string;
  priority: number;
  timestamp: number;
  deadline: number;
  retryCount: number;
  /** Authorization: Bearer <token> (injected via injectAuth). */
  auth?: string;
  /** Human-readable category derived from msg.type. */
  payloadCategory: string;
  /** JSON-serialized payload (exact shape restored in fromNative). */
  payloadJson: string;
}

/** Full OpenClaw native frame. */
export interface OpenClawFrame {
  type: OpenClawFrameType;
  header: OpenClawHeader;
  /** Optional binary attachment (file content). */
  fileContent?: Uint8Array;
}

/**
 * Mapping: unified MessageType → OpenClawFrameType.
 */
function msgTypeToOpenClaw(type: MessageType): OpenClawFrameType {
  switch (type) {
    case 'task_request':
    case 'retry':
    case 'status_query':
    case 'cancel':
      return 'req';
    case 'task_result':
      return 'res';
    case 'heartbeat':
      return 'tick';
    case 'error':
      return 'event';
    default:
      return 'req';
  }
}

/**
 * Mapping: OpenClawFrameType → unified MessageType.
 * Note: the reverse is lossy; we default to task_request for 'req'.
 */
function openClawToMsgType(type: OpenClawFrameType): MessageType {
  switch (type) {
    case 'req':
      return 'task_request';
    case 'res':
      return 'task_result';
    case 'event':
      return 'error';
    case 'tick':
      return 'heartbeat';
    case 'final':
      return 'task_result';
    default:
      return 'task_request';
  }
}

/** Extract the "fn" value from a task_request payload. */
function extractFn(payload: MessagePayload): string | undefined {
  if ('subtask' in payload && payload.subtask) {
    return payload.subtask.description ?? payload.subtask.id;
  }
  return undefined;
}

export class OpenClawAdapter implements PlatformAdapter<OpenClawFrame> {
  readonly platform = 'openclaw' as const;
  readonly endpoint = 'ws://127.0.0.1:18679';

  // ───────────────────────── toNative ─────────────────────────
  toNative(msg: CrossPlatformMessage): OpenClawFrame {
    const type = msgTypeToOpenClaw(msg.type);
    const header: OpenClawHeader = {
      id: msg.id,
      taskId: msg.taskId,
      from: msg.from,
      to: msg.to,
      fn: extractFn(msg.payload),
      priority: msg.priority,
      timestamp: msg.timestamp,
      deadline: msg.deadline,
      retryCount: msg.retryCount,
      payloadCategory: messageTypeCategory(msg.type),
      payloadJson: JSON.stringify(msg.payload),
    };
    return { type, header };
  }

  // ───────────────────────── fromNative ─────────────────────────
  fromNative(frame: OpenClawFrame): CrossPlatformMessage {
    const h = frame.header;
    const msgType = openClawToMsgType(frame.type);

    // Deserialize payload; on failure build a minimal fallback.
    let payload: MessagePayload;
    try {
      payload = JSON.parse(h.payloadJson) as MessagePayload;
    } catch {
      payload = buildFallbackPayload(msgType, h.fn, h.taskId, h.from.agentId);
    }

    return {
      id: h.id,
      taskId: h.taskId,
      from: h.from,
      to: h.to,
      type: msgType,
      payload,
      timestamp: h.timestamp,
      deadline: h.deadline,
      retryCount: h.retryCount,
      priority: h.priority,
    };
  }

  // ───────────────────────── injectAuth ─────────────────────────
  injectAuth(frame: OpenClawFrame, token: string): OpenClawFrame {
    return {
      ...frame,
      header: {
        ...frame.header,
        auth: `Bearer ${token}`,
      },
    };
  }
}

/** Build a minimal payload when JSON parsing fails or is absent. */
function buildFallbackPayload(
  type: MessageType,
  fn: string | undefined,
  taskId: string,
  agentId: string
): MessagePayload {
  switch (type) {
    case 'task_request': {
      const subtask = createMinimalSubTask(
        taskId,
        fn ?? 'Recovered subtask from OpenClaw frame',
        'researcher',
        'openclaw'
      );
      return {
        subtask,
        context: '',
        dependencies: {},
      } as TaskRequestPayload;
    }
    case 'task_result': {
      return {
        result: createMinimalTaskResult(
          taskId,
          agentId,
          fn ?? 'Recovered result from OpenClaw frame'
        ),
      } as TaskResultPayload;
    }
    case 'heartbeat': {
      return {
        agentStatus: 'healthy',
        queueDepth: 0,
        loadFactor: 0,
      } as HeartbeatPayload;
    }
    case 'error': {
      return {
        code: 'ERR_OPENCLAW_FALLBACK',
        message: fn ?? 'Native frame parsed as error fallback',
        recoverable: true,
        suggestedAction: 'retry',
        context: {},
      } as ErrorPayload;
    }
    case 'retry': {
      return {
        originalMessageId: taskId,
        reason: fn ?? 'Recovered retry from OpenClaw frame',
        delayMs: 1000,
      } as RetryPayload;
    }
    default: {
      // Default to task_request for any unmapped type.
      const subtask = createMinimalSubTask(
        taskId,
        fn ?? 'Unmapped OpenClaw frame fallback',
        'researcher',
        'openclaw'
      );
      return {
        subtask,
        context: '',
        dependencies: {},
      } as TaskRequestPayload;
    }
  }
}
