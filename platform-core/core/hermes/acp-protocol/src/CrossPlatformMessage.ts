import {
  CrossPlatformMessage,
  AgentAddress,
  MessageType,
  MessagePayload,
  TaskRequestPayload,
  TaskResultPayload,
  HeartbeatPayload,
  ErrorPayload,
  RetryPayload,
} from './types';

// ============================================================
// Cross-Platform Message Format
// ============================================================
// Standardized envelope: every message carries taskId, from/to,
// payload, timestamp, deadline, retryCount.
//
// Serialization: JSON (universally compatible)
// Transport abstraction: each platform has an "inbox" (queue);
//   the Coordinator polls inboxes in round-robin.

export class MessageFactory {
  private static idCounter = 0;

  static create(
    taskId: string,
    from: AgentAddress,
    to: AgentAddress,
    type: MessageType,
    payload: MessagePayload,
    deadlineMs: number = 30000,
    priority: number = 5
  ): CrossPlatformMessage {
    const now = Date.now();
    return {
      id: `msg-${++this.idCounter}-${now}`,
      taskId,
      from,
      to,
      type,
      payload,
      timestamp: now,
      deadline: now + deadlineMs,
      retryCount: 0,
      priority: Math.max(1, Math.min(10, priority)),
    };
  }

  static taskRequest(
    taskId: string,
    from: AgentAddress,
    to: AgentAddress,
    payload: TaskRequestPayload,
    deadlineMs?: number
  ): CrossPlatformMessage {
    return this.create(taskId, from, to, 'task_request', payload, deadlineMs, 7);
  }

  static taskResult(
    taskId: string,
    from: AgentAddress,
    to: AgentAddress,
    payload: TaskResultPayload
  ): CrossPlatformMessage {
    return this.create(taskId, from, to, 'task_result', payload, 30000, 6);
  }

  static heartbeat(
    taskId: string,
    from: AgentAddress,
    payload: HeartbeatPayload
  ): CrossPlatformMessage {
    // Heartbeat broadcasts to coordinator
    const to: AgentAddress = { agentId: 'coordinator', platform: from.platform };
    return this.create(taskId, from, to, 'heartbeat', payload, 5000, 3);
  }

  static error(
    taskId: string,
    from: AgentAddress,
    to: AgentAddress,
    payload: ErrorPayload,
    priority: number = 9
  ): CrossPlatformMessage {
    return this.create(taskId, from, to, 'error', payload, 30000, priority);
  }

  static retry(
    taskId: string,
    from: AgentAddress,
    to: AgentAddress,
    payload: RetryPayload
  ): CrossPlatformMessage {
    return this.create(taskId, from, to, 'retry', payload, payload.delayMs + 30000, 8);
  }
}

// Message validation helpers
export class MessageValidator {
  static isExpired(msg: CrossPlatformMessage): boolean {
    return Date.now() > msg.deadline;
  }

  static canRetry(msg: CrossPlatformMessage, maxRetries: number): boolean {
    return msg.retryCount < maxRetries;
  }

  static serialize(msg: CrossPlatformMessage): string {
    return JSON.stringify(msg);
  }

  static deserialize(raw: string): CrossPlatformMessage {
    return JSON.parse(raw) as CrossPlatformMessage;
  }
}

// Platform inbox abstraction
export interface Inbox {
  platform: string;
  enqueue(msg: CrossPlatformMessage): void;
  dequeue(batchSize?: number): CrossPlatformMessage[];
  peek(): CrossPlatformMessage | null;
  size(): number;
  purgeExpired(): number;
}

export class MemoryInbox implements Inbox {
  private queue: CrossPlatformMessage[] = [];

  constructor(public platform: string) {}

  enqueue(msg: CrossPlatformMessage): void {
    // Insert by priority (higher first), then timestamp
    const idx = this.queue.findIndex(
      (m) => m.priority < msg.priority || (m.priority === msg.priority && m.timestamp > msg.timestamp)
    );
    if (idx === -1) {
      this.queue.push(msg);
    } else {
      this.queue.splice(idx, 0, msg);
    }
  }

  dequeue(batchSize: number = 10): CrossPlatformMessage[] {
    return this.queue.splice(0, batchSize);
  }

  peek(): CrossPlatformMessage | null {
    return this.queue[0] ?? null;
  }

  size(): number {
    return this.queue.length;
  }

  purgeExpired(): number {
    const before = this.queue.length;
    this.queue = this.queue.filter((m) => !MessageValidator.isExpired(m));
    return before - this.queue.length;
  }
}
