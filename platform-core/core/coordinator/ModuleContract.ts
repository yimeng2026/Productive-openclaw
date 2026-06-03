/**
 * ModuleContract — 功能模块接口契约定义
 * 所有 y轴功能模块必须实现此契约，才能接入 3DACP 统一路由
 */

import type { ActionVerb, ModuleId } from '../coordinator/AxisMessage';

// ───────────────────────── 契约类型 ─────────────────────────

export interface ActionContract {
  name: string;
  verb: ActionVerb;
  description: string;
  /** JSON Schema（或 Zod Schema 引用路径） */
  inputSchema: string;
  outputSchema: string;
  /** 是否流式 */
  streaming: boolean;
  /** 是否幂等 */
  idempotent: boolean;
}

export interface EventContract {
  name: string;
  description: string;
  payloadSchema: string;
}

export interface StreamContract {
  name: string;
  description: string;
  chunkSchema: string;
}

export interface ModuleContract {
  moduleId: ModuleId;
  description: string;
  version: string;
  /** 支持的动作 */
  actions: ActionContract[];
  /** 支持的事件 */
  events: EventContract[];
  /** 支持的流 */
  streams: StreamContract[];
  /** 该模块的协议偏好 */
  preferredProtocol?: 'rest' | 'sse' | 'ws' | 'internal';
  /** 是否需要流式传输 */
  requiresStreaming?: boolean;
}

// ───────────────────────── Dialog 模块契约 ─────────────────────────

export const DialogContract: ModuleContract = {
  moduleId: 'dialog',
  description: '对话管理模块：创建对话、发送消息、获取历史、流式响应',
  version: '1.0.0',
  actions: [
    { name: 'create', verb: 'create', description: '创建新对话', inputSchema: 'DialogCreateSchema', outputSchema: 'DialogSchema', streaming: false, idempotent: false },
    { name: 'sendMessage', verb: 'invoke', description: '发送消息并获取响应', inputSchema: 'MessageSchema', outputSchema: 'MessageSchema', streaming: true, idempotent: false },
    { name: 'getHistory', verb: 'read', description: '获取对话历史', inputSchema: 'PaginationSchema', outputSchema: 'MessageListSchema', streaming: false, idempotent: true },
    { name: 'attachFile', verb: 'invoke', description: '附加文件到对话', inputSchema: 'FileSchema', outputSchema: 'AttachmentSchema', streaming: false, idempotent: false },
    { name: 'updateTitle', verb: 'update', description: '更新对话标题', inputSchema: 'TitleUpdateSchema', outputSchema: 'DialogSchema', streaming: false, idempotent: true },
    { name: 'delete', verb: 'delete', description: '删除对话', inputSchema: 'DialogIdSchema', outputSchema: 'DeleteResultSchema', streaming: false, idempotent: true },
  ],
  events: [
    { name: 'messageReceived', description: '收到新消息', payloadSchema: 'MessageSchema' },
    { name: 'agentTyping', description: 'Agent 正在输入', payloadSchema: 'AgentTypingSchema' },
    { name: 'streamStart', description: '流式响应开始', payloadSchema: 'StreamStartSchema' },
    { name: 'streamEnd', description: '流式响应结束', payloadSchema: 'StreamEndSchema' },
  ],
  streams: [
    { name: 'responseStream', description: 'Agent 流式响应', chunkSchema: 'StreamChunkSchema' },
  ],
  preferredProtocol: 'ws',
  requiresStreaming: true,
};

// ───────────────────────── Agent 模块契约 ─────────────────────────

