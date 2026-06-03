// websocket/push.ts — 状态推送便捷接口
// 供 TaskRouter、AgentRegistry、Group 面板等模块调用

import { getWebSocketManager } from './index';
import type {
  ServerEvent,
  AgentStatusEvent,
  AgentHealthEvent,
  TaskStartedEvent,
  TaskProgressEvent,
  TaskCompleteEvent,
  TaskErrorEvent,
  GroupMeetingEvent,
  GroupRelayEvent,
  GroupConflictEvent,
  SystemAlertEvent,
  LogEvent,
  MeetingInfo,
  RelayInfo,
  ConflictInfo,
} from './types';
import type { TaskResult, AgentStatus, AgentHealth } from '../coordinator/unified/types';

// ── 单例访问 ─────────────────────────────────

function ws() {
  return getWebSocketManager();
}

// ── Agent 推送 ─────────────────────────────────

export function pushAgentStatus(agentId: string, status: AgentStatus): void {
  const event: AgentStatusEvent = { type: 'agent.status', agentId, status };
  ws().pushToAgent(agentId, event);
  ws().pushSystem(event);
}

export function pushAgentHealth(agentId: string, health: AgentHealth): void {
  const event: AgentHealthEvent = { type: 'agent.health', agentId, health };
  ws().pushToAgent(agentId, event);
  ws().pushSystem(event);
}

// ── 任务推送 ─────────────────────────────────

export function pushTaskStarted(taskId: string, agentId: string): void {
  const event: TaskStartedEvent = {
    type: 'task.started',
    taskId,
    agentId,
    timestamp: Date.now(),
  };
  ws().pushToTask(taskId, event);
  ws().pushToAgent(agentId, event);
  ws().pushSystem(event);
}

export function pushTaskProgress(taskId: string, delta: string): void {
  const event: TaskProgressEvent = { type: 'task.progress', taskId, delta };
  ws().pushToTask(taskId, event);
}

export function pushTaskComplete(taskId: string, result: TaskResult): void {
  const event: TaskCompleteEvent = { type: 'task.complete', taskId, result };
  ws().pushToTask(taskId, event);
  ws().pushToAgent(result.agentId, event);
  ws().pushSystem(event);
}

export function pushTaskError(taskId: string, error: string, agentId?: string): void {
  const event: TaskErrorEvent = { type: 'task.error', taskId, error };
  ws().pushToTask(taskId, event);
  if (agentId) ws().pushToAgent(agentId, event);
  ws().pushSystem(event);
}

// ── 群组推送 ─────────────────────────────────

export function pushGroupMeeting(groupId: string, meeting: MeetingInfo): void {
  const event: GroupMeetingEvent = { type: 'group.meeting', groupId, meeting };
  ws().pushToGroup(groupId, event);
}

export function pushGroupRelay(groupId: string, relay: RelayInfo): void {
  const event: GroupRelayEvent = { type: 'group.relay', groupId, relay };
  ws().pushToGroup(groupId, event);
}

export function pushGroupConflict(groupId: string, conflict: ConflictInfo): void {
  const event: GroupConflictEvent = { type: 'group.conflict', groupId, conflict };
  ws().pushToGroup(groupId, event);
  ws().pushSystem(event);
}

// ── 日志推送 ─────────────────────────────────

export function pushLog(
  id: string,
  timestamp: string,
  agent: string,
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  message: string,
  source?: string,
  metadata?: Record<string, any>
): void {
  const event: LogEvent = {
    type: 'log.entry',
    id,
    timestamp,
    agent,
    level,
    message,
    source,
    metadata,
  };
  ws().broadcastToRoom('system', event);
}

// ── 系统推送 ─────────────────────────────────

export function pushSystemAlert(level: 'info' | 'warn' | 'error', message: string): void {
  const event: SystemAlertEvent = {
    type: 'system.alert',
    level,
    message,
    timestamp: Date.now(),
  };
  ws().pushSystem(event);
}

// ── 通用推送（原始事件）──────────────────────

export function broadcast(event: ServerEvent): void {
  ws().broadcast(event);
}

export function broadcastToRoom(room: string, event: ServerEvent): void {
  ws().broadcastToRoom(room, event);
}
