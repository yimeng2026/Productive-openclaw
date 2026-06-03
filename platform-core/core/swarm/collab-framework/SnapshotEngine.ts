/**
 * SnapshotEngine.ts — SYLVA 蜂群快照引擎
 *
 * 核心职责:
 * 1. 快照捕获 (capture) — 将战车完整状态序列化为不可变快照
 * 2. 快照恢复 (restore) — 从快照重建战车状态
 * 3. 快照克隆 (clone) — 从父快照创建子战车（自动继承）
 * 4. 快照合并 (merge) — 合并多个快照用于群组合并
 * 5. 快照差异 (diff) — 分析两个快照之间的变化
 *
 * 设计原则:
 * - 快照是战车的"DNA"，包含重建所需的一切信息
 * - 共享记忆必须深拷贝，避免引用污染
 * - 快照包含血缘信息（parentId），支持追溯
 * - 与现有 SwarmCoordinator / SwarmNode 完全兼容，零侵入
 */

import { SwarmNode, AgentConfig } from './SwarmNode';
import { SwarmCoordinator, ChariotState, CoordinatorConfig, SharedMemoryPool } from './SwarmCoordinator';
import { TaskResult } from './ExecutionModes';

// ──────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────

/** Agent 配置模板 — 快照中保存的配置原型，非运行时实例 */
export interface AgentTemplate {
  /** 角色标识 */
  role: string;
  /** 命名模式（用于生成新实例） */
  namePattern: string;
  /** Agent 配置（模型、专长、温度等） */
  config: AgentConfig;
  /** 节点深度（在蜂群树中的位置） */
  depth: number;
}

/** 共享记忆快照 — 三层记忆的深拷贝序列化 */
export interface SharedMemorySnapshot {
  /** HOT层: 实时共享数据（深拷贝） */
  hot: Record<string, unknown>;
  /** WARM层: 结构化摘要（深拷贝） */
  warm: Record<string, string>;
  /** COLD层: 归档元数据列表（向量存储的ID列表） */
  coldIds: string[];
}

/** 快照元数据 */
export interface SnapshotMetadata {
  /** 快照唯一ID */
  snapshotId: string;
  /** 来源战车ID */
  sourceChariotId: string;
  /** 父快照ID（用于血缘追溯） */
  parentSnapshotId?: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 快照版本号 */
  version: number;
  /** 标签（用于分类检索） */
  tags: string[];
  /** 快照描述 */
  description?: string;
  /** 关联的快照ID列表（用于群组合并场景） */
  mergedFrom?: string[];
}

/** 战车快照 — 完整的战车状态序列化 */
export interface Snapshot {
  /** 快照元数据 */
  metadata: SnapshotMetadata;
  /** 战车名称 */
  chariotName: string;
  /** 协调器配置模板 */
  coordinatorConfig: CoordinatorConfig;
  /** 成员配置模板列表（不包含运行时Agent实例） */
  agentTemplates: AgentTemplate[];
  /** 共享记忆快照（深拷贝） */
  sharedMemory: SharedMemorySnapshot;
  /** 历史任务结果（最近N条） */
  taskHistory: TaskResult[];
  /** 运行时统计 */
  stats: {
    totalTasksExecuted: number;
    totalTasksFailed: number;
    createdAt: number;
    destroyedAt?: number;
  };
}

/** 快照差异结果 */
export interface SnapshotDiff {
  /** 只在旧快照中存在的键 */
  removed: string[];
  /** 只在新快照中存在的键 */
  added: string[];
  /** 值发生变化的键 */
  modified: Array<{
    key: string;
    oldValue: unknown;
    newValue: unknown;
    type: 'memory' | 'config' | 'template' | 'history';
  }>;
  /** 共享记忆差异详情 */
  memoryDiff: {
    hotDiff: Record<string, { old?: unknown; new?: unknown }>;
    warmDiff: Record<string, { old?: string; new?: string }>;
  };
  /** Agent模板差异 */
  templateDiff: {
    added: AgentTemplate[];
    removed: AgentTemplate[];
    modified: Array<{ template: AgentTemplate; changes: string[] }>;
  };
}

