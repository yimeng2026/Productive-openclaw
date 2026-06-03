import { CrossPlatformAuthContext } from '../../src/auth/CrossPlatformAuthContext';
import { CredentialResolver } from '../../src/auth/CredentialResolver';
import { AgentCredentialBinding } from '../../src/auth/AgentCredentialBinding';
import { SecureCredentialCache } from '../../src/auth/SecureCredentialCache';
import { AuditLogger } from '../../src/auth/AuditLogger';
import { VaultStore, StaticBearerCredential } from '../../../vault/src/vault';
import { ProxyTokenExpiredError, ProxyTokenInvalidError } from '../../src/auth/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CrossPlatformAuthContext', () => {
  let authContext: CrossPlatformAuthContext;
  let resolver: CredentialResolver;
  let auditLogger: AuditLogger;
  let logDir: string;

  beforeEach(async () => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
    auditLogger = new AuditLogger(logDir);
    const vaultStore = new VaultStore({ masterKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))) });
    const bindingStore = new AgentCredentialBinding(auditLogger);
    const cache = new SecureCredentialCache();

    const cred: StaticBearerCredential = {
      type: 'static_bearer',
      metadata: { name: 'proxy-cred', createdAt: Date.now(), updatedAt: Date.now() },
      token: 'real-secret-42',
    };
    const { id } = vaultStore.create(cred);
    await bindingStore.bind('agent-proxy', 'openclaw', id);

    resolver = new CredentialResolver({ vaultStore, bindingStore, cache });
    authContext = new CrossPlatformAuthContext({
      resolver,
      auditLogger,
      jwtSecret: 'test-secret-for-jwt-signing-only',
    });
  });

  afterEach(() => {
    auditLogger.close();
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  // ── Generate ─────────────────────────────────────────────────────────

  it('generates a valid proxy token', async () => {
    const token = await authContext.generateProxyToken('agent-proxy', 'openclaw', 'read');
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT format
  });

  it('includes correct claims in proxy token', async () => {
    const token = await authContext.generateProxyToken('agent-proxy', 'openclaw', 'write');
    const payload = authContext.verifyProxyToken(token);

    expect(payload.sub).toBe('agent-proxy');
    expect(payload.platform).toBe('openclaw');
    expect(payload.scope).toBe('write');
    expect(payload.jti).toBeDefined();
    expect(payload.exp - payload.iat).toBe(60);
  });

  // ── Verify ──────────────────────────────────────────────────────────

  it('verifies a valid proxy token', async () => {
    const token = await authContext.generateProxyToken('agent-proxy', 'openclaw');
    const payload = authContext.verifyProxyToken(token);
    expect(payload.sub).toBe('agent-proxy');
  });

  it('throws ProxyTokenExpiredError on expired token', async () => {
    jest.useFakeTimers();
    const token = await authContext.generateProxyToken('agent-proxy', 'openclaw');
    jest.advanceTimersByTime(61_000); // 61 seconds

    expect(() => authContext.verifyProxyToken(token)).toThrow(ProxyTokenExpiredError);
    jest.useRealTimers();
  });

  it('throws ProxyTokenInvalidError on tampered token', () => {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.tampered.signature';
    expect(() => authContext.verifyProxyToken(token)).toThrow(ProxyTokenInvalidError);
  });

  // ── Redeem ──────────────────────────────────────────────────────────

  it('redeems proxy token for real credential', async () => {
    const token = await authContext.generateProxyToken('agent-proxy', 'openclaw');
    const { payload, bundle } = await authContext.redeemProxyToken(token, '10.0.0.1');

    expect(payload.sub).toBe('agent-proxy');
    expect(bundle.type).toBe('bearer');
    expect(bundle.value).toBe('real-secret-42');
  });

  it('logs proxy_redeem to audit log', async () => {
    const token = await authContext.generateProxyToken('agent-proxy', 'openclaw');
    await authContext.redeemProxyToken(token, '192.168.1.1');

    const entries = auditLogger.readAll();
    const redeemEntry = entries.find((e) => e.operation === 'proxy_redeem');
    expect(redeemEntry).toBeDefined();
    expect(redeemEntry!.agentId).toBe('agent-proxy');
    expect(redeemEntry!.ip).toBe('192.168.1.1');
  });
});
