import { AgentCredentialBinding } from '../../src/auth/AgentCredentialBinding';
import { AuditLogger } from '../../src/auth/AuditLogger';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('AgentCredentialBinding', () => {
  let bindingStore: AgentCredentialBinding;
  let auditLogger: AuditLogger;

  beforeEach(() => {
    const logDir = path.join(os.tmpdir(), `binding-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(logDir, { recursive: true });
    auditLogger = new AuditLogger(logDir);
    bindingStore = new AgentCredentialBinding(auditLogger);
  });

  afterEach(() => {
    auditLogger.destroy();
  });

  // ── Bind ─────────────────────────────────────────────────────────────

  it('binds a credential to an agent and platform', async () => {
    const ref = await bindingStore.bind('agent-1', 'openclaw', 'vault-abc');
    expect(ref.agentId).toBe('agent-1');
    expect(ref.platform).toBe('openclaw');
    expect(ref.vaultId).toBe('vault-abc');
    expect(ref.boundAt).toBeGreaterThan(0);
  });

  it('overwrites existing binding for same platform', async () => {
    await bindingStore.bind('agent-1', 'openclaw', 'vault-old');
    const ref = await bindingStore.bind('agent-1', 'openclaw', 'vault-new');
    expect(ref.vaultId).toBe('vault-new');
  });

  // ── Unbind ───────────────────────────────────────────────────────────

  it('unbinds a credential', async () => {
    await bindingStore.bind('agent-1', 'claude', 'vault-xyz');
    await bindingStore.unbind('agent-1', 'claude');
    expect(bindingStore.getBinding('agent-1', 'claude')).toBeUndefined();
  });

  it('throws when unbinding non-existent agent', async () => {
    await expect(bindingStore.unbind('ghost', 'openclaw')).rejects.toThrow('has no bindings');
  });

  it('throws when unbinding non-existent platform', async () => {
    await bindingStore.bind('agent-1', 'openclaw', 'vault-abc');
    await expect(bindingStore.unbind('agent-1', 'claude')).rejects.toThrow('No binding');
  });

  // ── Migrate ──────────────────────────────────────────────────────────

  it('migrates a binding from one platform to another', async () => {
    await bindingStore.bind('agent-1', 'openclaw', 'vault-abc');
    const migrated = await bindingStore.migrate('agent-1', 'openclaw', 'claude');

    expect(migrated.platform).toBe('claude');
    expect(migrated.vaultId).toBe('vault-abc');
    expect(bindingStore.getBinding('agent-1', 'openclaw')).toBeUndefined();
    expect(bindingStore.getBinding('agent-1', 'claude')).toBeDefined();
  });

  it('throws when migrating from non-existent binding', async () => {
    await expect(bindingStore.migrate('agent-1', 'openclaw', 'claude')).rejects.toThrow(
      'has no bindings'
    );
  });

  it('throws when target platform already bound', async () => {
    await bindingStore.bind('agent-1', 'openclaw', 'vault-a');
    await bindingStore.bind('agent-1', 'claude', 'vault-b');
    await expect(bindingStore.migrate('agent-1', 'openclaw', 'claude')).rejects.toThrow(
      'already has a binding'
    );
  });

  // ── Query ────────────────────────────────────────────────────────────

  it('returns all bound credentials for an agent', async () => {
    await bindingStore.bind('agent-1', 'openclaw', 'vault-a');
    await bindingStore.bind('agent-1', 'claude', 'vault-b');

    const all = bindingStore.getBoundCredentials('agent-1');
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.platform).sort()).toEqual(['claude', 'openclaw']);
  });

  it('returns empty array for agent with no bindings', () => {
    expect(bindingStore.getBoundCredentials('ghost')).toEqual([]);
  });

  // ── Audit ────────────────────────────────────────────────────────────

  it('logs bind operation', async () => {
    await bindingStore.bind('agent-audit', 'openclaw', 'vault-x');
    const entries = auditLogger.readAll();
    const bindEntry = entries.find((e) => e.operation === 'bind');
    expect(bindEntry).toBeDefined();
    expect(bindEntry!.agentId).toBe('agent-audit');
  });

  it('logs unbind operation', async () => {
    await bindingStore.bind('agent-audit', 'claude', 'vault-y');
    await bindingStore.unbind('agent-audit', 'claude');
    const entries = auditLogger.readAll();
    const unbindEntry = entries.find((e) => e.operation === 'unbind');
    expect(unbindEntry).toBeDefined();
    expect(unbindEntry!.vaultId).toBe('vault-y');
  });

  it('logs migrate operation', async () => {
    await bindingStore.bind('agent-audit', 'openclaw', 'vault-z');
    await bindingStore.migrate('agent-audit', 'openclaw', 'ollama');
    const entries = auditLogger.readAll();
    const migrateEntry = entries.find((e) => e.operation === 'migrate');
    expect(migrateEntry).toBeDefined();
    expect(migrateEntry!.metadata).toEqual({ fromPlatform: 'openclaw' });
  });
});
