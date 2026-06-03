/**
 * AxisGateway — 3DACP Express 中间件
 * 后端统一入口：接收 AxisMessage，路由到对应 Service 或转发
 */

import type { Request, Response, NextFunction, Router } from 'express';
import type {
  AxisMessage,
  AxisMessageReply,
  AxisStreamChunk,
} from '../coordinator/AxisMessage';
import { validateAxisMessage, createReply } from '../coordinator/AxisMessage';
import type { AxisRouter } from '../coordinator/AxisRouter';
import type { AxisRegistry } from '../coordinator/AxisRegistry';
import type { ModuleContract } from '../coordinator/ModuleContract';

// ───────────────────────── Gateway 上下文 ─────────────────────────

export interface GatewayContext {
  router: AxisRouter;
  registry: AxisRegistry;
  /** 模块 ID → Service 处理函数 的映射 */
  handlers: Map<string, ModuleHandler>;
}

export interface ModuleHandler {
  /** 处理 RPC 请求 */
  handleRpc(msg: AxisMessage): Promise<AxisMessageReply>;
  /** 处理流式请求 */
  handleStream(msg: AxisMessage, onChunk: (chunk: AxisStreamChunk) => void): Promise<void>;
  /** 处理单向事件 */
  handleEmit(msg: AxisMessage): Promise<void>;
}

// ───────────────────────── 中间件 ─────────────────────────