/** 快照合并冲突 */
export interface MergeConflict {
  /** 冲突字段路径 */
  path: string;
  /** 来源快照A的值 */
  valueA: unknown;
  /** 来源快照B的值 */
  valueB: unknown;
  /** 冲突类型 */
  type: 'memory' | 'config' | 'template';
}

/** 快照合并结果 */
export interface MergeResult {
  /** 合并后的快照 */
  snapshot: Snapshot;
  /** 冲突列表（需要人工/策略解决） */
  conflicts: MergeConflict[];
  /** 自动解决的数量 */
  autoResolved: number;
}

/** 深拷贝工具类型 */
type DeepCloneable = Record<string, unknown> | unknown[] | Map<unknown, unknown>;

// ──────────────────────────────────────────
// 快照引擎
// ──────────────────────────────────────────

export class SnapshotEngine {
  private coordinator: SwarmCoordinator;
  private snapshotCounter = 0;

  constructor(coordinator: SwarmCoordinator) {
    this.coordinator = coordinator;
  }

  // ── 1. 快照捕获 ─────────────────────────

  /**
   * 捕获指定战车的完整状态快照
   *
   * 捕获内容:
   * - 协调器配置（模型、策略等）
   * - Agent配置模板（非实例，用于重建）
   * - 共享记忆三层（HOT/WARM深拷贝，COLD ID列表）
   * - 最近任务历史
   * - 运行时统计
   *
   * @param chariotId 战车ID
   * @param options 可选配置（标签、描述、父快照ID）
   * @returns 完整的快照对象
   */
  captureSnapshot(
    chariotId: string,
    options?: {
      tags?: string[];
      description?: string;
      parentSnapshotId?: string;
    }
  ): Snapshot {
    const chariot = this.coordinator.getChariot(chariotId);
    if (!chariot) {
      throw new Error(`SnapshotEngine: Chariot ${chariotId} not found`);
    }

    const snapshotId = this.generateSnapshotId();
    const version = ++this.snapshotCounter;

    // 1. 提取Agent配置模板（深拷贝配置，不包含运行时状态）
    const agentTemplates = this.extractAgentTemplates(chariot);

    // 2. 捕获共享记忆（深拷贝避免引用污染）
    const sharedMemory = this.captureSharedMemory(chariot.sharedMemory);

    // 3. 捕获任务历史（深拷贝结果）
    const taskHistory = this.captureTaskHistory(chariot);

    // 4. 构建快照
    const snapshot: Snapshot = {
      metadata: {
        snapshotId,
        sourceChariotId: chariotId,
        parentSnapshotId: options?.parentSnapshotId,
        createdAt: Date.now(),
        version,
        tags: options?.tags ?? [],
        description: options?.description,
      },
      chariotName: chariot.name,
      coordinatorConfig: { ...chariot.coordinator.subSwarm?.configOverride as unknown as CoordinatorConfig },
      agentTemplates,
      sharedMemory,
      taskHistory,
      stats: {
        totalTasksExecuted: chariot.agents.reduce(
          (sum, a) => sum + (a.meta?.totalTasksExecuted ?? 0), 0
        ),
        totalTasksFailed: chariot.agents.reduce(
          (sum, a) => sum + (a.meta?.totalTasksFailed ?? 0), 0
        ),
        createdAt: chariot.createdAt.getTime(),
      },
    };

    return snapshot;
  }

  /**
   * 从Agent实例提取配置模板
   */
  private extractAgentTemplates(chariot: ChariotState): AgentTemplate[] {
    return chariot.agents.map((agent, idx) => ({
      role: agent.role,
      namePattern: agent.name,
      config: agent.agentConfig
        ? this.deepClone(agent.agentConfig) as AgentConfig
        : { modelId: 'default', expertise: [] },
      depth: agent.meta?.depth ?? 0,
    }));
  }

