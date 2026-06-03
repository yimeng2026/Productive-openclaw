/**
 * @fileoverview Sylva Platform - Handoff Gateway Shared Types
 * @description Agent 协作群组、无中断上下文迁移、资产导入、交接审批的类型定义
 * @version 1.0.0
 */

import type { UUID, Timestamp } from "./index";

// ============================================================================
// Handoff Gateway 核心枚举
// ============================================================================

/** 群组状态 */
export type GroupStatus = "active" | "idle" | "paused" | "error";

/** 成员类型 */
export type MemberType = "single_agent" | "sub_group";

/** 成员状态 */
export type MemberStatus = "active" | "idle" | "error" | "migrating";

/** 资产类型 */
export type AssetType = "memory" | "workfile" | "log" | "config";

/** 导入模式 */
export type ImportMode = "reference" | "copy" | "merge";

/** 资产导入状态 */
export type AssetImportStatus = "pending" | "importing" | "completed" | "failed";

/** 交接规则 */
export type HandoffRule = "auto" | "manual" | "conditional";

/** 任务类型 */
export type TaskType = "sequential" | "parallel" | "conditional";

/** 交接记录状态 */
export type HandoffRecordStatus =
  | "pending"
  | "auto-approved"
  | "needs-review"
  | "rejected"
  | "timed-out"
  | "completed";

/** 导入进度状态 */
export type ImportProgressStatus = "pending" | "importing" | "completed" | "failed";

/** 协作单元状态（前端统一类型） */
export type CollaborationUnitStatus = "active" | "idle" | "paused" | "error" | "running";

// ============================================================================
// Handoff Gateway 核心接口
// ============================================================================

/**
 * Agent 协作群组
 * 表示一组协作的 Agent/子群组的容器，支持嵌套结构
 */
export interface AgentGroup {
  /** 群组唯一标识符 */
  id: UUID;
  /** 群组显示名称 */
  name: string;
  /** 群组描述 */
  description: string;
  /** 当前运行状态 */
  status: GroupStatus;
  /** 成员列表 */
  members: GroupMember[];
  /** 创建时间戳 (ms) */
  createdAt: Timestamp;
  /** 最后更新时间戳 (ms) */
  updatedAt: Timestamp;
  /** 交接规则：自动/手动/条件触发 */
  handoffRule: HandoffRule;
  /** 任务执行类型：顺序/并行/条件 */
  taskType: TaskType;
  /** 自主级别 (0-10，越高越自主) */
  autonomyLevel: number;
  /** 已导入的资产列表 */
  importedAssets: ImportedAsset[];
}

/**
 * 群组成员
 * 可以是单个 Agent 或嵌套子群组
 */
export interface GroupMember {
  /** 成员唯一标识符（在群组内） */
  id: UUID;
  /** 成员类型 */
  type: MemberType;
  /** 源 Agent/群组 ID */
  sourceId: UUID;
  /** 成员显示名称 */
  name: string;
  /** 当前运行状态 */
  status: MemberStatus;
  /** 原始进程 ID（迁移前） */
  originalProcessId?: UUID;
  /** 快照引用标识 */
  snapshotRef?: string;
  /** 头像类型标识 */
  avatarType: string;
  /** 主题颜色 */
  color: string;
  /** 是否保留原始 Agent（不中断运行） */
  preserveOriginal: boolean;
}

/**
 * 导入资产
 * 从源成员导入的记忆/工作文件/日志/配置
 */
export interface ImportedAsset {
  /** 资产唯一标识符 */
  id: UUID;
  /** 源成员 ID */
  sourceMemberId: UUID;
  /** 资产类型 */
  type: AssetType;
  /** 源文件路径 */
  sourcePath: string;
  /** 目标文件路径 */
  targetPath: string;
  /** 导入模式：引用/复制/合并 */
  importMode: ImportMode;
  /** 导入状态 */
  status: AssetImportStatus;
  /** 文件大小 (bytes) */
  size: number;
  /** 额外元数据 */
  metadata: Record<string, unknown>;
}

/**
 * 交接记录
 * 记录一次 Agent 间上下文交接的完整信息
 */
