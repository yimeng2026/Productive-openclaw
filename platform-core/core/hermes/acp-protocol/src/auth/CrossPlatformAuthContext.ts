/**
 * @file CrossPlatformAuthContext.ts
 * @description Proxy-token based cross-platform authentication.
 *
 * Instead of passing raw API keys over the network, the coordinator
 * generates a short-lived proxy token (JWT). The receiving platform
 * redeems the proxy token for the real credential via Vault resolution.
 *
 * Flow:
 *   Coordinator → generateProxyToken(agentId, platform)
 *   → send proxy-token to target
 *   → target calls redeemProxyToken(token) → resolves real credential
 *
 * Security:
 * - Proxy tokens expire in 60 seconds (single-flight)
 * - JWT signed with a process-level secret (HS256)
 * - Real credentials NEVER traverse the network
 */

import * as crypto from 'crypto';
import jwt from 'jsonwebtoken';
import {
  ProxyTokenPayload,
  Platform,
  ProxyTokenExpiredError,
  ProxyTokenInvalidError,
  CredentialBundle,
} from './types';
import { CredentialResolver } from './CredentialResolver';
import { AuditLogger } from './AuditLogger';

/** Default TTL for proxy tokens: 60 seconds */
const PROXY_TOKEN_TTL_SECONDS = 60;

/** Default JWT signing secret (override via options for production) */
function defaultJwtSecret(): string {
  // Generate a deterministic secret from a random base if env is absent.
  // In production this MUST be provided via PROXY_JWT_SECRET env var.
  return process.env.PROXY_JWT_SECRET ?? crypto.randomBytes(32).toString('hex');
}

export interface CrossPlatformAuthContextOptions {
  /** Credential resolver for real credential lookup */
  resolver: CredentialResolver;
  /** Audit logger for all proxy operations */
  auditLogger: AuditLogger;
  /** Optional custom JWT secret (default from env or random) */
  jwtSecret?: string;
}

export class CrossPlatformAuthContext {
  private readonly resolver: CredentialResolver;
  private readonly auditLogger: AuditLogger;
  private readonly jwtSecret: string;

  constructor(options: CrossPlatformAuthContextOptions) {
    this.resolver = options.resolver;
    this.auditLogger = options.auditLogger;
    this.jwtSecret = options.jwtSecret ?? defaultJwtSecret();
  }

  /**
   * Generate a short-lived proxy token for cross-platform transport.
   *
   * The token contains ONLY identity claims — no secrets.
   *
   * @param agentId - Agent identifier
   * @param platform - Target platform
   * @param scope - Permission scope (default 'default')
   * @returns Signed JWT string
   */
  async generateProxyToken(
    agentId: string,
    platform: Platform,
    scope: string = 'default'
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload: ProxyTokenPayload = {
      sub: agentId,
      platform,
      scope,
      jti: crypto.randomUUID(),
      iat: now,
      exp: now + PROXY_TOKEN_TTL_SECONDS,
    };

    const token = jwt.sign(payload, this.jwtSecret, { algorithm: 'HS256' });

    await this.auditLogger.log({
      timestamp: Date.now(),
      agentId,
      platform,
      operation: 'proxy_generate',
      metadata: { jti: payload.jti, scope },
    });

    return token;
  }

  /**
   * Verify a proxy token and return its decoded payload.
   *
   * @param token - JWT string
   * @returns Decoded payload
   * @throws {ProxyTokenExpiredError} if token expired
   * @throws {ProxyTokenInvalidError} if signature or claims invalid
   */
  verifyProxyToken(token: string): ProxyTokenPayload {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
        complete: false,
      }) as unknown as ProxyTokenPayload;

      if (!decoded.sub || !decoded.platform || !decoded.jti) {
        throw new ProxyTokenInvalidError();
      }

      return decoded;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new ProxyTokenExpiredError();
      }
      throw new ProxyTokenInvalidError();
    }
  }

  /**
   * Redeem a proxy token for the real credential bundle.
   *
   * Called on the TARGET platform. Verifies the proxy token,
   * then resolves the actual credential for the agent.
   *
   * @param token - Proxy JWT
   * @param ip - Optional client IP for audit
   * @returns Payload + real credential bundle
   */
  async redeemProxyToken(
    token: string,
    ip?: string
  ): Promise<{ payload: ProxyTokenPayload; bundle: CredentialBundle }> {
    const payload = this.verifyProxyToken(token);

    const bundle = await this.resolver.resolve(payload.sub, payload.platform);

    await this.auditLogger.log({
      timestamp: Date.now(),
      agentId: payload.sub,
      platform: payload.platform,
      operation: 'proxy_redeem',
      ip,
      metadata: { jti: payload.jti, scope: payload.scope },
    });

    return { payload, bundle };
  }
}