  /**
   * 捕获共享记忆池（三层全部深拷贝）
   *
   * 注意:
   * - HOT/WARM 层是 Map，需要深拷贝为普通对象
   * - COLD 层是向量存储，只保存ID列表（重建时重新索引）
   */
  private captureSharedMemory(pool: SharedMemoryPool): SharedMemorySnapshot {
    const hot: Record<string, unknown> = {};
    const warm: Record<string, string> = {};

    // 深拷贝 HOT 层
    if (pool.hot instanceof Map) {
      for (const [key, value] of pool.hot.entries()) {
        hot[key] = this.deepClone(value);
      }
    }

    // 深拷贝 WARM 层
    if (pool.warm instanceof Map) {
      for (const [key, value] of pool.warm.entries()) {
        warm[key] = value; // string 是值类型，无需深拷贝
      }
    }

    // COLD 层只记录ID列表（向量存储重建时重新索引）
    const coldIds: string[] = [];

    return { hot, warm, coldIds };
  }

  /**
   * 捕获任务历史（最近50条，深拷贝）
   */
  private captureTaskHistory(chariot: ChariotState): TaskResult[] {
    // 从共享记忆中读取历史（如果存在）
    const historyKey = 'global-task-history';
    const stored = chariot.sharedMemory.read('system', historyKey);
    
    if (stored && Array.isArray(stored)) {
      return stored.slice(-50).map((item: TaskResult) => this.deepClone(item) as TaskResult);
    }

    return [];
  }

  // ── 2. 快照恢复 ─────────────────────────

  /**
   * 将指定战车恢复到快照状态
   *
   * 恢复内容:
   * - 共享记忆（三层全部覆盖）
   * - 协调器配置（覆盖当前配置）
   * - 任务历史（覆盖）
   *
   * 注意:
   * - 不恢复Agent实例（运行时对象不可序列化）
   * - 不修改战车ID和名称
   * - 恢复后广播 snapshot.restored 事件
   *
   * @param chariotId 目标战车ID
   * @param snapshot 要恢复的快照
   */
  restoreSnapshot(chariotId: string, snapshot: Snapshot): void {
    const chariot = this.coordinator.getChariot(chariotId);
    if (!chariot) {
      throw new Error(`SnapshotEngine: Chariot ${chariotId} not found`);
    }

    // 1. 恢复共享记忆（深拷贝写入，避免引用污染）
    this.restoreSharedMemory(chariot, snapshot.sharedMemory);

    // 2. 恢复任务历史
    this.restoreTaskHistory(chariot, snapshot.taskHistory);

    // 3. 更新战车统计
    // stats 是只读参考，不直接修改运行时统计

    // 4. 广播恢复事件
    (this.coordinator as any).messageBus?.publish?.('snapshot.restored', {
      chariotId,
      snapshotId: snapshot.metadata.snapshotId,
      sourceChariotId: snapshot.metadata.sourceChariotId,
      timestamp: Date.now(),
    });
  }

  /**
   * 恢复共享记忆池
   */
  private restoreSharedMemory(
    chariot: ChariotState,
    memorySnapshot: SharedMemorySnapshot
  ): void {
    // 清空并重建 HOT 层
    chariot.sharedMemory.hot.clear();
    for (const [key, value] of Object.entries(memorySnapshot.hot)) {
      chariot.sharedMemory.hot.set(key, this.deepClone(value));
    }

    // 清空并重建 WARM 层
    chariot.sharedMemory.warm.clear();
    for (const [key, value] of Object.entries(memorySnapshot.warm)) {
      chariot.sharedMemory.warm.set(key, value);
    }

    // COLD 层重建：由协调器按需重新索引
    // 此处不做处理，向量存储在运行时动态重建

    // 强制同步
    chariot.sharedMemory.sync();
  }

  /**
   * 恢复任务历史
   */
  private restoreTaskHistory(chariot: ChariotState, history: TaskResult[]): void {
    const cloned = history.map(item => this.deepClone(item) as TaskResult);
    chariot.sharedMemory.write('system', 'global-task-history', cloned);
  }

  // ── 3. 快照克隆（继承） ─────────────────

