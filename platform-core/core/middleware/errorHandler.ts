import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled error');
  const status = (err as any).statusCode || 500;
  res.status(status).json({
    success: false,
    error: err.message || 'Internal server error',
    code: (err as any).code || 'INTERNAL_ERROR',
  });
}