export const AgentContract: ModuleContract = {
  moduleId: 'agent',
  description: 'Agent 管理模块：CRUD、状态管理、配置',
  version: '1.0.0',
  actions: [
    { name: 'create', verb: 'create', description: '创建 Agent', inputSchema: 'AgentCreateSchema', outputSchema: 'AgentSchema', streaming: false, idempotent: false },
    { name: 'get', verb: 'read', description: '获取 Agent 详情', inputSchema: 'AgentIdSchema', outputSchema: 'AgentSchema', streaming: false, idempotent: true },
    { name: 'list', verb: 'read', description: '列出所有 Agent', inputSchema: 'FilterSchema', outputSchema: 'AgentListSchema', streaming: false, idempotent: true },
    { name: 'update', verb: 'update', description: '更新 Agent 配置', inputSchema: 'AgentUpdateSchema', outputSchema: 'AgentSchema', streaming: false, idempotent: true },
    { name: 'delete', verb: 'delete', description: '删除 Agent', inputSchema: 'AgentIdSchema', outputSchema: 'DeleteResultSchema', streaming: false, idempotent: true },
    { name: 'clone', verb: 'create', description: '克隆 Agent', inputSchema: 'AgentCloneSchema', outputSchema: 'AgentSchema', streaming: false, idempotent: false },
    { name: 'import', verb: 'create', description: '导入 Agent', inputSchema: 'AgentImportSchema', outputSchema: 'AgentSchema', streaming: false, idempotent: false },
    { name: 'pause', verb: 'update', description: '暂停 Agent', inputSchema: 'AgentIdSchema', outputSchema: 'AgentSchema', streaming: false, idempotent: true },
    { name: 'resume', verb: 'update', description: '恢复 Agent', inputSchema: 'AgentIdSchema', outputSchema: 'AgentSchema', streaming: false, idempotent: true },
  ],
  events: [
    { name: 'statusChanged', description: 'Agent 状态变化', payloadSchema: 'AgentStatusSchema' },
    { name: 'created', description: 'Agent 已创建', payloadSchema: 'AgentSchema' },
    { name: 'deleted', description: 'Agent 已删除', payloadSchema: 'AgentIdSchema' },
  ],
  streams: [],
  preferredProtocol: 'rest',
  requiresStreaming: false,
};

// ───────────────────────── Group 模块契约 ─────────────────────────

export const GroupContract: ModuleContract = {
  moduleId: 'group',
  description: '群组管理模块：Agent 群组创建、编排、调度',
  version: '1.0.0',
  actions: [
    { name: 'create', verb: 'create', description: '创建群组', inputSchema: 'GroupCreateSchema', outputSchema: 'GroupSchema', streaming: false, idempotent: false },
    { name: 'get', verb: 'read', description: '获取群组详情', inputSchema: 'GroupIdSchema', outputSchema: 'GroupSchema', streaming: false, idempotent: true },
    { name: 'list', verb: 'read', description: '列出群组', inputSchema: 'FilterSchema', outputSchema: 'GroupListSchema', streaming: false, idempotent: true },
    { name: 'update', verb: 'update', description: '更新群组', inputSchema: 'GroupUpdateSchema', outputSchema: 'GroupSchema', streaming: false, idempotent: true },
    { name: 'delete', verb: 'delete', description: '删除群组', inputSchema: 'GroupIdSchema', outputSchema: 'DeleteResultSchema', streaming: false, idempotent: true },
    { name: 'addAgent', verb: 'update', description: '添加 Agent 到群组', inputSchema: 'GroupAgentSchema', outputSchema: 'GroupSchema', streaming: false, idempotent: false },
    { name: 'removeAgent', verb: 'update', description: '从群组移除 Agent', inputSchema: 'GroupAgentSchema', outputSchema: 'GroupSchema', streaming: false, idempotent: false },
    { name: 'reorder', verb: 'update', description: '重新排序 Agent', inputSchema: 'GroupReorderSchema', outputSchema: 'GroupSchema', streaming: false, idempotent: true },
    { name: 'orchestrate', verb: 'invoke', description: '触发群组编排', inputSchema: 'OrchestrateSchema', outputSchema: 'OrchestrateResultSchema', streaming: true, idempotent: false },
  ],
  events: [
    { name: 'agentJoined', description: 'Agent 加入群组', payloadSchema: 'GroupAgentSchema' },
    { name: 'agentLeft', description: 'Agent 离开群组', payloadSchema: 'GroupAgentSchema' },
    { name: 'orchestrationStarted', description: '编排开始', payloadSchema: 'OrchestrateSchema' },
    { name: 'orchestrationCompleted', description: '编排完成', payloadSchema: 'OrchestrateResultSchema' },
  ],
  streams: [
    { name: 'orchestrationStream', description: '编排过程流式输出', chunkSchema: 'StreamChunkSchema' },
  ],
  preferredProtocol: 'ws',
  requiresStreaming: true,
};

// ───────────────────────── Knowledge 模块契约 ─────────────────────────

