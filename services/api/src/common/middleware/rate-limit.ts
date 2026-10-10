import type { Request, RequestHandler } from 'express';
import { rateLimit, type Options } from 'express-rate-limit';

/*
 * In-memory limits: correct for a single API process. Running several instances would need a
 * shared store (e.g. Postgres or Redis) so the counts are not per process.
 */

const tooMany: Options['handler'] = (_req, res, _next, options) => {
  res.status(options.statusCode).json({
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please wait a little and try again.',
    },
  });
};

const base = { standardHeaders: 'draft-8', legacyHeaders: false, handler: tooMany } as const;

const MINUTE = 60_000;

export interface RateLimits {
  /** Every request, per IP: a coarse guard against floods. */
  global: RequestHandler;
  /** Failed sign-ins per IP, and per account so a password cannot be guessed from many IPs. */
  loginPerIp: RequestHandler;
  loginPerAccount: RequestHandler;
  register: RequestHandler;
  refresh: RequestHandler;
  /** Assistant turns per user: protects the model quota (free tiers allow only a few a minute). */
  assistant: RequestHandler;
}

const emailKey = (req: Request) =>
  String((req.body as { email?: unknown } | undefined)?.email ?? '')
    .trim()
    .toLowerCase() || 'unknown';

export function createRateLimits(): RateLimits {
  return {
    global: rateLimit({ ...base, windowMs: MINUTE, limit: 300 }),
    loginPerIp: rateLimit({
      ...base,
      windowMs: 15 * MINUTE,
      limit: 10,
      skipSuccessfulRequests: true,
    }),
    loginPerAccount: rateLimit({
      ...base,
      windowMs: 15 * MINUTE,
      limit: 10,
      skipSuccessfulRequests: true,
      keyGenerator: (req) => `login:${emailKey(req)}`,
    }),
    register: rateLimit({ ...base, windowMs: 60 * MINUTE, limit: 10 }),
    refresh: rateLimit({ ...base, windowMs: 15 * MINUTE, limit: 60 }),
    assistant: rateLimit({
      ...base,
      windowMs: MINUTE,
      limit: 20,
      keyGenerator: (req) => `assistant:${req.userId ?? 'anonymous'}`,
    }),
  };
}

const pass: RequestHandler = (_req, _res, next) => next();

/** Limits switched off (tests that are not about rate limiting). */
export const noRateLimits: RateLimits = {
  global: pass,
  loginPerIp: pass,
  loginPerAccount: pass,
  register: pass,
  refresh: pass,
  assistant: pass,
};
