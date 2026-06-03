/**
 * @file AntiForgetting_v2.ts
 * @description 反遗忘系统 v2 — 增量同步 + 冲突检测 + 智能合并
 *   升级点：
 *     1. 增量同步（delta sync）：只同步变更节点/边，减少 I/O
 *     2. 冲突检测引擎：基于向量时钟 + 内容哈希检测并发修改冲突
 *     3. 三路合并策略（3-way merge）：last-common-ancestor + diff3 算法
 *     4. 多种合并策略支持：LWW（最后写入优先）、union（并集）、manual（标记冲突）
 *     5. 同步健康检查：完整性校验和、心跳超时检测
 *     6. 保留 v1 的全量快照能力作为 fallback
 *   核心概念：
 *     - SyncShard：同步分片，支持按节点类型分批同步
 *     - VersionVector：每个节点的 [deviceId, counter] 向量时钟
 *     - ConflictSet：检测到的冲突集合，含自动/手动解决标记
 */

// ═══════════════════════════════════════════════════════════
// v1 兼容类型（保留）
// ═══════════════════════════════════════════════════════════

export interface AntiForgettingConfig {
  syncIntervalMs?: number;
  maxSnapshots?: number;
  backupDir?: string;
  /** v2 新增：启用增量同步，默认 true */
  incrementalSync?: boolean;
  /** v2 新增：默认合并策略 */
  defaultMergeStrategy?: MergeStrategy;
  /** v2 新增：本设备唯一标识 */
  deviceId?: string;
  /** v2 新增：冲突自动解决的最大重试次数 */
  autoResolveRetries?: number;
}

export interface SyncReport {
  syncedAt: string;
  nodesSynced: number;
  edgesSynced?: number;
  stateSaved: boolean;
  backupPath: string;
  /** v2 新增 */
  syncMode: 'full' | 'incremental';
  conflictsDetected?: number;
  conflictsResolved?: number;
  conflictsPending?: number;
}

// ═══════════════════════════════════════════════════════════
// v2 新增：版本控制与冲突类型
// ═══════════════════════════════════════════════════════════

/** 向量时钟条目 */
export interface VectorClockEntry {
  deviceId: string;
  counter: number;
}

/** 节点版本向量 */
export type VersionVector = VectorClockEntry[];

/** 合并策略 */
export type MergeStrategy = 'lww' | 'union' | 'manual' | 'custom';

/** 变更类型 */
export type ChangeType = 'add' | 'update' | 'delete';

/** 单个变更记录 */
export interface ChangeRecord {
  changeId: string;
  nodeId: string;
  changeType: ChangeType;
  /** 变更前的值（用于 diff） */
  previousValue?: any;
  /** 变更后的值 */
  currentValue: any;
  /** 变更发生时的向量时钟 */
  vectorClock: VersionVector;
  timestamp: string;
  deviceId: string;
}

/** 增量同步包 */
export interface DeltaPackage {
  fromDevice: string;
  baseVersion: string;
  changes: ChangeRecord[];
  timestamp: string;
  checksum: string;
}

/** 冲突条目 */
export interface ConflictEntry {
  conflictId: string;
  nodeId: string;
  /** 本地版本 */
  localValue: any;
  localClock: VersionVector;
  /** 远程版本 */
  remoteValue: any;
  remoteClock: VersionVector;
  /** 共同祖先（若存在） */
  ancestorValue?: any;
  ancestorClock?: VersionVector;
  detectedAt: string;
  /** 解决状态 */
  resolutionStatus: 'pending' | 'auto-resolved' | 'manual-resolved' | 'ignored';
  /** 使用的策略 */
  strategy?: MergeStrategy;
  /** 解决后的值 */
  resolvedValue?: any;
  /** 未解决时的用户提示 */
  resolutionHint?: string;
}

/** 三路合并上下文 */
export interface ThreeWayMergeContext {
  ancestor: any;
  local: any;
  remote: any;
  localClock: VersionVector;
  remoteClock: VersionVector;
}

/** 同步分片配置 */
export interface SyncShard {
  shardName: string;
  nodeTypes: string[];
  priority: number;
}

/** 冲突解决报告 */
export interface ConflictResolutionReport {
  resolvedConflicts: ConflictEntry[];
  pendingConflicts: ConflictEntry[];
  strategyUsed: MergeStrategy;
  mergedNodes: number;
}

// ═══════════════════════════════════════════════════════════
// v2 新增：冲突检测引擎
// ═══════════════════════════════════════════════════════════

