/**
 * @fileoverview Sylva Platform - Shared Types
 * @description 前后端共享的核心类型定义库，覆盖所有前后端交互的数据结构
 * @version 2.0.0
 */

// ============================================================================
// 通用基础类型
// ============================================================================

/** UUID 字符串类型 */
export type UUID = string;

/** 时间戳 (毫秒) */
export type Timestamp = number;

/** 分页参数 */
export interface PaginationParams {
  /** 页码 (从1开始) */
  page?: number;
  /** 每页数量 */
  limit?: number;
  /** 排序字段 */
  sortBy?: string;
  /** 排序方向 */
  sortOrder?: "asc" | "desc";
}

/** 分页响应包装器 */
export interface PaginatedResponse<T> {
  /** 数据列表 */
  data: T[];
  /** 总数量 */
  total: number;
  /** 当前页码 */
  page: number;
  /** 每页数量 */
  limit: number;
  /** 总页数 */
  totalPages: number;
}

/** 通用错误响应 */
export interface ErrorResponse {
  /** 错误码 */
  code: string;
  /** 错误消息 */
  message: string;
  /** HTTP状态码 */
  statusCode: number;
  /** 错误详情 */
  details?: Record<string, unknown>;
  /** 时间戳 (ms) */
  timestamp?: Timestamp;
  /** 请求追踪ID */
  traceId?: UUID;
}

/** 通用API响应包装器 */
export interface ApiResponse<T> {
  /** 是否成功 */
  success: boolean;
  /** 响应数据 */
  data?: T;
  /** 错误信息 */
  error?: ErrorResponse;
  /** 响应消息 */
  message?: string;
  /** 时间戳 (ms) */
  timestamp: Timestamp;
  /** 请求追踪ID */
  traceId?: UUID;
}

/** 通用排序方向 */
export type SortOrder = "asc" | "desc";

/** 通用时间范围 */
export interface TimeRange {
  /** 开始时间戳 */
  start: Timestamp;
  /** 结束时间戳 */
  end: Timestamp;
}

/** 键值对记录 */
export interface KeyValueRecord {
  [key: string]: string | number | boolean | null;
}

// ============================================================================
// Agent 模块
// ============================================================================

export namespace AgentModule {
  /** Agent 运行状态 */
  export type AgentStatus = "idle" | "running" | "error" | "paused" | "stopping" | "starting";

  /** Agent 实体 - 表示一个可执行任务的智能代理 */
  export interface Agent {
    /** Agent 唯一标识符 */
    id: UUID;
    /** Agent 显示名称 */
    name: string;
    /** 当前运行状态 */
    status: AgentStatus;
    /** 创建时间戳 (ms) */
    createdAt: Timestamp;
    /** 最后活跃时间戳 (ms) */
    lastActiveAt?: Timestamp;
    /** Agent 配置 */
    config?: AgentConfig;
    /** 关联的模型ID */
    modelId?: UUID;
    /** 可用工具列表 */
    tools?: string[];
    /** Agent 描述 */
    description?: string;
    /** Agent 图标/头像URL */
    avatar?: string;
    /** 所属用户ID */
    ownerId?: UUID;
    /** 标签列表 */
    tags?: string[];
  }

  /** Agent 配置 */
  export interface AgentConfig {
    /** 系统提示词 */
    systemPrompt?: string;
    /** 温度参数 */
    temperature?: number;
    /** 最大Token数 */
    maxTokens?: number;
    /** 是否允许访问记忆 */
    memoryAccess?: boolean;
    /** 自定义参数 */
    [key: string]: unknown;
  }

  /** 创建Agent请求 */
  export interface CreateAgentRequest {
    /** Agent 显示名称 */
    name: string;
    /** Agent 描述 */
    description?: string;
    /** Agent 配置 */
    config?: AgentConfig;
    /** 关联的模型ID */
    modelId?: UUID;
    /** 可用工具列表 */
    tools?: string[];
    /** 标签列表 */
    tags?: string[];
    /** 图标/头像URL */
    avatar?: string;
  }

  /** 更新Agent请求 */
  export interface UpdateAgentRequest {
    /** Agent 显示名称 */
    name?: string;
    /** Agent 描述 */
    description?: string;
    /** Agent 配置 (部分更新) */
    config?: Partial<AgentConfig>;
    /** 关联的模型ID */
    modelId?: UUID;
    /** 可用工具列表 (替换) */
    tools?: string[];
    /** 标签列表 (替换) */
    tags?: string[];
    /** 图标/头像URL */
    avatar?: string;
    /** 运行状态 */
    status?: AgentStatus;
  }

  /** Agent 统计数据 */
  export interface AgentStats {
    /** Agent ID */
    agentId: UUID;
    /** 总处理消息数 */
    totalMessages: number;
    /** 总会话数 */
    totalSessions: number;
    /** 平均响应时间 (ms) */
    avgResponseTime: number;
    /** 错误率 (0-1) */
    errorRate: number;
    /** 当前活跃会话数 */
    activeSessions: number;
    /** 最后活跃时间 */
    lastActiveAt?: Timestamp;
    /** 今日消息数 */
    messagesToday: number;
    /** 今日Token使用量 */
    tokensToday: number;
    /** 累积Token使用量 */
    totalTokens: number;
  }

  /** 批量Agent操作请求 */
  export interface BatchAgentRequest {
    /** 操作类型 */
    action: "start" | "stop" | "pause" | "resume" | "delete" | "restart";
    /** 目标Agent ID列表 */
    agentIds: UUID[];
    /** 是否等待操作完成 */
    waitForCompletion?: boolean;
    /** 超时时间 (ms) */
    timeout?: number;
  }

  /** 批量操作结果 */
  export interface BatchAgentResult {
    /** 成功操作的Agent ID列表 */
    succeeded: UUID[];
    /** 失败的操作记录 */
    failed: Array<{
      agentId: UUID;
      error: string;
      code: string;
    }>;
    /** 操作耗时 (ms) */
    duration: number;
  }
}

// 顶层导出别名（保持向后兼容）
export type AgentStatus = AgentModule.AgentStatus;
export type Agent = AgentModule.Agent;
export type AgentConfig = AgentModule.AgentConfig;
export type CreateAgentRequest = AgentModule.CreateAgentRequest;
export type UpdateAgentRequest = AgentModule.UpdateAgentRequest;
export type AgentStats = AgentModule.AgentStats;
export type BatchAgentRequest = AgentModule.BatchAgentRequest;
export type BatchAgentResult = AgentModule.BatchAgentResult;

// ============================================================================
// Channel 模块
// ============================================================================

export namespace ChannelModule {
  /** 通道状态 */
  export type ChannelStatus = "active" | "inactive" | "error" | "connecting" | "disconnecting" | "archived";

  /** 通道类型 */
  export type ChannelType = "dm" | "group" | "public" | "broadcast";

  /** 通道实体 - 聊天/通讯通道 */
  export interface Channel {
    /** 通道唯一标识符 */
    id: UUID;
    /** 通道名称 */
    name: string;
    /** 通道类型 */
    type: ChannelType;
    /** 通道状态 */
    status: ChannelStatus;
    /** 参与者用户ID列表 */
    participants: UUID[];
    /** 创建时间戳 (ms) */
    createdAt: Timestamp;
    /** 最后更新时间戳 (ms) */
    updatedAt?: Timestamp;
    /** 通道配置 */
    config?: ChannelConfig;
    /** 关联的适配器名称 */
    adapter?: string;
    /** 通道描述 */
    description?: string;
    /** 图标/封面URL */
    avatar?: string;
  }

  /** 通道配置 */
  export interface ChannelConfig {
    /** 速率限制 (消息/秒) */
    rateLimit?: number;
    /** 是否启用Webhook */
    webhookEnabled?: boolean;
    /** Webhook URL */
    webhookUrl?: string;
    /** 适配器配置 */
    adapter?: Record<string, unknown>;
    /** 是否允许匿名 */
    allowAnonymous?: boolean;
    /** 消息保留天数 */
    messageRetentionDays?: number;
    /** 是否启用消息加密 */
    encryptionEnabled?: boolean;
    /** 自定义配置 */
    [key: string]: unknown;
  }

  /** 创建通道请求 */
  export interface CreateChannelRequest {
    /** 通道名称 */
    name: string;
    /** 通道类型 */
    type: ChannelType;
    /** 参与者用户ID列表 */
    participants?: UUID[];
    /** 通道配置 */
    config?: ChannelConfig;
    /** 关联的适配器名称 */
    adapter?: string;
    /** 通道描述 */
    description?: string;
    /** 图标/封面URL */
    avatar?: string;
  }

  /** 通道统计数据 */
  export interface ChannelStats {
    /** 通道ID */
    channelId: UUID;
    /** 总消息数 */
    totalMessages: number;
    /** 今日消息数 */
    messagesToday: number;
    /** 活跃参与者数 */
    activeParticipants: number;
    /** 总参与者数 */
    totalParticipants: number;
    /** 最后消息时间 */
    lastMessageAt?: Timestamp;
    /** 平均消息长度 */
    avgMessageLength: number;
    /** 消息类型分布 */
    messageTypeDistribution: Record<string, number>;
    /** 响应率 (0-1) */
    responseRate: number;
  }

