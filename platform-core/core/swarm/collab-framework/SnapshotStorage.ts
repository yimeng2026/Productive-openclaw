/**
 * SnapshotStorage.ts — SYLVA 快照存储管理器
 *
 * 核心职责:
 * 1. 内存存储 — Map-based 高速读写
 * 2. 持久化 — 可选 JSON文件 / Redis 后端
 * 3. 版本管理 — 自动编号、时间戳、标签索引
 * 4. 清理策略 — 保留最近N个、按TTL过期、按标签保留
 * 5. 血缘索引 — 支持快速查询快照链
 *
 * 设计原则:
 * - 默认纯内存，零依赖启动
 * - 持久化按需激活（配置驱动）
 * - 清理策略可组合（最近N + 标签保护 + TTL）
 * - 所有操作返回 Promise（兼容异步后端）
 */

import { Snapshot, SnapshotMetadata } from './SnapshotEngine';

// ──────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────

/** 存储后端类型 */
export type StorageBackend = 'memory' | 'json-file' | 'redis';

/** 清理策略配置 */
export interface CleanupPolicy {
  /** 保留每个战车的最近N个快照（null = 不限制） */
  keepLastN?: number;
  /** 快照最大存活时间（毫秒，null = 不过期） */
  ttlMs?: number;
  /** 保护标签（带这些标签的快照不会被自动清理） */
  protectedTags?: string[];
  /** 保留带特定前缀的快照 */
  protectedPrefixes?: string[];
}

/** 存储配置 */
export interface StorageConfig {
  /** 后端类型 */
  backend: StorageBackend;
  /** 仅 backend='json-file' 时：存储目录路径 */
  filePath?: string;
  /** 仅 backend='redis' 时：Redis连接URL */
  redisUrl?: string;
  /** 仅 backend='redis' 时：键前缀 */
  redisPrefix?: string;
  /** 清理策略 */
  cleanupPolicy?: CleanupPolicy;
  /** 是否自动保存（捕获后自动写入持久层） */
  autoSave?: boolean;
}

/** 快照查询条件 */
export interface SnapshotQuery {
  /** 来源战车ID */
  chariotId?: string;
  /** 父快照ID（查子代） */
  parentSnapshotId?: string;
  /** 标签过滤 */
  tags?: string[];
  /** 时间范围起始 */
  fromTime?: number;
  /** 时间范围结束 */
  toTime?: number;
  /** 版本号 */
  version?: number;
  /** 快照ID精确匹配 */
  snapshotId?: string;
}

/** 存储统计 */
export interface StorageStats {
  totalSnapshots: number;
  totalByChariot: Record<string, number>;
  oldestSnapshotAt: number | null;
  newestSnapshotAt: number | null;
  averageSnapshotSizeBytes: number;
}

// ──────────────────────────────────────────
// 存储实现
// ──────────────────────────────────────────

export class SnapshotStorage {
  private config: StorageConfig;

  // 内存存储：snapshotId -> Snapshot
  private memoryStore: Map<string, Snapshot> = new Map();

  // 索引：chariotId -> snapshotId[]（按时间排序）
  private chariotIndex: Map<string, string[]> = new Map();

  // 索引：parentSnapshotId -> snapshotId[]（血缘索引）
  private lineageIndex: Map<string, string[]> = new Map();

  // 索引：tag -> snapshotId[]
  private tagIndex: Map<string, Set<string>> = new Map();

  // 版本计数器：chariotId -> 当前最大版本号
  private versionCounter: Map<string, number> = new Map();

  // JSON文件后端状态
  private fileDirty = false;
  private fileWritePromise: Promise<void> | null = null;

  constructor(config: StorageConfig) {
    this.config = {
      autoSave: true,
      ...config,
    };

    // 如果是文件后端，启动时加载
    if (config.backend === 'json-file' && config.filePath) {
      this.loadFromFile().catch(console.error);
    }
  }

  // ── 1. 基础CRUD ─────────────────────────

