// ============================================================
// Hermes Adapter
// ============================================================
// Native protocol: ACP (Agent Communication Protocol) over JSON-RPC 2.0
//
// Known methods (from AionUI / TeamMcpServer):
//   Initialize          → session/new
//   TeamMcpServer       → team_send_message, team_spawn_agent
//   Session lifecycle   → session/update, session/heartbeat
//
// Field mapping (UnifiedMessage ↔ HermesACPMessage):
//   msg.type === "task_request"  → JSON-RPC request: method="team_send_message"
//   msg.type === "task_result"   → JSON-RPC notification: method="session/update"
//   msg.type === "heartbeat"     → JSON-RPC notification: method="session/heartbeat"
//   msg.type === "error"         → JSON-RPC notification: method="session/error"
//   msg.type === "retry"         → JSON-RPC request: method="team_send_message" (with retry flag)
//   msg.type === "status_query"  → JSON-RPC request: method="session/status"
//   msg.type === "cancel"        → JSON-RPC request: method="session/cancel"
//   msg.id                       → JSON-RPC id (if request)
//   msg.taskId                   → params.task_id
//   msg.from.agentId             → params.sender_id
//   msg.to.agentId               → params.recipient_id
//   msg.payload.subtask          → params.subtask (MCP tool input)
//   msg.payload.result.output     → params.output
//   auth token                   → params.acp_token (injected)
//   endpoint                     → stdio or http://localhost

import {
  CrossPlatformMessage,
  MessageType,
  MessagePayload,
  TaskRequestPayload,
  TaskResultPayload,
  HeartbeatPayload,
  ErrorPayload,
  RetryPayload,
} from '../types';
import {
  PlatformAdapter,
  makeAgentAddress,
  createMinimalSubTask,
  createMinimalTaskResult,
} from './types';

/**
 * JSON-RPC 2.0 message — can be a Request, Notification, Response, or Error.
 */
export interface HermesACPMessage {
  jsonrpc: '2.0';

  /** Present for requests / notifications. */
  method?: string;

  /** Params for requests / notifications. */
  params?: Record<string, unknown>;

  /** Present for requests (optional for notifications). */
  id?: string | number | null;

  /** Present for successful responses. */
  result?: Record<string, unknown>;