  /** Ping 测试结果 */
  export interface PingResult {
    /** 目标通道ID */
    channelId: UUID;
    /** 是否成功 */
    success: boolean;
    /** 往返延迟 (ms) */
    latency: number;
    /** 错误信息 */
    error?: string;
    /** 时间戳 */
    timestamp: Timestamp;
    /** 额外诊断信息 */
    diagnostics?: Record<string, unknown>;
  }

  /** 测试消息请求 */
  export interface TestMessageRequest {
    /** 目标通道ID */
    channelId: UUID;
    /** 测试消息内容 */
    content: string;
    /** 消息类型 */
    type?: string;
    /** 是否等待响应 */
    waitForResponse?: boolean;
    /** 超时时间 (ms) */
    timeout?: number;
  }
}

// 顶层导出别名
export type ChannelStatus = ChannelModule.ChannelStatus;
export type ChannelType = ChannelModule.ChannelType;
export type Channel = ChannelModule.Channel;
export type ChannelConfig = ChannelModule.ChannelConfig;
export type CreateChannelRequest = ChannelModule.CreateChannelRequest;
export type ChannelStats = ChannelModule.ChannelStats;
export type PingResult = ChannelModule.PingResult;
export type TestMessageRequest = ChannelModule.TestMessageRequest;

// ============================================================================
// Model 模块
// ============================================================================

export namespace ModelModule {
  /** 模型能力类型 */
  export type ModelCapability =
    | "chat"
    | "reasoning"
    | "analysis"
    | "vision"
    | "code"
    | "embedding"
    | "audio"
    | "multimodal"
    | "function_calling"
    | "json_mode";

  /** 模型提供商 */
  export interface ModelProvider {
    /** 提供商唯一标识 */
    id: string;
    /** 提供商名称 */
    name: string;
    /** 提供商类型 */
    type: "openai" | "anthropic" | "google" | "local" | "custom";
    /** 基础URL */
    baseUrl?: string;
    /** 默认API版本 */
    apiVersion?: string;
    /** 是否启用 */
    enabled: boolean;
    /** 优先级 (数值越小越优先) */
    priority: number;
    /** 自定义请求头 */
    headers?: Record<string, string>;
    /** 配置参数 */
    config?: Record<string, unknown>;
  }

  /** 模型健康状态 */
  export interface ModelHealth {
    /** 模型ID */
    modelId: UUID;
    /** 健康状态 */
    status: "healthy" | "degraded" | "unhealthy" | "unknown";
    /** 上次检查时间 */
    lastCheckAt: Timestamp;
    /** 平均响应时间 (ms) */
    avgLatency: number;
    /** 错误率 (0-1) */
    errorRate: number;
    /** 当前可用性 (0-1) */
    availability: number;
    /** 诊断信息 */
    diagnostics?: Record<string, unknown>;
  }

  /** 模型实体 - AI模型定义 */
  export interface Model {
    /** 模型唯一标识符 */
    id: UUID;
    /** 模型显示名称 */
    name: string;
    /** 模型内部标识 */
    modelId: string;
    /** 提供商ID */
    providerId: string;
    /** 能力列表 */
    capabilities: ModelCapability[];
    /** 模型权重 (负载均衡) */
    weight?: number;
    /** 配额设置 */
    quota?: ModelQuota;
    /** 回退模型ID */
    fallback?: UUID;
    /** 端点URL (覆盖提供商默认) */
    endpoint?: string;
    /** 上下文窗口大小 */
    contextWindow?: number;
    /** 是否启用 */
    enabled: boolean;
    /** 描述 */
    description?: string;
    /** 成本信息 (每1K tokens) */
    pricing?: {
      input: number;
      output: number;
      currency: string;
    };
  }

  /** 模型配额 */
  export interface ModelQuota {
    /** 每分钟Token数限制 */
    tokensPerMinute?: number;
    /** 每分钟请求数限制 */
    requestsPerMinute?: number;
    /** 每日Token数限制 */
    tokensPerDay?: number;
    /** 每日请求数限制 */
    requestsPerDay?: number;
  }

  /** 模型统计数据 */
  export interface ModelStats {
    /** 模型ID */
    modelId: UUID;
    /** 总请求数 */
    totalRequests: number;
    /** 今日请求数 */
    requestsToday: number;
    /** 总Token使用量 (input) */
    totalInputTokens: number;
    /** 总Token使用量 (output) */
    totalOutputTokens: number;
    /** 今日Token使用量 */
    tokensToday: number;
    /** 平均响应时间 (ms) */
    avgResponseTime: number;
    /** P95响应时间 (ms) */
    p95ResponseTime: number;
    /** 错误率 (0-1) */
    errorRate: number;
    /** 活跃用户数 */
    activeUsers: number;
  }

  /** 加载模型请求 */
  export interface LoadModelRequest {
    /** 模型ID */
    modelId: UUID;
    /** 是否异步加载 */
    async?: boolean;
    /** 超时时间 (ms) */
    timeout?: number;
    /** 额外参数 */
    options?: Record<string, unknown>;
  }

  /** 模型加载结果 */
  export interface LoadModelResult {
    /** 模型ID */
    modelId: UUID;
    /** 是否成功 */
    success: boolean;
    /** 加载耗时 (ms) */
    loadTime?: number;
    /** 错误信息 */
    error?: string;
    /** 模型状态 */
    status: "loaded" | "loading" | "error" | "unloaded";
  }
}

// 顶层导出别名
export type ModelCapability = ModelModule.ModelCapability;
export type ModelProvider = ModelModule.ModelProvider;
export type ModelHealth = ModelModule.ModelHealth;
export type Model = ModelModule.Model;
export type ModelQuota = ModelModule.ModelQuota;
export type ModelStats = ModelModule.ModelStats;
export type LoadModelRequest = ModelModule.LoadModelRequest;
export type LoadModelResult = ModelModule.LoadModelResult;

// ============================================================================
// Health 模块
// ============================================================================

export namespace HealthModule {
  /** 健康状态等级 */
  export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

  /** 服务状态 */
  export interface ServiceStatus {
    /** 服务名称 */
    name: string;
    /** 健康状态 */
    status: HealthStatus;
    /** 运行时间 (秒) */
    uptime: number;
    /** 上次心跳时间 */
    lastHeartbeat?: Timestamp;
    /** 版本信息 */
    version?: string;
    /** 诊断信息 */
    diagnostics?: Record<string, unknown>;
  }

  /** 系统指标 */
  export interface SystemMetrics {
    /** CPU使用率 (0-1) */
    cpuUsage: number;
    /** 内存使用率 (0-1) */
    memoryUsage: number;
    /** 内存使用 (bytes) */
    memoryUsed: number;
    /** 内存总量 (bytes) */
    memoryTotal: number;
    /** 磁盘使用率 (0-1) */
    diskUsage: number;
    /** 磁盘使用 (bytes) */
    diskUsed: number;
    /** 磁盘总量 (bytes) */
    diskTotal: number;
    /** 网络输入速率 (bytes/s) */
    networkIn: number;
    /** 网络输出速率 (bytes/s) */
    networkOut: number;
    /** 活跃连接数 */
    activeConnections: number;
    /** 总请求数 */
    totalRequests: number;
    /** 请求速率 (req/s) */
    requestRate: number;
    /** 错误率 (0-1) */
    errorRate: number;
    /** 时间戳 */
    timestamp: Timestamp;
  }

  /** 健康检查响应 */
  export interface HealthResponse {
    /** 整体状态 */
    status: HealthStatus;
    /** 各服务状态 */
    services?: Record<string, "up" | "down" | "unknown">;
    /** 运行时间 (秒) */
    uptime: number;
    /** 时间戳 (ms) */
    timestamp?: Timestamp;
    /** 版本信息 */
    version?: string;
    /** 详细指标 */
    metrics?: SystemMetrics;
    /** 各服务详细状态 */
    serviceStatus?: ServiceStatus[];
  }
}

// 顶层导出别名
export type HealthStatus = HealthModule.HealthStatus;
export type ServiceStatus = HealthModule.ServiceStatus;
export type SystemMetrics = HealthModule.SystemMetrics;
export type HealthResponse = HealthModule.HealthResponse;

// ============================================================================
// Security 模块
// ============================================================================

export namespace SecurityModule {
  /** 安全等级 */
  export type SecurityLevel = "none" | "low" | "medium" | "high" | "critical";

  /** ACL规则 */
  export interface AclRule {
    /** 规则ID */
    id: UUID;
    /** 规则名称 */
    name: string;
    /** 资源路径 */
    resource: string;
    /** 操作类型 */
    action: "create" | "read" | "update" | "delete" | "execute" | "*";
    /** 主体类型 */
    principalType: "user" | "role" | "group" | "agent";
    /** 主体标识 */
    principalId: UUID;
    /** 是否允许 */
    allow: boolean;
    /** 生效时间范围 */
    timeRange?: TimeRange;
    /** 优先级 (数值越大越优先) */
    priority: number;
    /** 是否启用 */
    enabled: boolean;
    /** 创建时间 */
    createdAt: Timestamp;
  }