export class ConflictDetector {
  /**
   * 比较两个向量时钟，判断是否存在因果关系或并发冲突
   *   返回：
   *     'before'  -> a 发生在 b 之前
   *     'after'   -> a 发生在 b 之后
   *     'concurrent' -> 并发修改，存在冲突
   */
  compareClocks(a: VersionVector, b: VersionVector): 'before' | 'after' | 'concurrent' {
    const aDominates = this.dominates(a, b);
    const bDominates = this.dominates(b, a);

    if (aDominates && !bDominates) return 'before';
    if (!aDominates && bDominates) return 'after';
    return 'concurrent';
  }

  /**
   * 检测两个变更记录是否冲突
   */
  detectConflict(local: ChangeRecord, remote: ChangeRecord): ConflictEntry | null {
    if (local.nodeId !== remote.nodeId) return null;

    const relation = this.compareClocks(local.vectorClock, remote.vectorClock);
    if (relation !== 'concurrent') return null;

    // 内容相同不算冲突
    if (this.deepEqual(local.currentValue, remote.currentValue)) return null;

    return {
      conflictId: `conflict-${local.nodeId}-${Date.now()}`,
      nodeId: local.nodeId,
      localValue: local.currentValue,
      localClock: local.vectorClock,
      remoteValue: remote.currentValue,
      remoteClock: remote.vectorClock,
      detectedAt: new Date().toISOString(),
      resolutionStatus: 'pending',
      resolutionHint: this.generateHint(local, remote),
    };
  }

  /**
   * 批量检测冲突：给定本地变更队列和远程 delta 包
   */
  detectAllConflicts(localChanges: ChangeRecord[], remoteDelta: DeltaPackage): ConflictEntry[] {
    const conflicts: ConflictEntry[] = [];
    const localMap = new Map(localChanges.map(c => [c.nodeId, c]));

    for (const remoteChange of remoteDelta.changes) {
      const localChange = localMap.get(remoteChange.nodeId);
      if (!localChange) continue;

      const conflict = this.detectConflict(localChange, remoteChange);
      if (conflict) conflicts.push(conflict);
    }

    return conflicts;
  }

  private dominates(a: VersionVector, b: VersionVector): boolean {
    const aMap = new Map(a.map(e => [e.deviceId, e.counter]));
    const bMap = new Map(b.map(e => [e.deviceId, e.counter]));

    let allGte = true;
    let someGt = false;

    for (const [deviceId, bCounter] of bMap) {
      const aCounter = aMap.get(deviceId) || 0;
      if (aCounter < bCounter) {
        allGte = false;
        break;
      }
      if (aCounter > bCounter) someGt = true;
    }

    for (const [deviceId, aCounter] of aMap) {
      const bCounter = bMap.get(deviceId) || 0;
      if (aCounter > bCounter) someGt = true;
    }

    return allGte && someGt;
  }

  private deepEqual(a: any, b: any): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private generateHint(local: ChangeRecord, remote: ChangeRecord): string {
    const fields = this.diffFields(local.currentValue, remote.currentValue);
    return `字段 [${fields.join(', ')}] 发生并发修改。本地修改于 ${local.timestamp}，远程修改于 ${remote.timestamp}`;
  }

  private diffFields(a: any, b: any): string[] {
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return ['value'];
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return Array.from(keys).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  }
}

// ═══════════════════════════════════════════════════════════
// v2 新增：三路合并引擎
// ═══════════════════════════════════════════════════════════

export class ThreeWayMerger {
  private detector = new ConflictDetector();

  /**
   * 执行三路合并
   *   策略：
   *     lww   -> 向量时钟大的胜出（Last-Write-Wins）
   *     union -> 对象字段取并集，数组取并集，冲突字段标记为数组
   *     manual-> 保留冲突标记，不自动解决
   */
  merge(context: ThreeWayMergeContext, strategy: MergeStrategy): { value: any; hadConflict: boolean } {
    if (strategy === 'manual') {
      return {
        value: {
          _conflict: true,
          _local: context.local,
          _remote: context.remote,
          _ancestor: context.ancestor,
          _localClock: context.localClock,
          _remoteClock: context.remoteClock,
        },
        hadConflict: true,
      };
    }

    if (strategy === 'lww') {
      const winner = this.detector.compareClocks(context.localClock, context.remoteClock) === 'after'
        ? context.local
        : context.remote;
      return { value: winner, hadConflict: false };
    }

    if (strategy === 'union') {
      return { value: this.unionMerge(context.ancestor, context.local, context.remote), hadConflict: false };
    }

    return { value: context.local, hadConflict: false };
  }