export const KnowledgeContract: ModuleContract = {
  moduleId: 'knowledge',
  description: '知识库管理模块：文档上传、索引、检索',
  version: '1.0.0',
  actions: [
    { name: 'create', verb: 'create', description: '创建知识库', inputSchema: 'KnowledgeCreateSchema', outputSchema: 'KnowledgeSchema', streaming: false, idempotent: false },
    { name: 'get', verb: 'read', description: '获取知识库', inputSchema: 'KnowledgeIdSchema', outputSchema: 'KnowledgeSchema', streaming: false, idempotent: true },
    { name: 'list', verb: 'read', description: '列出知识库', inputSchema: 'FilterSchema', outputSchema: 'KnowledgeListSchema', streaming: false, idempotent: true },
    { name: 'update', verb: 'update', description: '更新知识库', inputSchema: 'KnowledgeUpdateSchema', outputSchema: 'KnowledgeSchema', streaming: false, idempotent: true },
    { name: 'delete', verb: 'delete', description: '删除知识库', inputSchema: 'KnowledgeIdSchema', outputSchema: 'DeleteResultSchema', streaming: false, idempotent: true },
    { name: 'uploadDocument', verb: 'invoke', description: '上传文档', inputSchema: 'DocumentUploadSchema', outputSchema: 'DocumentSchema', streaming: false, idempotent: false },
    { name: 'search', verb: 'read', description: '语义检索', inputSchema: 'SearchQuerySchema', outputSchema: 'SearchResultSchema', streaming: false, idempotent: true },
    { name: 'index', verb: 'invoke', description: '触发索引', inputSchema: 'KnowledgeIdSchema', outputSchema: 'IndexResultSchema', streaming: false, idempotent: true },
  ],
  events: [
    { name: 'documentIndexed', description: '文档索引完成', payloadSchema: 'DocumentSchema' },
    { name: 'indexProgress', description: '索引进度', payloadSchema: 'ProgressSchema' },
  ],
  streams: [],
  preferredProtocol: 'rest',
  requiresStreaming: false,
};

// ───────────────────────── Skill 模块契约 ─────────────────────────

export const SkillContract: ModuleContract = {
  moduleId: 'skill',
  description: '技能管理模块：工具注册、调用、编排',
  version: '1.0.0',
  actions: [
    { name: 'create', verb: 'create', description: '注册技能', inputSchema: 'SkillCreateSchema', outputSchema: 'SkillSchema', streaming: false, idempotent: false },
    { name: 'get', verb: 'read', description: '获取技能', inputSchema: 'SkillIdSchema', outputSchema: 'SkillSchema', streaming: false, idempotent: true },
    { name: 'list', verb: 'read', description: '列出技能', inputSchema: 'FilterSchema', outputSchema: 'SkillListSchema', streaming: false, idempotent: true },
    { name: 'update', verb: 'update', description: '更新技能', inputSchema: 'SkillUpdateSchema', outputSchema: 'SkillSchema', streaming: false, idempotent: true },
    { name: 'delete', verb: 'delete', description: '删除技能', inputSchema: 'SkillIdSchema', outputSchema: 'DeleteResultSchema', streaming: false, idempotent: true },
    { name: 'invoke', verb: 'invoke', description: '调用技能', inputSchema: 'SkillInvokeSchema', outputSchema: 'SkillResultSchema', streaming: false, idempotent: false },
  ],
  events: [
    { name: 'invoked', description: '技能被调用', payloadSchema: 'SkillInvokeSchema' },
    { name: 'executionFailed', description: '技能执行失败', payloadSchema: 'ErrorSchema' },
  ],
  streams: [],
  preferredProtocol: 'rest',
  requiresStreaming: false,
};

// ───────────────────────── Monitor 模块契约 ─────────────────────────