  /** IP条目 - 白名单/黑名单 */
  export interface IpEntry {
    /** 条目ID */
    id: UUID;
    /** IP地址或CIDR */
    ip: string;
    /** 类型 */
    type: "allow" | "deny" | "monitor";
    /** 描述 */
    description?: string;
    /** 过期时间 */
    expiresAt?: Timestamp;
    /** 创建时间 */
    createdAt: Timestamp;
  }

  /** 活跃会话 */
  export interface ActiveSession {
    /** 会话ID */
    sessionId: UUID;
    /** 用户ID */
    userId: UUID;
    /** IP地址 */
    ipAddress: string;
    /** 用户代理 */
    userAgent?: string;
    /** 登录时间 */
    loginAt: Timestamp;
    /** 最后活动时间 */
    lastActiveAt: Timestamp;
    /** 过期时间 */
    expiresAt: Timestamp;
    /** 设备信息 */
    deviceInfo?: {
      type?: string;
      os?: string;
      browser?: string;
    };
  }

  /** 评分详情 */
  export interface ScoreDetail {
    /** 评分维度 */
    dimension: string;
    /** 评分值 (0-100) */
    score: number;
    /** 权重 (0-1) */
    weight: number;
    /** 说明 */
    description?: string;
  }

  /** 合规标准 */
  export type ComplianceStandard = "GDPR" | "HIPAA" | "SOC2" | "ISO27001" | "PCI_DSS" | "CCPA" | "custom";

  /** 合规检查项 */
  export interface ComplianceItem {
    /** 检查项ID */
    id: UUID;
    /** 所属标准 */
    standard: ComplianceStandard;
    /** 检查项名称 */
    name: string;
    /** 检查项描述 */
    description: string;
    /** 是否通过 */
    passed: boolean;
    /** 严重程度 */
    severity: "info" | "warning" | "critical";
    /** 检查详情 */
    details?: Record<string, unknown>;
    /** 检查时间 */
    checkedAt: Timestamp;
  }

  /** 审计日志条目 */
  export interface AuditLogEntry {
    /** 日志ID */
    id: UUID;
    /** 时间戳 */
    timestamp: Timestamp;
    /** 操作类型 */
    action: string;
    /** 主体类型 */
    actorType: "user" | "agent" | "system" | "service";
    /** 主体ID */
    actorId: UUID;
    /** 目标资源类型 */
    resourceType: string;
    /** 目标资源ID */
    resourceId: UUID;
    /** 操作结果 */
    result: "success" | "failure" | "denied";
    /** IP地址 */
    ipAddress?: string;
    /** 用户代理 */
    userAgent?: string;
    /** 请求追踪ID */
    traceId?: UUID;
    /** 变更前数据 */
    before?: Record<string, unknown>;
    /** 变更后数据 */
    after?: Record<string, unknown>;
    /** 额外元数据 */
    metadata?: Record<string, unknown>;
  }

  /** 安全数据汇总 */
  export interface SecurityData {
    /** 安全等级 */
    level: SecurityLevel;
    /** 总威胁数 */
    totalThreats: number;
    /** 待处理威胁数 */
    pendingThreats: number;
    /** 已阻止攻击数 */
    blockedAttacks: number;
    /** 活跃会话数 */
    activeSessions: number;
    /** ACL规则数 */
    aclRulesCount: number;
    /** 合规检查通过数 */
    compliancePassed: number;
    /** 合规检查总数 */
    complianceTotal: number;
    /** 最近审计日志 */
    recentAudits: AuditLogEntry[];
    /** 时间戳 */
    timestamp: Timestamp;
  }
}

// 顶层导出别名
export type SecurityLevel = SecurityModule.SecurityLevel;
export type AclRule = SecurityModule.AclRule;
export type IpEntry = SecurityModule.IpEntry;
export type ActiveSession = SecurityModule.ActiveSession;
export type ScoreDetail = SecurityModule.ScoreDetail;
export type ComplianceStandard = SecurityModule.ComplianceStandard;
export type ComplianceItem = SecurityModule.ComplianceItem;
export type AuditLogEntry = SecurityModule.AuditLogEntry;
export type SecurityData = SecurityModule.SecurityData;

// ============================================================================
// Logs 模块
// ============================================================================

export namespace LogsModule {
  /** 日志级别 */
  export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal" | "trace";

  /** 日志来源 */
  export type LogSource =
    | "api"
    | "gateway"
    | "agent"
    | "model"
    | "channel"
    | "memory"
    | "security"
    | "system"
    | "websocket"
    | "scheduler"
    | "user";

  /** 日志条目 */
  export interface LogEntry {
    /** 日志ID */
    id: UUID;
    /** 时间戳 */
    timestamp: Timestamp;
    /** 日志级别 */
    level: LogLevel;
    /** 日志来源 */
    source: LogSource;
    /** 服务/组件名称 */
    service: string;
    /** 消息内容 */
    message: string;
    /** 关联的请求追踪ID */
    traceId?: UUID;
    /** 关联的会话ID */
    sessionId?: UUID;
    /** 关联的用户ID */
    userId?: UUID;
    /** 关联的Agent ID */
    agentId?: UUID;
    /** 关联的通道ID */
    channelId?: UUID;
    /** 错误对象 */
    error?: {
      name?: string;
      message: string;
      stack?: string;
      code?: string;
    };
    /** 额外上下文 */
    context?: Record<string, unknown>;
    /** 元数据 */
    metadata?: Record<string, unknown>;
  }

  /** 日志过滤器 */
  export interface LogFilter {
    /** 日志级别过滤 */
    level?: LogLevel[];
    /** 来源过滤 */
    source?: LogSource[];
    /** 服务名称过滤 */
    service?: string[];
    /** 时间范围 */
    timeRange?: TimeRange;
    /** 搜索关键词 */
    search?: string;
    /** 关联的追踪ID */
    traceId?: UUID;
    /** 关联的会话ID */
    sessionId?: UUID;
    /** 关联的用户ID */
    userId?: UUID;
    /** 关联的Agent ID */
    agentId?: UUID;
  }

  /** 日志响应 */
  export interface LogsResponse {
    /** 日志列表 */
    logs: LogEntry[];
    /** 分页信息 */
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
    /** 汇总统计 */
    summary: {
      byLevel: Record<LogLevel, number>;
      bySource: Record<LogSource, number>;
    };
  }

  /** 日志统计 */
  export interface LogStats {
    /** 时间范围 */
    timeRange: TimeRange;
    /** 总数 */
    total: number;
    /** 按级别分布 */
    byLevel: Record<LogLevel, number>;
    /** 按来源分布 */
    bySource: Record<LogSource, number>;
    /** 按服务分布 */
    byService: Record<string, number>;
    /** 按小时分布 */
    byHour: Array<{ hour: number; count: number }>;
    /** 错误率 (0-1) */
    errorRate: number;
    /** 平均日志数/小时 */
    avgLogsPerHour: number;
  }

  /** 日志导出请求 */
  export interface LogExportRequest {
    /** 导出过滤器 */
    filter?: LogFilter;
    /** 导出格式 */
    format: "json" | "csv" | "ndjson";
    /** 时间范围 */
    timeRange?: TimeRange;
    /** 导出文件名 */
    filename?: string;
    /** 是否包含上下文 */
    includeContext?: boolean;
    /** 最大导出数量 */
    maxEntries?: number;
  }

  /** 日志导出结果 */
  export interface LogExportResult {
    /** 导出ID */
    exportId: UUID;
    /** 导出文件名 */
    filename: string;
    /** 导出数量 */
    exportedCount: number;
    /** 文件大小 (bytes) */
    fileSize: number;
    /** 下载URL */
    downloadUrl?: string;
    /** 创建时间 */
    createdAt: Timestamp;
    /** 过期时间 */
    expiresAt?: Timestamp;
  }
}

// 顶层导出别名
export type LogLevel = LogsModule.LogLevel;
export type LogSource = LogsModule.LogSource;
export type LogEntry = LogsModule.LogEntry;
export type LogFilter = LogsModule.LogFilter;
export type LogsResponse = LogsModule.LogsResponse;
export type LogStats = LogsModule.LogStats;
export type LogExportRequest = LogsModule.LogExportRequest;
export type LogExportResult = LogsModule.LogExportResult;

// ============================================================================
// Memory 模块
// ============================================================================

export namespace MemoryModule {
  /** 记忆类型 */
  export type MemoryType = "fact" | "conversation" | "preference" | "task" | "context" | "insight";

