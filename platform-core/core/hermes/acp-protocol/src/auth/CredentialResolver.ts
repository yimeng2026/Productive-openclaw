/**
 * @file CredentialResolver.ts
 * @description Resolves platform-specific credentials for agents.
 *
 * Given an agentId and a target platform, the resolver:
 * 1. Looks up the AgentCredentialBinding for the vault reference
 * 2. Fetches the full credential from VaultStore (decrypted)
 * 3. Transforms the vault credential into a platform-native CredentialBundle
 * 4. Caches the result in SecureCredentialCache
 *
 * Platforms:
 * - OpenClaw: static_bearer token → "Authorization: Bearer xxx" (WebSocket header)
 * - Claude:   static_bearer token → "x-api-key: xxx" (HTTP header)
 * - Hermes:   session token from external resolver → "Authorization: Bearer xxx" (ACP params)
 * - Ollama:   no credentials required
 */

import {
  CredentialBundle,
  Platform,
  CredentialNotBoundError,
  AuthBridgeError,
} from './types';
import { AgentCredentialBinding } from './AgentCredentialBinding';
import { SecureCredentialCache } from './SecureCredentialCache';
import {
  VaultStore,
  Credential,
  StaticBearerCredential,
} from '../../../vault/src/vault';

// ─── Type guard for Vault credentials ────────────────────────────────────

function isStaticBearer(cred: Credential): cred is StaticBearerCredential {
  return cred.type === 'static_bearer';
}

// ─── Options ───────────────────────────────────────────────────────────

export interface CredentialResolverOptions {
  /** Vault store for fetching decrypted credentials */
  vaultStore: VaultStore;
  /** Agent-to-credential binding registry */
  bindingStore: AgentCredentialBinding;
  /** Encrypted in-memory cache */
  cache: SecureCredentialCache;
  /** Optional external resolver for Hermes session tokens */
  hermesTokenResolver?: (agentId: string) => Promise<string | undefined>;
}

// ─── Class ─────────────────────────────────────────────────────────────

export class CredentialResolver {
  private readonly vaultStore: VaultStore;
  private readonly bindingStore: AgentCredentialBinding;
  private readonly cache: SecureCredentialCache;
  private readonly hermesTokenResolver?: (agentId: string) => Promise<string | undefined>;

  constructor(options: CredentialResolverOptions) {
    this.vaultStore = options.vaultStore;
    this.bindingStore = options.bindingStore;
    this.cache = options.cache;
    this.hermesTokenResolver = options.hermesTokenResolver;
  }

  /**
   * Resolve the credential bundle for an agent on a target platform.
   *
   * @param agentId - Agent identifier
   * @param platform - Target platform
   * @returns Platform-native credential bundle
   * @throws {CredentialNotBoundError} if no binding exists
   * @throws {AuthBridgeError} if credential type is incompatible
   */
  async resolve(agentId: string, platform: Platform): Promise<CredentialBundle> {
    const cacheKey = `${agentId}:${platform}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const binding = this.bindingStore.getBinding(agentId, platform);
    if (!binding) {
      throw new CredentialNotBoundError(agentId, platform);
    }

    let bundle: CredentialBundle;

    switch (platform) {
      case 'openclaw': {
        const cred = this.vaultStore.get(binding.vaultId);
        if (!isStaticBearer(cred)) {
          throw new AuthBridgeError(
            `Expected static_bearer credential for OpenClaw, got ${cred.type}`
          );
        }
        const token = cred.token ?? '';
        bundle = {
          type: 'bearer',
          header: `Authorization: Bearer ${token}`,
          value: token,
        };
        break;
      }

      case 'claude': {
        const cred = this.vaultStore.get(binding.vaultId);
        if (!isStaticBearer(cred)) {
          throw new AuthBridgeError(
            `Expected static_bearer credential for Claude, got ${cred.type}`
          );
        }
        const apiKey = cred.token ?? '';
        bundle = {
          type: 'api_key',
          header: `x-api-key: ${apiKey}`,
          value: apiKey,
        };
        break;
      }

      case 'hermes': {
        if (!this.hermesTokenResolver) {
          throw new AuthBridgeError('Hermes token resolver not configured');
        }
        const sessionToken = await this.hermesTokenResolver(agentId);
        if (!sessionToken) {
          throw new AuthBridgeError(
            `No Hermes session token available for agent ${agentId}`
          );
        }
        bundle = {
          type: 'bearer',
          header: `Authorization: Bearer ${sessionToken}`,
          value: sessionToken,
        };
        break;
      }

      case 'ollama': {
        bundle = {
          type: 'none',
          header: '',
          value: '',
        };
        break;
      }

      default: {
        // Exhaustiveness check — TypeScript narrows Platform to never here
        const _exhaustive: never = platform;
        throw new AuthBridgeError(`Unsupported platform: ${_exhaustive}`);
      }
    }

    await this.cache.set(cacheKey, bundle);
    return bundle;
  }
}
