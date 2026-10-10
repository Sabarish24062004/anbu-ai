import type { Request, RequestHandler } from 'express';
import { AppError } from '../errors';
import { verifyAccessToken, type TokenConfig } from '../../modules/auth/tokens';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

const unauthorized = () => new AppError(401, 'UNAUTHORIZED', 'Sign in required');

export function requireAuth(config: TokenConfig): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    const userId = token ? await verifyAccessToken(token, config) : null;
    if (!userId) throw unauthorized();
    req.userId = userId;
    next();
  };
}

/** The authenticated user's id; only valid on routes behind requireAuth. */
export function currentUserId(req: Request): string {
  if (!req.userId) throw unauthorized();
  return req.userId;
}