  /** 记忆实体 */
  export interface Memory {
    /** 记忆唯一标识符 */
    id: UUID;
    /** 关联的用户ID */
    userId: UUID;
    /** 关联的会话ID */
    sessionId?: UUID;
    /** 关联的Agent ID */
    agentId?: UUID;
    /** 记忆类型 */
    type: MemoryType;
    /** 记忆内容 */
    content: string;
    /** 压缩后的内容 */
    contentCompressed?: string;
    /** 向量Embedding */
    embedding?: number[];
    /** 重要性 (0.0 - 1.0) */
    importance: number;
    /** 创建时间戳 (ms) */
    createdAt: Timestamp;
    /** 更新时间戳 (ms) */
    updatedAt: Timestamp;
    /** 版本号 */
    version: number;
    /** 是否已归档 */
    isArchived: boolean;
    /** 标签 */
    tags?: string[];
    /** 来源 */
    source?: string;
  }

  /** 记忆过滤器 */
  export interface MemoryFilter {
    /** 用户ID */
    userId?: UUID;
    /** 记忆类型过滤 */
    type?: MemoryType[];
    /** 时间范围 */
    timeRange?: TimeRange;
    /** 重要性阈值 (最小值) */
    importanceMin?: number;
    /** 重要性阈值 (最大值) */
    importanceMax?: number;
    /** 标签过滤 */
    tags?: string[];
    /** 搜索关键词 */
    search?: string;
    /** 是否包含已归档 */
    includeArchived?: boolean;
    /** 来源过滤 */
    source?: string[];
  }

  /** 记忆统计 */
  export interface MemoryStats {
    /** 用户ID */
    userId: UUID;
    /** 总记忆数 */
    total: number;
    /** 按类型分布 */
    byType: Record<MemoryType, number>;
    /** 归档数量 */
    archived: number;
    /** 平均重要性 */
    avgImportance: number;
    /** 总存储大小 (bytes, 估算) */
    estimatedSize: number;
    /** 最早记忆时间 */
    oldestMemory?: Timestamp;
    /** 最新记忆时间 */
    newestMemory?: Timestamp;
  }

  /** 记忆查询 */
  export interface MemoryQuery {
    /** 用户ID */
    userId: UUID;
    /** 全文搜索关键词 */
    text?: string;
    /** 语义搜索向量 */
    vector?: number[];
    /** 记忆类型过滤 */
    type?: MemoryType;
    /** 时间范围 [start, end] */
    timeRange?: [Timestamp, Timestamp];
    /** 重要性阈值 */
    importanceThreshold?: number;
    /** 返回数量限制 */
    limit?: number;
    /** 偏移量 */
    offset?: number;
    /** 相似度阈值 (语义搜索) */
    similarityThreshold?: number;
  }

  /** 记忆关联 */
  export interface MemoryLink {
    /** 源记忆ID */
    fromId: UUID;
    /** 目标记忆ID */
    toId: UUID;
    /** 关系类型 */
    relation: "similar" | "follow-up" | "contradicts" | "references" | "causes";
    /** 关联强度 (0-1) */
    strength: number;
  }

  /** 记忆分享请求 */
  export interface MemoryShareRequest {
    /** 记忆ID列表 */
    memoryIds: UUID[];
    /** 分享目标用户ID */
    targetUserIds: UUID[];
    /** 是否允许编辑 */
    allowEdit?: boolean;
    /** 过期时间 */
    expiresAt?: Timestamp;
    /** 分享备注 */
    note?: string;
  }

  /** 记忆分享结果 */
  export interface MemoryShareResult {
    /** 分享ID */
    shareId: UUID;
    /** 成功分享的记忆数 */
    sharedCount: number;
    /** 失败记录 */
    failed: Array<{
      memoryId: UUID;
      error: string;
    }>;
    /** 分享链接 */
    shareLink?: string;
    /** 创建时间 */
    createdAt: Timestamp;
  }
}

// 顶层导出别名
export type MemoryType = MemoryModule.MemoryType;
export type Memory = MemoryModule.Memory;
export type MemoryFilter = MemoryModule.MemoryFilter;
export type MemoryStats = MemoryModule.MemoryStats;
export type MemoryQuery = MemoryModule.MemoryQuery;
export type MemoryLink = MemoryModule.MemoryLink;
export type MemoryShareRequest = MemoryModule.MemoryShareRequest;
export type MemoryShareResult = MemoryModule.MemoryShareResult;

// ============================================================================
// Settings 模块
// ============================================================================

export namespace SettingsModule {
  /** 主题模式 */
  export type ThemeMode = "light" | "dark" | "system" | "auto";

  /** 字体大小 */
  export type FontSize = "xs" | "sm" | "md" | "lg" | "xl";

  /** 通知渠道 */
  export type NotificationChannel = "email" | "push" | "webhook" | "slack" | "discord" | "sms";

  /** 通知配置 */
  export interface NotificationConfig {
    /** 启用的渠道 */
    channels: NotificationChannel[];
    /** 邮件配置 */
    email?: {
      address: string;
      enabled: boolean;
    };
    /** Webhook配置 */
    webhook?: {
      url: string;
      headers?: Record<string, string>;
      enabled: boolean;
    };
    /** Slack配置 */
    slack?: {
      webhookUrl: string;
      channel?: string;
      enabled: boolean;
    };
    /** Discord配置 */
    discord?: {
      webhookUrl: string;
      enabled: boolean;
    };
    /** 静默时间段 */
    quietHours?: {
      start: string; // HH:mm
      end: string; // HH:mm
      timezone: string;
      enabled: boolean;
    };
    /** 最小通知级别 */
    minLevel?: LogLevel;
  }

  /** 应用设置 */
  export interface AppSettings {
    /** 设置版本 */
    version: number;
    /** 用户ID */
    userId?: UUID;
    /** 主题设置 */
    theme: {
      mode: ThemeMode;
      accentColor?: string;
      fontSize: FontSize;
      fontFamily?: string;
      codeTheme?: string;
    };
    /** 语言设置 */
    language: {
      locale: string;
      fallback?: string;
    };
    /** 通知设置 */
    notifications: NotificationConfig;
    /** 隐私设置 */
    privacy: {
      shareAnalytics: boolean;
      saveHistory: boolean;
      autoArchiveDays: number;
      exportFormat: "json" | "md" | "txt";
    };
    /** 编辑器设置 */
    editor: {
      autoSave: boolean;
      autoSaveInterval: number;
      spellCheck: boolean;
      wordWrap: boolean;
      tabSize: number;
      showLineNumbers: boolean;
    };
    /** 快捷键设置 */
    shortcuts?: Record<string, string>;
    /** 自定义扩展 */
    extensions?: Record<string, unknown>;
    /** 最后更新时间 */
    updatedAt: Timestamp;
  }

  /** 设置导出 */
  export interface SettingsExport {
    /** 导出ID */
    exportId: UUID;
    /** 设置数据 */
    settings: AppSettings;
    /** 导出时间 */
    exportedAt: Timestamp;
    /** 导出格式 */
    format: "json" | "yaml";
    /** 是否包含敏感数据 */
    includeSensitive: boolean;
    /** 版本 */
    version: number;
  }

  /** 设置导入请求 */
  export interface SettingsImportRequest {
    /** 设置数据 */
    data: string;
    /** 导入格式 */
    format: "json" | "yaml";
    /** 是否覆盖现有设置 */
    overwrite: boolean;
    /** 验证模式 (仅验证不导入) */
    dryRun?: boolean;
  }

  /** 设置导入结果 */
  export interface SettingsImportResult {
    /** 是否成功 */
    success: boolean;
    /** 导入的设置项数 */
    imported: number;
    /** 跳过的设置项数 */
    skipped: number;
    /** 失败的设置项 */
    failed: Array<{
      key: string;
      error: string;
    }>;
  }
}

// 顶层导出别名
export type ThemeMode = SettingsModule.ThemeMode;
export type FontSize = SettingsModule.FontSize;
export type NotificationChannel = SettingsModule.NotificationChannel;
export type NotificationConfig = SettingsModule.NotificationConfig;
export type AppSettings = SettingsModule.AppSettings;
export type SettingsExport = SettingsModule.SettingsExport;
export type SettingsImportRequest = SettingsModule.SettingsImportRequest;
export type SettingsImportResult = SettingsModule.SettingsImportResult;

// ============================================================================
// WebSocket 消息模块
// ============================================================================

export namespace WebSocketModule {
  /** WebSocket 消息类型 */
  export type WSMessageType =
    | "connected"
    | "disconnected"
    | "push"
    | "ack"
    | "error"
    | "heartbeat"
    | "subscribe"
    | "unsubscribe"
    | "tool-output"
    | "chat-message"
    | "system-alert"
    | "presence"
    | "typing"
    | "notification"
    | "sync";

  /** WebSocket 消息 - 前后端通信消息格式 */
  export interface WSMessage {
    /** 消息唯一标识符 */
    id?: UUID;
    /** 消息类型 */
    type: WSMessageType;
    /** 目标通道 */
    channel?: string;
    /** 消息负载 */
    payload: WSMessagePayload;
    /** 时间戳 (ms) */
    timestamp?: Timestamp;
    /** 发送者ID */
    senderId?: UUID;
    /** 是否需要确认 */
    requireAck?: boolean;
    /** 追踪ID */
    traceId?: UUID;
  }