export function axisGatewayMiddleware(context: GatewayContext): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req, res, next) => {
    // 只处理 /axis/ 路径
    if (!req.path?.startsWith('/axis/')) {
      return next();
    }

    try {
      // 解析 AxisMessage
      const msg = req.body as AxisMessage;
      const validation = validateAxisMessage(msg);
      if (!validation.valid) {
        res.status(400).json({
          error: 'Invalid AxisMessage',
          details: validation.errors,
        });
        return;
      }

      // 记录追踪链
      msg.header.traceChain.push(msg.header.msgId);

      // 判断消息类型
      const isStream = msg.payload.action === 'stream' || msg.payload.action === 'subscribe';
      const expectsReply = msg.header.expectsReply ?? true;

      if (isStream) {
        // 流式响应
        await handleStreamMessage(msg, context, res);
      } else if (expectsReply) {
        // RPC 响应
        await handleRpcMessage(msg, context, res);
      } else {
        // Fire-and-forget
        await handleEmitMessage(msg, context, res);
      }
    } catch (err) {
      console.error('[AxisGateway] Error:', err);
      res.status(500).json({
        error: 'Gateway internal error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

// ───────────────────────── RPC 处理 ─────────────────────────

async function handleRpcMessage(
  msg: AxisMessage,
  ctx: GatewayContext,
  res: Response
): Promise<void> {
  const handler = ctx.handlers.get(msg.payload.entity);

  if (!handler) {
    // 本地无 handler，尝试路由到远程
    try {
      const reply = await ctx.router.send(msg);
      res.json(reply);
    } catch (err) {
      res.status(502).json({
        error: 'Routing failed',
        target: msg.header.target,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // 本地处理
  try {
    const reply = await handler.handleRpc(msg);
    res.json(reply);
  } catch (err) {
    const errorReply = createReply(
      msg,
      'error',
      null,
      {
        code: 'MODULE_ERROR',
        message: err instanceof Error ? err.message : String(err),
      }
    );
    res.status(500).json(errorReply);
  }
}

// ───────────────────────── 流式处理 ─────────────────────────

async function handleStreamMessage(
  msg: AxisMessage,
  ctx: GatewayContext,
  res: Response
): Promise<void> {
  const handler = ctx.handlers.get(msg.payload.entity);

  // 设置 SSE 头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const streamId = msg.header.msgId;
  let sequence = 0;

  const sendChunk = (chunk: AxisStreamChunk) => {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  };

  // 发送流开始标记
  sendChunk({
    streamId,
    sequence: sequence++,
    isLast: false,
    chunk: { type: 'streamStart', entity: msg.payload.entity, action: msg.payload.action },
    metadata: { timestamp: Date.now() },
  });

  if (!handler) {
    // 远程流式路由
    try {
      await ctx.router.sendStream(msg, (chunk) => {
        sendChunk(chunk);
      });
    } catch (err) {
      sendChunk({
        streamId,
        sequence: sequence++,
        isLast: true,
        chunk: { type: 'error', message: err instanceof Error ? err.message : String(err) },
      });
    }
  } else {
    // 本地流式处理
    try {
      await handler.handleStream(msg, (chunk) => {
        sendChunk({
          streamId,
          sequence: sequence++,
          isLast: false,
          chunk,
        });
      });
    } catch (err) {
      sendChunk({
        streamId,
        sequence: sequence++,
        isLast: true,
        chunk: { type: 'error', message: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  // 流结束
  sendChunk({
    streamId,
    sequence: sequence++,
    isLast: true,
    chunk: { type: 'streamEnd' },
  });

  res.end();
}

// ───────────────────────── Emit 处理 ─────────────────────────

async function handleEmitMessage(
  msg: AxisMessage,
  ctx: GatewayContext,
  res: Response
): Promise<void> {
  const handler = ctx.handlers.get(msg.payload.entity);

  if (!handler) {
    // 远程 emit
    ctx.router.emit(msg).catch((err) => {
      console.error('[AxisGateway] Emit routing failed:', err);
    });
    res.status(202).json({ accepted: true });
    return;
  }

  // 本地 emit
  handler.handleEmit(msg).catch((err) => {
    console.error('[AxisGateway] Emit handler error:', err);
  });
  res.status(202).json({ accepted: true });
}

// ───────────────────────── 路由注册辅助 ─────────────────────────

export function createAxisRouter(gateway: GatewayContext): Router {
  const expressRouter = require('express').Router();

  // POST /axis — 统一消息入口
  expressRouter.post('/', axisGatewayMiddleware(gateway));

  // GET /axis/stream — SSE 流式入口（用于长连接初始化）
  expressRouter.get('/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 保持连接，等待客户端发送 stream 请求
    const keepAlive = setInterval(() => {
      res.write(':keepalive\n\n');
    }, 30000);

    req.on('close', () => {
      clearInterval(keepAlive);
    });
  });

  // POST /axis/batch — 批量消息
  expressRouter.post('/batch', async (req: Request, res: Response) => {
    const messages = req.body.messages as AxisMessage[];
    if (!Array.isArray(messages)) {
      res.status(400).json({ error: 'Expected array of messages' });
      return;
    }

    const results = await Promise.allSettled(
      messages.map((msg) => {
        const handler = gateway.handlers.get(msg.payload.entity);
        if (handler) {
          return handler.handleRpc(msg);
        } else {
          return gateway.router.send(msg);
        }
      })
    );

    res.json({ results });
  });

  // GET /axis/registry — 查询注册中心
  expressRouter.get('/registry', (req: Request, res: Response) => {
    const stats = gateway.registry.getStats();
    res.json(stats);
  });

  // GET /axis/registry/nodes — 列出所有节点
  expressRouter.get('/registry/nodes', (req: Request, res: Response) => {
    const nodes = gateway.registry.exportNodes();
    res.json({ nodes, count: nodes.length });
  });

  // GET /axis/registry/modules/:moduleId — 查询支持某模块的节点
  expressRouter.get('/registry/modules/:moduleId', (req: Request, res: Response) => {
    const nodes = gateway.registry.getByModule(req.params.moduleId);
    res.json({ moduleId: req.params.moduleId, nodes, count: nodes.length });
  });

  // GET /axis/contracts — 列出所有模块契约
  expressRouter.get('/contracts', (req: Request, res: Response) => {
    const { listContracts } = require('../coordinator/ModuleContract');
    res.json({ contracts: listContracts() });
  });

  return expressRouter;
}

// ───────────────────────── Service 注册辅助 ─────────────────────────

export function registerService(
  gateway: GatewayContext,
  moduleId: string,
  handler: ModuleHandler
): void {
  gateway.handlers.set(moduleId, handler);
  console.log(`[AxisGateway] Registered handler for module: ${moduleId}`);
}

export function unregisterService(
  gateway: GatewayContext,
  moduleId: string
): void {
  gateway.handlers.delete(moduleId);
  console.log(`[AxisGateway] Unregistered handler for module: ${moduleId}`);
}
