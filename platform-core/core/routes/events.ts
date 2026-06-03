// routes/events.ts — HTTP 轮询降级端点
// WebSocket 不可用时，前端通过此接口轮询获取实时事件

import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
import { getWebSocketManager } from '../websocket';

const router: Router = Router();

/**
 * GET /api/v2/events/poll
 * Query:
 *   - since: string — 上次接收到的事件 ID，只返回该 ID 之后的事件
 *   - rooms: string[] — 订阅的房间列表（逗号分隔或重复参数）
 *   - limit: number — 最大返回条数（默认 50，最大 200）
 */
router.get('/poll', asyncWrapper(async (req, res) => {
  const since = req.query.since as string | undefined;
  const roomsParam = req.query.rooms;
  let rooms: string[] | undefined;

  if (roomsParam) {
    if (typeof roomsParam === 'string') {
      rooms = roomsParam.split(',').map((r) => r.trim()).filter(Boolean);
    } else if (Array.isArray(roomsParam)) {
      rooms = roomsParam.map(String);
    }
  }

  const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);

  const wsManager = getWebSocketManager();
  const events = wsManager.getBufferedEvents({ since, rooms, limit });

  res.json({
    success: true,
    data: events,
    meta: {
      since,
      returned: events.length,
      serverTime: Date.now(),
    },
  });
}));

/**
 * GET /api/v2/events/stats
 * WebSocket 连接统计（供调试）
 */
router.get('/stats', asyncWrapper(async (_req, res) => {
  const wsManager = getWebSocketManager();
  const stats = wsManager.getStats();

  res.json({
    success: true,
    data: stats,
  });
}));

export default router;
