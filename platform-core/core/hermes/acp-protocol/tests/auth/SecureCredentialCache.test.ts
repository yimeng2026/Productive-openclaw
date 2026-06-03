import { SecureCredentialCache } from '../../src/auth/SecureCredentialCache';
import { CredentialBundle } from '../../src/auth/types';

describe('SecureCredentialCache', () => {
  let cache: SecureCredentialCache;

  beforeEach(() => {
    cache = new SecureCredentialCache();
  });

  afterEach(() => {
    cache.wipe();
  });

  // ── Basic set/get ─────────────────────────────────────────────────────

  it('stores and retrieves a bearer token', async () => {
    const bundle: CredentialBundle = {
      type: 'bearer',
      header: 'Authorization: Bearer tok-123',
      value: 'tok-123',
      expiry: Date.now() + 3600_000,
    };

    await cache.set('key-1', bundle);
    const result = await cache.get('key-1');

    expect(result).not.toBeNull();
    expect(result!.type).toBe('bearer');
    expect(result!.value).toBe('tok-123');
    expect(result!.header).toBe('Authorization: Bearer tok-123');
  });

  it('returns null for missing keys', async () => {
    const result = await cache.get('nonexistent');
    expect(result).toBeNull();
  });

  // ── TTL ──────────────────────────────────────────────────────────────

  it('expires bearer tokens after 15 minutes', async () => {
    jest.useFakeTimers();
    const bundle: CredentialBundle = {
      type: 'bearer',
      header: 'Authorization: Bearer tok',
      value: 'tok',
    };

    await cache.set('ttl-bearer', bundle);
    expect(await cache.get('ttl-bearer')).not.toBeNull();

    jest.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(await cache.get('ttl-bearer')).toBeNull();

    jest.useRealTimers();
  });

  it('expires api_key after 7 days', async () => {
    jest.useFakeTimers();
    const bundle: CredentialBundle = {
      type: 'api_key',
      header: 'x-api-key: key',
      value: 'key',
    };

    await cache.set('ttl-api', bundle);
    expect(await cache.get('ttl-api')).not.toBeNull();

    jest.advanceTimersByTime(7 * 24 * 60 * 60 * 1000 + 1);
    expect(await cache.get('ttl-api')).toBeNull();

    jest.useRealTimers();
  });

  it('expires none tokens after 1 minute', async () => {
    jest.useFakeTimers();
    const bundle: CredentialBundle = {
      type: 'none',
      header: '',
      value: '',
    };

    await cache.set('ttl-none', bundle);
    expect(await cache.get('ttl-none')).not.toBeNull();

    jest.advanceTimersByTime(60 * 1000 + 1);
    expect(await cache.get('ttl-none')).toBeNull();

    jest.useRealTimers();
  });

  // ── Encryption ───────────────────────────────────────────────────────

  it('does not store plaintext in memory', async () => {
    const bundle: CredentialBundle = {
      type: 'bearer',
      header: 'Authorization: Bearer secret',
      value: 'secret',
    };

    await cache.set('enc', bundle);

    // Access internal map directly to inspect storage
    const internalMap = (cache as unknown as { cache: Map<string, { ciphertext: Buffer }> }).cache;
    const entry = internalMap.get('enc')!;
    const rawText = entry.ciphertext.toString('utf8');

    expect(rawText).not.toContain('secret');
  });

  // ── Auto-refresh ─────────────────────────────────────────────────────

  it('auto-refreshes token 5 minutes before expiry', async () => {
    const refreshFn = jest.fn().mockResolvedValue('refreshed-token');
    const now = Date.now();
    const bundle: CredentialBundle = {
      type: 'bearer',
      header: 'Authorization: Bearer old',
      value: 'old',
      expiry: now + 4 * 60 * 1000, // expires in 4 minutes (within 5-min window)
      refresh: refreshFn,
    };

    await cache.set('refresh-test', bundle);
    const result = await cache.get('refresh-test');

    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(result!.value).toBe('refreshed-token');
  });

  it('does not auto-refresh when expiry is far away', async () => {
    const refreshFn = jest.fn().mockResolvedValue('refreshed-token');
    const bundle: CredentialBundle = {
      type: 'bearer',
      header: 'Authorization: Bearer old',
      value: 'old',
      expiry: Date.now() + 60 * 60 * 1000, // expires in 1 hour
      refresh: refreshFn,
    };

    await cache.set('no-refresh', bundle);
    await cache.get('no-refresh');

    expect(refreshFn).not.toHaveBeenCalled();
  });

  // ── Wipe ─────────────────────────────────────────────────────────────

  it('clears all entries on wipe', async () => {
    const bundle: CredentialBundle = {
      type: 'api_key',
      header: 'x-api-key: k',
      value: 'k',
    };

    await cache.set('wipe-1', bundle);
    await cache.set('wipe-2', bundle);
    expect(cache.size()).toBe(2);

    cache.wipe();
    expect(cache.size()).toBe(0);
    expect(await cache.get('wipe-1')).toBeNull();
  });
});
