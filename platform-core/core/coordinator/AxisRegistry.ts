/**
 * AxisRegistry — 平台节点注册中心
 * 管理所有内部 Agent 节点和外部集成节点的注册、发现、健康检查
 */

import type { PlatformId, ModuleId, ProtocolLevel } from './AxisMessage';
import type { PlatformNode } from './AxisRouter';

// ───────────────────────── 节点类型 ─────────────────────────

export type NodeType = 'frontend' | 'backend' | 'agentzero' | 'external' | 'integration';

export interface AxisRegistryNode extends PlatformNode {
  /** 注册时间 */
  registeredAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** 标签 */
  tags: string[];
  /** 权重（用于负载均衡） */
  weight: number;
}

export interface ExternalRegistryNode extends AxisRegistryNode {
  type: 'integration';
  /** 外部原生协议 */
  nativeProtocol: 'rest' | 'graphql' | 'webhook' | 'mcp' | 'oauth' | 'grpc';
  /** 外部 API 端点 */
  apiEndpoint: string;
  /** 认证配置 */
  auth: {
    type: 'apikey' | 'oauth2' | 'basic' | 'bearer' | 'none';
    /** 密钥引用（指向安全存储） */
    secretRef: string;
  };
  /** 限流配置 */
  rateLimit: {
    requestsPerMinute: number;
    burstAllowance: number;
  };
  /** 操作映射表 */
  operationMap: Record<string, {
    nativeEndpoint: string;
    nativeMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    /** 输入转换器（AxisMessage → 外部格式） */
    inputTransform?: string;
    /** 输出转换器（外部格式 → AxisMessage） */
    outputTransform?: string;
  }>;
  /** 扩展元数据 */
  metadata: Record<string, unknown>;
}

// ───────────────────────── 健康状态 ─────────────────────────

export interface HealthReport {
  nodeId: PlatformId;
  status: 'up' | 'down' | 'degraded';
  latency: number;
  cpuUsage?: number;
  memoryUsage?: number;
  activeConnections?: number;
  timestamp: number;
}

// ───────────────────────── 注册中心 ─────────────────────────

export class AxisRegistry {
  /** 节点存储 */
  private nodes = new Map<PlatformId, AxisRegistryNode>();
  /** 按模块索引 */
  private moduleIndex = new Map<ModuleId, Set<PlatformId>>();
  /** 按类型索引 */
  private typeIndex = new Map<NodeType, Set<PlatformId>>();
  /** 健康检查定时器 */
  private healthCheckTimer?: ReturnType<typeof setInterval>;
  /** 心跳超时（毫秒） */
  private readonly HEARTBEAT_TIMEOUT = 30000;

  constructor(
    private options: {
      enableHealthCheck?: boolean;
      healthCheckInterval?: number;
      onNodeChange?: (node: AxisRegistryNode, event: 'join' | 'leave' | 'update') => void;
    } = {}
  ) {
    if (this.options.enableHealthCheck ?? true) {
      this.startHealthCheck(this.options.healthCheckInterval ?? 10000);
    }
  }

  // ───────────────────────── 注册 ─────────────────────────

  /** 注册节点 */
  register(node: AxisRegistryNode | ExternalRegistryNode): boolean {
    const existing = this.nodes.get(node.id);
    const event: 'join' | 'update' = existing ? 'update' : 'join';

    node.registeredAt = existing?.registeredAt ?? Date.now();
    node.updatedAt = Date.now();
    node.weight = node.weight ?? 1;
    node.tags = node.tags ?? [];

    this.nodes.set(node.id, node);

    // 更新模块索引
    for (const cap of node.capabilities) {
      const set = this.moduleIndex.get(cap) ?? new Set();
      set.add(node.id);
      this.moduleIndex.set(cap, set);
    }

    // 更新类型索引
    const typeSet = this.typeIndex.get(node.type) ?? new Set();
    typeSet.add(node.id);
    this.typeIndex.set(node.type, typeSet);

    this.options.onNodeChange?.(node, event);
    return true;
  }

