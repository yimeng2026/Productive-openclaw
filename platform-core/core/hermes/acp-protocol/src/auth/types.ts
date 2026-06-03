/**
 * @file types.ts
 * @description Core type definitions for cross-platform authentication bridge.
 *
 * This module defines the shared types, interfaces, and error classes
 * used across the auth bridge layer. All exported shapes are designed
 * to be credential-safe — no raw secrets in transit.
 */

/** Supported agent platforms in the swarm */
export type Platform = 'openclaw' | 'claude' | 'hermes' | 'ollama';

/** All valid platform values for iteration */
export const ALL_PLATFORMS: readonly Platform[] = ['openclaw', 'claude', 'hermes', 'ollama'];

/**
 * Credential bundle returned by the resolver.
 *
 * This is the ONLY shape that leaves the auth layer. It is safe for
 * injection into HTTP headers, WebSocket handshakes, or ACP params.
 */
export interface CredentialBundle {
  /** Authentication scheme */
  type: 'bearer' | 'api_key' | 'none';
  /** Ready-to-inject header string (e.g. "Authorization: Bearer xxx") */
  header: string;
  /** The actual token / key value */
  value: string;
  /** Unix timestamp (ms) when the credential expires */
  expiry?: number;
  /** Optional async refresh function for renewing the credential */
  refresh?: () => Promise<string>;
}

/** Reference to a vault-stored credential bound to an agent */
export interface CredentialRef {
  /** Agent identifier */
  agentId: string;
  /** Target platform */
  platform: Platform;
  /** Vault credential ID */
  vaultId: string;
  /** Unix timestamp (ms) when the binding was created */
  boundAt: number;
}

/** Operations that can be recorded in the audit log */
export type AuditOperation =
  | 'resolve'
  | 'bind'
  | 'unbind'
  | 'migrate'
  | 'proxy_generate'
  | 'proxy_redeem'
  | 'cache_hit'
  | 'cache_miss'
  | 'refresh';

/** Single audit log entry */
export interface AuditEntry {
  /** Unix timestamp (ms) */
  timestamp: number;
  /** Agent identifier */
  agentId: string;
  /** Target platform */
  platform: Platform;
  /** Operation type */
  operation: AuditOperation;
  /** Optional client IP */
  ip?: string;
  /** Vault credential ID if applicable */
  vaultId?: string;
  /** True if anomaly detected */
  riskFlag?: boolean;
  /** Human-readable risk reason */
  riskReason?: string;
  /** Additional context */
  metadata?: Record<string, unknown>;
}

/** JWT payload for proxy tokens */
export interface ProxyTokenPayload {
  /** Subject = agentId */
  sub: string;
  /** Target platform */
  platform: Platform;
  /** Permission scope */
  scope: string;
  /** Unique token identifier */
  jti: string;
  /** Issued at (Unix seconds) */
  iat: number;
  /** Expiration (Unix seconds) */
  exp: number;
}

// ─── Errors ────────────────────────────────────────────────────────────

/** Base error for the auth bridge */
export class AuthBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthBridgeError';
  }
}

/** Thrown when an agent has no credential bound for a platform */
export class CredentialNotBoundError extends AuthBridgeError {
  constructor(agentId: string, platform: Platform) {
    super(`No credential bound for agent ${agentId} on platform ${platform}`);
    this.name = 'CredentialNotBoundError';
  }
}

/** Thrown when a proxy token has expired */
export class ProxyTokenExpiredError extends AuthBridgeError {
  constructor() {
    super('Proxy token has expired');
    this.name = 'ProxyTokenExpiredError';
  }
}

/** Thrown when a proxy token fails verification */
export class ProxyTokenInvalidError extends AuthBridgeError {
  constructor() {
    super('Proxy token is invalid');
    this.name = 'ProxyTokenInvalidError';
  }
}
