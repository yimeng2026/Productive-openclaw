import { CredentialResolver, CredentialResolverOptions } from '../../src/auth/CredentialResolver';
import { AgentCredentialBinding } from '../../src/auth/AgentCredentialBinding';
import { SecureCredentialCache } from '../../src/auth/SecureCredentialCache';
import { AuditLogger } from '../../src/auth/AuditLogger';
import { VaultStore, StaticBearerCredential } from '../../../vault/src/vault';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEST_LOG_DIR = path.join(os.tmpdir(), `resolver-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

describe('CredentialResolver', () => {
  let vaultStore: VaultStore;
  let bindingStore: AgentCredentialBinding;
  let cache: SecureCredentialCache;
  let auditLogger: AuditLogger;
  let resolver: CredentialResolver;

  beforeEach(() => {
    if (!fs.existsSync(TEST_LOG_DIR)) {
      fs.mkdirSync(TEST_LOG_DIR, { recursive: true });
    }
    auditLogger = new AuditLogger(TEST_LOG_DIR);
    vaultStore = new VaultStore({ masterKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))) });
    bindingStore = new AgentCredentialBinding(auditLogger);
    cache = new SecureCredentialCache();
    const opts: CredentialResolverOptions = {
      vaultStore,
      bindingStore,
      cache,
      hermesTokenResolver: async (agentId: string) =>
        agentId === 'agent-hermes' ? 'hermes-session-123' : undefined,
    };
    resolver = new CredentialResolver(opts);
  });

  afterEach(() => {
    cache.wipe();
    auditLogger.destroy();
  });

  // ── OpenClaw ─────────────────────────────────────────────────────────

  describe('OpenClaw', () => {
    it('resolves a bound bearer token', async () => {
      const cred: StaticBearerCredential = {
        type: 'static_bearer',
        metadata: { name: 'openclaw-token', createdAt: Date.now(), updatedAt: Date.now() },
        token: 'oc-token-abc',
      };
      const { id } = vaultStore.create(cred);
      await bindingStore.bind('agent-oc', 'openclaw', id);

      const bundle = await resolver.resolve('agent-oc', 'openclaw');
      expect(bundle.type).toBe('bearer');
      expect(bundle.header).toBe('Authorization: Bearer oc-token-abc');
      expect(bundle.value).toBe('oc-token-abc');
    });

    it('throws when no binding exists', async () => {
      await expect(resolver.resolve('agent-oc', 'openclaw')).rejects.toThrow('No credential bound');
    });
  });

  // ── Claude ───────────────────────────────────────────────────────────

  describe('Claude', () => {
    it('resolves a bound API key', async () => {
      const cred: StaticBearerCredential = {
        type: 'static_bearer',
        metadata: { name: 'claude-api-key', createdAt: Date.now(), updatedAt: Date.now() },
        token: 'sk-ant-123',
      };
      const { id } = vaultStore.create(cred);
      await bindingStore.bind('agent-claude', 'claude', id);

      const bundle = await resolver.resolve('agent-claude', 'claude');
      expect(bundle.type).toBe('api_key');
      expect(bundle.header).toBe('x-api-key: sk-ant-123');
      expect(bundle.value).toBe('sk-ant-123');
    });

    it('throws when vault credential type is incompatible', async () => {
      const cred = {
        type: 'mcp_oauth' as const,
        metadata: { name: 'oauth-cred', createdAt: Date.now(), updatedAt: Date.now() },
        clientId: 'client',
        authorizationEndpoint: 'https://example.com/auth',
        tokenEndpoint: 'https://example.com/token',
        accessToken: 'at',
      };
      const { id } = vaultStore.create(cred);
      await bindingStore.bind('agent-claude-bad', 'claude', id);

      await expect(resolver.resolve('agent-claude-bad', 'claude')).rejects.toThrow(
        'Expected static_bearer'
      );
    });
  });

  // ── Hermes ─────────────────────────────────────────────────────────────

  describe('Hermes', () => {
    it('resolves via session token resolver', async () => {
      const cred: StaticBearerCredential = {
        type: 'static_bearer',
        metadata: { name: 'dummy', createdAt: Date.now(), updatedAt: Date.now() },
        token: 'dummy',
      };
      const { id } = vaultStore.create(cred);
      await bindingStore.bind('agent-hermes', 'hermes', id);

      const bundle = await resolver.resolve('agent-hermes', 'hermes');
      expect(bundle.type).toBe('bearer');
      expect(bundle.value).toBe('hermes-session-123');
    });

    it('throws when no session token available', async () => {
      const cred: StaticBearerCredential = {
        type: 'static_bearer',
        metadata: { name: 'dummy', createdAt: Date.now(), updatedAt: Date.now() },
        token: 'dummy',
      };
      const { id } = vaultStore.create(cred);
      await bindingStore.bind('agent-hermes-unknown', 'hermes', id);

      await expect(resolver.resolve('agent-hermes-unknown', 'hermes')).rejects.toThrow(
        'No Hermes session token'
      );
    });
  });

  // ── Ollama ───────────────────────────────────────────────────────────

  describe('Ollama', () => {
    it('returns none type without credentials', async () => {
      const cred: StaticBearerCredential = {
        type: 'static_bearer',
        metadata: { name: 'dummy', createdAt: Date.now(), updatedAt: Date.now() },
        token: 'dummy',
      };
      const { id } = vaultStore.create(cred);
      await bindingStore.bind('agent-ollama', 'ollama', id);

      const bundle = await resolver.resolve('agent-ollama', 'ollama');
      expect(bundle.type).toBe('none');
      expect(bundle.value).toBe('');
    });

    it('throws when no binding exists', async () => {
      await expect(resolver.resolve('agent-ollama', 'ollama')).rejects.toThrow('No credential bound');
    });
  });
});