  /**
   * 保存快照到存储
   *
   * 流程:
   * 1. 写入内存存储
   * 2. 更新所有索引
   * 3. 触发清理策略
   * 4. 如配置 autoSave，异步写入持久层
   *
   * @param snapshot 要保存的快照
   * @returns 快照ID
   */
  async save(snapshot: Snapshot): Promise<string> {
    const id = snapshot.metadata.snapshotId;

    // 1. 深拷贝存入（防止外部修改污染存储）
    this.memoryStore.set(id, this.deepClone(snapshot));

    // 2. 更新战车索引
    const chariotId = snapshot.metadata.sourceChariotId;
    if (!this.chariotIndex.has(chariotId)) {
      this.chariotIndex.set(chariotId, []);
    }
    const chariotList = this.chariotIndex.get(chariotId)!;
    if (!chariotList.includes(id)) {
      chariotList.push(id);
    }

    // 3. 更新血缘索引
    if (snapshot.metadata.parentSnapshotId) {
      if (!this.lineageIndex.has(snapshot.metadata.parentSnapshotId)) {
        this.lineageIndex.set(snapshot.metadata.parentSnapshotId, []);
      }
      this.lineageIndex.get(snapshot.metadata.parentSnapshotId)!.push(id);
    }

    // 4. 更新标签索引
    for (const tag of snapshot.metadata.tags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(id);
    }

    // 5. 更新版本计数器
    const currentVersion = this.versionCounter.get(chariotId) ?? 0;
    if (snapshot.metadata.version > currentVersion) {
      this.versionCounter.set(chariotId, snapshot.metadata.version);
    }

    // 6. 执行清理
    if (this.config.cleanupPolicy) {
      this.applyCleanup(chariotId);
    }

    // 7. 异步持久化
    if (this.config.autoSave) {
      this.persistAsync();
    }

    return id;
  }

  /**
   * 通过ID获取快照
   */
  async get(snapshotId: string): Promise<Snapshot | undefined> {
    const snapshot = this.memoryStore.get(snapshotId);
    return snapshot ? this.deepClone(snapshot) : undefined;
  }

  /**
   * 通过ID获取快照（同步版，用于血缘查询等内部场景）
   */
  getSync(snapshotId: string): Snapshot | undefined {
    const snapshot = this.memoryStore.get(snapshotId);
    return snapshot ? this.deepClone(snapshot) : undefined;
  }

  /**
   * 删除快照
   */
  async delete(snapshotId: string): Promise<boolean> {
    const snapshot = this.memoryStore.get(snapshotId);
    if (!snapshot) return false;

    // 1. 从内存删除
    this.memoryStore.delete(snapshotId);

    // 2. 从战车索引删除
    const chariotId = snapshot.metadata.sourceChariotId;
    const chariotList = this.chariotIndex.get(chariotId);
    if (chariotList) {
      const idx = chariotList.indexOf(snapshotId);
      if (idx >= 0) chariotList.splice(idx, 1);
    }

    // 3. 从血缘索引删除
    if (snapshot.metadata.parentSnapshotId) {
      const parentList = this.lineageIndex.get(snapshot.metadata.parentSnapshotId);
      if (parentList) {
        const idx = parentList.indexOf(snapshotId);
        if (idx >= 0) parentList.splice(idx, 1);
      }
    }

    // 4. 从标签索引删除
    for (const tag of snapshot.metadata.tags) {
      this.tagIndex.get(tag)?.delete(snapshotId);
    }

    // 5. 异步持久化
    this.persistAsync();

    return true;
  }

  /**
   * 检查快照是否存在
   */
  async exists(snapshotId: string): Promise<boolean> {
    return this.memoryStore.has(snapshotId);
  }

  // ── 2. 查询 ─────────────────────────────