  /** 批量注册 */
  registerBatch(nodes: (AxisRegistryNode | ExternalRegistryNode)[]): void {
    for (const node of nodes) {
      this.register(node);
    }
  }

  // ───────────────────────── 注销 ─────────────────────────

  /** 注销节点 */
  unregister(platformId: PlatformId): boolean {
    const node = this.nodes.get(platformId);
    if (!node) return false;

    // 从模块索引移除
    for (const cap of node.capabilities) {
      const set = this.moduleIndex.get(cap);
      set?.delete(platformId);
      if (set?.size === 0) {
        this.moduleIndex.delete(cap);
      }
    }

    // 从类型索引移除
    const typeSet = this.typeIndex.get(node.type);
    typeSet?.delete(platformId);
    if (typeSet?.size === 0) {
      this.typeIndex.delete(node.type);
    }

    this.nodes.delete(platformId);
    this.options.onNodeChange?.(node, 'leave');
    return true;
  }

  // ───────────────────────── 查询 ─────────────────────────

  /** 根据 ID 查询节点 */
  get(platformId: PlatformId): AxisRegistryNode | undefined {
    return this.nodes.get(platformId);
  }

  /** 查询所有节点 */
  getAll(): AxisRegistryNode[] {
    return Array.from(this.nodes.values());
  }

  /** 查询支持某模块的所有节点 */
  getByModule(moduleId: ModuleId): AxisRegistryNode[] {
    const ids = this.moduleIndex.get(moduleId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.nodes.get(id))
      .filter((n): n is AxisRegistryNode => !!n);
  }

  /** 查询某类型的所有节点 */
  getByType(type: NodeType): AxisRegistryNode[] {
    const ids = this.typeIndex.get(type);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.nodes.get(id))
      .filter((n): n is AxisRegistryNode => !!n);
  }

  /** 查询某平台支持的所有模块 */
  getCapabilities(platformId: PlatformId): ModuleId[] {
    return this.nodes.get(platformId)?.capabilities ?? [];
  }

  /** 查询外部集成节点 */
  getExternalIntegrations(): ExternalRegistryNode[] {
    return this.getByType('integration') as ExternalRegistryNode[];
  }

  // ───────────────────────── 健康检查 ─────────────────────────

  /** 上报心跳 */
  heartbeat(platformId: PlatformId, report?: Partial<HealthReport>): boolean {
    const node = this.nodes.get(platformId);
    if (!node) return false;

    node.health.status = 'up';
    node.health.lastSeen = Date.now();
    if (report?.latency !== undefined) {
      node.health.latency = report.latency;
    }
    node.updatedAt = Date.now();

    return true;
  }

  /** 启动健康检查 */
  private startHealthCheck(intervalMs: number): void {
    this.healthCheckTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, node] of this.nodes) {
        const elapsed = now - node.health.lastSeen;
        if (elapsed > this.HEARTBEAT_TIMEOUT) {
          if (node.health.status === 'up') {
            node.health.status = 'degraded';
            this.options.onNodeChange?.(node, 'update');
          } else if (node.health.status === 'degraded' && elapsed > this.HEARTBEAT_TIMEOUT * 2) {
            node.health.status = 'down';
            this.options.onNodeChange?.(node, 'update');
          }
        }
      }
    }, intervalMs);
  }

  /** 停止健康检查 */
  stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  // ───────────────────────── 负载均衡 ─────────────────────────

  /** 为某模块选择最优节点 */
  selectBestNode(moduleId: ModuleId): AxisRegistryNode | undefined {
    const candidates = this.getByModule(moduleId)
      .filter((n) => n.health.status === 'up')
      .sort((a, b) => {
        // 综合评分：latency 越低越好，weight 越高越好
        const scoreA = (a.weight * 100) / (a.health.latency + 1);
        const scoreB = (b.weight * 100) / (b.health.latency + 1);
        return scoreB - scoreA;
      });
    return candidates[0];
  }

  // ───────────────────────── 统计 ─────────────────────────

  /** 获取注册中心统计 */
  getStats(): {
    totalNodes: number;
    byType: Record<NodeType, number>;
    byModule: Record<string, number>;
    healthy: number;
    degraded: number;
    down: number;
  } {
    const byType: Record<NodeType, number> = {
      frontend: 0,
      backend: 0,
      agentzero: 0,
      external: 0,
      integration: 0,
    };
    let healthy = 0;
    let degraded = 0;
    let down = 0;

    for (const node of this.nodes.values()) {
      byType[node.type]++;
      if (node.health.status === 'up') healthy++;
      else if (node.health.status === 'degraded') degraded++;
      else down++;
    }

    const byModule: Record<string, number> = {};
    for (const [moduleId, set] of this.moduleIndex) {
      byModule[moduleId] = set.size;
    }

    return {
      totalNodes: this.nodes.size,
      byType,
      byModule,
      healthy,
      degraded,
      down,
    };
  }

  /** 导出为路由表可用的节点列表 */
  exportNodes(): PlatformNode[] {
    return this.getAll().map((n) => ({
      id: n.id,
      type: n.type,
      capabilities: n.capabilities,
      protocols: n.protocols,
      endpoint: n.endpoint,
      health: n.health,
      metadata: n.metadata,
    }));
  }
}