export interface HandoffRecord {
  /** 记录唯一标识符 */
  id: UUID;
  /** 所属群组 ID */
  groupId: UUID;
  /** 移交方成员 ID */
  fromMemberId: UUID;
  /** 接收方成员 ID */
  toMemberId: UUID;
  /** 交接状态 */
  status: HandoffRecordStatus;
  /** 交接原因/说明 */
  reason: string;
  /** 上下文快照标识 */
  contextSnapshot: string;
  /** 数据大小（人类可读） */
  dataSize: string;
  /** 交接耗时 */
  duration: string;
  /** 交接时间戳 (ISO) */
  timestamp: string;
  /** 审批人 ID */
  approvedBy?: UUID;
  /** 自动审批截止时间 */
  autoApproveDeadline?: string;
}

// ============================================================================
// 请求/响应类型
// ============================================================================

/**
 * 创建群组请求
 */
export interface CreateGroupRequest {
  /** 群组名称 */
  name: string;
  /** 群组描述 */
  description?: string;
  /** 任务执行类型 */
  taskType: TaskType;
  /** 自主级别 (0-10) */
  autonomyLevel: number;
  /** 交接规则 */
  handoffRule: HandoffRule;
  /** 初始成员配置 */
  members: {
    /** 源 Agent/群组 ID */
    sourceId: UUID;
    /** 成员类型 */
    type: MemberType;
    /** 是否保留原始 Agent */
    preserveOriginal: boolean;
    /** 默认导入模式 */
    importMode: "reference" | "copy";
  }[];
  /** 资产导入配置 */
  assetConfig?: {
    /** 默认导入模式 */
    defaultImportMode: ImportMode;
    /** 要导入的资产类型 */
    assetTypes: AssetType[];
  };
}

/**
 * 创建群组响应
 */
export interface CreateGroupResponse {
  /** 创建的群组 */
  group: AgentGroup;
  /** 导入任务 ID */
  importJobId: UUID;
  /** 预计导入时间 (秒) */
  estimatedImportTime: number;
}

/**
 * 资产导入进度
 */
export interface AssetImportProgress {
  /** 导入任务 ID */
  jobId: UUID;
  /** 目标群组 ID */
  groupId: UUID;
  /** 总资产数 */
  totalAssets: number;
  /** 已完成数 */
  completedAssets: number;
  /** 失败数 */
  failedAssets: number;
  /** 当前正在处理的资产 */
  currentAsset?: ImportedAsset;
  /** 完成百分比 (0-100) */
  percent: number;
  /** 导入状态 */
  status: ImportProgressStatus;
}

/**
 * 更新群组请求
 */
export interface UpdateGroupRequest {
  /** 群组名称 */
  name?: string;
  /** 群组描述 */
  description?: string;
  /** 交接规则 */
  handoffRule?: HandoffRule;
  /** 任务类型 */
  taskType?: TaskType;
  /** 自主级别 */
  autonomyLevel?: number;
  /** 群组状态 */
  status?: GroupStatus;
}

/**
 * 添加成员请求
 */
export interface AddMemberRequest {
  /** 源 Agent/群组 ID */
  sourceId: UUID;
  /** 成员类型 */
  type: MemberType;
  /** 是否保留原始 Agent */
  preserveOriginal: boolean;
  /** 导入模式 */
  importMode: "reference" | "copy";
}

/**
 * 移除成员请求
 */
export interface RemoveMemberRequest {
  /** 成员 ID */
  memberId: UUID;
  /** 是否清理已导入资产 */
  cleanupAssets?: boolean;
}

/**
 * 交接审批请求
 */
export interface ReviewHandoffRequest {
  /** 交接记录 ID */
  recordId: UUID;
  /** 审批动作 */
  action: "approve" | "reject" | "rollback";
  /** 审批备注 */
  comment?: string;
}

/**
 * 交接审批响应
 */
export interface ReviewHandoffResponse {
  /** 交接记录 */
  record: HandoffRecord;
  /** 审批结果 */
  result: "approved" | "rejected" | "rolled-back";
  /** 执行的操作 */
  executedAction: string;
}

/**
 * 回滚请求
 */