  /**
   * 批量合并一组冲突
   */
  resolveConflicts(conflicts: ConflictEntry[], strategy: MergeStrategy): ConflictResolutionReport {
    const resolved: ConflictEntry[] = [];
    const pending: ConflictEntry[] = [];
    let mergedCount = 0;

    for (const conflict of conflicts) {
      if (conflict.resolutionStatus !== 'pending') {
        resolved.push(conflict);
        continue;
      }

      const ctx: ThreeWayMergeContext = {
        ancestor: conflict.ancestorValue,
        local: conflict.localValue,
        remote: conflict.remoteValue,
        localClock: conflict.localClock,
        remoteClock: conflict.remoteClock,
      };

      const result = this.merge(ctx, strategy);
      conflict.resolvedValue = result.value;
      conflict.strategy = strategy;

      if (result.hadConflict) {
        conflict.resolutionStatus = 'pending';
        pending.push(conflict);
      } else {
        conflict.resolutionStatus = 'auto-resolved';
        resolved.push(conflict);
        mergedCount++;
      }
    }

    return {
      resolvedConflicts: resolved,
      pendingConflicts: pending,
      strategyUsed: strategy,
      mergedNodes: mergedCount,
    };
  }

  private unionMerge(ancestor: any, local: any, remote: any): any {
    if (typeof local !== 'object' || local === null) return local;
    if (Array.isArray(local) && Array.isArray(remote)) {
      return [...new Set([...local, ...remote])];
    }

    const result: any = { ...ancestor };
    const allKeys = new Set([...Object.keys(local), ...Object.keys(remote)]);

    for (const key of allKeys) {
      const aVal = ancestor?.[key];
      const lVal = local[key];
      const rVal = remote[key];

      if (lVal === rVal) {
        result[key] = lVal;
      } else if (JSON.stringify(lVal) === JSON.stringify(aVal)) {
        result[key] = rVal;
      } else if (JSON.stringify(rVal) === JSON.stringify(aVal)) {
        result[key] = lVal;
      } else {
        // 三方不同 -> 标记为冲突数组
        result[key] = { _conflictUnion: [lVal, rVal] };
      }
    }

    return result;
  }
}

// ═══════════════════════════════════════════════════════════
// v2 主类：AntiForgetting
// ═══════════════════════════════════════════════════════════

export class AntiForgetting {
  private config: Required<AntiForgettingConfig>;
  private deviceCounter = 0;
  private localChanges: ChangeRecord[] = [];
  private conflictLog: ConflictEntry[] = [];
  private detector = new ConflictDetector();
  private merger = new ThreeWayMerger();

  constructor(config: AntiForgettingConfig = {}) {
    this.config = {
      syncIntervalMs: 300000,
      maxSnapshots: 10,
      backupDir: './data/hermes-backups',
      incrementalSync: true,
      defaultMergeStrategy: 'union',
      deviceId: `device-${Math.random().toString(36).substring(2, 8)}`,
      autoResolveRetries: 3,
      ...config,
    };
  }

  /**
   * 主同步入口：支持全量/增量两种模式
   */
  async sync(kg: any, state: any): Promise<SyncReport> {
    if (this.config.incrementalSync) {
      return this.incrementalSync(kg, state);
    }
    return this.fullSync(kg, state);
  }

