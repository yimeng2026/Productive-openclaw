import type { Request, Response, NextFunction } from 'express';

const requestCounts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 200;

export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip || 'unknown';
  const now = Date.now();
  let record = requestCounts.get(key);
  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + WINDOW_MS };
    requestCounts.set(key, record);
  }
  record.count++;
  if (record.count > MAX_REQUESTS) {
    res.status(429).json({ success: false, error: 'Rate limit exceeded' });
    return;
  }
  next();
}