export const MonitorContract: ModuleContract = {
  moduleId: 'monitor',
  description: '监控模块：实时指标、日志、拓扑、告警',
  version: '1.0.0',
  actions: [
    { name: 'getMetrics', verb: 'read', description: '获取实时指标', inputSchema: 'MetricsQuerySchema', outputSchema: 'MetricsSchema', streaming: false, idempotent: true },
    { name: 'getLogs', verb: 'read', description: '获取日志', inputSchema: 'LogsQuerySchema', outputSchema: 'LogsSchema', streaming: false, idempotent: true },
    { name: 'getTopology', verb: 'read', description: '获取拓扑图', inputSchema: 'TopologyQuerySchema', outputSchema: 'TopologySchema', streaming: false, idempotent: true },
    { name: 'getHandoffs', verb: 'read', description: '获取交接记录', inputSchema: 'HandoffQuerySchema', outputSchema: 'HandoffListSchema', streaming: false, idempotent: true },
    { name: 'getInterventions', verb: 'read', description: '获取人工干预记录', inputSchema: 'InterventionQuerySchema', outputSchema: 'InterventionListSchema', streaming: false, idempotent: true },
    { name: 'getTasks', verb: 'read', description: '获取任务列表', inputSchema: 'TaskQuerySchema', outputSchema: 'TaskListSchema', streaming: false, idempotent: true },
    { name: 'subscribeMetrics', verb: 'subscribe', description: '订阅指标更新', inputSchema: 'MetricsSubscribeSchema', outputSchema: 'SubscribeResultSchema', streaming: false, idempotent: true },
    { name: 'subscribeLogs', verb: 'subscribe', description: '订阅日志', inputSchema: 'LogsSubscribeSchema', outputSchema: 'SubscribeResultSchema', streaming: false, idempotent: true },
  ],
  events: [
    { name: 'metricAlert', description: '指标告警', payloadSchema: 'AlertSchema' },
    { name: 'nodeStatusChange', description: '节点状态变化', payloadSchema: 'NodeStatusSchema' },
    { name: 'newLog', description: '新日志', payloadSchema: 'LogEntrySchema' },
  ],
  streams: [
    { name: 'metricsStream', description: '实时指标流', chunkSchema: 'MetricsChunkSchema' },
    { name: 'logsStream', description: '实时日志流', chunkSchema: 'LogEntrySchema' },
  ],
  preferredProtocol: 'sse',
  requiresStreaming: true,
};

// ───────────────────────── Platform 模块契约 ─────────────────────────

export const PlatformContract: ModuleContract = {
  moduleId: 'platform',
  description: '平台管理模块：50+ 平台的注册、发现、健康检查',
  version: '1.0.0',
  actions: [
    { name: 'register', verb: 'create', description: '注册平台节点', inputSchema: 'PlatformRegisterSchema', outputSchema: 'PlatformSchema', streaming: false, idempotent: false },
    { name: 'get', verb: 'read', description: '获取平台信息', inputSchema: 'PlatformIdSchema', outputSchema: 'PlatformSchema', streaming: false, idempotent: true },
    { name: 'list', verb: 'read', description: '列出所有平台', inputSchema: 'FilterSchema', outputSchema: 'PlatformListSchema', streaming: false, idempotent: true },
    { name: 'heartbeat', verb: 'invoke', description: '心跳上报', inputSchema: 'HeartbeatSchema', outputSchema: 'HeartbeatResultSchema', streaming: false, idempotent: true },
    { name: 'unregister', verb: 'delete', description: '注销平台', inputSchema: 'PlatformIdSchema', outputSchema: 'DeleteResultSchema', streaming: false, idempotent: true },
    { name: 'discover', verb: 'read', description: '发现可用节点', inputSchema: 'DiscoverQuerySchema', outputSchema: 'PlatformListSchema', streaming: false, idempotent: true },
  ],
  events: [
    { name: 'nodeJoined', description: '节点加入', payloadSchema: 'PlatformSchema' },
    { name: 'nodeLeft', description: '节点离开', payloadSchema: 'PlatformIdSchema' },
    { name: 'nodeHealthChange', description: '节点健康变化', payloadSchema: 'PlatformHealthSchema' },
  ],
  streams: [],
  preferredProtocol: 'rest',
  requiresStreaming: false,
};

// ───────────────────────── 合约注册表 ─────────────────────────

export const ModuleContracts: Record<ModuleId, ModuleContract> = {
  dialog: DialogContract,
  agent: AgentContract,
  group: GroupContract,
  knowledge: KnowledgeContract,
  skill: SkillContract,
  monitor: MonitorContract,
  platform: PlatformContract,
};

export function getContract(moduleId: ModuleId): ModuleContract | undefined {
  return ModuleContracts[moduleId];
}

export function listContracts(): ModuleContract[] {
  return Object.values(ModuleContracts);
}

export function listModuleIds(): ModuleId[] {
  return Object.keys(ModuleContracts) as ModuleId[];
}
