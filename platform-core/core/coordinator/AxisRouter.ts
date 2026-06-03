/**
 * AxisRouter — 3D 消息路由核心
 * 任意两点 (x₁,y₁,z₁) ↔ (x₂,y₂,z₂) 的自动寻址与转发
 */

import type {
  AxisMessage,
  AxisMessageReply,
  AxisStreamChunk,
  AxisCoordinate,
  PlatformId,
  ModuleId,
  ProtocolLevel,
} from './AxisMessage';
import type { ModuleContract } from './ModuleContract';
import { getContract } from './ModuleContract';

// ───────────────────────── 路由表条目 ─────────────────────────

export interface RouteEntry {
  /** 目标坐标 */
  target: AxisCoordinate;
  /** 下一跳地址（可能是直接送达或中转） */
  nextHop: AxisCoordinate;
  /** 链路质量评分（延迟、丢包率、带宽） */
  quality: {
    latency: number;     // ms
    packetLoss: number;  // 0-1
    bandwidth: number;   // Mbps
    lastUpdated: number; // timestamp
  };
  /** 路径类型 */
  pathType: 'direct' | 'relay' | 'bridge';
  /** 中转链（relay 模式下） */
  relayChain?: AxisCoordinate[];
}

// ───────────────────────── 路由表 ─────────────────────────

export class AxisRoutingTable {
  private routes = new Map<string, RouteEntry[]>();

  /** 生成路由键 */
  private key(target: AxisCoordinate): string {
    return `${target.x}:${target.y}:${target.z ?? '*'}`;
  }

  /** 注册路由 */
  register(route: RouteEntry): void {
    const k = this.key(route.target);
    const existing = this.routes.get(k) ?? [];
    // 去重：同一 nextHop 只保留质量最好的
    const filtered = existing.filter((r) =>
      !(r.nextHop.x === route.nextHop.x && r.nextHop.y === route.nextHop.y && r.nextHop.z === route.nextHop.z)
    );
    filtered.push(route);
    // 按质量排序（latency 升序）
    filtered.sort((a, b) => a.quality.latency - b.quality.latency);
    this.routes.set(k, filtered);
  }

  /** 查找路由 */
  lookup(target: AxisCoordinate): RouteEntry | undefined {
    const k = this.key(target);
    const entries = this.routes.get(k);
    if (entries && entries.length > 0) {
      return entries[0]; // 返回质量最好的
    }
    // 模糊匹配：不指定 z 时匹配任意协议
    const fuzzyKey = `${target.x}:${target.y}:*`;
    const fuzzyEntries = this.routes.get(fuzzyKey);
    return fuzzyEntries?.[0];
  }

  /** 查找所有可用路由（用于负载均衡） */
  lookupAll(target: AxisCoordinate): RouteEntry[] {
    const k = this.key(target);
    return this.routes.get(k) ?? [];
  }

  /** 移除某平台的所有路由 */
  removeByPlatform(platformId: PlatformId): void {
    for (const [k, entries] of this.routes) {
      const filtered = entries.filter(
        (e) => e.target.x !== platformId && e.nextHop.x !== platformId
      );
      if (filtered.length === 0) {
        this.routes.delete(k);
      } else {
        this.routes.set(k, filtered);
      }
    }
  }

  /** 获取路由表摘要 */
  snapshot(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [k, entries] of this.routes) {
      result[k] = entries.length;
    }
    return result;
  }
}

// ───────────────────────── 路由器 ─────────────────────────

export interface ProtocolAdapter {
  protocol: ProtocolLevel;
  send(msg: AxisMessage): Promise<AxisMessageReply | undefined>;
  sendStream(msg: AxisMessage, onChunk: (chunk: AxisStreamChunk) => void): Promise<void>;
  isAvailable(target: AxisCoordinate): Promise<boolean>;
}

export interface AxisRouterDeps {
  routingTable: AxisRoutingTable;
  adapters: Map<ProtocolLevel, ProtocolAdapter>;
  registry: AxisRegistryClient;
  logger?: (msg: string) => void;
}

export interface AxisRegistryClient {
  /** 查询平台节点信息 */
  queryNode(platformId: PlatformId): Promise<PlatformNode | undefined>;
  /** 查询支持某模块的所有平台 */
  queryByModule(moduleId: ModuleId): Promise<PlatformNode[]>;
  /** 查询某平台支持的所有模块 */
  queryCapabilities(platformId: PlatformId): Promise<ModuleId[]>;
}

