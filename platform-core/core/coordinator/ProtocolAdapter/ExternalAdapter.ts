/**
 * ExternalAdapter — 外部集成平台适配器
 * 支持 OAuth、Bearer Token、API Key 三种认证方式
 * 覆盖 GitHub、GitLab、npm、OpenAI、Discord 等 ~35 个预设集成
 */

import type {
  AxisMessage,
  AxisMessageReply,
  AxisStreamChunk,
} from '../AxisMessage';
import { createReply } from '../AxisMessage';
import { BaseAdapter, type AdapterStats } from './BaseAdapter';

export type AuthType = 'oauth' | 'bearer' | 'apikey' | 'none';

export interface ExternalAdapterConfig {
  /** 平台标识：github / gitlab / npm / openai / discord / ... */
  platform: string;
  /** 认证方式 */
  authType: AuthType;
  /** 认证凭证（OAuth token / Bearer token / API Key） */
  credential: string;
  /** 可选：OAuth 刷新令牌 */
  refreshToken?: string;
  /** API 基础地址 */
  baseUrl?: string;
  /** 请求超时 */
  timeout?: number;
  /** 自定义请求头 */
  extraHeaders?: Record<string, string>;
  /** 速率限制（请求/分钟） */
  rateLimitPerMinute?: number;
}

export class ExternalAdapter extends BaseAdapter {
  readonly protocol = 'external';

  private config: ExternalAdapterConfig;
  private timeout: number;
  private requestTimestamps: number[] = [];
  private static readonly DEFAULT_BASE_URLS: Record<string, string> = {
    github: 'https://api.github.com',
    gitlab: 'https://gitlab.com/api/v4',
    npm: 'https://registry.npmjs.org',
    openai: 'https://api.openai.com/v1',
    discord: 'https://discord.com/api/v10',
    slack: 'https://slack.com/api',
    notion: 'https://api.notion.com/v1',
    trello: 'https://api.trello.com/1',
    jira: 'https://api.atlassian.com',
    linear: 'https://api.linear.app/graphql',
    figma: 'https://api.figma.com/v1',
    stripe: 'https://api.stripe.com/v1',
    twilio: 'https://api.twilio.com',
    sendgrid: 'https://api.sendgrid.com/v3',
    supabase: 'https://api.supabase.io',
    vercel: 'https://api.vercel.com/v9',
    cloudflare: 'https://api.cloudflare.com/client/v4',
    aws: 'https://sts.amazonaws.com',
    azure: 'https://management.azure.com',
    gcp: 'https://cloudresourcemanager.googleapis.com/v1',
  };

  constructor(config?: Partial<ExternalAdapterConfig>) {
    super();
    this.config = {
      platform: 'generic',
      authType: 'none',
      credential: '',
      ...config,
    };
    this.timeout = this.config.timeout ?? 30000;
    this.setStatus('connected');
  }

  // ──────────── 认证头构建 ────────────

  private buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    switch (this.config.authType) {
      case 'oauth':
        headers['Authorization'] = `Bearer ${this.config.credential}`;
        break;
      case 'bearer':
        headers['Authorization'] = `Bearer ${this.config.credential}`;
        break;
      case 'apikey':
        // 不同平台 API Key 的位置不同，尝试常见方式
        headers['Authorization'] = `Bearer ${this.config.credential}`;
        headers['X-API-Key'] = this.config.credential;
        headers['api-key'] = this.config.credential;
        break;
      case 'none':
      default:
        break;
    }