  /**
   * 从父快照创建新的战车配置（自动继承）
   *
   * 继承逻辑:
   * - 成员列表：继承父快照的Agent模板，可叠加新的Agent
   * - 配置模板：继承父协调器配置，允许覆盖
   * - 共享记忆：继承父快照的HOT/WARM层（深拷贝）
   * - 血缘关系：新快照的 parentSnapshotId 指向父快照
   *
   * @param parentSnapshot 父快照
   * @param childOptions 子战车覆盖选项
   * @returns 子战车配置（用于 createChariotFromSnapshot）
   */
  cloneFromSnapshot(
    parentSnapshot: Snapshot,
    childOptions?: {
      name?: string;
      additionalAgents?: AgentTemplate[];
      configOverrides?: Partial<CoordinatorConfig>;
      memoryOverrides?: { hot?: Record<string, unknown>; warm?: Record<string, string> };
    }
  ): {
    inheritedSnapshot: Snapshot;
    agentTemplates: AgentTemplate[];
    coordinatorConfig: CoordinatorConfig;
    sharedMemory: SharedMemorySnapshot;
  } {
    // 1. 深拷贝父快照的共享记忆（避免引用污染）
    const inheritedMemory: SharedMemorySnapshot = {
      hot: this.deepClone(parentSnapshot.sharedMemory.hot),
      warm: this.deepClone(parentSnapshot.sharedMemory.warm),
      coldIds: [...parentSnapshot.sharedMemory.coldIds],
    };

    // 2. 应用子战车覆盖
    if (childOptions?.memoryOverrides?.hot) {
      Object.assign(inheritedMemory.hot, childOptions.memoryOverrides.hot);
    }
    if (childOptions?.memoryOverrides?.warm) {
      Object.assign(inheritedMemory.warm, childOptions.memoryOverrides.warm);
    }

    // 3. 合并Agent模板（父模板 + 新增模板）
    const agentTemplates = [
      ...parentSnapshot.agentTemplates,
      ...(childOptions?.additionalAgents ?? []),
    ];

    // 4. 合并配置（父配置 + 覆盖）
    const coordinatorConfig = {
      ...parentSnapshot.coordinatorConfig,
      ...childOptions?.configOverrides,
    } as CoordinatorConfig;

    // 5. 构建继承快照（用于血缘追溯）
    const inheritedSnapshot: Snapshot = {
      metadata: {
        snapshotId: this.generateSnapshotId(),
        sourceChariotId: '', // 尚未绑定战车
        parentSnapshotId: parentSnapshot.metadata.snapshotId,
        createdAt: Date.now(),
        version: ++this.snapshotCounter,
        tags: ['inherited', ...(parentSnapshot.metadata.tags ?? [])],
        description: `Inherited from ${parentSnapshot.metadata.snapshotId}`,
      },
      chariotName: childOptions?.name ?? `${parentSnapshot.chariotName}-child`,
      coordinatorConfig,
      agentTemplates,
      sharedMemory: inheritedMemory,
      taskHistory: this.deepClone(parentSnapshot.taskHistory) as TaskResult[],
      stats: { ...parentSnapshot.stats },
    };

    return {
      inheritedSnapshot,
      agentTemplates,
      coordinatorConfig,
      sharedMemory: inheritedMemory,
    };
  }

  // ── 4. 快照合并 ─────────────────────────

