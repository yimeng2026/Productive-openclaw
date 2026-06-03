/**
 * @file AgentCredentialBinding.ts
 * @description Agent-to-credential binding lifecycle management.
 *
 * Each Agent is bound to exactly one credential per platform (1:1).
 * Operations: bind, unbind, migrate, query.
 * Every mutation is recorded to the audit log.
 */

import { CredentialRef, Platform, AuthBridgeError } from './types';
import { AuditLogger } from './AuditLogger';

export class AgentCredentialBinding {
  private readonly bindings: Map<string, Map<Platform, CredentialRef>> = new Map();
  private readonly auditLogger: AuditLogger;

  constructor(auditLogger: AuditLogger) {
    this.auditLogger = auditLogger;
  }

  /**
   * Bind a vault credential to an agent for a specific platform.
   *
   * @param agentId - Agent identifier
   * @param platform - Target platform
   * @param vaultId - Vault credential ID
   * @returns The created binding reference
   * @throws {AuthBridgeError} if inputs are invalid
   */
  async bind(agentId: string, platform: Platform, vaultId: string): Promise<CredentialRef> {
    if (!agentId || !vaultId) {
      throw new AuthBridgeError('agentId and vaultId are required');
    }

    const agentBindings = this.bindings.get(agentId) ?? new Map<Platform, CredentialRef>();
    const now = Date.now();

    const ref: CredentialRef = {
      agentId,
      platform,
      vaultId,
      boundAt: now,
    };

    agentBindings.set(platform, ref);
    this.bindings.set(agentId, agentBindings);

    await this.auditLogger.log({
      timestamp: now,
      agentId,
      platform,
      operation: 'bind',
      vaultId,
    });

    return ref;
  }

  /**
   * Unbind a credential from an agent for a specific platform.
   *
   * @param agentId - Agent identifier
   * @param platform - Target platform
   * @throws {AuthBridgeError} if binding does not exist
   */
  async unbind(agentId: string, platform: Platform): Promise<void> {
    const agentBindings = this.bindings.get(agentId);
    if (!agentBindings) {
      throw new AuthBridgeError(`Agent ${agentId} has no bindings`);
    }

    const ref = agentBindings.get(platform);
    if (!ref) {
      throw new AuthBridgeError(`No binding for agent ${agentId} on platform ${platform}`);
    }

    agentBindings.delete(platform);
    if (agentBindings.size === 0) {
      this.bindings.delete(agentId);
    }

    await this.auditLogger.log({
      timestamp: Date.now(),
      agentId,
      platform,
      operation: 'unbind',
      vaultId: ref.vaultId,
    });
  }

  /**
   * Migrate an agent's credential from one platform to another.
   *
   * The vault credential stays the same; only the platform binding changes.
   *
   * @param agentId - Agent identifier
   * @param oldPlatform - Source platform
   * @param newPlatform - Destination platform
   * @returns The new binding reference
   * @throws {AuthBridgeError} if old binding missing or new platform already bound
   */
  async migrate(agentId: string, oldPlatform: Platform, newPlatform: Platform): Promise<CredentialRef> {
    const agentBindings = this.bindings.get(agentId);
    if (!agentBindings) {
      throw new AuthBridgeError(`Agent ${agentId} has no bindings`);
    }

    const oldRef = agentBindings.get(oldPlatform);
    if (!oldRef) {
      throw new AuthBridgeError(`No binding for agent ${agentId} on platform ${oldPlatform}`);
    }

    if (agentBindings.has(newPlatform)) {
      throw new AuthBridgeError(`Agent ${agentId} already has a binding on platform ${newPlatform}`);
    }

    const now = Date.now();
    const newRef: CredentialRef = {
      agentId,
      platform: newPlatform,
      vaultId: oldRef.vaultId,
      boundAt: now,
    };

    agentBindings.delete(oldPlatform);
    agentBindings.set(newPlatform, newRef);

    await this.auditLogger.log({
      timestamp: now,
      agentId,
      platform: newPlatform,
      operation: 'migrate',
      vaultId: oldRef.vaultId,
      metadata: { fromPlatform: oldPlatform },
    });

    return newRef;
  }

  /**
   * Query all credentials bound to an agent.
   *
   * @param agentId - Agent identifier
   * @returns Array of credential references
   */
  getBoundCredentials(agentId: string): CredentialRef[] {
    const agentBindings = this.bindings.get(agentId);
    if (!agentBindings) return [];
    return Array.from(agentBindings.values());
  }

  /**
   * Get a specific binding.
   *
   * @param agentId - Agent identifier
   * @param platform - Target platform
   * @returns The binding reference, or undefined
   */
  getBinding(agentId: string, platform: Platform): CredentialRef | undefined {
    return this.bindings.get(agentId)?.get(platform);
  }
}
