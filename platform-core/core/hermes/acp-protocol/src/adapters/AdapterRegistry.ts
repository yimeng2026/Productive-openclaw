// ============================================================
// Adapter Registry
// ============================================================
// Maintains a map of platform → PlatformAdapter instances.
// Provides:
//   register(platform, adapter)       — add or overwrite
//   getAdapter(platform)              — retrieve (throws if missing)
//   resolveForMessage(msg)            — auto-select via msg.to.platform
//   listPlatforms()                     — all registered keys
//
// The registry is intentionally thin; adapters carry their own
// wire-format logic and endpoint defaults.

import { Platform, CrossPlatformMessage } from '../types';
import { PlatformAdapter } from './types';

export class AdapterRegistry {
  private adapters = new Map<Platform, PlatformAdapter<unknown>>();

  /**
   * Register an adapter for a platform.
   * Overwrites any existing adapter for that platform.
   */
  register<T>(platform: Platform, adapter: PlatformAdapter<T>): void {
    this.adapters.set(platform, adapter as PlatformAdapter<unknown>);
  }

  /**
   * Retrieve the adapter for a platform.
   * @throws if no adapter is registered.
   */
  getAdapter<T>(platform: Platform): PlatformAdapter<T> {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new Error(`No adapter registered for platform: ${platform}`);
    }
    return adapter as PlatformAdapter<T>;
  }

  /**
   * Auto-resolve the correct adapter for a message using `msg.to.platform`.
   * @throws if the target platform has no registered adapter.
   */
  resolveForMessage<T>(msg: CrossPlatformMessage): PlatformAdapter<T> {
    return this.getAdapter<T>(msg.to.platform);
  }

  /** Check whether a platform has a registered adapter. */
  has(platform: Platform): boolean {
    return this.adapters.has(platform);
  }

  /** List all registered platform keys. */
  listPlatforms(): Platform[] {
    return Array.from(this.adapters.keys());
  }

  /** Remove an adapter. */
  unregister(platform: Platform): boolean {
    return this.adapters.delete(platform);
  }

  /** Clear all adapters. */
  clear(): void {
    this.adapters.clear();
  }
}

/** Global singleton instance (optional convenience). */
export const globalRegistry = new AdapterRegistry();
