// ============================================================
// Ollama Adapter
// ============================================================
// Native protocol: Ollama HTTP API (POST /api/generate)
//
// Request shape:
//   { model: string, prompt: string, system?: string, stream?: boolean, options?: object }
//
// Response shape:
//   { model: string, response: string, done: boolean, created_at?: string }
//
// Field mapping (UnifiedMessage ↔ OllamaRequest / OllamaResponse):
//   msg.type === "task_request"  → prompt = system + "\n\nUser: " + subtask.description
//   msg.type === "task_result"   → prompt = system + "\n\nResult: " + result.output
//   msg.type === "heartbeat"     → prompt = "[system] heartbeat status=..."
//   msg.type === "error"         → prompt = "[system] error code=..."
//   msg.type === "retry"         → prompt = "[system] retry reason=..."
//   msg.type === "status_query"  → prompt = "[system] status query"
//   msg.type === "cancel"        → prompt = "[system] cancel taskId=..."
//   msg.id                       → options.swarm_msg_id (passthrough)
//   msg.taskId                   → options.swarm_task_id (passthrough)
//   msg.priority                 → options.swarm_priority (passthrough)
//   response.response            → result.output (task_result payload)
//   auth                         → none (local service)
//   endpoint                     → http://localhost:11434

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

export interface OllamaRequest {
  model: string;
  prompt: string;
  system?: string;
  stream?: boolean;
  options?: Record<string, unknown>;
}

export interface OllamaResponse {
  model: string;
  response: string;
  done: boolean;
  created_at?: string;
  context?: number[];       // conversation context tokens
  total_duration?: number; // nanoseconds
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Default model used when none is configured. */
const DEFAULT_MODEL = 'llama3';

/** Default system prompt for swarm tasks. */
const DEFAULT_SYSTEM =
  'You are an agent in a cross-platform swarm. Follow instructions precisely and return concise results.';

/**
 * Build the user prompt from a unified message.
 */
function buildPrompt(msg: CrossPlatformMessage): string {
  switch (msg.type) {
    case 'task_request': {
      const p = msg.payload as TaskRequestPayload;
      const desc = p.subtask?.description ?? p.subtask?.id ?? 'No description';
      const ctx = p.context ? `\nContext: ${p.context}` : '';
      const deps = Object.keys(p.dependencies ?? {}).length
        ? `\nDependencies: ${Object.keys(p.dependencies).join(', ')}`
        : '';
      return `Task ${msg.taskId}:\n${desc}${ctx}${deps}\n\nRespond with the completed output.`;
    }

    case 'task_result': {
      const p = msg.payload as TaskResultPayload;
      return `Result for ${msg.taskId}:\n${p.result?.output ?? ''}`;
    }

    case 'heartbeat': {
      const p = msg.payload as HeartbeatPayload;
      return `[heartbeat] status=${p.agentStatus} queue=${p.queueDepth} load=${p.loadFactor.toFixed(2)}`;
    }

    case 'error': {
      const p = msg.payload as ErrorPayload;
      return `[error] code=${p.code} recoverable=${p.recoverable} action=${p.suggestedAction} message=${p.message}`;
    }

    case 'retry': {
      const p = msg.payload as RetryPayload;
      return `[retry] original=${p.originalMessageId} reason=${p.reason} delayMs=${p.delayMs}`;
    }

    case 'status_query':
      return `[status_query] taskId=${msg.taskId} from=${msg.from.agentId}`;

    case 'cancel':
      return `[cancel] taskId=${msg.taskId} requested by ${msg.from.agentId}`;

    default: {
      const _exhaustive: never = msg.type;
      return `[unknown type=${_exhaustive}]`;
    }
  }
}

/**
 * Build passthrough options so downstream code can correlate Ollama
 * responses with the original swarm message.
 */
function buildOptions(msg: CrossPlatformMessage): Record<string, unknown> {
  return {
    swarm_msg_id: msg.id,
    swarm_task_id: msg.taskId,
    swarm_priority: msg.priority,
    swarm_retry_count: msg.retryCount,
    swarm_deadline: msg.deadline,
  };
}

/**
 * Detect unified type from a raw Ollama response (best-effort heuristic).
 */
function detectTypeFromResponse(response: OllamaResponse): MessageType {
  const text = response.response ?? '';
  if (text.startsWith('[heartbeat]')) return 'heartbeat';
  if (text.startsWith('[error]')) return 'error';
  if (text.startsWith('[retry]')) return 'retry';
  if (text.startsWith('[status_query]')) return 'status_query';
  if (text.startsWith('[cancel]')) return 'cancel';
  if (text.startsWith('[task_request]')) return 'task_request';
  // Default: treat everything else as a task result.
  return 'task_result';
}

/**
 * Build a unified payload from an Ollama response.
 */
function buildPayloadFromResponse(
  type: MessageType,
  response: OllamaResponse
): MessagePayload {
  const text = response.response ?? '';
  const model = response.model ?? 'unknown';

  switch (type) {
    case 'task_request': {
      const body = text.replace(/^\[task_request\]\s*/, '');
      return {
        subtask: createMinimalSubTask('ollama-gen', body, 'researcher', 'ollama'),
        context: `Generated by model ${model}`,
        dependencies: {},
      } as TaskRequestPayload;
    }

    case 'task_result': {
      return {
        result: createMinimalTaskResult('ollama-task', model, text),
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
        code: 'ERR_OLLAMA_FALLBACK',
        message: text,
        recoverable: true,
        suggestedAction: 'retry',
        context: { model, response_metadata: response },
      } as ErrorPayload;
    }

    case 'retry': {
      return {
        originalMessageId: 'unknown',
        reason: text,
        delayMs: 1000,
      } as RetryPayload;
    }

    case 'status_query':
    case 'cancel':
    default: {
      // Fallback to task_result so generated text is never lost.
      return {
        result: createMinimalTaskResult('ollama-fallback', model, text),
      } as TaskResultPayload;
    }
  }
}

export class OllamaAdapter implements PlatformAdapter<OllamaRequest> {
  readonly platform = 'ollama' as const;
  readonly endpoint = 'http://localhost:11434';