    return headers;
  }

  private getBaseUrl(): string {
    if (this.config.baseUrl) return this.config.baseUrl;
    return ExternalAdapter.DEFAULT_BASE_URLS[this.config.platform] ?? '';
  }

  // ──────────── 速率限制检查 ────────────

  private checkRateLimit(): boolean {
    if (!this.config.rateLimitPerMinute) return true;

    const now = Date.now();
    const windowStart = now - 60000;
    this.requestTimestamps = this.requestTimestamps.filter((t) => t > windowStart);

    if (this.requestTimestamps.length >= this.config.rateLimitPerMinute) {
      return false;
    }

    this.requestTimestamps.push(now);
    return true;
  }

  // ──────────── RPC ────────────

  async send(msg: AxisMessage): Promise<AxisMessageReply> {
    const start = Date.now();
    this.recordSent();

    if (!this.checkRateLimit()) {
      this.recordError();
      return createReply(msg, 'error', null, {
        code: 'RATE_LIMITED',
        message: `Rate limit exceeded for ${this.config.platform}: ${this.config.rateLimitPerMinute} req/min`,
      });
    }

    try {
      const baseUrl = this.getBaseUrl();
      if (!baseUrl) {
        throw new Error(`No base URL configured for platform: ${this.config.platform}`);
      }

      // 从 AxisMessage 中解析外部 API 路径
      const externalPath = this.extractExternalPath(msg);
      const url = `${baseUrl.replace(/\/$/, '')}${externalPath}`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.buildAuthHeaders(),
        ...this.config.extraHeaders,
      };

      const response = await fetch(url, {
        method: this.httpMethod(msg),
        headers,
        body: msg.payload.data ? JSON.stringify(msg.payload.data) : undefined,
        signal: AbortSignal.timeout(this.timeout),
      });

      this.recordLatency(Date.now() - start);

      if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText);
        this.recordError();
        return createReply(msg, 'error', null, {
          code: `EXTERNAL_${response.status}`,
          message: `${this.config.platform} API error: ${errText}`,
        });
      }

      const data = await response.json().catch(() => null);
      this.recordReceived();
      return createReply(msg, 'ok', data);
    } catch (err) {
      this.recordError();
      return createReply(msg, 'error', null, {
        code: 'EXTERNAL_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ──────────── 流式（SSE fallback） ────────────

  async sendStream(
    msg: AxisMessage,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void> {
    const start = Date.now();
    this.recordSent();

    if (!this.checkRateLimit()) {
      this.recordError();
      onChunk({
        streamId: msg.header.msgId,
        sequence: 0,
        isLast: true,
        chunk: { type: 'error', message: 'Rate limited' },
      });
      return;
    }

    try {
      const baseUrl = this.getBaseUrl();
      const externalPath = this.extractExternalPath(msg);
      const url = `${baseUrl.replace(/\/$/, '')}${externalPath}`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...this.buildAuthHeaders(),
        ...this.config.extraHeaders,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(msg.payload.data),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sequence = 0;
      const streamId = msg.header.msgId;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;

            const payload = trimmed.slice(6);
            if (payload === '[DONE]') {
              onChunk({ streamId, sequence: sequence++, isLast: true, chunk: { type: 'done' } });
              continue;
            }

            try {
              const parsed = JSON.parse(payload);
              this.recordReceived();
              onChunk({ streamId, sequence: sequence++, isLast: false, chunk: parsed });
            } catch {
              onChunk({ streamId, sequence: sequence++, isLast: false, chunk: payload });
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      this.recordLatency(Date.now() - start);
    } catch (err) {
      this.recordError();
      onChunk({
        streamId: msg.header.msgId,
        sequence: 0,
        isLast: true,
        chunk: { type: 'error', message: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  // ──────────── Emit ────────────

  async emit(msg: AxisMessage): Promise<void> {
    this.recordSent();

    if (!this.checkRateLimit()) {
      this.recordError();
      return;
    }

    try {
      const baseUrl = this.getBaseUrl();
      const externalPath = this.extractExternalPath(msg);
      const url = `${baseUrl.replace(/\/$/, '')}${externalPath}`;

      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.buildAuthHeaders(),
          ...this.config.extraHeaders,
        },
        body: JSON.stringify(msg.payload.data),
      }).catch((err) => {
        this.recordError();
        console.error('[ExternalAdapter] Emit failed:', err);
      });
    } catch (err) {
      this.recordError();
      console.error('[ExternalAdapter] Emit error:', err);
    }
  }

  // ──────────── 内部工具 ────────────

  private extractExternalPath(msg: AxisMessage): string {
    // 从 metadata 或 payload 中提取外部 API 路径
    const meta = msg.payload.metadata as Record<string, unknown> | undefined;
    const path = meta?.externalPath ?? (msg.payload.data as any)?.path ?? '';
    if (typeof path === 'string' && path.startsWith('/')) return path;
    return `/${path}`;
  }

  private httpMethod(msg: AxisMessage): string {
    const meta = msg.payload.metadata as Record<string, unknown> | undefined;
    const method = meta?.httpMethod;
    if (typeof method === 'string') return method.toUpperCase();

    switch (msg.payload.action) {
      case 'create': return 'POST';
      case 'read': return 'GET';
      case 'update': return 'PUT';
      case 'delete': return 'DELETE';
      case 'invoke':
      case 'stream': return 'POST';
      default: return 'POST';
    }
  }

  // ──────────── 健康检查 ────────────

  override isHealthy(): boolean {
    return this.getBaseUrl() !== '' && this.config.credential !== '';
  }

  override getStats(): AdapterStats {
    return {
      ...this.stats,
      connectionStatus: this.isHealthy() ? 'connected' : 'error',
    };
  }

  /** 获取平台配置 */
  getPlatform(): string {
    return this.config.platform;
  }

  /** 获取认证类型 */
  getAuthType(): AuthType {
    return this.config.authType;
  }

  /** 刷新凭证（OAuth 场景） */
  async refreshCredential(newCredential: string, newRefreshToken?: string): Promise<void> {
    this.config.credential = newCredential;
    if (newRefreshToken) {
      this.config.refreshToken = newRefreshToken;
    }
  }

  /** 支持的预设平台列表 */
  static listPresetPlatforms(): string[] {
    return Object.keys(ExternalAdapter.DEFAULT_BASE_URLS);
  }
}
