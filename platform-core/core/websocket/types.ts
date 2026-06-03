/**
 * WebSocket Event Types
 * Type definitions for WebSocket push events
 */

import type { TaskResult, AgentStatus, AgentHealth } from '../coordinator/unified/types';

export type { TaskResult, AgentStatus, AgentHealth };

// ── Server Events ─────────────────────────────────

export interface ServerEvent {
  type: string;
  [key: string]: unknown;
}

export interface AgentStatusEvent extends ServerEvent {
  type: 'agent.status';
  agentId: string;
  status: AgentStatus;
}

export interface AgentHealthEvent extends ServerEvent {
  type: 'agent.health';
  agentId: string;
  health: AgentHealth;
}

export interface TaskStartedEvent extends ServerEvent {
  type: 'task.started';
  taskId: string;
  agentId: string;
  timestamp: number;
}

export interface TaskProgressEvent extends ServerEvent {
  type: 'task.progress';
  taskId: string;
  delta: string;
}

export interface TaskCompleteEvent extends ServerEvent {
  type: 'task.complete';
  taskId: string;
  result: TaskResult;
}

export interface TaskErrorEvent extends ServerEvent {
  type: 'task.error';
  taskId: string;
  error: string;
}

export interface GroupMeetingEvent extends ServerEvent {
  type: 'group.meeting';
  groupId: string;
  meeting: MeetingInfo;
}

export interface GroupRelayEvent extends ServerEvent {
  type: 'group.relay';
  groupId: string;
  relay: RelayInfo;
}

export interface GroupConflictEvent extends ServerEvent {
  type: 'group.conflict';
  groupId: string;
  conflict: ConflictInfo;
}

export interface SystemAlertEvent extends ServerEvent {
  type: 'system.alert';
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

export interface LogEvent extends ServerEvent {
  type: 'log.entry';
  id: string;
  timestamp: string;
  agent: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

// ── Info Types ─────────────────────────────────

export interface MeetingInfo {
  id: string;
  participants: string[];
  topic: string;
  status: 'active' | 'closed';
  startedAt: number;
}

export interface RelayInfo {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  timestamp: number;
}

export interface ConflictInfo {
  id: string;
  agents: string[];
  issue: string;
  severity: 'low' | 'medium' | 'high';
  timestamp: number;
}