  /** WebSocket 消息负载 - 联合类型 */
  export type WSMessagePayload =
    | ConnectionPayload
    | ChatPayload
    | ToolOutputPayload
    | SystemAlertPayload
    | HeartbeatPayload
    | ErrorPayload
    | SubscribePayload
    | PresencePayload
    | TypingPayload
    | NotificationPayload
    | SyncPayload;

  /** 连接状态负载 */
  export interface ConnectionPayload {
    clientId?: string;
    status: "connected" | "disconnected" | "reconnecting";
    reason?: string;
  }

  /** 聊天消息负载 */
  export interface ChatPayload {
    message: Message;
    sessionId?: UUID;
    channelId?: UUID;
    replyTo?: UUID;
    editOf?: UUID;
  }

  /** 工具输出负载 */
  export interface ToolOutputPayload {
    toolName: string;
    output: string;
    exitCode?: number;
    executionTime?: number;
    processId?: UUID;
  }

  /** 系统告警负载 */
  export interface SystemAlertPayload {
    level: "info" | "warning" | "error" | "critical";
    title: string;
    description: string;
    service?: string;
    details?: Record<string, unknown>;
    actionRequired?: boolean;
  }

  /** 心跳负载 */
  export interface HeartbeatPayload {
    sequence: number;
    latency?: number;
  }

  /** 错误负载 */
  export interface ErrorPayload {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    recoverable?: boolean;
  }

  /** 订阅负载 */
  export interface SubscribePayload {
    channels: string[];
    pattern?: string;
    includeHistory?: boolean;
    historyLimit?: number;
  }

  /** 在线状态负载 */
  export interface PresencePayload {
    userId: UUID;
    status: "online" | "away" | "busy" | "offline";
    lastSeen?: Timestamp;
    device?: string;
  }

  /** 正在输入负载 */
  export interface TypingPayload {
    userId: UUID;
    channelId: UUID;
    sessionId?: UUID;
    isTyping: boolean;
  }

  /** 通知负载 */
  export interface NotificationPayload {
    notificationId: UUID;
    title: string;
    body: string;
    type: string;
    priority: "low" | "normal" | "high" | "urgent";
    data?: Record<string, unknown>;
    read?: boolean;
    createdAt: Timestamp;
  }

  /** 同步负载 */
  export interface SyncPayload {
    syncId: UUID;
    entity: string;
    action: "create" | "update" | "delete";
    data: Record<string, unknown>;
    timestamp: Timestamp;
    version: number;
  }

  /** WebSocket 订阅 */
  export interface WSSubscription {
    /** 订阅ID */
    id: UUID;
    /** 用户ID */
    userId: UUID;
    /** 订阅的通道列表 */
    channels: string[];
    /** 订阅模式 (通配符) */
    pattern?: string;
    /** 创建时间 */
    createdAt: Timestamp;
    /** 最后活跃时间 */
    lastActiveAt: Timestamp;
    /** 是否接收历史消息 */
    includeHistory: boolean;
    /** 历史消息数量限制 */
    historyLimit: number;
  }

  /** WebSocket 连接配置 */
  export interface WSConnectionConfig {
    /** 重连间隔 (ms) */
    reconnectInterval: number;
    /** 最大重连次数 */
    maxReconnectAttempts: number;
    /** 心跳间隔 (ms) */
    heartbeatInterval: number;
    /** 连接超时 (ms) */
    connectionTimeout: number;
    /** 是否自动重连 */
    autoReconnect: boolean;
  }
}

// 顶层导出别名
export type WSMessageType = WebSocketModule.WSMessageType;
export type WSMessage = WebSocketModule.WSMessage;
export type WSMessagePayload = WebSocketModule.WSMessagePayload;
export type ConnectionPayload = WebSocketModule.ConnectionPayload;
export type ChatPayload = WebSocketModule.ChatPayload;
export type ToolOutputPayload = WebSocketModule.ToolOutputPayload;
export type SystemAlertPayload = WebSocketModule.SystemAlertPayload;
export type HeartbeatPayload = WebSocketModule.HeartbeatPayload;
export type ErrorPayload = WebSocketModule.ErrorPayload;
export type SubscribePayload = WebSocketModule.SubscribePayload;
export type PresencePayload = WebSocketModule.PresencePayload;
export type TypingPayload = WebSocketModule.TypingPayload;
export type NotificationPayload = WebSocketModule.NotificationPayload;
export type SyncPayload = WebSocketModule.SyncPayload;
export type WSSubscription = WebSocketModule.WSSubscription;
export type WSConnectionConfig = WebSocketModule.WSConnectionConfig;

// 保留旧名称的向后兼容别名
/** @deprecated 使用 WSMessage */
export type WebSocketMessage = WSMessage;
/** @deprecated 使用 WebSocketModule 中的 payload 类型 */
export type WebSocketPayload = WSMessagePayload;

// ============================================================================
// 用户模块
// ============================================================================

export namespace UserModule {
  /** 用户实体 */
  export interface User {
    /** 用户唯一标识符 */
    id: UUID;
    /** 用户显示名称 */
    name: string;
    /** 用户邮箱 */
    email?: string;
    /** 用户头像URL */
    avatar?: string;
    /** 用户角色 */
    role: "user" | "admin" | "service" | "guest";
    /** 创建时间戳 (ms) */
    createdAt: Timestamp;
    /** 最后活跃时间 */
    lastActiveAt?: Timestamp;
    /** 是否激活 */
    isActive: boolean;
    /** API配额信息 */
    quota?: UserQuota;
    /** 偏好设置 */
    preferences?: AppSettings;
  }

  /** 用户配额 */
  export interface UserQuota {
    /** 每分钟请求数限制 */
    requestsPerMinute: number;
    /** 每分钟Token数限制 */
    tokensPerMinute: number;
    /** 已用Token数 */
    tokensUsed: number;
    /** 配额重置时间 */
    resetAt: Timestamp;
    /** 每日请求限制 */
    requestsPerDay?: number;
    /** 每日Token限制 */
    tokensPerDay?: number;
  }

  /** 创建用户请求 */
  export interface CreateUserRequest {
    name: string;
    email: string;
    role?: User["role"];
    avatar?: string;
    password?: string;
  }

  /** 更新用户请求 */
  export interface UpdateUserRequest {
    name?: string;
    email?: string;
    avatar?: string;
    role?: User["role"];
    isActive?: boolean;
    quota?: Partial<UserQuota>;
  }
}

// 顶层导出别名
export type User = UserModule.User;
export type UserQuota = UserModule.UserQuota;
export type CreateUserRequest = UserModule.CreateUserRequest;
export type UpdateUserRequest = UserModule.UpdateUserRequest;

// ============================================================================
// 会话模块
// ============================================================================

export namespace SessionModule {
  /** 会话实体 - 表示一次对话上下文 */
  export interface Session {
    /** 会话唯一标识符 */
    id: UUID;
    /** 会话标题 */
    title?: string;
    /** 关联的用户ID */
    userId: UUID;
    /** 关联的Agent ID */
    agentId?: UUID;
    /** 关联的通道ID */
    channelId?: UUID;
    /** 创建时间戳 (ms) */
    createdAt: Timestamp;
    /** 最后更新时间戳 (ms) */
    updatedAt: Timestamp;
    /** 会话状态 */
    status: "active" | "archived" | "closed" | "paused";
    /** 元数据 */
    metadata?: Record<string, unknown>;
    /** 消息数量 */
    messageCount?: number;
    /** 最后消息时间 */
    lastMessageAt?: Timestamp;
  }

  /** 创建会话请求 */
  export interface CreateSessionRequest {
    title?: string;
    userId: UUID;
    agentId?: UUID;
    channelId?: UUID;
    metadata?: Record<string, unknown>;
  }
}

// 顶层导出别名
export type Session = SessionModule.Session;
export type CreateSessionRequest = SessionModule.CreateSessionRequest;

// ============================================================================
// 消息模块
// ============================================================================

export namespace MessageModule {
  /** 消息类型 */
  export type MessageType = "text" | "image" | "file" | "command" | "system" | "error" | "thinking" | "tool_call" | "tool_result";

  /** 消息实体 */
  export interface Message {
    /** 消息唯一标识符 */
    id: UUID;
    /** 关联的会话ID */
    sessionId?: UUID;
    /** 关联的通道ID */
    channelId?: UUID;
    /** 发送者信息 */
    sender: MessageSender;
    /** 消息内容 */
    content: MessageContent;
    /** 消息类型 */
    type: MessageType;
    /** 创建时间戳 (ms) */
    timestamp: Timestamp;
    /** 元数据 */
    metadata?: MessageMetadata;
    /** 编辑时间 */
    editedAt?: Timestamp;
    /** 是否已删除 */
    isDeleted?: boolean;
    /** 反应表情列表 */
    reactions?: Array<{
      emoji: string;
      userIds: UUID[];
    }>;
  }