  /**
   * 条件查询快照
   *
   * 支持组合条件: chariotId, parentSnapshotId, tags, 时间范围, version
   */
  async query(query: SnapshotQuery): Promise<Snapshot[]> {
    let candidates: string[] = [];

    // 使用最严格的索引缩小范围
    if (query.snapshotId) {
      // 精确ID查询
      const snap = this.memoryStore.get(query.snapshotId);
      return snap ? [this.deepClone(snap)] : [];
    }

    if (query.chariotId && this.chariotIndex.has(query.chariotId)) {
      candidates = [...this.chariotIndex.get(query.chariotId)!];
    } else if (query.parentSnapshotId && this.lineageIndex.has(query.parentSnapshotId)) {
      candidates = [...this.lineageIndex.get(query.parentSnapshotId)!];
    } else if (query.tags && query.tags.length > 0) {
      // 取标签交集
      const sets = query.tags
        .map(tag => this.tagIndex.get(tag))
        .filter((s): s is Set<string> => s !== undefined);
      if (sets.length === 0) return [];
      const intersection = new Set(sets[0]);
      for (let i = 1; i < sets.length; i++) {
        for (const id of intersection) {
          if (!sets[i].has(id)) intersection.delete(id);
        }
      }
      candidates = [...intersection];
    } else {
      // 无索引条件，全量扫描
      candidates = [...this.memoryStore.keys()];
    }

    // 应用剩余过滤条件
    const results: Snapshot[] = [];
    for (const id of candidates) {
      const snapshot = this.memoryStore.get(id);
      if (!snapshot) continue;

      // 父ID过滤
      if (query.parentSnapshotId !== undefined) {
        if (snapshot.metadata.parentSnapshotId !== query.parentSnapshotId) continue;
      }

      // 标签过滤（必须包含所有指定标签）
      if (query.tags && query.tags.length > 0) {
        if (!query.tags.every(tag => snapshot.metadata.tags.includes(tag))) continue;
      }

      // 时间范围过滤
      if (query.fromTime !== undefined && snapshot.metadata.createdAt < query.fromTime) continue;
      if (query.toTime !== undefined && snapshot.metadata.createdAt > query.toTime) continue;

      // 版本过滤
      if (query.version !== undefined && snapshot.metadata.version !== query.version) continue;

      results.push(this.deepClone(snapshot));
    }

    // 按创建时间降序排列
    return results.sort((a, b) => b.metadata.createdAt - a.metadata.createdAt);
  }

  /**
   * 获取指定战车的所有快照（按时间降序）
   */
  async getByChariot(chariotId: string): Promise<Snapshot[]> {
    return this.query({ chariotId });
  }

  /**
   * 获取指定快照的所有子代（直接子级）
   */
  async getChildren(parentSnapshotId: string): Promise<Snapshot[]> {
    return this.query({ parentSnapshotId });
  }

  /**
   * 获取指定快照的血缘链（从根到当前）
   */
  async getLineage(snapshotId: string): Promise<Snapshot[]> {
    const lineage: Snapshot[] = [];
    let currentId: string | undefined = snapshotId;
    const visited = new Set<string>();

    while (currentId) {
      if (visited.has(currentId)) break; // 防止循环
      visited.add(currentId);

      const snapshot = this.memoryStore.get(currentId);
      if (!snapshot) break;

      lineage.unshift(this.deepClone(snapshot));
      currentId = snapshot.metadata.parentSnapshotId;
    }

    return lineage;
  }

  /**
   * 获取指定战车的最新快照
   */
  async getLatest(chariotId: string): Promise<Snapshot | undefined> {
    const list = await this.query({ chariotId });
    return list[0]; // 已按时间降序排列
  }

  /**
   * 获取下一个版本号
   */
  async nextVersion(chariotId: string): Promise<number> {
    const current = this.versionCounter.get(chariotId) ?? 0;
    const next = current + 1;
    this.versionCounter.set(chariotId, next);
    return next;
  }

  // ── 3. 清理策略 ─────────────────────────