// ───────────────────────── 预设节点注册 ─────────────────────────

/** 千界花园预设内部平台节点 */
export function createPresetInternalNodes(): AxisRegistryNode[] {
  const now = Date.now();
  const base = {
    health: { status: 'up' as const, lastSeen: now, latency: 0 },
    registeredAt: now,
    updatedAt: now,
    weight: 1,
    tags: [],
  };

  return [
    // X轴 — 前端平台 (15个)
    { ...base, id: 'frontend-main', type: 'frontend', capabilities: ['dialog', 'agent', 'group', 'monitor', 'settings'], protocols: ['rest', 'sse', 'ws'], endpoint: 'http://localhost:5173', metadata: { platform: 'react-vite' } },
    { ...base, id: 'frontend-desktop', type: 'frontend', capabilities: ['dialog', 'agent', 'monitor'], protocols: ['rest', 'ws'], endpoint: 'http://localhost:5174', metadata: { platform: 'electron' } },
    { ...base, id: 'frontend-mobile', type: 'frontend', capabilities: ['dialog', 'agent'], protocols: ['rest'], endpoint: 'http://localhost:5175', metadata: { platform: 'react-native' } },
    { ...base, id: 'frontend-web', type: 'frontend', capabilities: ['dialog', 'agent', 'group', 'knowledge', 'skill'], protocols: ['rest', 'sse'], endpoint: 'https://garden.web.app', metadata: { platform: 'web' } },
    { ...base, id: 'frontend-pwa', type: 'frontend', capabilities: ['dialog', 'agent', 'monitor'], protocols: ['rest', 'sse'], endpoint: 'https://garden.web.app/pwa', metadata: { platform: 'pwa' } },
    { ...base, id: 'frontend-admin', type: 'frontend', capabilities: ['agent', 'group', 'monitor', 'settings', 'platform'], protocols: ['rest'], endpoint: 'http://localhost:5176', metadata: { platform: 'admin-panel' } },
    { ...base, id: 'frontend-embed', type: 'frontend', capabilities: ['dialog'], protocols: ['rest'], endpoint: 'https://embed.garden.app', metadata: { platform: 'widget' } },
    { ...base, id: 'frontend-vscode', type: 'frontend', capabilities: ['dialog', 'agent', 'skill'], protocols: ['rest', 'ws'], endpoint: 'vscode://sylva.garden', metadata: { platform: 'vscode-extension' } },
    { ...base, id: 'frontend-cli', type: 'frontend', capabilities: ['dialog', 'agent'], protocols: ['rest'], endpoint: 'http://localhost:5177', metadata: { platform: 'cli' } },
    { ...base, id: 'frontend-obsidian', type: 'frontend', capabilities: ['dialog', 'knowledge'], protocols: ['rest'], endpoint: 'obsidian://sylva', metadata: { platform: 'obsidian-plugin' } },
    { ...base, id: 'frontend-telegram', type: 'frontend', capabilities: ['dialog'], protocols: ['rest'], endpoint: 'https://t.me/sylva_garden_bot', metadata: { platform: 'telegram-bot' } },
    { ...base, id: 'frontend-discord', type: 'frontend', capabilities: ['dialog', 'agent'], protocols: ['rest', 'ws'], endpoint: 'https://discord.com/api', metadata: { platform: 'discord-bot' } },
    { ...base, id: 'frontend-slack', type: 'frontend', capabilities: ['dialog'], protocols: ['rest'], endpoint: 'https://slack.com/api', metadata: { platform: 'slack-app' } },
    { ...base, id: 'frontend-wechat', type: 'frontend', capabilities: ['dialog'], protocols: ['rest'], endpoint: 'https://mp.weixin.qq.com', metadata: { platform: 'wechat-mp' } },
    { ...base, id: 'frontend-feishu', type: 'frontend', capabilities: ['dialog', 'agent'], protocols: ['rest'], endpoint: 'https://open.feishu.cn', metadata: { platform: 'feishu-app' } },

    // Y轴 — 后端平台 (15个)
    { ...base, id: 'backend-api', type: 'backend', capabilities: ['dialog', 'agent', 'group', 'knowledge', 'skill', 'monitor', 'settings', 'platform'], protocols: ['rest', 'sse', 'ws', 'internal'], endpoint: 'http://localhost:3000', metadata: { role: 'main-api' } },
    { ...base, id: 'backend-agent', type: 'backend', capabilities: ['agent', 'dialog', 'skill'], protocols: ['rest', 'internal'], endpoint: 'http://localhost:3001', metadata: { role: 'agent-engine' } },
    { ...base, id: 'backend-llm', type: 'backend', capabilities: ['dialog'], protocols: ['rest', 'internal'], endpoint: 'http://localhost:3002', metadata: { role: 'llm-proxy' } },
    { ...base, id: 'backend-kb', type: 'backend', capabilities: ['knowledge'], protocols: ['rest', 'internal'], endpoint: 'http://localhost:3003', metadata: { role: 'knowledge-base' } },
    { ...base, id: 'backend-vector', type: 'backend', capabilities: ['knowledge'], protocols: ['rest', 'internal'], endpoint: 'http://localhost:3004', metadata: { role: 'vector-store' } },
    { ...base, id: 'backend-monitor', type: 'backend', capabilities: ['monitor'], protocols: ['rest', 'sse', 'internal'], endpoint: 'http://localhost:3005', metadata: { role: 'monitoring' } },
    { ...base, id: 'backend-auth', type: 'backend', capabilities: ['settings'], protocols: ['rest', 'internal'], endpoint: 'http://localhost:3006', metadata: { role: 'auth-service' } },
    { ...base, id: 'backend-queue', type: 'backend', capabilities: ['dialog', 'agent', 'skill'], protocols: ['internal'], endpoint: 'ipc://queue', metadata: { role: 'task-queue' } },
    { ...base, id: 'backend-cache', type: 'backend', capabilities: ['dialog', 'agent', 'knowledge'], protocols: ['internal'], endpoint: 'ipc://cache', metadata: { role: 'cache' } },
    { ...base, id: 'backend-db', type: 'backend', capabilities: ['agent', 'group', 'knowledge', 'settings'], protocols: ['internal'], endpoint: 'ipc://db', metadata: { role: 'database' } },
    { ...base, id: 'backend-file', type: 'backend', capabilities: ['dialog', 'knowledge'], protocols: ['rest', 'internal'], endpoint: 'http://localhost:3007', metadata: { role: 'file-storage' } },
    { ...base, id: 'backend-webhook', type: 'backend', capabilities: ['dialog', 'agent'], protocols: ['rest', 'sse'], endpoint: 'http://localhost:3008', metadata: { role: 'webhook-handler' } },
    { ...base, id: 'backend-scheduler', type: 'backend', capabilities: ['agent', 'skill'], protocols: ['rest', 'internal'], endpoint: 'http://localhost:3009', metadata: { role: 'cron-scheduler' } },
    { ...base, id: 'backend-adapter', type: 'backend', capabilities: ['dialog', 'agent'], protocols: ['rest', 'internal'], endpoint: 'http://localhost:3010', metadata: { role: 'provider-adapter' } },
    { ...base, id: 'backend-gateway', type: 'backend', capabilities: ['dialog', 'agent', 'group', 'knowledge', 'skill', 'monitor', 'settings', 'platform'], protocols: ['rest', 'sse', 'ws', 'internal', 'bridge'], endpoint: 'http://localhost:3011', metadata: { role: 'gateway' } },

    // Z轴 — 子工具平台 (20个)
    { ...base, id: 'tool-code-interpreter', type: 'agentzero', capabilities: ['skill'], protocols: ['rest', 'internal'], endpoint: 'http://localhost:4001', metadata: { category: 'code-execution' } },
    { ...base, id: 'tool-browser', type: 'agentzero', capabilities: ['skill'], protocols: ['rest'], endpoint: 'http://localhost:4002', metadata: { category: 'web-automation' } },
    { ...base, id: 'tool-image-gen', type: 'agentzero', capabilities: ['skill'], protocols: ['rest'], endpoint: 'http://localhost:4003', metadata: { category: 'image-generation' } },
    { ...base, id: 'tool-doc-parser', type: 'agentzero', capabilities: ['skill', 'knowledge'], protocols: ['rest'], endpoint: 'http://localhost:4004', metadata: { category: 'document-parsing' } },
    { ...base, id: 'tool-git', type: 'agentzero', capabilities: ['skill'], protocols: ['rest'], endpoint: 'http://localhost:4005', metadata: { category: 'version-control' } },
    { ...base, id: 'tool-search', type: 'agentzero', capabilities: ['skill'], protocols: ['rest'], endpoint: 'http://localhost:4006', metadata: { category: 'web-search' } },
    { ...base, id: 'tool-calculator', type: 'agentzero', capabilities: ['skill'], protocols: ['rest', 'internal'], endpoint: 'http://localhost:4007', metadata: { category: 'math-computation' } },
    { ...base, id: 'tool-translator', type: 'agentzero', capabilities: ['skill'], protocols: ['rest'], endpoint: 'http://localhost:4008', metadata: { category: 'translation' } },
    { ...base, id: 'tool-summarizer', type: 'agentzero', capabilities: ['skill', 'knowledge'], protocols: ['rest'], endpoint: 'http://localhost:4009', metadata: { category: 'text-summarization' } },
    { ...base, id: 'tool-chart-gen', type: 'agentzero', capabilities: ['skill'], protocols: ['rest'], endpoint: 'http://localhost:4010', metadata: { category: 'chart-generation' } },
    { ...base, id: 'tool-ocr', type: 'agentzero', capabilities: ['skill', 'knowledge'], protocols: ['rest'], endpoint: 'http://localhost:4011', metadata: { category: 'ocr' } },
    { ...base, id: 'tool-speech', type: 'agentzero', capabilities: ['skill'], protocols: ['rest'], endpoint: 'http://localhost:4012', metadata: { category: 'speech-recognition' } },
    { ...base, id: 'tool-data-clean', type: 'agentzero', capabilities: ['skill'], protocols: ['rest'], endpoint: 'http://localhost:4013', metadata: { category: 'data-cleaning' } },
    { ...base, id: 'tool-sql-runner', type: 'agentzero', capabilities: ['skill'], protocols: ['rest', 'internal'], endpoint: 'http://localhost:4014', metadata: { category: 'sql-execution' } },
    { ...base, id: 'tool-api-tester', type: 'agentzero', capabilities: ['skill'], protocols: ['rest'], endpoint: 'http://localhost:4015', metadata: { category: 'api-testing' } },
    { ...base, id: 'tool-mermaid', type: 'agentzero', capabilities: ['skill'], protocols: ['rest'], endpoint: 'http://localhost:4016', metadata: { category: 'diagram-generation' } },
    { ...base, id: 'tool-latex', type: 'agentzero', capabilities: ['skill'], protocols: ['rest'], endpoint: 'http://localhost:4017', metadata: { category: 'latex-rendering' } },
    { ...base, id: 'tool-pdf-gen', type: 'agentzero', capabilities: ['skill'], protocols: ['rest'], endpoint: 'http://localhost:4018', metadata: { category: 'pdf-generation' } },
    { ...base, id: 'tool-email', type: 'agentzero', capabilities: ['skill'], protocols: ['rest'], endpoint: 'http://localhost:4019', metadata: { category: 'email-sending' } },
    { ...base, id: 'tool-crawler', type: 'agentzero', capabilities: ['skill'], protocols: ['rest'], endpoint: 'http://localhost:4020', metadata: { category: 'web-crawling' } },
  ];
}