  /** 消息发送者 */
  export interface MessageSender {
    /** 发送者ID */
    id: UUID;
    /** 发送者名称 */
    name: string;
    /** 发送者头像URL */
    avatar?: string;
    /** 是否为Bot */
    isBot: boolean;
    /** 角色 */
    role?: string;
  }

  /** 消息内容 */
  export interface MessageContent {
    /** 文本内容 */
    text: string;
    /** 附件列表 */
    attachments?: Attachment[];
    /** 提及列表 */
    mentions?: Mention[];
    /** 引用的消息ID */
    replyTo?: UUID;
    /** 工具调用 */
    toolCalls?: ToolCall[];
    /** 思维链 */
    reasoning?: string;
  }

  /** 工具调用 */
  export interface ToolCall {
    /** 调用ID */
    id: string;
    /** 工具名称 */
    name: string;
    /** 参数 */
    arguments: Record<string, unknown>;
    /** 结果 */
    result?: unknown;
  }

  /** 附件实体 */
  export interface Attachment {
    /** 附件ID */
    id: UUID;
    /** 附件名称 */
    name: string;
    /** MIME类型 */
    mimeType: string;
    /** 文件大小 (bytes) */
    size: number;
    /** 文件URL或base64数据 */
    url: string;
    /** 附件描述 */
    description?: string;
    /** 宽度 (图片/视频) */
    width?: number;
    /** 高度 (图片/视频) */
    height?: number;
    /** 缩略图URL */
    thumbnailUrl?: string;
  }

  /** 提及实体 */
  export interface Mention {
    /** 被提及用户ID */
    userId: UUID;
    /** 被提及用户名 */
    userName: string;
    /** 提及位置 (文本索引) */
    index: number;
    /** 提及长度 */
    length: number;
  }

  /** 消息元数据 */
  export interface MessageMetadata {
    /** 原始通道数据 */
    raw?: Record<string, unknown>;
    /** 是否已处理 */
    processed: boolean;
    /** 优先级 (0-9) */
    priority: number;
    /** 处理耗时 (ms) */
    processingTime?: number;
    /** 使用的模型ID */
    modelId?: UUID;
    /** 使用的Token数 */
    tokenCount?: {
      input: number;
      output: number;
    };
  }

  /** 创建消息请求 */
  export interface CreateMessageRequest {
    sessionId?: UUID;
    channelId?: UUID;
    content: string;
    type?: MessageType;
    attachments?: Omit<Attachment, "id">[];
    replyTo?: UUID;
    metadata?: Partial<MessageMetadata>;
  }

  /** 消息编辑请求 */
  export interface EditMessageRequest {
    messageId: UUID;
    newContent: string;
  }
}

// 顶层导出别名
export type MessageType = MessageModule.MessageType;
export type Message = MessageModule.Message;
export type MessageSender = MessageModule.MessageSender;
export type MessageContent = MessageModule.MessageContent;
export type ToolCall = MessageModule.ToolCall;
export type Attachment = MessageModule.Attachment;
export type Mention = MessageModule.Mention;
export type MessageMetadata = MessageModule.MessageMetadata;
export type CreateMessageRequest = MessageModule.CreateMessageRequest;
export type EditMessageRequest = MessageModule.EditMessageRequest;

// ============================================================================
// 系统配置模块
// ============================================================================

export namespace ConfigModule {
  /** 系统配置 */
  export interface Config {
    /** 服务器配置 */
    server: ServerConfig;
    /** 认证配置 */
    auth: AuthConfig;
    /** 日志配置 */
    logging: LoggingConfig;
    /** 服务配置 */
    services: ServicesConfig;
    /** 应用名称 */
    appName?: string;
    /** 应用版本 */
    appVersion?: string;
    /** 环境 */
    environment?: "development" | "staging" | "production" | "test";
  }

  /** 服务器配置 */
  export interface ServerConfig {
    /** 监听主机 */
    host: string;
    /** HTTP端口 */
    port: number;
    /** WebSocket端口 */
    wsPort: number;
    /** CORS配置 */
    cors: CorsConfig;
    /** 是否启用HTTPS */
    https?: boolean;
    /** SSL证书路径 */
    sslCert?: string;
    /** SSL密钥路径 */
    sslKey?: string;
  }

  /** CORS配置 */
  export interface CorsConfig {
    /** 允许的源 */
    origins: string[];
    /** 是否允许凭证 */
    credentials: boolean;
    /** 允许的方法 */
    methods?: string[];
    /** 允许的请求头 */
    allowedHeaders?: string[];
  }

  /** 认证配置 */
  export interface AuthConfig {
    /** 认证类型 */
    type: "jwt" | "api-key" | "oauth" | "session";
    /** JWT配置 */
    jwt?: JwtConfig;
    /** API Key配置 */
    apiKey?: ApiKeyConfig;
    /** OAuth配置 */
    oauth?: OAuthConfig;
    /** 会话配置 */
    session?: SessionConfig;
  }

  /** JWT配置 */
  export interface JwtConfig {
    /** 密钥 */
    secret: string;
    /** 过期时间 */
    expiresIn: string;
    /** 签发者 */
    issuer?: string;
    /** 受众 */
    audience?: string;
    /** 算法 */
    algorithm?: string;
    /** 刷新Token过期时间 */
    refreshExpiresIn?: string;
  }

  /** API Key配置 */
  export interface ApiKeyConfig {
    /** 请求头名称 */
    header: string;
    /** 是否允许查询参数传递 */
    allowQueryParam?: boolean;
    /** 查询参数名称 */
    queryParamName?: string;
  }

  /** OAuth配置 */
  export interface OAuthConfig {
    /** 提供商列表 */
    providers: Array<{
      name: string;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      scopes?: string[];
    }>;
  }

  /** 会话配置 */
  export interface SessionConfig {
    /** 会话过期时间 (秒) */
    expiresIn: number;
    /** 是否滚动更新 */
    rolling: boolean;
    /** Cookie名称 */
    cookieName?: string;
    /** Cookie配置 */
    cookie?: {
      secure?: boolean;
      httpOnly?: boolean;
      sameSite?: "strict" | "lax" | "none";
      maxAge?: number;
    };
  }

  /** 日志配置 */
  export interface LoggingConfig {
    /** 日志级别 */
    level: LogLevel;
    /** 输出格式 */
    format: "json" | "pretty" | "structured";
    /** 输出目标 */
    destinations: LogDestination[];
    /** 是否包含堆栈跟踪 */
    includeStackTrace?: boolean;
    /** 敏感字段过滤 */
    redactFields?: string[];
  }

  /** 日志输出目标 */
  export interface LogDestination {
    /** 目标类型 */
    type: "console" | "file" | "http" | "syslog";
    /** 文件路径 (type=file时) */
    path?: string;
    /** HTTP端点 (type=http时) */
    url?: string;
    /** 最大文件大小 */
    maxSize?: string;
    /** 最大文件数 */
    maxFiles?: number;
    /** 日志格式模板 */
    format?: string;
  }

  /** 服务配置 */
  export interface ServicesConfig {
    /** 网关配置 */
    gateway: GatewayConfig;
    /** 进程管理器配置 */
    processManager: ProcessManagerConfig;
    /** 模型路由器配置 */
    modelRouter: ModelRouterConfig;
    /** 通道网关配置 */
    channelGateway: ChannelGatewayConfig;
    /** 记忆服务配置 */
    memory: MemoryConfig;
    /** 蜂群编排器配置 */
    swarm: SwarmConfig;
    /** 安全服务配置 */
    security?: SecurityConfig;
  }

  /** 网关配置 */
  export interface GatewayConfig {
    /** 速率限制 */
    rateLimit: RateLimitConfig;
    /** 请求体大小限制 */
    bodyLimit?: string;
    /** 超时配置 */
    timeout?: {
      request: number;
      response: number;
    };
  }

  /** 速率限制配置 */
  export interface RateLimitConfig {
    /** 每分钟请求数 */
    requestsPerMinute: number;
    /** 突发请求数 */
    burst: number;
    /** 按IP限制 */
    perIp?: boolean;
    /** 按用户限制 */
    perUser?: boolean;
  }

  /** 进程管理器配置 */
  export interface ProcessManagerConfig {
    /** 运行时 */
    runtime: "nodejs" | "rust" | "python" | "deno";
    /** 最大并发进程数 */
    maxConcurrent: number;
    /** 默认超时 (ms) */
    defaultTimeout: number;
    /** 重启策略 */
    restartPolicy: RestartPolicy;
    /** 资源限制 */
    resourceLimits?: {
      memory?: string;
      cpu?: string;
    };
  }

  /** 重启策略 */
  export interface RestartPolicy {
    /** 最大重试次数 */
    maxRetries: number;
    /** 退避策略 */
    backoff: "exponential" | "linear" | "fixed";
    /** 最大退避时间 (ms) */
    maxBackoff?: number;
    /** 初始退避时间 (ms) */
    initialBackoff?: number;
  }