  /**
   * 应用清理策略到指定战车
   *
   * 清理规则（按优先级）:
   * 1. 保留 protectedTags / protectedPrefixes 标记的快照
   * 2. 保留最近 keepLastN 个快照
   * 3. 删除超过 ttlMs 的快照
   */
  private applyCleanup(chariotId: string): void {
    const policy = this.config.cleanupPolicy;
    if (!policy) return;

    const ids = this.chariotIndex.get(chariotId) ?? [];
    if (ids.length === 0) return;

    // 获取所有快照并按时间排序（新的在前）
    const snapshots = ids
      .map(id => this.memoryStore.get(id))
      .filter((s): s is Snapshot => s !== undefined)
      .sort((a, b) => b.metadata.createdAt - a.metadata.createdAt);

    const now = Date.now();
    const toDelete: string[] = [];

    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      let shouldDelete = false;

      // 检查保护标签
      const isProtected = this.isProtected(snap, policy);
      if (isProtected) continue;

      // 规则1: 保留最近N个
      if (policy.keepLastN !== undefined && policy.keepLastN !== null) {
        if (i >= policy.keepLastN) {
          shouldDelete = true;
        }
      }

      // 规则2: TTL过期
      if (policy.ttlMs !== undefined && policy.ttlMs !== null) {
        const age = now - snap.metadata.createdAt;
        if (age > policy.ttlMs) {
          shouldDelete = true;
        }
      }

      if (shouldDelete) {
        toDelete.push(snap.metadata.snapshotId);
      }
    }