export interface RollbackRequest {
  /** 交接记录 ID */
  recordId: UUID;
  /** 回滚原因 */
  reason?: string;
  /** 是否保留回滚前的状态 */
  preserveCurrent?: boolean;
}

/**
 * 群组列表查询参数
 */
export interface GroupListParams {
  /** 状态过滤 */
  status?: GroupStatus;
  /** 任务类型过滤 */
  taskType?: TaskType;
  /** 搜索关键词 */
  search?: string;
  /** 分页 */
  page?: number;
  /** 每页数量 */
  limit?: number;
}

// ============================================================================
// WebSocket 事件类型
// ============================================================================

/** Handoff Gateway WebSocket 事件 */
export type HandoffWsEvent =
  | { type: "handoff.group_created"; payload: { group: AgentGroup } }
  | { type: "handoff.member_joined"; payload: { groupId: UUID; member: GroupMember } }
  | { type: "handoff.member_left"; payload: { groupId: UUID; memberId: UUID; reason?: string } }
  | { type: "handoff.asset_import_progress"; payload: AssetImportProgress }
  | { type: "handoff.asset_import_complete"; payload: { groupId: UUID; jobId: UUID; summary: { total: number; completed: number; failed: number } } }
  | { type: "handoff.status_change"; payload: { groupId: UUID; status: GroupStatus; reason?: string } }
  | { type: "handoff.member_status_change"; payload: { groupId: UUID; memberId: UUID; status: MemberStatus; reason?: string } }
  | { type: "handoff.handoff_initiated"; payload: { record: HandoffRecord } }
  | { type: "handoff.needs_review"; payload: { record: HandoffRecord; deadline: string } }
  | { type: "handoff.completed"; payload: { record: HandoffRecord } }
  | { type: "handoff.rejected"; payload: { record: HandoffRecord; reason: string } }
  | { type: "handoff.rollback_complete"; payload: { recordId: UUID; restoredState: string } }
  | { type: "handoff.intervention"; payload: { recordId: UUID; action: string; result: string } }
  | { type: "handoff.nesting_limit_warning"; payload: { groupId: UUID; currentDepth: number; maxDepth: number } }
  | { type: "handoff.error"; payload: { groupId?: UUID; error: string; code: string; details?: Record<string, unknown> } };

// ============================================================================
// 前端统一协作单元类型
// ============================================================================

/**
 * 统一协作单元
 * 前端用于统一展示单个 Agent 或群组的类型
 */
export interface CollaborationUnit {
  /** 单元唯一标识符 */
  id: UUID;
  /** 单元类型 */
  type: "single_agent" | "group";
  /** 显示名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 运行状态 */
  status: CollaborationUnitStatus;
  /** 头像类型 */
  avatarType: string;
  /** 主题颜色 */
  color: string;
  /** 所属平台 */
  platform?: string;
  /** 技能列表 */
  skills?: string[];
  /** 成员列表（仅群组） */
  members?: GroupMember[];
  /** 活跃任务数 */
  activeTasks?: number;
  /** 总任务数 */
  totalTasks?: number;
  /** 文件数量 */
  fileCount: number;
  /** 记忆数量 */
  memoryCount: number;
  /** 运行时长（人类可读） */
  uptime?: string;
}

// ============================================================================
// 服务层内部类型
// ============================================================================

/**
 * 快照元数据
 * 记录 Agent 状态快照的信息
 */
export interface SnapshotMetadata {
  /** 快照 ID */
  id: UUID;
  /** 源 Agent ID */
  agentId: UUID;
  /** 快照时间戳 */
  createdAt: Timestamp;
  /** 快照大小 (bytes) */
  size: number;
  /** 包含的资产类型 */
  assetTypes: AssetType[];
  /** 快照版本 */
  version: string;
  /** 过期时间 */
  expiresAt?: Timestamp;
}

/**
 * 冲突记录
 * 资产导入时的冲突信息
 */
export interface AssetConflict {
  /** 冲突 ID */
  id: UUID;
  /** 涉及的资产 ID */
  assetId: UUID;
  /** 冲突类型 */
  type: "name_collision" | "key_collision" | "version_mismatch" | "permission_denied";
  /** 冲突描述 */
  description: string;
  /** 源路径 */
  sourcePath: string;
  /** 目标路径 */
  targetPath: string;
  /** 解决策略 */
  resolution: "skip" | "overwrite" | "rename" | "merge";
  /** 解决后的路径 */
  resolvedPath?: string;
}