  /** 模型路由器配置 */
  export interface ModelRouterConfig {
    /** 配置文件路径 */
    configPath: string;
    /** 健康检查间隔 (ms) */
    healthCheckInterval: number;
    /** 负载均衡策略 */
    loadBalancing?: "round-robin" | "weighted" | "least-connections" | "adaptive";
    /** 熔断配置 */
    circuitBreaker?: {
      failureThreshold: number;
      recoveryTimeout: number;
      halfOpenMaxCalls: number;
    };
  }

  /** 通道网关配置 */
  export interface ChannelGatewayConfig {
    /** 适配器目录 */
    adaptersDir: string;
    /** 队列配置 */
    queue: QueueConfig;
    /** 重试配置 */
    retry?: {
      maxAttempts: number;
      backoff: number;
    };
  }

  /** 队列配置 */
  export interface QueueConfig {
    /** 队列类型 */
    type: "memory" | "bullmq" | "redis" | "sqs";
    /** 入站并发数 */
    inboundConcurrency: number;
    /** 出站并发数 */
    outboundConcurrency: number;
    /** Redis连接 (type=redis|bullmq时) */
    redis?: {
      host: string;
      port: number;
      password?: string;
      db?: number;
    };
  }

  /** 记忆服务配置 */
  export interface MemoryConfig {
    /** 数据库配置 */
    database: DatabaseConfig;
    /** Embedding配置 */
    embedding: EmbeddingConfig;
    /** 压缩配置 */
    compression: CompressionConfig;
    /** 检索配置 */
    retrieval?: {
      topK: number;
      similarityThreshold: number;
      maxContextLength: number;
    };
  }

  /** 数据库配置 */
  export interface DatabaseConfig {
    /** 数据库类型 */
    type: "sqlite" | "postgresql" | "mysql" | "mongodb";
    /** SQLite配置 */
    sqlite?: { path: string; busyTimeout?: number };
    /** PostgreSQL配置 */
    postgresql?: {
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
      ssl?: boolean;
      poolSize?: number;
    };
    /** MySQL配置 */
    mysql?: {
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
    };
    /** MongoDB配置 */
    mongodb?: {
      uri: string;
      database: string;
    };
  }

  /** Embedding配置 */
  export interface EmbeddingConfig {
    /** 提供商 */
    provider: "local" | "openai" | "custom";
    /** 本地模型 */
    local?: { model: string; device?: "cpu" | "gpu" };
    /** OpenAI配置 */
    openai?: { model: string; apiKey?: string };
    /** 自定义配置 */
    custom?: { endpoint: string; apiKey?: string; model: string };
    /** 向量维度 */
    dimensions?: number;
  }

  /** 压缩配置 */
  export interface CompressionConfig {
    /** 是否启用 */
    enabled: boolean;
    /** 压缩阈值天数 */
    thresholdDays: number;
    /** 归档天数 */
    archiveAfterDays: number;
    /** 压缩策略 */
    strategy?: "summary" | "extract" | "compress";
  }

  /** 蜂群编排器配置 */
  export interface SwarmConfig {
    /** 最大并行Agent数 */
    maxParallelAgents: number;
    /** 默认超时 (ms) */
    defaultTimeout: number;
    /** 调度策略 */
    scheduling: SchedulingConfig;
    /** 升级策略 */
    escalation: EscalationConfig;
    /** 协作模式 */
    collaboration?: {
      strategy: "best-of-n" | "ensemble" | "debate" | "sequential";
      consensusThreshold?: number;
    };
  }

  /** 调度配置 */
  export interface SchedulingConfig {
    /** 调度策略 */
    strategy: "priority-queue" | "round-robin" | "fair-share" | "earliest-deadline";
    /** 是否允许抢占 */
    preemption: boolean;
    /** 优先级权重 */
    priorityWeights?: {
      user: number;
      system: number;
      background: number;
    };
  }

  /** 升级配置 */
  export interface EscalationConfig {
    /** 失败阈值 */
    threshold: number;
    /** 升级动作 */
    action: "notify-admin" | "auto-scale" | "degrade" | "circuit-break";
    /** 通知渠道 */
    notifyChannels?: NotificationChannel[];
  }

  /** 安全配置 */
  export interface SecurityConfig {
    /** CORS配置 */
    cors?: CorsConfig;
    /** 速率限制 */
    rateLimit?: RateLimitConfig;
    /** 内容安全策略 */
    csp?: string;
    /** 允许的MIME类型 */
    allowedMimeTypes?: string[];
    /** 最大上传大小 */
    maxUploadSize?: string;
    /** IP黑名单 */
    ipBlacklist?: string[];
    /** IP白名单 */
    ipWhitelist?: string[];
  }
}

// 顶层导出别名
export type Config = ConfigModule.Config;
export type ServerConfig = ConfigModule.ServerConfig;
export type CorsConfig = ConfigModule.CorsConfig;
export type AuthConfig = ConfigModule.AuthConfig;
export type JwtConfig = ConfigModule.JwtConfig;
export type ApiKeyConfig = ConfigModule.ApiKeyConfig;
export type OAuthConfig = ConfigModule.OAuthConfig;
export type SessionConfig = ConfigModule.SessionConfig;
export type LoggingConfig = ConfigModule.LoggingConfig;
export type LogDestination = ConfigModule.LogDestination;
export type ServicesConfig = ConfigModule.ServicesConfig;
export type GatewayConfig = ConfigModule.GatewayConfig;
export type RateLimitConfig = ConfigModule.RateLimitConfig;
export type ProcessManagerConfig = ConfigModule.ProcessManagerConfig;
export type RestartPolicy = ConfigModule.RestartPolicy;
export type ModelRouterConfig = ConfigModule.ModelRouterConfig;
export type ChannelGatewayConfig = ConfigModule.ChannelGatewayConfig;
export type QueueConfig = ConfigModule.QueueConfig;
export type MemoryConfig = ConfigModule.MemoryConfig;
export type DatabaseConfig = ConfigModule.DatabaseConfig;
export type EmbeddingConfig = ConfigModule.EmbeddingConfig;
export type CompressionConfig = ConfigModule.CompressionConfig;
export type SwarmConfig = ConfigModule.SwarmConfig;
export type SchedulingConfig = ConfigModule.SchedulingConfig;
export type EscalationConfig = ConfigModule.EscalationConfig;
export type SecurityConfig = ConfigModule.SecurityConfig;

// ============================================================================
// 服务层类型
// ============================================================================

export namespace ServiceModule {
  /** 服务消息 - 服务间通信格式 */
  export interface ServiceMessage {
    /** 消息唯一标识符 */
    id: UUID;
    /** 源服务名 */
    source: string;
    /** 目标服务名 */
    target: string | "broadcast";
    /** 消息类型 */
    type: "request" | "response" | "event" | "error" | "heartbeat";
    /** 主题 */
    topic: string;
    /** 消息负载 */
    payload: Record<string, unknown>;
    /** 时间戳 (ms) */
    timestamp: Timestamp;
    /** 消息过期时间 (ms) */
    ttl?: number;
    /** 优先级 */
    priority?: number;
    /** 关联的追踪ID */
    traceId?: UUID;
  }

  /** 服务错误 */
  export interface ServiceError {
    /** 错误码 */
    code: string;
    /** 源服务 */
    service: string;
    /** 错误消息 */
    message: string;
    /** 详细错误信息 */
    details?: Record<string, unknown>;
    /** 是否可重试 */
    retryable: boolean;
    /** 建议操作 */
    suggestedAction?: string;
    /** 追踪ID */
    traceId?: UUID;
  }

  /** 服务状态 (运行时) */
  export interface ServiceRuntimeStatus {
    /** 服务名称 */
    name: string;
    /** 版本 */
    version: string;
    /** 状态 */
    status: "running" | "stopped" | "crashed" | "starting" | "unknown";
    /** 启动时间 */
    startedAt?: Timestamp;
    /** PID */
    pid?: number;
    /** 内存使用 (bytes) */
    memoryUsage?: number;
    /** CPU使用率 */
    cpuUsage?: number;
    /** 最后心跳 */
    lastHeartbeat?: Timestamp;
  }
}

// 顶层导出别名
export type ServiceMessage = ServiceModule.ServiceMessage;
export type ServiceError = ServiceModule.ServiceError;
export type ServiceRuntimeStatus = ServiceModule.ServiceRuntimeStatus;

// ============================================================================
// 工具/进程类型
// ============================================================================

export namespace ToolModule {
  /** 工具进程状态 */
  export type ToolProcessState =
    | "spawning"
    | "running"
    | "success"
    | "failed"
    | "timeout"
    | "cancelled"
    | "pending";

