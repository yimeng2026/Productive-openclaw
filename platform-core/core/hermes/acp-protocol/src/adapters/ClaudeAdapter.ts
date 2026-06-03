// ============================================================
// Claude Adapter
// ============================================================
// Native protocol: Claude Messages API + Tool use / Tool result
//
// Messages API shape:
//   { role: "user" | "assistant", content: ContentBlock[] }
//
// ContentBlock variants:
//   { type: "text", text: string }
//   { type: "tool_use", id: string, name: string, input: object }
//   { type: "tool_result", tool_use_id: string, content: string }
//
// Field mapping (UnifiedMessage ↔ ClaudeMessage):
//   msg.type === "task_request"  → content block tool_use (name="execute_subtask")
//   msg.type === "task_result"   → content block tool_result
//   msg.type === "heartbeat"       → text block with JSON status
//   msg.type === "error"         → text block with error description
//   msg.type === "retry"         → text block with retry instructions
//   msg.type === "status_query"  → text block asking for status
//   msg.type === "cancel"        → text block requesting cancellation
//   msg.id, msg.taskId           → injected into tool_use.id / text preamble
//   msg.payload.subtask          → tool_use.input.subtask
//   msg.payload.result.output     → tool_result.content
//   auth token                   → _metadata.apiKey (for HTTP header injection)
//   endpoint                     → https://api.anthropic.com/v1/messages

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

export type ClaudeRole = 'user' | 'assistant';

export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    };

export interface ClaudeMessage {
  role: ClaudeRole;
  content: ClaudeContentBlock[];
  /** Internal metadata — not sent to Claude API, used for header injection. */
  _metadata?: {
    apiKey?: string;
    model?: string;
    max_tokens?: number;
  };
}

/**
 * Decide the Claude role based on unified message type and direction.
 * Messages *to* an agent are "user" requests; messages *from* an agent are "assistant".
 */
function decideRole(msg: CrossPlatformMessage): ClaudeRole {
  // Heuristic: if the sender is a coordinator, treat as user.
  if (msg.from.agentId === 'coordinator' || msg.from.agentId === 'user') {
    return 'user';
  }
  return 'assistant';
}

/**
 * Build Claude content blocks from a unified message.
 */
function buildContentBlocks(msg: CrossPlatformMessage): ClaudeContentBlock[] {
  switch (msg.type) {
    case 'task_request': {
      const p = msg.payload as TaskRequestPayload;
      const subtaskDesc = p.subtask?.description ?? p.subtask?.id ?? 'subtask';
      return [
        {
          type: 'tool_use',
          id: msg.id,
          name: 'execute_subtask',
          input: {
            taskId: msg.taskId,
            subtaskId: p.subtask?.id,
            description: subtaskDesc,
            context: p.context,
            dependencies: p.dependencies,
            priority: msg.priority,
            deadline: msg.deadline,
          },
        },
      ];
    }

    case 'task_result': {
      const p = msg.payload as TaskResultPayload;
      return [
        {
          type: 'tool_result',
          tool_use_id: msg.taskId,
          content: p.result?.output ?? JSON.stringify(p),
        },
      ];
    }

    case 'heartbeat': {
      const p = msg.payload as HeartbeatPayload;
      return [
        {
          type: 'text',
          text: `[heartbeat] status=${p.agentStatus} queue=${p.queueDepth} load=${p.loadFactor.toFixed(2)}`,
        },
      ];
    }

    case 'error': {
      const p = msg.payload as ErrorPayload;
      return [
        {
          type: 'text',
          text: `[error] code=${p.code} recoverable=${p.recoverable} action=${p.suggestedAction} msg=${p.message}`,
        },
      ];
    }

    case 'retry': {
      const p = msg.payload as RetryPayload;
      return [
        {
          type: 'text',
          text: `[retry] original=${p.originalMessageId} reason=${p.reason} delayMs=${p.delayMs}`,
        },
      ];
    }

    case 'status_query':
      return [
        {
          type: 'text',
          text: `[status_query] taskId=${msg.taskId} from=${msg.from.agentId}`,
        },
      ];

    case 'cancel':
      return [
        {
          type: 'text',
          text: `[cancel] taskId=${msg.taskId} requested by ${msg.from.agentId}`,
        },
      ];

    default: {
      // Exhaustive fallback
      const _exhaustive: never = msg.type;
      return [{ type: 'text', text: `[unknown type=${_exhaustive}]` }];
    }
  }
}

/**
 * Parse a ClaudeMessage back into a unified message.
 */
