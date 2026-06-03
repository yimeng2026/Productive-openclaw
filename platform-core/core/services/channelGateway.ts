import type { WebSocket } from "ws";
import { logger } from "../server";

/**
 * ChannelGateway - 通道网关
 * 负责 WebSocket 连接的广播、频道订阅管理。
 */
export class ChannelGateway {
  private clients = new Map<string, WebSocket>();

  register(clientId: string, ws: WebSocket): void {
    this.clients.set(clientId, ws);
    logger.info({ clientId, total: this.clients.size }, "Client registered");
  }

  unregister(clientId: string): void {
    this.clients.delete(clientId);
    logger.info({ clientId, total: this.clients.size }, "Client unregistered");
  }

  broadcast(message: unknown, exclude?: string): void {
    const payload = JSON.stringify(message);
    for (const [id, ws] of this.clients) {
      if (id === exclude) continue;
      if (ws.readyState === 1) {
        ws.send(payload);
      }
    }
  }

  sendTo(clientId: string, message: unknown): boolean {
    const ws = this.clients.get(clientId);
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(message));
    return true;
  }
}