  /** 工具进程 */
  export interface ToolProcess {
    /** 进程唯一标识符 */
    id: UUID;
    /** 工具名称 */
    toolName: string;
    /** 操作系统进程ID */
    pid: number;
    /** 当前状态 */
    state: ToolProcessState;
    /** 开始时间戳 (ms) */
    startTime: Timestamp;
    /** 超时时间 (ms) */
    timeoutMs: number;
    /** 退出码 */
    exitCode?: number;
    /** 标准输出缓冲区 */
    outputBuffer: string[];
    /** 标准错误缓冲区 */
    errorBuffer: string[];
    /** 标准输出流 */
    stdout?: NodeJS.ReadableStream;
    /** 标准错误流 */
    stderr?: NodeJS.ReadableStream;
    /** 标准输入流 */
    stdin?: NodeJS.WritableStream;
    /** 关联的会话ID */
    sessionId?: UUID;
    /** 关联的Agent ID */
    agentId?: UUID;
  }

  /** 进程输出 */
  export interface ProcessOutput {
    /** 进程ID */
    processId: UUID;
    /** 输出行 */
    line: string;
    /** 是否为错误输出 */
    isError: boolean;
    /** 时间戳 (ms) */
    timestamp: Timestamp;
    /** 是否为最终输出 */
    isFinal?: boolean;
  }

  /** 工具定义 */
  export interface ToolDefinition {
    /** 工具名称 */
    name: string;
    /** 工具描述 */
    description: string;
    /** 参数定义 */
    parameters: {
      type: "object";
      properties: Record<string, {
        type: string;
        description?: string;
        enum?: unknown[];
        default?: unknown;
      }>;
      required?: string[];
    };
    /** 返回类型 */
    returns?: {
      type: string;
      description?: string;
    };
  }
}

// 顶层导出别名
export type ToolProcessState = ToolModule.ToolProcessState;
export type ToolProcess = ToolModule.ToolProcess;
export type ProcessOutput = ToolModule.ProcessOutput;
export type ToolDefinition = ToolModule.ToolDefinition;

// ============================================================================
// 蜂群/任务类型
// ============================================================================

export namespace SwarmModule {
  /** 蜂群任务类型 */
  export type SwarmTaskType = "single" | "parallel" | "sequential" | "voting" | "debate" | "ensemble";

  /** 蜂群策略模式 */
  export type SwarmMode = "competition" | "collaboration" | "verification" | "hybrid";

  /** 聚合策略 */
  export type AggregationStrategy = "best" | "merge" | "vote" | "all" | "consensus" | "rank";

  /** 蜂群任务 */
  export interface SwarmTask {
    /** 任务唯一标识符 */
    id: UUID;
    /** 任务类型 */
    type: SwarmTaskType;
    /** 任务目标描述 */
    objective: string;
    /** 参与的Agent配置 */
    agents: AgentModule.AgentConfig[];
    /** 策略配置 */
    strategy: SwarmStrategy;
    /** 任务上下文 */
    context: TaskContext;
    /** 优先级 (0-10) */
    priority?: number;
    /** 截止时间 */
    deadline?: Timestamp;
    /** 标签 */
    tags?: string[];
  }

  /** 蜂群策略 */
  export interface SwarmStrategy {
    /** 协作模式 */
    mode: SwarmMode;
    /** 结果聚合方式 */
    aggregation: AggregationStrategy;
    /** 超时时间 (ms) */
    timeout: number;
    /** 最大重试次数 */
    maxRetries: number;
    /** 共识阈值 (0-1) */
    consensusThreshold?: number;
    /** 评分维度 */
    scoringDimensions?: string[];
  }

  /** 任务上下文 */
  export interface TaskContext {
    /** 关联的会话ID */
    sessionId?: UUID;
    /** 关联的用户ID */
    userId?: UUID;
    /** 关联的通道ID */
    channelId?: UUID;
    /** 额外上下文数据 */
    data?: Record<string, unknown>;
    /** 参考文档 */
    references?: string[];
    /** 约束条件 */
    constraints?: string[];
  }

  /** Agent输出 */
  export interface AgentOutput {
    /** Agent ID */
    agentId: UUID;
    /** 输出内容 */
    output: string;
    /** 置信度 (0-1) */
    confidence?: number;
    /** 执行时间 (ms) */
    executionTime: number;
    /** 状态 */
    status: "success" | "partial" | "failed" | "skipped";
    /** 评分详情 */
    scores?: ScoreDetail[];
    /** 元数据 */
    metadata?: Record<string, unknown>;
  }

  /** 蜂群结果 */
  export interface SwarmResult {
    /** 关联的任务ID */
    taskId: UUID;
    /** 任务状态 */
    status: "completed" | "partial" | "failed" | "cancelled";
    /** 各Agent输出 */
    outputs: AgentOutput[];
    /** 共识结果 */
    consensus?: ConsensusResult;
    /** 冲突报告 */
    conflicts?: ConflictReport[];
    /** 最终输出 */
    finalOutput?: string;
    /** 总执行时间 (ms) */
    executionTime: number;
    /** 开始时间 */
    startedAt: Timestamp;
    /** 结束时间 */
    completedAt?: Timestamp;
  }

  /** 共识结果 */
  export interface ConsensusResult {
    /** 获胜的Agent ID */
    winnerId?: UUID;
    /** 共识分数 (0-1) */
    score: number;
    /** 投票分布 */
    votes: Record<string, number>;
    /** 是否达成强共识 */
    strongConsensus: boolean;
  }

  /** 冲突报告 */
  export interface ConflictReport {
    /** 冲突ID */
    id: UUID;
    /** 冲突类型 */
    type: "fact" | "opinion" | "semantic" | "logical" | "coverage";
    /** 涉及的Agent ID列表 */
    agentIds: UUID[];
    /** 冲突描述 */
    description: string;
    /** 严重程度 (0-1) */
    severity: number;
    /** 建议解决方案 */
    suggestedResolution?: string;
  }
}

// 顶层导出别名
export type SwarmTaskType = SwarmModule.SwarmTaskType;
export type SwarmMode = SwarmModule.SwarmMode;
export type AggregationStrategy = SwarmModule.AggregationStrategy;
export type SwarmTask = SwarmModule.SwarmTask;
export type SwarmStrategy = SwarmModule.SwarmStrategy;
export type TaskContext = SwarmModule.TaskContext;
export type AgentOutput = SwarmModule.AgentOutput;
export type SwarmResult = SwarmModule.SwarmResult;
export type ConsensusResult = SwarmModule.ConsensusResult;
export type ConflictReport = SwarmModule.ConflictReport;

// ============================================================================
// 通道适配器类型
// ============================================================================

export namespace AdapterModule {
  /** 统一消息 - 跨通道标准化消息格式 */
  export interface UnifiedMessage {
    /** Sylva内部UUID */
    id: UUID;
    /** 通道类型 */
    channelType: string;
    /** 通道标识 */
    channelId: string;
    /** 发送者 */
    sender: MessageSender;
    /** 消息内容 */
    content: MessageContent;
    /** 时间戳 (ms) */
    timestamp: Timestamp;
    /** 元数据 */
    metadata: MessageMetadata;
    /** 原始消息ID */
    rawMessageId?: string;
    /** 是否已处理 */
    processed: boolean;
  }

  /** 适配器配置 */
  export interface AdapterConfig {
    /** 适配器名称 */
    name: string;
    /** 是否启用 */
    enabled: boolean;
    /** 凭证信息 */
    credentials?: Record<string, string>;
    /** 额外配置 */
    options?: Record<string, unknown>;
    /** 支持的通道类型 */
    supportedChannelTypes?: string[];
    /** 版本 */
    version?: string;
  }

  /** 发送结果 */
  export interface SendResult {
    /** 是否成功 */
    success: boolean;
    /** 消息ID */
    messageId?: string;
    /** 错误信息 */
    error?: string;
    /** 响应时间 (ms) */
    responseTime?: number;
    /** 原始响应 */
    rawResponse?: Record<string, unknown>;
  }

  /** 适配器状态 */
  export interface AdapterStatus {
    /** 适配器名称 */
    name: string;
    /** 是否启用 */
    enabled: boolean;
    /** 连接状态 */
    connected: boolean;
    /** 最后连接时间 */
    lastConnectedAt?: Timestamp;
    /** 最后断开时间 */
    lastDisconnectedAt?: Timestamp;
    /** 错误计数 */
    errorCount: number;
    /** 总消息数 */
    totalMessages: number;
    /** 平均响应时间 */
    avgResponseTime: number;
  }
}

// 顶层导出别名
export type UnifiedMessage = AdapterModule.UnifiedMessage;
export type AdapterConfig = AdapterModule.AdapterConfig;
export type SendResult = AdapterModule.SendResult;
export type AdapterStatus = AdapterModule.AdapterStatus;

// ============================================================================
// Handoff Gateway 类型
// ============================================================================

export * from "./handoff";

// ============================================================================
// 保留旧API名称的向后兼容别名
// ============================================================================

/** @deprecated 使用 ErrorResponse */
export type ApiErrorResponse = ErrorResponse;

/** @deprecated 使用 ApiResponse<T> */
export type ApiSuccessResponse<T> = ApiResponse<T>;
