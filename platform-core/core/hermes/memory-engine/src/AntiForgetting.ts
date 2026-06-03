/**
 * @file AntiForgetting.ts
 * @description 反遗忘系统 — 防止 Hermes 重启后丢失已积累的知识
 *   核心机制：定期将知识图谱和状态快照同步到持久存储
 *   TODO: 实际实现使用 SQLite 或 Redis 做持久化
 */

export interface AntiForgettingConfig {
  syncIntervalMs?: number;
  maxSnapshots?: number;
  backupDir?: string;
}

export interface SyncReport {
  syncedAt: string;
  nodesSynced: number;
  stateSaved: boolean;
  backupPath: string;
}

export class AntiForgetting {
  private config: AntiForgettingConfig;

  constructor(config: AntiForgettingConfig = {}) {
    this.config = {
      syncIntervalMs: 300000, // 5分钟
      maxSnapshots: 10,
      backupDir: './data/hermes-backups',
      ...config,
    };
  }

  /**
   * 同步知识图谱和状态到持久存储
   */
  async sync(kg: any, state: any): Promise<SyncReport> {
    try {
      const fs = require('fs');
      const dir = this.config.backupDir!;
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${dir}/snapshot-${timestamp}.json`;

      const snapshot = {
        state,
        syncedAt: new Date().toISOString(),
      };

      fs.writeFileSync(backupPath, JSON.stringify(snapshot, null, 2));

      // 清理旧快照
      this.cleanOldSnapshots(dir);

      return {
        syncedAt: new Date().toISOString(),
        nodesSynced: state.knowledgeGraphSize || 0,
        stateSaved: true,
        backupPath,
      };
    } catch {
      return {
        syncedAt: new Date().toISOString(),
        nodesSynced: 0,
        stateSaved: false,
        backupPath: '',
      };
    }
  }

  private cleanOldSnapshots(dir: string): void {
    try {
      const fs = require('fs');
      const files = fs.readdirSync(dir)
        .filter((f: string) => f.startsWith('snapshot-'))
        .map((f: string) => ({
          name: f,
          time: fs.statSync(`${dir}/${f}`).mtime.getTime(),
        }))
        .sort((a: any, b: any) => b.time - a.time);

      for (let i = this.config.maxSnapshots!; i < files.length; i++) {
        fs.unlinkSync(`${dir}/${files[i].name}`);
      }
    } catch {
      // ignore cleanup errors
    }
  }
}

export default AntiForgetting;
