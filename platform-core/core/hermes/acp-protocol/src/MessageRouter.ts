import {
  CrossPlatformMessage,
  AgentAddress,
  MessageType,
  Platform,
  PlatformBridge,
} from './types';
import { MemoryInbox, Inbox } from './CrossPlatformMessage';

// ============================================================
// Message Router
// ============================================================
// The Router owns one Inbox per platform. Coordinator polls
// all inboxes in round-robin, processes messages, and routes
// replies to the correct destination inbox or over the bridge.

export class MessageRouter {
  private inboxes = new Map<string, Inbox>();
  private bridges = new Map<string, PlatformBridge>();
  private lastPollIndex = 0;
  private readonly pollBatchSize: number;

  constructor(batchSize: number = 10) {
    this.pollBatchSize = batchSize;
  }

  registerInbox(platform: string, inbox?: Inbox): Inbox {
    const box = inbox ?? new MemoryInbox(platform);
    this.inboxes.set(platform, box);
    return box;
  }

  registerBridge(bridge: PlatformBridge): void {
    this.bridges.set(bridge.platform, bridge);
  }

  /**
   * Send a message. If destination platform has a bridge, use it;
   * otherwise drop into local inbox.
   */
  async route(msg: CrossPlatformMessage): Promise<void> {
    const destPlatform = msg.to.platform;

    // Local delivery
    const inbox = this.inboxes.get(destPlatform);
    if (inbox) {
      inbox.enqueue(msg);
      return;
    }

    // Bridge delivery
    const bridge = this.bridges.get(destPlatform);
    if (bridge) {
      await bridge.send(msg);
      return;
    }

    throw new Error(`No inbox or bridge for platform: ${destPlatform}`);
  }

  /**
   * Poll all inboxes round-robin, return messages grouped by platform.
   */
  pollAll(): Map<string, CrossPlatformMessage[]> {
    const results = new Map<string, CrossPlatformMessage[]>();
    const platforms = Array.from(this.inboxes.keys());

    if (platforms.length === 0) return results;

    // Round-robin start point
    let idx = this.lastPollIndex;
    for (let i = 0; i < platforms.length; i++) {
      const platform = platforms[(idx + i) % platforms.length]!;
      const inbox = this.inboxes.get(platform)!;
      inbox.purgeExpired();
      const batch = inbox.dequeue(this.pollBatchSize);
      if (batch.length > 0) {
        results.set(platform, batch);
      }
    }

    this.lastPollIndex = (this.lastPollIndex + 1) % platforms.length;
    return results;
  }

  /**
   * Poll a specific bridge for inbound cross-platform messages.
   */
  async pollBridge(platform: Platform): Promise<CrossPlatformMessage[]> {
    const bridge = this.bridges.get(platform);
    if (!bridge) return [];
    return bridge.poll();
  }

  /**
   * Broadcast a message to all agents on a given platform.
   */
  async broadcast(
    taskId: string,
    from: AgentAddress,
    platform: Platform,
    type: MessageType,
    payload: unknown
  ): Promise<void> {
    // Broadcast = enqueue to platform inbox with wildcard to
    const msg = {
      ...this.createStub(taskId, from, { agentId: '*', platform }, type),
      payload: payload as CrossPlatformMessage['payload'],
    };
    await this.route(msg);
  }

  private createStub(
    taskId: string,
    from: AgentAddress,
    to: AgentAddress,
    type: MessageType
  ): Omit<CrossPlatformMessage, 'payload'> {
    const now = Date.now();
    return {
      id: `bc-${now}`,
      taskId,
      from,
      to,
      type,
      timestamp: now,
      deadline: now + 30000,
      retryCount: 0,
      priority: 5,
    };
  }

  getStats(): Record<string, { inboxSize: number; bridgeHealthy: boolean }> {
    const stats: Record<string, { inboxSize: number; bridgeHealthy: boolean }> = {};
    for (const [platform, inbox] of this.inboxes.entries()) {
      const bridge = this.bridges.get(platform);
      stats[platform] = {
        inboxSize: inbox.size(),
        bridgeHealthy: bridge ? true : false,
      };
    }
    return stats;
  }
}
