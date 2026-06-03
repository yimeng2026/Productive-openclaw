/**
 * @file SecureCredentialCache.ts
 * @description In-memory credential cache with AES-256-GCM encryption.
 *
 * Reduces Vault store queries by keeping decrypted credentials in memory.
 * All cached values are encrypted at rest in memory; the master key is
 * generated fresh per process and never leaves this module.
 *
 * TTL:
 * - Bearer tokens: 15 minutes
 * - API keys: 7 days
 * - None (Ollama): 1 minute
 *
 * Auto-refresh: triggered 5 minutes before expiry if a refresh function
 * is provided. Memory is wiped on process exit.
 */

import * as crypto from 'crypto';
import { CredentialBundle } from './types';

interface CacheEntry {
  /** AES-256-GCM encrypted value */
  ciphertext: Buffer;
  /** Initialization vector */
  iv: Buffer;
  /** GCM authentication tag */
  authTag: Buffer;
  /** Non-sensitive: header string */
  header: string;
  /** Non-sensitive: credential type */
  type: 'bearer' | 'api_key' | 'none';
  /** Expiry timestamp (ms) */
  expiry?: number;
  /** When the entry was inserted */
  insertedAt: number;
  /** TTL in milliseconds */
  ttlMs: number;
  /** Optional refresh callback */
  refreshFn?: () => Promise<string>;
}

export class SecureCredentialCache {
  private readonly cache: Map<string, CacheEntry> = new Map();
  private readonly masterKey: Buffer;
  private readonly refreshBeforeExpiryMs = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.masterKey = crypto.randomBytes(32);

    // Wipe memory on process exit
    process.on('exit', () => this.wipe());
    process.on('SIGINT', () => { this.wipe(); process.exit(0); });
    process.on('SIGTERM', () => { this.wipe(); process.exit(0); });
  }

  // ─── Cryptography ────────────────────────────────────────────────────

  private encrypt(plaintext: string): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { ciphertext: encrypted, iv, authTag };
  }

  private decrypt(ciphertext: Buffer, iv: Buffer, authTag: Buffer): string {
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
  }

  // ─── TTL logic ────────────────────────────────────────────────────────

  private getTtl(type: 'bearer' | 'api_key' | 'none'): number {
    switch (type) {
      case 'bearer':
        return 15 * 60 * 1000; // 15 minutes
      case 'api_key':
        return 7 * 24 * 60 * 60 * 1000; // 7 days
      case 'none':
        return 60 * 1000; // 1 minute
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────

  /**
   * Store a credential bundle in the encrypted cache.
   */
  async set(key: string, bundle: CredentialBundle): Promise<void> {
    const ttlMs = this.getTtl(bundle.type);
    const { ciphertext, iv, authTag } = this.encrypt(bundle.value);

    const entry: CacheEntry = {
      ciphertext,
      iv,
      authTag,
      header: bundle.header,
      type: bundle.type,
      expiry: bundle.expiry,
      insertedAt: Date.now(),
      ttlMs,
      refreshFn: bundle.refresh,
    };

    this.cache.set(key, entry);
  }

  /**
   * Retrieve a credential bundle from cache.
   *
   * Returns null if missing or expired. Auto-refreshes if a refresh
   * function is registered and expiry is within the refresh window.
   */
  async get(key: string): Promise<CredentialBundle | null> {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    if (now - entry.insertedAt > entry.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    // Auto-refresh: token expires within 5 minutes
    if (entry.expiry && entry.refreshFn && entry.expiry - now <= this.refreshBeforeExpiryMs) {
      try {
        const newValue = await entry.refreshFn();
        const encrypted = this.encrypt(newValue);
        entry.ciphertext = encrypted.ciphertext;
        entry.iv = encrypted.iv;
        entry.authTag = encrypted.authTag;
        entry.insertedAt = now;
        entry.expiry = now + entry.ttlMs;
      } catch {
        // Refresh failed; continue with stale entry if not expired
      }
    }

    const value = this.decrypt(entry.ciphertext, entry.iv, entry.authTag);
    return {
      type: entry.type,
      header: entry.header,
      value,
      expiry: entry.expiry,
      refresh: entry.refreshFn,
    };
  }

  /** Remove a single cached entry */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /** Zero-fill all cached values and keys, then clear the map */
  wipe(): void {
    for (const entry of this.cache.values()) {
      entry.ciphertext.fill(0);
      entry.iv.fill(0);
      entry.authTag.fill(0);
    }
    this.cache.clear();
    this.masterKey.fill(0);
  }

  /** Number of entries currently in cache */
  size(): number {
    return this.cache.size;
  }
}
