/**
 * WebSocket Manager Stub
 * Provides initWebSocket and getWebSocketManager for server.ts and push.ts
 */

import type { Server } from "http";

export interface WebSocketManager {
  pushToAgent(agentId: string, event: unknown): void;
  pushToTask(taskId: string, event: unknown): void;
  pushToGroup(groupId: string, event: unknown): void;
  pushSystem(event: unknown): void;
  broadcast(event: unknown): void;
  broadcastToRoom(room: string, event: unknown): void;
}

let manager: WebSocketManager | null = null;

class NoopWebSocketManager implements WebSocketManager {
  pushToAgent(_agentId: string, _event: unknown): void { /* noop */ }
  pushToTask(_taskId: string, _event: unknown): void { /* noop */ }
  pushToGroup(_groupId: string, _event: unknown): void { /* noop */ }
  pushSystem(_event: unknown): void { /* noop */ }
  broadcast(_event: unknown): void { /* noop */ }
  broadcastToRoom(_room: string, _event: unknown): void { /* noop */ }
}

export function getWebSocketManager(): WebSocketManager {
  if (!manager) {
    manager = new NoopWebSocketManager();
  }
  return manager;
}

export function initWebSocket(server: Server, _path: string): void {
  // Stub: WebSocket initialization
  // In production, this would initialize a real WebSocket server
  manager = new NoopWebSocketManager();
  console.log(`[WebSocket] Stub initialized on server`);
}