/** 千界花园预设外部集成平台节点 */
export function createPresetExternalNodes(): ExternalRegistryNode[] {
  const now = Date.now();
  const base = {
    health: { status: 'up' as const, lastSeen: now, latency: 100 },
    registeredAt: now,
    updatedAt: now,
    weight: 1,
    tags: ['external', 'integration'],
  };

  return [
    {
      ...base,
      id: 'github',
      type: 'integration',
      capabilities: ['skill'],
      protocols: ['rest'],
      endpoint: 'https://api.github.com',
      nativeProtocol: 'rest',
      apiEndpoint: 'https://api.github.com',
      auth: { type: 'oauth2', secretRef: 'vault://secrets/github' },
      rateLimit: { requestsPerMinute: 500, burstAllowance: 100 },
      operationMap: {
        read_repo: { nativeEndpoint: '/repos/{owner}/{repo}', nativeMethod: 'GET' },
        create_issue: { nativeEndpoint: '/repos/{owner}/{repo}/issues', nativeMethod: 'POST' },
        read_file: { nativeEndpoint: '/repos/{owner}/{repo}/contents/{path}', nativeMethod: 'GET' },
        search_code: { nativeEndpoint: '/search/code', nativeMethod: 'GET' },
      },
      metadata: {},
    },
    {
      ...base,
      id: 'gitlab',
      type: 'integration',
      capabilities: ['skill'],
      protocols: ['rest'],
      endpoint: 'https://gitlab.com/api/v4',
      nativeProtocol: 'rest',
      apiEndpoint: 'https://gitlab.com/api/v4',
      auth: { type: 'oauth2', secretRef: 'vault://secrets/gitlab' },
      rateLimit: { requestsPerMinute: 600, burstAllowance: 120 },
      operationMap: {
        read_project: { nativeEndpoint: '/projects/{id}', nativeMethod: 'GET' },
        create_issue: { nativeEndpoint: '/projects/{id}/issues', nativeMethod: 'POST' },
      },
      metadata: {},
    },
    {
      ...base,
      id: 'npm',
      type: 'integration',
      capabilities: ['skill', 'knowledge'],
      protocols: ['rest'],
      endpoint: 'https://registry.npmjs.org',
      nativeProtocol: 'rest',
      apiEndpoint: 'https://registry.npmjs.org',
      auth: { type: 'none', secretRef: '' },
      rateLimit: { requestsPerMinute: 1000, burstAllowance: 200 },
      operationMap: {
        search_package: { nativeEndpoint: '/-/v1/search', nativeMethod: 'GET' },
        read_package: { nativeEndpoint: '/{package}', nativeMethod: 'GET' },
      },
      metadata: {},
    },
    {
      ...base,
      id: 'openai',
      type: 'integration',
      capabilities: ['dialog', 'agent'],
      protocols: ['rest'],
      endpoint: 'https://api.openai.com/v1',
      nativeProtocol: 'rest',
      apiEndpoint: 'https://api.openai.com/v1',
      auth: { type: 'bearer', secretRef: 'vault://secrets/openai' },
      rateLimit: { requestsPerMinute: 60, burstAllowance: 10 },
      operationMap: {
        chat_completion: { nativeEndpoint: '/chat/completions', nativeMethod: 'POST' },
        create_embedding: { nativeEndpoint: '/embeddings', nativeMethod: 'POST' },
        list_models: { nativeEndpoint: '/models', nativeMethod: 'GET' },
      },
      metadata: {},
    },
    {
      ...base,
      id: 'pinecone',
      type: 'integration',
      capabilities: ['knowledge'],
      protocols: ['rest'],
      endpoint: 'https://api.pinecone.io',
      nativeProtocol: 'rest',
      apiEndpoint: 'https://api.pinecone.io',
      auth: { type: 'apikey', secretRef: 'vault://secrets/pinecone' },
      rateLimit: { requestsPerMinute: 100, burstAllowance: 20 },
      operationMap: {
        query_vectors: { nativeEndpoint: '/query', nativeMethod: 'POST' },
        upsert_vectors: { nativeEndpoint: '/vectors/upsert', nativeMethod: 'POST' },
      },
      metadata: {},
    },
    {
      ...base,
      id: 'slack',
      type: 'integration',
      capabilities: ['dialog'],
      protocols: ['rest'],
      endpoint: 'https://slack.com/api',
      nativeProtocol: 'rest',
      apiEndpoint: 'https://slack.com/api',
      auth: { type: 'bearer', secretRef: 'vault://secrets/slack' },
      rateLimit: { requestsPerMinute: 200, burstAllowance: 40 },
      operationMap: {
        post_message: { nativeEndpoint: '/chat.postMessage', nativeMethod: 'POST' },
        read_channel: { nativeEndpoint: '/conversations.history', nativeMethod: 'GET' },
      },
      metadata: {},
    },
    {
      ...base,
      id: 'stripe',
      type: 'integration',
      capabilities: ['skill'],
      protocols: ['rest'],
      endpoint: 'https://api.stripe.com/v1',
      nativeProtocol: 'rest',
      apiEndpoint: 'https://api.stripe.com/v1',
      auth: { type: 'bearer', secretRef: 'vault://secrets/stripe' },
      rateLimit: { requestsPerMinute: 100, burstAllowance: 20 },
      operationMap: {
        create_charge: { nativeEndpoint: '/charges', nativeMethod: 'POST' },
        read_customer: { nativeEndpoint: '/customers/{id}', nativeMethod: 'GET' },
      },
      metadata: {},
    },
    {
      ...base,
      id: 'supabase',
      type: 'integration',
      capabilities: ['knowledge', 'skill'],
      protocols: ['rest'],
      endpoint: 'https://{project}.supabase.co',
      nativeProtocol: 'rest',
      apiEndpoint: 'https://{project}.supabase.co/rest/v1',
      auth: { type: 'apikey', secretRef: 'vault://secrets/supabase' },
      rateLimit: { requestsPerMinute: 300, burstAllowance: 60 },
      operationMap: {
        query_table: { nativeEndpoint: '/{table}', nativeMethod: 'GET' },
        insert_row: { nativeEndpoint: '/{table}', nativeMethod: 'POST' },
      },
      metadata: {},
    },
    {
      ...base,
      id: 'serpapi',
      type: 'integration',
      capabilities: ['skill'],
      protocols: ['rest'],
      endpoint: 'https://serpapi.com/search',
      nativeProtocol: 'rest',
      apiEndpoint: 'https://serpapi.com/search',
      auth: { type: 'apikey', secretRef: 'vault://secrets/serpapi' },
      rateLimit: { requestsPerMinute: 30, burstAllowance: 5 },
      operationMap: {
        web_search: { nativeEndpoint: '', nativeMethod: 'GET' },
      },
      metadata: {},
    },
    {
      ...base,
      id: 'wolfram',
      type: 'integration',
      capabilities: ['skill'],
      protocols: ['rest'],
      endpoint: 'https://api.wolframalpha.com/v2',
      nativeProtocol: 'rest',
      apiEndpoint: 'https://api.wolframalpha.com/v2',
      auth: { type: 'apikey', secretRef: 'vault://secrets/wolfram' },
      rateLimit: { requestsPerMinute: 60, burstAllowance: 10 },
      operationMap: {
        compute: { nativeEndpoint: '/query', nativeMethod: 'GET' },
      },
      metadata: {},
    },
  ];
}