  private defaultModel: string;
  private defaultSystem: string;

  constructor(model = DEFAULT_MODEL, system = DEFAULT_SYSTEM) {
    this.defaultModel = model;
    this.defaultSystem = system;
  }

  // ───────────────────────── toNative ─────────────────────────
  toNative(msg: CrossPlatformMessage): OllamaRequest {
    return {
      model: this.defaultModel,
      system: this.defaultSystem,
      prompt: buildPrompt(msg),
      stream: false,
      options: buildOptions(msg),
    };
  }

  // ───────────────────────── fromNative ─────────────────────────
  /**
   * Ollama responses are not full envelopes; they carry the generated text.
   * We wrap that text into a task_result payload so the swarm can process it.
   */
  fromNative(response: OllamaRequest): CrossPlatformMessage {
    // OllamaRequest itself is used as the "native frame" for this adapter.
    // When receiving from Ollama, the actual wire format is OllamaResponse,
    // but for interface uniformity we accept an OllamaRequest-shaped object
    // that carries the response text in the `prompt` field (filled by caller).
    const text = response.prompt ?? '';
    const now = Date.now();
    const msgType = text.startsWith('[heartbeat]')
      ? 'heartbeat'
      : text.startsWith('[error]')
        ? 'error'
        : text.startsWith('[retry]')
          ? 'retry'
          : 'task_result';

    return {
      id: `ollama-${now}`,
      taskId: (response.options?.swarm_task_id as string) ?? 'ollama-generated',
      from: makeAgentAddress('ollama-local', 'ollama'),
      to: makeAgentAddress('coordinator', 'generic'),
      type: msgType,
      payload: buildPayloadFromResponse(msgType, {
        model: response.model,
        response: text,
        done: true,
      }),
      timestamp: now,
      deadline: now + 30000,
      retryCount: 0,
      priority: (response.options?.swarm_priority as number) ?? 5,
    };
  }

  // ───────────────────────── injectAuth ─────────────────────────
  /** Ollama is local-only; auth is a no-op but satisfies the contract. */
  injectAuth(frame: OllamaRequest, _token: string): OllamaRequest {
    return frame;
  }
}

/**
 * Convenience: convert an actual Ollama HTTP /api/generate response
 * into a unified message.  Callers receiving JSON from Ollama should use this.
 */
export function ollamaResponseToUnified(
  response: OllamaResponse,
  taskId?: string
): CrossPlatformMessage {
  const now = Date.now();
  const msgType = detectTypeFromResponse(response);
  const resolvedTaskId = taskId ?? 'ollama-generated';

  return {
    id: `ollama-resp-${now}`,
    taskId: resolvedTaskId,
    from: makeAgentAddress('ollama-local', 'ollama'),
    to: makeAgentAddress('coordinator', 'generic'),
    type: msgType,
    payload: buildPayloadFromResponse(msgType, response),
    timestamp: now,
    deadline: now + 30000,
    retryCount: 0,
    priority: 5,
  };
}