/**
 * 交接配置
 * 群组级别的交接行为配置
 */
export interface HandoffConfig {
  /** 自动审批超时 (ms) */
  autoApproveTimeout: number;
  /** 最大嵌套深度 */
  maxNestingDepth: number;
  /** 默认导入模式 */
  defaultImportMode: ImportMode;
  /** 是否启用快照持久化 */
  enableSnapshotPersistence: boolean;
  /** 快照保留时间 (ms) */
  snapshotRetentionMs: number;
  /** 最大单次交接数据量 (MB) */
  maxHandoffDataSizeMB: number;
  /** 冲突默认解决策略 */
  defaultConflictResolution: "skip" | "overwrite" | "rename" | "merge";
  /** 是否允许跨平台交接 */
  allowCrossPlatformHandoff: boolean;
  /** 交接前是否需要确认 */
  requirePreHandoffConfirmation: boolean;
}

/**
 * 交接统计
 */
export interface HandoffStats {
  /** 群组 ID */
  groupId: UUID;
  /** 总交接次数 */
  totalHandoffs: number;
  /** 自动审批次数 */
  autoApproved: number;
  /** 人工审批次数 */
  manualApproved: number;
  /** 拒绝次数 */
  rejected: number;
  /** 超时次数 */
  timedOut: number;
  /** 平均交接耗时 (ms) */
  avgDuration: number;
  /** 总导入资产数 */
  totalImportedAssets: number;
  /** 失败资产数 */
  failedAssets: number;
  /** 最后交接时间 */
  lastHandoffAt?: Timestamp;
}

// ============================================================================
// Namespace 导出（与 index.ts 风格一致）
// ============================================================================

export namespace HandoffModule {
  export type GroupStatus = import("./handoff").GroupStatus;
  export type MemberType = import("./handoff").MemberType;
  export type MemberStatus = import("./handoff").MemberStatus;
  export type AssetType = import("./handoff").AssetType;
  export type ImportMode = import("./handoff").ImportMode;
  export type AssetImportStatus = import("./handoff").AssetImportStatus;
  export type HandoffRule = import("./handoff").HandoffRule;
  export type TaskType = import("./handoff").TaskType;
  export type HandoffRecordStatus = import("./handoff").HandoffRecordStatus;
  export type ImportProgressStatus = import("./handoff").ImportProgressStatus;
  export type CollaborationUnitStatus = import("./handoff").CollaborationUnitStatus;

  export type AgentGroup = import("./handoff").AgentGroup;
  export type GroupMember = import("./handoff").GroupMember;
  export type ImportedAsset = import("./handoff").ImportedAsset;
  export type HandoffRecord = import("./handoff").HandoffRecord;
  export type CreateGroupRequest = import("./handoff").CreateGroupRequest;
  export type CreateGroupResponse = import("./handoff").CreateGroupResponse;
  export type AssetImportProgress = import("./handoff").AssetImportProgress;
  export type UpdateGroupRequest = import("./handoff").UpdateGroupRequest;
  export type AddMemberRequest = import("./handoff").AddMemberRequest;
  export type RemoveMemberRequest = import("./handoff").RemoveMemberRequest;
  export type ReviewHandoffRequest = import("./handoff").ReviewHandoffRequest;
  export type ReviewHandoffResponse = import("./handoff").ReviewHandoffResponse;
  export type RollbackRequest = import("./handoff").RollbackRequest;
  export type GroupListParams = import("./handoff").GroupListParams;
  export type HandoffWsEvent = import("./handoff").HandoffWsEvent;
  export type CollaborationUnit = import("./handoff").CollaborationUnit;
  export type SnapshotMetadata = import("./handoff").SnapshotMetadata;
  export type AssetConflict = import("./handoff").AssetConflict;
  export type HandoffConfig = import("./handoff").HandoffConfig;
  export type HandoffStats = import("./handoff").HandoffStats;
}