    // 执行删除（同步，不等待持久化）
    for (const id of toDelete) {
      this.deleteSync(id);
    }
  }

  /**
   * 检查快照是否受保护
   */
  private isProtected(snapshot: Snapshot, policy: CleanupPolicy): boolean {
    // 标签保护
    if (policy.protectedTags) {
      for (const tag of policy.protectedTags) {
        if (snapshot.metadata.tags.includes(tag)) return true;
      }
    }

    // 前缀保护（快照ID前缀匹配）
    if (policy.protectedPrefixes) {
      for (const prefix of policy.protectedPrefixes) {
        if (snapshot.metadata.snapshotId.startsWith(prefix)) return true;
      }
    }

    return false;
  }

  /**
   * 手动触发全量清理
   */
  async cleanupAll(): Promise<number> {
    let deletedCount = 0;
    for (const chariotId of this.chariotIndex.keys()) {
      const before = this.chariotIndex.get(chariotId)?.length ?? 0;
      this.applyCleanup(chariotId);
      const after = this.chariotIndex.get(chariotId)?.length ?? 0;
      deletedCount += before - after;
    }
    if (deletedCount > 0) {
      this.persistAsync();
    }
    return deletedCount;
  }

  // ── 4. 持久化 ───────────────────────────

  /**
   * 立即持久化所有快照到后端
   */
  async persist(): Promise<void> {
    switch (this.config.backend) {
      case 'json-file':
        await this.saveToFile();
        break;
      case 'redis':
        await this.saveToRedis();
        break;
      case 'memory':
      default:
        // 内存模式无需持久化
        break;
    }
  }

  /**
   * 异步持久化（防抖，避免频繁写入）
   */
  private persistAsync(): void {
    if (this.config.backend === 'memory') return;

    this.fileDirty = true;

    if (this.fileWritePromise) return; // 已有写入进行中

    // 延迟100ms写入（防抖）
    this.fileWritePromise = new Promise(resolve => {
      setTimeout(async () => {
        if (this.fileDirty) {
          await this.persist();
          this.fileDirty = false;
        }
        this.fileWritePromise = null;
        resolve();
      }, 100);
    });
  }

  /**
   * 保存到JSON文件
   */
  private async saveToFile(): Promise<void> {
    if (!this.config.filePath) return;

    const data = {
      snapshots: Array.from(this.memoryStore.values()).map(s => this.snapshotToJSON(s)),
      versionCounters: Object.fromEntries(this.versionCounter),
      savedAt: Date.now(),
    };

    const fs = await import('fs/promises');
    const path = await import('path');

    const dir = path.dirname(this.config.filePath);
    await fs.mkdir(dir, { recursive: true });

    // 原子写入：先写临时文件，再重命名
    const tempPath = `${this.config.filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tempPath, this.config.filePath);
  }

  /**
   * 从JSON文件加载
   */
  private async loadFromFile(): Promise<void> {
    if (!this.config.filePath) return;

    const fs = await import('fs/promises');

    try {
      const raw = await fs.readFile(this.config.filePath, 'utf-8');
      const data = JSON.parse(raw);

      // 重建内存存储
      this.memoryStore.clear();
      for (const snapData of data.snapshots ?? []) {
        const snapshot = this.snapshotFromJSON(snapData);
        this.memoryStore.set(snapshot.metadata.snapshotId, snapshot);
      }

      // 重建索引
      this.rebuildIndexes();

      // 恢复版本计数器
      this.versionCounter.clear();
      for (const [chariotId, version] of Object.entries(data.versionCounters ?? {})) {
        this.versionCounter.set(chariotId, version as number);
      }
    } catch (err) {
      // 文件不存在或损坏，忽略（从空状态开始）
      console.log(`[SnapshotStorage] loadFromFile: ${err}`);
    }
  }

  /**
   * 保存到Redis（仅在 redis 模式下激活）
   * 将内存中的所有快照序列化为 JSON 后存入 Redis Hash
   */
  private async saveToRedis(): Promise<void> {
    if (!this.config.redisUrl) {
      console.warn('[SnapshotStorage] Redis URL not configured');
      return;
    }

    const prefix = this.config.redisPrefix ?? 'sylva:snapshot';

    // 动态导入 redis 客户端（避免启动时硬依赖）
    let redis: any;
    try {
      const redisModule = await import('redis');
      redis = redisModule.createClient?.({ url: this.config.redisUrl })
        ?? redisModule.default?.createClient?.({ url: this.config.redisUrl });
    } catch (err) {
      console.error('[SnapshotStorage] Failed to load redis client:', err);
      return;
    }

    if (!redis) {
      console.error('[SnapshotStorage] Redis client creation failed');
      return;
    }

    try {
      if (redis.connect && typeof redis.connect === 'function') {
        await redis.connect();
      }

      // 批量写入：每个战车一个 Hash，字段为 snapshotId
      for (const [chariotId, snapshotIds] of this.chariotIndex) {
        const hashKey = `${prefix}:${chariotId}`;
        const entries: Record<string, string> = {};

        for (const snapId of snapshotIds) {
          const snapshot = this.memoryStore.get(snapId);
          if (snapshot) {
            entries[snapId] = JSON.stringify(this.snapshotToJSON(snapshot));
          }
        }

        if (Object.keys(entries).length > 0) {
          await redis.hSet(hashKey, entries);
        }
      }

      // 写入元数据索引
      const metaKey = `${prefix}:meta`;
      const meta = {
        versionCounters: Object.fromEntries(this.versionCounter),
        savedAt: Date.now(),
        totalSnapshots: this.memoryStore.size,
      };
      await redis.set(metaKey, JSON.stringify(meta));

      console.log(`[SnapshotStorage] Saved ${this.memoryStore.size} snapshots to Redis`);
    } catch (err) {
      console.error('[SnapshotStorage] Redis save failed:', err);
    } finally {
      try {
        if (redis.quit && typeof redis.quit === 'function') {
          await redis.quit();
        } else if (redis.disconnect && typeof redis.disconnect === 'function') {
          await redis.disconnect();
        }
      } catch {
        // ignore close errors
      }
    }
  }

  // ── 5. 统计 ─────────────────────────────

  /**
   * 获取存储统计信息
   */
  async getStats(): Promise<StorageStats> {
    const snapshots = Array.from(this.memoryStore.values());
    const totalByChariot: Record<string, number> = {};

    for (const snap of snapshots) {
      const cid = snap.metadata.sourceChariotId;
      totalByChariot[cid] = (totalByChariot[cid] ?? 0) + 1;
    }

    const times = snapshots.map(s => s.metadata.createdAt);

    // 估算平均大小（JSON序列化后字节数）
    let totalSize = 0;
    for (const snap of snapshots) {
      totalSize += JSON.stringify(snap).length * 2; // UTF-16 近似
    }

    return {
      totalSnapshots: snapshots.length,
      totalByChariot,
      oldestSnapshotAt: times.length > 0 ? Math.min(...times) : null,
      newestSnapshotAt: times.length > 0 ? Math.max(...times) : null,
      averageSnapshotSizeBytes: snapshots.length > 0 ? Math.floor(totalSize / snapshots.length) : 0,
    };
  }

  /**
   * 导出所有快照为JSON（用于备份/迁移）
   */
  async exportAll(): Promise<string> {
    const data = {
      snapshots: Array.from(this.memoryStore.values()).map(s => this.snapshotToJSON(s)),
      versionCounters: Object.fromEntries(this.versionCounter),
      exportedAt: Date.now(),
      format: 'sylva-snapshot-v1',
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * 从JSON导入快照（用于恢复/迁移）
   */
  async importAll(json: string): Promise<number> {
    const data = JSON.parse(json);

    let imported = 0;
    for (const snapData of data.snapshots ?? []) {
      const snapshot = this.snapshotFromJSON(snapData);
      if (!this.memoryStore.has(snapshot.metadata.snapshotId)) {
        this.memoryStore.set(snapshot.metadata.snapshotId, snapshot);
        imported++;
      }
    }

    this.rebuildIndexes();

    if (data.versionCounters) {
      for (const [chariotId, version] of Object.entries(data.versionCounters)) {
        const current = this.versionCounter.get(chariotId) ?? 0;
        if ((version as number) > current) {
          this.versionCounter.set(chariotId, version as number);
        }
      }
    }

    return imported;
  }

  // ── 6. 内部工具 ─────────────────────────

  /**
   * 重建所有索引（加载后调用）
   */
  private rebuildIndexes(): void {
    this.chariotIndex.clear();
    this.lineageIndex.clear();
    this.tagIndex.clear();

    for (const snapshot of this.memoryStore.values()) {
      const id = snapshot.metadata.snapshotId;
      const chariotId = snapshot.metadata.sourceChariotId;

      // chariotIndex
      if (!this.chariotIndex.has(chariotId)) {
        this.chariotIndex.set(chariotId, []);
      }
      this.chariotIndex.get(chariotId)!.push(id);

      // lineageIndex
      if (snapshot.metadata.parentSnapshotId) {
        if (!this.lineageIndex.has(snapshot.metadata.parentSnapshotId)) {
          this.lineageIndex.set(snapshot.metadata.parentSnapshotId, []);
        }
        this.lineageIndex.get(snapshot.metadata.parentSnapshotId)!.push(id);
      }

      // tagIndex
      for (const tag of snapshot.metadata.tags) {
        if (!this.tagIndex.has(tag)) {
          this.tagIndex.set(tag, new Set());
        }
        this.tagIndex.get(tag)!.add(id);
      }
    }
  }

  /**
   * 同步删除（内部使用，不触发持久化）
   */
  private deleteSync(snapshotId: string): boolean {
    const snapshot = this.memoryStore.get(snapshotId);
    if (!snapshot) return false;

    this.memoryStore.delete(snapshotId);

    const chariotId = snapshot.metadata.sourceChariotId;
    const chariotList = this.chariotIndex.get(chariotId);
    if (chariotList) {
      const idx = chariotList.indexOf(snapshotId);
      if (idx >= 0) chariotList.splice(idx, 1);
    }

    if (snapshot.metadata.parentSnapshotId) {
      const parentList = this.lineageIndex.get(snapshot.metadata.parentSnapshotId);
      if (parentList) {
        const idx = parentList.indexOf(snapshotId);
        if (idx >= 0) parentList.splice(idx, 1);
      }
    }

    for (const tag of snapshot.metadata.tags) {
      this.tagIndex.get(tag)?.delete(snapshotId);
    }

    return true;
  }

  /**
   * 快照序列化（处理Map等特殊类型）
   */
  private snapshotToJSON(snapshot: Snapshot): unknown {
    // Snapshot已经是纯JSON-compatible对象（sharedMemory中的Map已被转为Record）
    return snapshot;
  }

  /**
   * 快照反序列化
   */
  private snapshotFromJSON(data: unknown): Snapshot {
    return data as Snapshot;
  }

  /**
   * 深拷贝 — 与 SnapshotEngine 保持一致
   */
  private deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime()) as unknown as T;
    if (Array.isArray(obj)) {
      return obj.map(item => this.deepClone(item)) as unknown as T;
    }
    const clone = {} as T;
    for (const key of Object.keys(obj as unknown as Record<string, unknown>)) {
      (clone as any)[key] = this.deepClone((obj as any)[key]);
    }
    return clone;
  }
}

export default SnapshotStorage;