function parseClaudeMessage(claude: ClaudeMessage): CrossPlatformMessage {
  const now = Date.now();
  // Try to detect the intended unified type from content blocks.
  const toolUse = claude.content.find((b) => b.type === 'tool_use') as
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    | undefined;
  const toolResult = claude.content.find((b) => b.type === 'tool_result') as
    | { type: 'tool_result'; tool_use_id: string; content: string }
    | undefined;
  const textBlock = claude.content.find((b) => b.type === 'text') as
    | { type: 'text'; text: string }
    | undefined;

  if (toolUse) {
    const input = toolUse.input ?? {};
    const taskId = (input.taskId as string) ?? toolUse.id;
    const subtaskId = (input.subtaskId as string) ?? 'unknown';
    const description = (input.description as string) ?? toolUse.name;
    const context = (input.context as string) ?? '';
    const dependencies = (input.dependencies as Record<string, unknown>) ?? {};
    const subtask = createMinimalSubTask(subtaskId, description, 'researcher', 'claude');

    return {
      id: toolUse.id,
      taskId,
      from: makeAgentAddress('claude-agent', 'claude'),
      to: makeAgentAddress('coordinator', 'generic'),
      type: 'task_request',
      payload: {
        subtask,
        context,
        dependencies: dependencies as Record<string, TaskResultPayload['result']>,
      } as TaskRequestPayload,
      timestamp: now,
      deadline: now + 30000,
      retryCount: 0,
      priority: 5,
    };
  }

  if (toolResult) {
    return {
      id: `claude-result-${now}`,
      taskId: toolResult.tool_use_id,
      from: makeAgentAddress('claude-agent', 'claude'),
      to: makeAgentAddress('coordinator', 'generic'),
      type: 'task_result',
      payload: {
        result: createMinimalTaskResult(
          toolResult.tool_use_id,
          'claude-agent',
          toolResult.content
        ),
      } as TaskResultPayload,
      timestamp: now,
      deadline: now + 30000,
      retryCount: 0,
      priority: 5,
    };
  }

  // Default: treat as a task_result containing the text.
  const text = textBlock?.text ?? '';
  const derivedType = detectTypeFromText(text);

  return {
    id: `claude-msg-${now}`,
    taskId: 'unknown',
    from: makeAgentAddress('claude-agent', 'claude'),
    to: makeAgentAddress('coordinator', 'generic'),
    type: derivedType,
    payload: buildPayloadFromText(derivedType, text, now),
    timestamp: now,
    deadline: now + 30000,
    retryCount: 0,
    priority: 5,
  };
}

/** Heuristic: scan text prefix to guess the original unified type. */
function detectTypeFromText(text: string): MessageType {
  if (text.startsWith('[heartbeat]')) return 'heartbeat';
  if (text.startsWith('[error]')) return 'error';
  if (text.startsWith('[retry]')) return 'retry';
  if (text.startsWith('[status_query]')) return 'status_query';
  if (text.startsWith('[cancel]')) return 'cancel';
  return 'task_result';
}

/** Build a minimal payload from parsed text. */
function buildPayloadFromText(
  type: MessageType,
  text: string,
  _now: number
): MessagePayload {
  switch (type) {
    case 'heartbeat':
      return {
        agentStatus: 'healthy',
        queueDepth: 0,
        loadFactor: 0,
      } as HeartbeatPayload;
    case 'error':
      return {
        code: 'ERR_CLAUDE_FALLBACK',
        message: text,
        recoverable: true,
        suggestedAction: 'retry',
        context: {},
      } as ErrorPayload;
    case 'retry': {
      const parts = text.split(' ');
      const delayMatch = parts.find((p) => p.startsWith('delayMs='));
      return {
        originalMessageId: 'unknown',
        reason: text,
        delayMs: delayMatch ? parseInt(delayMatch.split('=')[1], 10) || 1000 : 1000,
      } as RetryPayload;
    }
    case 'status_query':
      return {
        subtask: createMinimalSubTask('unknown', text, 'researcher', 'claude'),
        context: '',
        dependencies: {},
      } as TaskRequestPayload;
    case 'cancel':
      return {
        subtask: createMinimalSubTask('unknown', text, 'researcher', 'claude'),
        context: '',
        dependencies: {},
      } as TaskRequestPayload;
    case 'task_result':
      return {
        result: createMinimalTaskResult('unknown', 'claude-agent', text),
      } as TaskResultPayload;
    case 'task_request':
      return {
        subtask: createMinimalSubTask('unknown', text, 'researcher', 'claude'),
        context: '',
        dependencies: {},
      } as TaskRequestPayload;
    default: {
      const _exhaustive: never = type;
      return {
        result: createMinimalTaskResult('unknown', 'claude-agent', `Unhandled: ${_exhaustive}`),
      } as TaskResultPayload;
    }
  }
}

export class ClaudeAdapter implements PlatformAdapter<ClaudeMessage> {
  readonly platform = 'claude' as const;
  readonly endpoint = 'https://api.anthropic.com/v1/messages';

  // ───────────────────────── toNative ─────────────────────────
  toNative(msg: CrossPlatformMessage): ClaudeMessage {
    return {
      role: decideRole(msg),
      content: buildContentBlocks(msg),
    };
  }

  // ───────────────────────── fromNative ─────────────────────────
  fromNative(frame: ClaudeMessage): CrossPlatformMessage {
    return parseClaudeMessage(frame);
  }

  // ───────────────────────── injectAuth ─────────────────────────
  injectAuth(frame: ClaudeMessage, token: string): ClaudeMessage {
    return {
      ...frame,
      _metadata: {
        ...frame._metadata,
        apiKey: token,
      },
    };
  }
}