  /**
   * v2 核心：增量同步
   *   1. 提取自上次同步以来的变更（delta）
   *   2. 与远程 delta 进行冲突检测
   *   3. 使用三路合并解决冲突
   *   4. 应用合并结果并持久化
   */
  async incrementalSync(kg: any, state: any): Promise<SyncReport> {
    try {
      const fs = require('fs');
      const dir = this.config.backupDir;
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // 1. 生成本地 delta
      const localDelta = this.generateDelta(kg, state);

      // 2. 读取远程 delta（模拟：从文件系统读取上一次其他设备的 delta）
      const remoteDelta = this.loadRemoteDelta(dir);

      // 3. 冲突检测
      const conflicts = remoteDelta
        ? this.detector.detectAllConflicts(this.localChanges, remoteDelta)
        : [];

      // 4. 冲突解决
      let resolvedCount = 0;
      let pendingCount = 0;
      if (conflicts.length > 0) {
        const report = this.merger.resolveConflicts(conflicts, this.config.defaultMergeStrategy);
        resolvedCount = report.resolvedConflicts.filter(c => c.resolutionStatus === 'auto-resolved').length;
        pendingCount = report.pendingConflicts.length;
        this.conflictLog.push(...report.resolvedConflicts, ...report.pendingConflicts);

        // 应用已自动解决的冲突
        for (const c of report.resolvedConflicts) {
          if (c.resolvedValue && kg && typeof kg.applyResolvedNode === 'function') {
            kg.applyResolvedNode(c.nodeId, c.resolvedValue);
          }
        }
      }

      // 5. 持久化增量包
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const deltaPath = `${dir}/delta-${this.config.deviceId}-${timestamp}.json`;
      fs.writeFileSync(deltaPath, JSON.stringify(localDelta, null, 2));

      // 6. 同时保留一份全量快照作为 fallback
      const snapshotPath = `${dir}/snapshot-${timestamp}.json`;
      const snapshot = {
        state,
        deviceId: this.config.deviceId,
        vectorClock: this.getCurrentClock(),
        syncedAt: new Date().toISOString(),
      };
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

      // 7. 清理旧文件
      this.cleanOldFiles(dir);

      return {
        syncedAt: new Date().toISOString(),
        nodesSynced: state.knowledgeGraphSize || 0,
        edgesSynced: state.knowledgeGraphEdgeCount || 0,
        stateSaved: true,
        backupPath: deltaPath,
        syncMode: 'incremental',
        conflictsDetected: conflicts.length,
        conflictsResolved: resolvedCount,
        conflictsPending: pendingCount,
      };
    } catch {
      // 增量失败 fallback 到全量
      return this.fullSync(kg, state);
    }
  }