export interface PlatformNode {
  id: PlatformId;
  type: 'frontend' | 'backend' | 'agentzero' | 'external' | 'integration';
  capabilities: ModuleId[];
  protocols: ProtocolLevel[];
  endpoint: string;
  health: {
    status: 'up' | 'down' | 'degraded';
    lastSeen: number;
    latency: number;
  };
  metadata: Record<string, unknown>;
}

export class AxisRouter {
  private rt: AxisRoutingTable;
  private adapters: Map<ProtocolLevel, ProtocolAdapter>;
  private registry: AxisRegistryClient;
  private log: (msg: string) => void;

  /** 正在等待响应的 RPC 请求 */
  private pendingRpc = new Map<string, {
    resolve: (reply: AxisMessageReply) => void;
    reject: (err: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  constructor(deps: AxisRouterDeps) {
    this.rt = deps.routingTable;
    this.adapters = deps.adapters;
    this.registry = deps.registry;
    this.log = deps.logger ?? ((m) => console.log(`[AxisRouter] ${m}`));
  }

  // ───────────────────────── 核心发送 ─────────────────────────

  /** 发送消息并等待响应（RPC 模式） */
  async send(msg: AxisMessage): Promise<AxisMessageReply> {
    const route = await this.resolveRoute(msg.header.target);
    if (!route) {
      throw new AxisRouteError(`No route to ${this.formatCoord(msg.header.target)}`);
    }

    // 自适应协议选择
    const protocol = this.selectProtocol(route, msg);
    const adapter = this.adapters.get(protocol);
    if (!adapter) {
      throw new AxisRouteError(`No adapter for protocol: ${protocol}`);
    }

    // 如果 target.z 未指定，填充实际使用的协议
    if (!msg.header.target.z) {
      msg.header.target.z = protocol;
      msg.transport.protocol = protocol;
    }

    this.log(`Routing ${msg.header.msgId} via ${protocol} to ${this.formatCoord(route.nextHop)}`);

    // 如果是中转，改写 nextHop
    if (route.pathType === 'relay' && route.relayChain && route.relayChain.length > 0) {
      msg.header.target = route.relayChain[0];
    }

    // RPC 等待
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRpc.delete(msg.header.msgId);
        reject(new AxisRouteError(`RPC timeout: ${msg.header.msgId}`));
      }, msg.header.ttl);

      this.pendingRpc.set(msg.header.msgId, { resolve, reject, timeout });

      adapter.send(msg).then((reply) => {
        if (reply) {
          this.handleReply(reply);
        }
      }).catch((err) => {
        this.pendingRpc.delete(msg.header.msgId);
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /** 发送流式消息 */
  async sendStream(
    msg: AxisMessage,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void> {
    const route = await this.resolveRoute(msg.header.target);
    if (!route) {
      throw new AxisRouteError(`No route to ${this.formatCoord(msg.header.target)}`);
    }

    const protocol = this.selectProtocol(route, msg);
    const adapter = this.adapters.get(protocol);
    if (!adapter) {
      throw new AxisRouteError(`No adapter for protocol: ${protocol}`);
    }

    if (!msg.header.target.z) {
      msg.header.target.z = protocol;
      msg.transport.protocol = protocol;
    }

    this.log(`Streaming ${msg.header.msgId} via ${protocol}`);
    await adapter.sendStream(msg, onChunk);
  }

  /** 发送单向消息（fire-and-forget） */
  async emit(msg: AxisMessage): Promise<void> {
    const route = await this.resolveRoute(msg.header.target);
    if (!route) {
      this.log(`Dropping message: no route to ${this.formatCoord(msg.header.target)}`);
      return;
    }

    const protocol = this.selectProtocol(route, msg);
    const adapter = this.adapters.get(protocol);
    if (!adapter) {
      this.log(`Dropping message: no adapter for ${protocol}`);
      return;
    }

    msg.header.expectsReply = false;
    if (!msg.header.target.z) {
      msg.header.target.z = protocol;
      msg.transport.protocol = protocol;
    }

    adapter.send(msg).catch((err) => {
      this.log(`Emit failed: ${err.message}`);
    });
  }

  // ───────────────────────── 响应处理 ─────────────────────────

  /** 处理收到的响应消息 */
  handleReply(reply: AxisMessageReply): void {
    const pending = this.pendingRpc.get(reply.header.correlationId ?? '');
    if (!pending) {
      this.log(`Orphan reply: ${reply.header.msgId} (correlationId=${reply.header.correlationId})`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRpc.delete(reply.header.correlationId ?? '');

    if (reply.status === 'error') {
      pending.reject(new AxisRouteError(reply.error?.message ?? 'Unknown error'));
    } else {
      pending.resolve(reply);
    }
  }

  // ───────────────────────── 路由解析 ─────────────────────────

  /** 解析目标坐标到实际路由 */
  private async resolveRoute(target: AxisCoordinate): Promise<RouteEntry | undefined> {
    // 1. 查本地路由表
    let route = this.rt.lookup(target);
    if (route) return route;

    // 2. 查注册中心（动态发现）
    const node = await this.registry.queryNode(target.x);
    if (!node) {
      // 3. 如果 x 未指定，按模块找最优平台
      if (target.x === '*' || !target.x) {
        const candidates = await this.registry.queryByModule(target.y);
        if (candidates.length > 0) {
          // 选 latency 最低的在线节点
          const best = candidates
            .filter((n) => n.health.status === 'up')
            .sort((a, b) => a.health.latency - b.health.latency)[0];
          if (best) {
            target.x = best.id;
            return this.buildDirectRoute(target, best);
          }
        }
      }
      return undefined;
    }

    // 4. 检查目标模块能力
    if (!node.capabilities.includes(target.y)) {
      this.log(`Node ${target.x} does not support module ${target.y}`);
      return undefined;
    }

    // 5. 构建直连路由
    route = this.buildDirectRoute(target, node);
    this.rt.register(route);
    return route;
  }

  private buildDirectRoute(target: AxisCoordinate, node: PlatformNode): RouteEntry {
    return {
      target,
      nextHop: target,
      quality: {
        latency: node.health.latency,
        packetLoss: 0,
        bandwidth: 100,
        lastUpdated: Date.now(),
      },
      pathType: 'direct',
    };
  }

  // ───────────────────────── 协议选择 ─────────────────────────

  /** 根据路由和消息选择最优协议 */
  private selectProtocol(route: RouteEntry, msg: AxisMessage): ProtocolLevel {
    // 如果目标已指定协议，尊重选择
    if (msg.header.target.z) {
      return msg.header.target.z;
    }

    // 查询目标节点支持的协议
    const node = this.registry.queryNode(route.target.x);
    // 由于 queryNode 是异步，这里简化处理：假设 registry 有同步缓存
    // 实际实现中可改为同步缓存 + 异步刷新

    // 获取模块契约，查看 preferredProtocol
    const contract = getContract(msg.payload.entity as ModuleId);

    // 优先级：消息指定 > 模块偏好 > 距离自适应
    if (contract?.preferredProtocol) {
      return contract.preferredProtocol;
    }

    // 默认规则：流式用 ws，实时推送用 sse，普通调用用 rest
    if (contract?.requiresStreaming || msg.payload.action === 'stream') {
      return 'ws';
    }
    if (msg.payload.action === 'subscribe') {
      return 'sse';
    }

    // 距离判断（简化版）
    if (route.pathType === 'direct' && route.target.x.startsWith('frontend')) {
      return 'internal'; // 同进程内通信
    }

    return 'rest';
  }

  // ───────────────────────── 健康与维护 ─────────────────────────

  /** 定期刷新路由表 */
  async refreshRoutes(): Promise<void> {
    this.log('Refreshing routes...');
    // 查询所有在线节点，更新路由质量
    // 实际实现中遍历 registry 的活跃节点
  }

  /** 获取路由统计 */
  getStats(): {
    routeCount: number;
    pendingRpc: number;
    adapterStats: Record<ProtocolLevel, { sent: number; failed: number }>;
  } {
    const adapterStats: Record<ProtocolLevel, { sent: number; failed: number }> = {
      rest: { sent: 0, failed: 0 },
      sse: { sent: 0, failed: 0 },
      ws: { sent: 0, failed: 0 },
      internal: { sent: 0, failed: 0 },
      bridge: { sent: 0, failed: 0 },
    };

    return {
      routeCount: Object.keys(this.rt.snapshot()).length,
      pendingRpc: this.pendingRpc.size,
      adapterStats,
    };
  }

  // ───────────────────────── 工具 ─────────────────────────

  private formatCoord(c: AxisCoordinate): string {
    return `(${c.x}, ${c.y}, ${c.z ?? 'auto'})`;
  }
}

// ───────────────────────── 错误类 ─────────────────────────

export class AxisRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AxisRouteError';
  }
}
