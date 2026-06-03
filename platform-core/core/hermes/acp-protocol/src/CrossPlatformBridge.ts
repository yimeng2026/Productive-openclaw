import {
  Platform,
  PlatformBridge,
  CrossPlatformMessage,
} from './types';
import {
  MessageFactory,
  MessageValidator,
  MemoryInbox,
} from './CrossPlatformMessage';

// ============================================================
// Cross-Platform Bridge
// ============================================================
// Abstracts transport between platforms. Each platform has an
// Inbox (local queue). The bridge serializes messages to JSON
// and can be backed by HTTP, WebSocket, or in-memory pipes.
//
// For this framework we provide an in-memory bridge for testing
// and an HTTP bridge skeleton for real deployments.

export abstract class BasePlatformBridge implements PlatformBridge {
  constructor(public platform: Platform) {}

  abstract send(message: CrossPlatformMessage): Promise<void>;
  abstract poll(): Promise<CrossPlatformMessage[]>;

  async healthCheck(): Promise<boolean> {
    try {
      const hb = MessageFactory.heartbeat(
        'health-check',
        { agentId: 'bridge', platform: this.platform },
        { agentStatus: 'healthy', queueDepth: 0, loadFactor: 0 }
      );
      await this.send(hb);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * In-memory bridge for unit testing and single-process deployments.
 */
export class InMemoryBridge extends BasePlatformBridge {
  private inbox = new MemoryInbox('memory');
  private static relay = new Map<string, InMemoryBridge[]>();

  constructor(platform: Platform) {
    super(platform);
    if (!InMemoryBridge.relay.has(platform)) {
      InMemoryBridge.relay.set(platform, []);
    }
    InMemoryBridge.relay.get(platform)!.push(this);
  }

  async send(message: CrossPlatformMessage): Promise<void> {
    const json = MessageValidator.serialize(message);
    const deserialized = MessageValidator.deserialize(json);

    // Deliver to all bridges on target platform
    const targets = InMemoryBridge.relay.get(message.to.platform) ?? [];
    for (const target of targets) {
      if (target !== this) {
        target.inbox.enqueue(deserialized);
      }
    }

    // Also enqueue locally if same platform
    if (message.to.platform === this.platform) {
      this.inbox.enqueue(deserialized);
    }
  }

  async poll(): Promise<CrossPlatformMessage[]> {
    this.inbox.purgeExpired();
    return this.inbox.dequeue(50);
  }
}

/**
 * HTTP bridge skeleton for real cross-platform deployments.
 * Implementers provide endpoint and auth.
 */
export class HTTPBridge extends BasePlatformBridge {
  private endpoint: string;
  private apiKey: string | null;

  constructor(
    platform: Platform,
    endpoint: string,
    apiKey?: string
  ) {
    super(platform);
    this.endpoint = endpoint.replace(/\/$/, '');
    this.apiKey = apiKey ?? null;
  }

  async send(message: CrossPlatformMessage): Promise<void> {
    const payload = MessageValidator.serialize(message);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    const res = await fetch(`${this.endpoint}/inbox`, {
      method: 'POST',
      headers,
      body: payload,
    });

    if (!res.ok) {
      throw new Error(`HTTP bridge send failed: ${res.status} ${res.statusText}`);
    }
  }

  async poll(): Promise<CrossPlatformMessage[]> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    const res = await fetch(`${this.endpoint}/outbox?limit=50`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      throw new Error(`HTTP bridge poll failed: ${res.status}`);
    }

    const rawMessages: string[] = (await res.json()) as string[];
    return rawMessages.map((r) => MessageValidator.deserialize(r));
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/health`, {
        method: 'GET',
        headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {},
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Bridge factory.
 */
export class BridgeFactory {
  static create(
    platform: Platform,
    mode: 'memory' | 'http',
    endpoint?: string,
    apiKey?: string
  ): PlatformBridge {
    if (mode === 'memory') {
      return new InMemoryBridge(platform);
    }
    if (mode === 'http') {
      if (!endpoint) throw new Error('HTTP bridge requires endpoint');
      return new HTTPBridge(platform, endpoint, apiKey);
    }
    throw new Error(`Unknown bridge mode: ${mode}`);
  }
}