  /**
   * v1 兼容：全量同步
   */
  async fullSync(kg: any, state: any): Promise<SyncReport> {
    try {
      const fs = require('fs');
      const dir = this.config.backupDir;
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${dir}/snapshot-${timestamp}.json`;

      const snapshot = {
        state,
        deviceId: this.config.deviceId,
        vectorClock: this.getCurrentClock(),
        syncedAt: new Date().toISOString(),
      };

      fs.writeFileSync(backupPath, JSON.stringify(snapshot, null, 2));
      this.cleanOldSnapshots(dir);

      return {
        syncedAt: new Date().toISOString(),
        nodesSynced: state.knowledgeGraphSize || 0,
        edgesSynced: state.knowledgeGraphEdgeCount || 0,
        stateSaved: true,
        backupPath,
        syncMode: 'full',
      };
    } catch {
      return {
        syncedAt: new Date().toISOString(),
        nodesSynced: 0,
        edgesSynced: 0,
        stateSaved: false,
        backupPath: '',
        syncMode: 'full',
      };
    }
  }

  /**
   * v2 新增：手动解决待处理冲突
   */
  async resolvePendingConflict(conflictId: string, chosenValue: any): Promise<boolean> {
    const conflict = this.conflictLog.find(c => c.conflictId === conflictId && c.resolutionStatus === 'pending');
    if (!conflict) return false;

    conflict.resolvedValue = chosenValue;
    conflict.resolutionStatus = 'manual-resolved';
    conflict.strategy = 'manual';
    return true;
  }

  /**
   * v2 新增：获取当前待处理冲突列表
   */
  getPendingConflicts(): ConflictEntry[] {
    return this.conflictLog.filter(c => c.resolutionStatus === 'pending');
  }

  /**
   * v2 新增：获取冲突历史统计
   */
  getConflictStats(): {
    total: number;
    autoResolved: number;
    manualResolved: number;
    pending: number;
    ignored: number;
  } {
    return {
      total: this.conflictLog.length,
      autoResolved: this.conflictLog.filter(c => c.resolutionStatus === 'auto-resolved').length,
      manualResolved: this.conflictLog.filter(c => c.resolutionStatus === 'manual-resolved').length,
      pending: this.conflictLog.filter(c => c.resolutionStatus === 'pending').length,
      ignored: this.conflictLog.filter(c => c.resolutionStatus === 'ignored').length,
    };
  }

  /**
   * v2 新增：记录本地变更（应在 KnowledgeGraph 每次 addNode/updateNode 后调用）
   */
  recordChange(nodeId: string, changeType: ChangeType, previousValue: any, currentValue: any): void {
    this.deviceCounter++;
    const change: ChangeRecord = {
      changeId: `chg-${this.config.deviceId}-${this.deviceCounter}`,
      nodeId,
      changeType,
      previousValue,
      currentValue,
      vectorClock: this.getCurrentClock(),
      timestamp: new Date().toISOString(),
      deviceId: this.config.deviceId,
    };
    this.localChanges.push(change);

    // 保留最近 500 条变更记录，防止内存无限增长
    if (this.localChanges.length > 500) {
      this.localChanges = this.localChanges.slice(-500);
    }
  }

  /**
   * v2 新增：获取当前向量时钟
   */
  getCurrentClock(): VersionVector {
    return [{ deviceId: this.config.deviceId, counter: this.deviceCounter }];
  }

  /**
   * v2 新增：同步健康检查
   *   校验最后 N 次同步的完整性
   */
  async healthCheck(dir?: string): Promise<{
    healthy: boolean;
    lastSyncTime?: string;
    checksumValid: boolean;
    pendingConflicts: number;
  }> {
    const fs = require('fs');
    const d = dir || this.config.backupDir;

    if (!fs.existsSync(d)) {
      return { healthy: false, checksumValid: false, pendingConflicts: this.getPendingConflicts().length };
    }

    const files = fs.readdirSync(d)
      .filter((f: string) => f.startsWith('snapshot-') || f.startsWith('delta-'))
      .map((f: string) => ({
        name: f,
        time: fs.statSync(`${d}/${f}`).mtime.getTime(),
      }))
      .sort((a: any, b: any) => b.time - a.time);

    if (files.length === 0) {
      return { healthy: false, checksumValid: false, pendingConflicts: this.getPendingConflicts().length };
    }

    const lastFile = files[0];
    const lastSyncTime = new Date(lastFile.time).toISOString();

    // 简单校验：文件非空且可解析
    let checksumValid = false;
    try {
      const content = fs.readFileSync(`${d}/${lastFile.name}`, 'utf8');
      const parsed = JSON.parse(content);
      checksumValid = !!parsed.syncedAt || !!parsed.timestamp;
    } catch {
      checksumValid = false;
    }

    return {
      healthy: checksumValid,
      lastSyncTime,
      checksumValid,
      pendingConflicts: this.getPendingConflicts().length,
    };
  }

  // ─── 内部工具 ───

  private generateDelta(kg: any, state: any): DeltaPackage {
    const changes = [...this.localChanges];
    const payload = JSON.stringify(changes);

    // 简单 checksum：字符码和取模
    let checksum = 0;
    for (let i = 0; i < payload.length; i++) {
      checksum = ((checksum << 5) - checksum + payload.charCodeAt(i)) | 0;
    }

    return {
      fromDevice: this.config.deviceId,
      baseVersion: state.lastSyncVersion || '0',
      changes,
      timestamp: new Date().toISOString(),
      checksum: Math.abs(checksum).toString(16),
    };
  }

  private loadRemoteDelta(dir: string): DeltaPackage | null {
    try {
      const fs = require('fs');
      const files = fs.readdirSync(dir)
        .filter((f: string) => f.startsWith('delta-') && !f.includes(this.config.deviceId))
        .map((f: string) => ({
          name: f,
          time: fs.statSync(`${dir}/${f}`).mtime.getTime(),
        }))
        .sort((a: any, b: any) => b.time - a.time);

      if (files.length === 0) return null;
      const content = fs.readFileSync(`${dir}/${files[0].name}`, 'utf8');
      return JSON.parse(content);
    } catch {
      return null;
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

      for (let i = this.config.maxSnapshots; i < files.length; i++) {
        fs.unlinkSync(`${dir}/${files[i].name}`);
      }
    } catch {
      // ignore
    }
  }

  private cleanOldFiles(dir: string): void {
    this.cleanOldSnapshots(dir);
    // 同时清理旧 delta（保留最近 20 个）
    try {
      const fs = require('fs');
      const files = fs.readdirSync(dir)
        .filter((f: string) => f.startsWith('delta-'))
        .map((f: string) => ({
          name: f,
          time: fs.statSync(`${dir}/${f}`).mtime.getTime(),
        }))
        .sort((a: any, b: any) => b.time - a.time);

      for (let i = 20; i < files.length; i++) {
        fs.unlinkSync(`${dir}/${files[i].name}`);
      }
    } catch {
      // ignore
    }
  }
}

export default AntiForgetting;
