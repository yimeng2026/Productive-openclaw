/**
 * @file AuditLogger.ts
 * @description Append-only audit logger with anomaly detection.
 *
 * Every credential usage is recorded to an append-only log file.
 * The logger detects anomalies: the same credential used across
 * multiple platforms within a short window is flagged as high-risk.
 *
 * Invariants:
 * - Log file is append-only (no rewrites, no deletes)
 * - Each entry is a single JSON line
 * - Anomaly detection runs in-memory on recent usage
 */

import * as fs from 'fs';
import * as path from 'path';
import { AuditEntry, Platform } from './types';

interface UsageRecord {
  /** Set of platforms this credential was used on */
  platforms: Set<Platform>;
  /** Timestamp of first usage in this window */
  timestamp: number;
}

export class AuditLogger {
  private readonly logPath: string;
  private readonly stream: fs.WriteStream;
  private readonly recentUsage: Map<string, UsageRecord> = new Map();
  private readonly anomalyWindowMs: number = 60_000; // 1 minute

  /**
   * Creates a new AuditLogger.
   *
   * @param logDir - Directory for log files (default ./logs)
   */
  constructor(logDir: string = './logs') {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logPath = path.join(logDir, 'auth-bridge.audit.log');
    this.stream = fs.createWriteStream(this.logPath, { flags: 'a', encoding: 'utf8' });

    // Graceful shutdown hooks
    process.on('exit', () => this.close());
    process.on('SIGINT', () => { this.close(); process.exit(0); });
    process.on('SIGTERM', () => { this.close(); process.exit(0); });
  }

  /**
   * Write a single audit entry to the append-only log.
   *
   * @param entry - Partial audit entry (risk fields are computed)
   * @returns The enriched entry with anomaly flags
   */
  async log(entry: Omit<AuditEntry, 'riskFlag' | 'riskReason'>): Promise<AuditEntry> {
    const enriched = this.detectAnomaly(entry);
    const line = JSON.stringify(enriched) + '\n';

    return new Promise((resolve, reject) => {
      this.stream.write(line, (err: Error | null | undefined) => {
        if (err) reject(err);
        else resolve(enriched);
      });
    });
  }

  /**
   * Anomaly detection: same credential on multiple platforms
   * within the anomaly window is flagged as risky.
   */
  private detectAnomaly(entry: Omit<AuditEntry, 'riskFlag' | 'riskReason'>): AuditEntry {
    if (!entry.vaultId) {
      return { ...entry, riskFlag: false };
    }

    const now = entry.timestamp;
    const key = entry.vaultId;
    const record = this.recentUsage.get(key);

    if (!record) {
      this.recentUsage.set(key, { platforms: new Set([entry.platform]), timestamp: now });
      return { ...entry, riskFlag: false };
    }

    // Reset window if expired
    if (now - record.timestamp > this.anomalyWindowMs) {
      this.recentUsage.set(key, { platforms: new Set([entry.platform]), timestamp: now });
      return { ...entry, riskFlag: false };
    }

    record.platforms.add(entry.platform);

    if (record.platforms.size > 1) {
      return {
        ...entry,
        riskFlag: true,
        riskReason: `Credential ${entry.vaultId} used across ${record.platforms.size} platforms within ${this.anomalyWindowMs}ms`,
      };
    }

    return { ...entry, riskFlag: false };
  }

  /**
   * Read all audit entries from the log file.
   * Primarily for testing and diagnostics.
   */
  readAll(): AuditEntry[] {
    if (!fs.existsSync(this.logPath)) return [];
    const content = fs.readFileSync(this.logPath, 'utf8');
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AuditEntry);
  }

  /** Close the underlying write stream */
  close(): void {
    this.stream.end();
  }

  /** Forcefully destroy the write stream (for emergency cleanup) */
  destroy(): void {
    this.stream.destroy();
  }
}
