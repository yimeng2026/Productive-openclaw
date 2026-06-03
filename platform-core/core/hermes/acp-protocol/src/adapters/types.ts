// ============================================================
// Shared Adapter Types — Cross-Platform Swarm
// ============================================================
// Every platform adapter implements this contract:
//   toNative:   unified envelope → platform-native wire format
//   fromNative: platform-native wire format → unified envelope
//   injectAuth: attach bearer/api-key into the native frame

import {
  CrossPlatformMessage,
  AgentAddress,
  Platform,
  MessageType,
  AgentRole,
  SubTask,
  TaskResult,
  OutputFormat,
  DegradationLevel,
  TaskStatus,
  ResultMetadata,
} from '../types';

/**
 * Generic adapter contract.
 * @template NativeFrame — the wire-format type for a given platform.
 */
export interface PlatformAdapter<NativeFrame> {
  /** Platform key used by the registry. */
  readonly platform: Platform;

  /** Default endpoint (WebSocket / HTTP / stdio descriptor). */
  readonly endpoint: string;

  /** Convert a unified message into the platform's native frame. */
  toNative(msg: CrossPlatformMessage): NativeFrame;

  /** Parse a platform-native frame back into a unified message. */
  fromNative(frame: NativeFrame): CrossPlatformMessage;

  /** Inject an auth token / API key into the native frame. */
  injectAuth(frame: NativeFrame, token: string): NativeFrame;
}

/**
 * Utility: build a minimal AgentAddress.
 */
export function makeAgentAddress(
  agentId: string,
  platform: Platform,
  endpoint?: string
): AgentAddress {
  return endpoint ? { agentId, platform, endpoint } : { agentId, platform };
}

/**
 * Utility: map unified MessageType → a short category string.
 */
export function messageTypeCategory(type: MessageType): string {
  switch (type) {
    case 'task_request':
      return 'request';
    case 'task_result':
      return 'result';
    case 'heartbeat':
      return 'heartbeat';
    case 'error':
      return 'error';
    case 'retry':
      return 'retry';
    case 'status_query':
      return 'query';
    case 'cancel':
      return 'cancel';
    default:
      return 'unknown';
  }
}

/**
 * Build a minimal valid SubTask (required for reconstructing task_request
 * payloads in fromNative when the native frame only carries a description).
 */
export function createMinimalSubTask(
  id: string,
  description: string,
  role: AgentRole = 'researcher',
  platform: Platform = 'generic'
): SubTask {
  const now = Date.now();
  return {
    id,
    parentId: null,
    description,
    role,
    platformPreference: platform,
    platformFallbacks: [],
    inputDependencies: [],
    outputFormat: { type: 'text' } as OutputFormat,
    estimatedComplexity: 5,
    timeoutMs: 30000,
    degradationChain: ['full', 'simplified'] as DegradationLevel[],
    status: 'pending' as TaskStatus,
    assignedAgentId: null,
    result: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
  };
}

/**
 * Build a minimal valid TaskResult.
 */
export function createMinimalTaskResult(
  taskId: string,
  agentId: string,
  output: string,
  status: TaskStatus = 'completed'
): TaskResult {
  return {
    taskId,
    agentId,
    status,
    output,
    metadata: {
      tokensUsed: 0,
      latencyMs: 0,
      toolCalls: [],
    } as ResultMetadata,
    qualityScore: 0.5,
    timestamp: Date.now(),
  };
}