  /** Present for error responses. */
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Map unified MessageType → ACP method name.
 */
function msgTypeToHermesMethod(type: MessageType): string {
  switch (type) {
    case 'task_request':
      return 'team_send_message';
    case 'task_result':
      return 'session/update';
    case 'heartbeat':
      return 'session/heartbeat';
    case 'error':
      return 'session/error';
    case 'retry':
      return 'team_send_message';
    case 'status_query':
      return 'session/status';
    case 'cancel':
      return 'session/cancel';
    default:
      return 'team_send_message';
  }
}

/**
 * Reverse mapping: ACP method → unified MessageType (best-effort).
 */
function hermesMethodToMsgType(method: string): MessageType {
  switch (method) {
    case 'team_send_message':
      return 'task_request';
    case 'session/update':
      return 'task_result';
    case 'session/heartbeat':
      return 'heartbeat';
    case 'session/error':
      return 'error';
    case 'session/status':
      return 'status_query';
    case 'session/cancel':
      return 'cancel';
    default:
      return 'task_request';
  }
}

/**
 * Build JSON-RPC params from a unified message.
 */
function buildHermesParams(msg: CrossPlatformMessage): Record<string, unknown> {
  const base: Record<string, unknown> = {
    task_id: msg.taskId,
    sender_id: msg.from.agentId,
    sender_platform: msg.from.platform,
    recipient_id: msg.to.agentId,
    recipient_platform: msg.to.platform,
    timestamp: msg.timestamp,
    deadline: msg.deadline,
    retry_count: msg.retryCount,
    priority: msg.priority,
  };

  switch (msg.type) {
    case 'task_request': {
      const p = msg.payload as TaskRequestPayload;
      return {
        ...base,
        subtask: p.subtask ?? null,
        context: p.context ?? '',
        dependencies: p.dependencies ?? {},
      };
    }

    case 'task_result': {
      const p = msg.payload as TaskResultPayload;
      return {
        ...base,
        output: p.result?.output ?? '',
        quality_score: p.result?.qualityScore ?? 0,
        status: p.result?.status ?? 'completed',
        metadata: p.result?.metadata ?? {},
      };
    }

    case 'heartbeat': {
      const p = msg.payload as HeartbeatPayload;
      return {
        ...base,
        agent_status: p.agentStatus,
        queue_depth: p.queueDepth,
        load_factor: p.loadFactor,
      };
    }

    case 'error': {
      const p = msg.payload as ErrorPayload;
      return {
        ...base,
        error_code: p.code,
        error_message: p.message,
        recoverable: p.recoverable,
        suggested_action: p.suggestedAction,
        context: p.context,
      };
    }

    case 'retry': {
      const p = msg.payload as RetryPayload;
      return {
        ...base,
        original_message_id: p.originalMessageId,
        reason: p.reason,
        delay_ms: p.delayMs,
      };
    }

    case 'status_query':
    case 'cancel':
      return { ...base, message_type: msg.type };

    default: {
      const _exhaustive: never = msg.type;
      return { ...base, raw_type: _exhaustive };
    }
  }
}

/**
 * Reconstruct a unified message from a Hermes JSON-RPC frame.
 */
function parseHermesMessage(acp: HermesACPMessage): CrossPlatformMessage {
  const now = Date.now();
  const method = acp.method ?? '';
  const p = acp.params ?? {};
  const msgType = hermesMethodToMsgType(method);

  const from = makeAgentAddress(
    (p.sender_id as string) ?? 'hermes-agent',
    ((p.sender_platform as string) ?? 'hermes') as import('../types').Platform
  );
  const to = makeAgentAddress(
    (p.recipient_id as string) ?? 'coordinator',
    ((p.recipient_platform as string) ?? 'generic') as import('../types').Platform
  );
  const taskId = (p.task_id as string) ?? 'unknown';
  const msgId = acp.id !== undefined && acp.id !== null ? String(acp.id) : `hermes-${now}`;

  const payload = buildPayloadFromHermesParams(msgType, p, taskId);

  return {
    id: msgId,
    taskId,
    from,
    to,
    type: msgType,
    payload,
    timestamp: (p.timestamp as number) ?? now,
    deadline: (p.deadline as number) ?? now + 30000,
    retryCount: (p.retry_count as number) ?? 0,
    priority: (p.priority as number) ?? 5,
  };
}

/**
 * Build a unified payload from Hermes params.
 */
function buildPayloadFromHermesParams(
  type: MessageType,
  p: Record<string, unknown>,
  taskId: string
): MessagePayload {
  switch (type) {
    case 'task_request': {
      const rawSubtask = p.subtask as Record<string, unknown> | undefined;
      const subtask = rawSubtask
        ? createMinimalSubTask(
            (rawSubtask.id as string) ?? taskId,
            (rawSubtask.description as string) ?? 'Hermes subtask',
            ((rawSubtask.role as string) ?? 'researcher') as import('../types').AgentRole,
            'hermes'
          )
        : createMinimalSubTask(taskId, 'Recovered Hermes subtask', 'researcher', 'hermes');
      return {
        subtask,
        context: (p.context as string) ?? '',
        dependencies: (p.dependencies as Record<string, unknown>) ?? {},
      } as TaskRequestPayload;
    }

    case 'task_result': {
      return {
        result: createMinimalTaskResult(
          taskId,
          (p.sender_id as string) ?? 'hermes-agent',
          (p.output as string) ?? ''
        ),
      } as TaskResultPayload;
    }

    case 'heartbeat': {
      return {
        agentStatus: (p.agent_status as string) ?? 'healthy',
        queueDepth: (p.queue_depth as number) ?? 0,
        loadFactor: (p.load_factor as number) ?? 0,
      } as HeartbeatPayload;
    }

    case 'error': {
      return {
        code: (p.error_code as string) ?? 'ERR_HERMES_FALLBACK',
        message: (p.error_message as string) ?? 'Recovered from Hermes ACP frame',
        recoverable: (p.recoverable as boolean) ?? true,
        suggestedAction: (p.suggested_action as string) ?? 'retry',
        context: (p.context as Record<string, unknown>) ?? {},
      } as ErrorPayload;
    }

    case 'retry': {
      return {
        originalMessageId: (p.original_message_id as string) ?? taskId,
        reason: (p.reason as string) ?? 'Recovered retry',
        delayMs: (p.delay_ms as number) ?? 1000,
      } as RetryPayload;
    }

    case 'status_query':
    case 'cancel':
    default: {
      // Default fallback to task_request so the message is never silently lost.
      return {
        subtask: createMinimalSubTask(taskId, `Hermes method=${type}`, 'researcher', 'hermes'),
        context: '',
        dependencies: {},
      } as TaskRequestPayload;
    }
  }
}

export class HermesAdapter implements PlatformAdapter<HermesACPMessage> {
  readonly platform = 'hermes' as const;
  readonly endpoint = 'stdio';

  // ───────────────────────── toNative ─────────────────────────
  toNative(msg: CrossPlatformMessage): HermesACPMessage {
    const method = msgTypeToHermesMethod(msg.type);
    const isNotification =
      msg.type === 'heartbeat' || msg.type === 'error' || msg.type === 'task_result';

    return {
      jsonrpc: '2.0',
      method,
      params: buildHermesParams(msg),
      id: isNotification ? undefined : msg.id,
    };
  }

  // ───────────────────────── fromNative ─────────────────────────
  fromNative(frame: HermesACPMessage): CrossPlatformMessage {
    return parseHermesMessage(frame);
  }

  // ───────────────────────── injectAuth ─────────────────────────
  injectAuth(frame: HermesACPMessage, token: string): HermesACPMessage {
    return {
      ...frame,
      params: {
        ...frame.params,
        acp_token: token,
      },
    };
  }
}