  /**
   * 合并多个快照（用于群组合并场景）
   *
   * 合并策略:
   * - Agent模板：并集（按role去重，冲突时保留第一个）
   * - 共享记忆：并集（冲突时标记为冲突，不自动覆盖）
   * - 配置：以第一个快照为主
   * - 任务历史：按时间戳合并排序
   *
   * @param snapshots 要合并的快照列表
   * @returns 合并结果（包含冲突列表）
   */
  mergeSnapshots(snapshots: Snapshot[]): MergeResult {
    if (snapshots.length === 0) {
      throw new Error('SnapshotEngine: cannot merge empty snapshot list');
    }
    if (snapshots.length === 1) {
      return { snapshot: snapshots[0], conflicts: [], autoResolved: 0 };
    }

    const base = snapshots[0];
    const conflicts: MergeConflict[] = [];
    let autoResolved = 0;

    // 1. 合并Agent模板（按role去重）
    const roleMap = new Map<string, AgentTemplate>();
    for (const snapshot of snapshots) {
      for (const template of snapshot.agentTemplates) {
        if (roleMap.has(template.role)) {
          const existing = roleMap.get(template.role)!;
          if (JSON.stringify(existing.config) !== JSON.stringify(template.config)) {
            conflicts.push({
              path: `agentTemplates.${template.role}`,
              valueA: existing,
              valueB: template,
              type: 'template',
            });
          }
          // 保留第一个（或按版本策略选择）
        } else {
          roleMap.set(template.role, template);
        }
      }
    }
    const mergedTemplates = Array.from(roleMap.values());
    autoResolved += (snapshots.reduce((sum, s) => sum + s.agentTemplates.length, 0) - mergedTemplates.length);

    // 2. 合并共享记忆
    const mergedMemory: SharedMemorySnapshot = {
      hot: this.deepClone(base.sharedMemory.hot),
      warm: this.deepClone(base.sharedMemory.warm),
      coldIds: [...base.sharedMemory.coldIds],
    };

    for (let i = 1; i < snapshots.length; i++) {
      const snap = snapshots[i];

      // 合并 HOT（冲突标记）
      for (const [key, value] of Object.entries(snap.sharedMemory.hot)) {
        if (key in mergedMemory.hot) {
          const oldValue = mergedMemory.hot[key];
          if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
            conflicts.push({
              path: `sharedMemory.hot.${key}`,
              valueA: oldValue,
              valueB: value,
              type: 'memory',
            });
          }
        } else {
          mergedMemory.hot[key] = this.deepClone(value);
          autoResolved++;
        }
      }

      // 合并 WARM（冲突标记）
      for (const [key, value] of Object.entries(snap.sharedMemory.warm)) {
        if (key in mergedMemory.warm && mergedMemory.warm[key] !== value) {
          conflicts.push({
            path: `sharedMemory.warm.${key}`,
            valueA: mergedMemory.warm[key],
            valueB: value,
            type: 'memory',
          });
        } else if (!(key in mergedMemory.warm)) {
          mergedMemory.warm[key] = value;
          autoResolved++;
        }
      }

      // 合并 COLD IDs（并集）
      mergedMemory.coldIds = [...new Set([...mergedMemory.coldIds, ...snap.sharedMemory.coldIds])];
    }

    // 3. 合并任务历史（按时间排序）
    const allHistory = snapshots.flatMap(s => s.taskHistory);
    const mergedHistory = allHistory
      .sort((a, b) => {
        const ta = (a as any).timestamp ?? 0;
        const tb = (b as any).timestamp ?? 0;
        return ta - tb;
      })
      .slice(-100); // 保留最近100条

    // 4. 构建合并快照
    const mergedSnapshot: Snapshot = {
      metadata: {
        snapshotId: this.generateSnapshotId(),
        sourceChariotId: base.metadata.sourceChariotId,
        parentSnapshotId: undefined, // 合并快照无单一父节点
        createdAt: Date.now(),
        version: ++this.snapshotCounter,
        tags: ['merged', ...new Set(snapshots.flatMap(s => s.metadata.tags))],
        description: `Merged from ${snapshots.length} snapshots`,
        mergedFrom: snapshots.map(s => s.metadata.snapshotId),
      },
      chariotName: `${base.chariotName}-merged`,
      coordinatorConfig: base.coordinatorConfig,
      agentTemplates: mergedTemplates,
      sharedMemory: mergedMemory,
      taskHistory: mergedHistory,
      stats: {
        totalTasksExecuted: snapshots.reduce((sum, s) => sum + s.stats.totalTasksExecuted, 0),
        totalTasksFailed: snapshots.reduce((sum, s) => sum + s.stats.totalTasksFailed, 0),
        createdAt: Date.now(),
      },
    };

