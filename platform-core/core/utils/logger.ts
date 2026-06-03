// backend/src/utils/logger.ts — Pino logger with WebSocket live push
// 将 INFO 及以上级别日志实时推送到前端 LogsPanel

import pino from 'pino';

// ── WebSocket 推送钩子 ─────────────────────────────
// 使用 pino hooks.logMethod 拦截日志，将系统日志实时广播到前端
// 采用动态 require 避免与 websocket 模块的循环依赖

let pushLogFn: typeof import('../websocket/push').pushLog | undefined;

function getPushLog() {
  if (!pushLogFn) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('../websocket/push');
      pushLogFn = mod.pushLog;
    } catch {
      // WebSocket 模块尚未初始化，静默跳过
    }
  }
  return pushLogFn;
}

const wsLogHook = {
  logMethod(
    inputArgs: unknown[],
    method: pino.LogFn,
    level: number,
  ) {
    // level: 10=trace 20=debug 30=info 40=warn 50=error 60=fatal
    if (level >= 30) {
      const pushLog = getPushLog();
      if (pushLog) {
        try {
          const levelMap: Record<number, 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'> = {
            30: 'INFO',
            40: 'WARN',
            50: 'ERROR',
            60: 'ERROR',
          };
          const logLevel = levelMap[level] || 'INFO';

          // 解析消息内容
          let msg = '';
          let service = 'SYSTEM';
          let component = 'backend';

          const firstArg = inputArgs[0];
          if (firstArg && typeof firstArg === 'object') {
            const obj = firstArg as Record<string, unknown>;
            msg = String(obj.msg ?? obj.message ?? JSON.stringify(firstArg));
            service = String(obj.service ?? obj.agent ?? obj.agentId ?? 'SYSTEM');
            component = String(obj.component ?? obj.source ?? 'backend');
          } else if (firstArg !== undefined) {
            msg = String(firstArg);
          }

          // 如果有第二个字符串参数（pino 的格式化参数），合并
          if (inputArgs[1] && typeof inputArgs[1] === 'string') {
            msg = `${msg} ${inputArgs[1]}`;
          }

          // 推送到 WebSocket system 房间
          pushLog(
            `sys-${Date.now()}`,
            new Date().toISOString(),
            service,
            logLevel,
            msg,
            component,
          );
        } catch {
          // 推送失败不影响日志记录本身
        }
      }
    }

    // 始终调用原始日志方法
    method.apply(this, inputArgs);
  },
};

// ── Logger 配置 ────────────────────────────────────

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  hooks: wsLogHook,
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' } }
      : undefined,
});

export default logger;