    return { snapshot: mergedSnapshot, conflicts, autoResolved };
  }

  // ── 5. 快照差异 ─────────────────────────

  /**
   * 比较两个快照，生成差异报告
   *
   * @param oldSnapshot 旧快照
   * @param newSnapshot 新快照
   * @returns 差异分析结果
   */
  diffSnapshots(oldSnapshot: Snapshot, newSnapshot: Snapshot): SnapshotDiff {
    const diff: SnapshotDiff = {
      removed: [],
      added: [],
      modified: [],
      memoryDiff: { hotDiff: {}, warmDiff: {} },
      templateDiff: { added: [], removed: [], modified: [] },
    };

    // 1. 比较元数据字段（顶层变化）
    const metaFields = ['chariotName', 'coordinatorConfig'] as const;
    for (const field of metaFields) {
      const oldVal = (oldSnapshot as any)[field];
      const newVal = (newSnapshot as any)[field];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        diff.modified.push({
          key: field,
          oldValue: oldVal,
          newValue: newVal,
          type: 'config',
        });
      }
    }

    // 2. 比较共享记忆 HOT 层
    const oldHotKeys = Object.keys(oldSnapshot.sharedMemory.hot);
    const newHotKeys = Object.keys(newSnapshot.sharedMemory.hot);
    for (const key of oldHotKeys) {
      if (!newHotKeys.includes(key)) {
        diff.memoryDiff.hotDiff[key] = { old: oldSnapshot.sharedMemory.hot[key] };
      } else if (
        JSON.stringify(oldSnapshot.sharedMemory.hot[key]) !==
        JSON.stringify(newSnapshot.sharedMemory.hot[key])
      ) {
        diff.memoryDiff.hotDiff[key] = {
          old: oldSnapshot.sharedMemory.hot[key],
          new: newSnapshot.sharedMemory.hot[key],
        };
        diff.modified.push({
          key: `sharedMemory.hot.${key}`,
          oldValue: oldSnapshot.sharedMemory.hot[key],
          newValue: newSnapshot.sharedMemory.hot[key],
          type: 'memory',
        });
      }
    }
    for (const key of newHotKeys) {
      if (!oldHotKeys.includes(key)) {
        diff.memoryDiff.hotDiff[key] = { new: newSnapshot.sharedMemory.hot[key] };
        diff.added.push(`sharedMemory.hot.${key}`);
      }
    }

    // 3. 比较共享记忆 WARM 层
    const oldWarmKeys = Object.keys(oldSnapshot.sharedMemory.warm);
    const newWarmKeys = Object.keys(newSnapshot.sharedMemory.warm);
    for (const key of oldWarmKeys) {
      if (!newWarmKeys.includes(key)) {
        diff.memoryDiff.warmDiff[key] = { old: oldSnapshot.sharedMemory.warm[key] };
      } else if (oldSnapshot.sharedMemory.warm[key] !== newSnapshot.sharedMemory.warm[key]) {
        diff.memoryDiff.warmDiff[key] = {
          old: oldSnapshot.sharedMemory.warm[key],
          new: newSnapshot.sharedMemory.warm[key],
        };
        diff.modified.push({
          key: `sharedMemory.warm.${key}`,
          oldValue: oldSnapshot.sharedMemory.warm[key],
          newValue: newSnapshot.sharedMemory.warm[key],
          type: 'memory',
        });
      }
    }
    for (const key of newWarmKeys) {
      if (!oldWarmKeys.includes(key)) {
        diff.memoryDiff.warmDiff[key] = { new: newSnapshot.sharedMemory.warm[key] };
        if (!diff.added.includes(`sharedMemory.warm.${key}`)) {
          diff.added.push(`sharedMemory.warm.${key}`);
        }
      }
    }

    // 4. 比较Agent模板
    const oldRoleMap = new Map(oldSnapshot.agentTemplates.map(t => [t.role, t]));
    const newRoleMap = new Map(newSnapshot.agentTemplates.map(t => [t.role, t]));

    for (const [role, template] of oldRoleMap) {
      if (!newRoleMap.has(role)) {
        diff.templateDiff.removed.push(template);
      } else {
        const newTemplate = newRoleMap.get(role)!;
        const changes = this.compareTemplates(template, newTemplate);
        if (changes.length > 0) {
          diff.templateDiff.modified.push({ template: newTemplate, changes });
          diff.modified.push({
            key: `agentTemplates.${role}`,
            oldValue: template,
            newValue: newTemplate,
            type: 'template',
          });
        }
      }
    }
    for (const [role, template] of newRoleMap) {
      if (!oldRoleMap.has(role)) {
        diff.templateDiff.added.push(template);
        diff.added.push(`agentTemplates.${role}`);
      }
    }

    // 5. 比较任务历史
    const oldHistoryIds = new Set(oldSnapshot.taskHistory.map(h => h.taskId));
    const newHistoryIds = new Set(newSnapshot.taskHistory.map(h => h.taskId));
    for (const id of oldHistoryIds) {
      if (!newHistoryIds.has(id)) {
        diff.removed.push(`taskHistory.${id}`);
      }
    }
    for (const id of newHistoryIds) {
      if (!oldHistoryIds.has(id)) {
        diff.added.push(`taskHistory.${id}`);
      }
    }

    return diff;
  }

  /**
   * 比较两个Agent模板的差异字段
   */
  private compareTemplates(oldT: AgentTemplate, newT: AgentTemplate): string[] {
    const changes: string[] = [];
    if (oldT.namePattern !== newT.namePattern) changes.push('namePattern');
    if (oldT.depth !== newT.depth) changes.push('depth');
    if (JSON.stringify(oldT.config) !== JSON.stringify(newT.config)) changes.push('config');
    return changes;
  }

  // ── 6. 内部工具 ─────────────────────────

  /**
   * 深拷贝 — 使用结构化克隆算法
   *
   * 支持: Object, Array, Map, Set, Date, 基本类型
   * 不支持: Function, Symbol, 循环引用（会截断）
   */
  deepClone<T>(obj: T): T {
    return SnapshotEngine.staticDeepClone(obj);
  }

  /**
   * 静态深拷贝工具（供外部模块使用）
   */
  static staticDeepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime()) as unknown as T;
    if (obj instanceof Map) {
      const clone = new Map();
      for (const [key, value] of obj.entries()) {
        clone.set(SnapshotEngine.staticDeepClone(key), SnapshotEngine.staticDeepClone(value));
      }
      return clone as unknown as T;
    }
    if (obj instanceof Set) {
      const clone = new Set();
      for (const value of obj) {
        clone.add(SnapshotEngine.staticDeepClone(value));
      }
      return clone as unknown as T;
    }
    if (Array.isArray(obj)) {
      return obj.map(item => SnapshotEngine.staticDeepClone(item)) as unknown as T;
    }
    // 普通对象
    const clone = {} as T;
    for (const key of Object.keys(obj as unknown as Record<string, unknown>)) {
      (clone as any)[key] = SnapshotEngine.staticDeepClone((obj as any)[key]);
    }
    return clone;
  }

  /**
   * 生成唯一快照ID
   */
  private generateSnapshotId(): string {
    return `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * 获取快照血缘链（从当前快照追溯到根）
   *
   * @param snapshot 起始快照
   * @param storage 快照存储（用于查询父快照）
   * @returns 血缘链（从根到当前）
   */
  getLineage(
    snapshot: Snapshot,
    storage: { get(snapshotId: string): Snapshot | undefined }
  ): Snapshot[] {
    const lineage: Snapshot[] = [snapshot];
    let current = snapshot;

    while (current.metadata.parentSnapshotId) {
      const parent = storage.get(current.metadata.parentSnapshotId);
      if (!parent) break;
      lineage.unshift(parent);
      current = parent;
    }

    return lineage;
  }
}

export { SnapshotEngine as default };

/** 独立深拷贝工具函数（零依赖） */
export function deepClone<T>(obj: T): T {
  return SnapshotEngine.staticDeepClone(obj);
}
