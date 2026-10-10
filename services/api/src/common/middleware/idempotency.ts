import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { PrismaClient } from '../../database/prisma';
import { Prisma } from '../../generated/prisma/client';
import { AppError } from '../errors';
import { currentUserId } from './require-auth';

const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Honours an optional `Idempotency-Key` header on mutating requests, so a retried command (a flaky
 * network, or a voice command sent twice) is applied once. The first response under a key is
 * stored and replayed for repeats with the same body; reusing a key for a different request fails.
 * Server errors (5xx) are not stored, so the client can retry them.
 */
export function idempotency(prisma: PrismaClient): RequestHandler {
  return async (req, res, next) => {
    const key = req.get('idempotency-key');
    if (!key || req.method === 'GET' || req.method === 'HEAD') return next();
    if (!KEY_RE.test(key)) {
      throw new AppError(
        400,
        'INVALID_IDEMPOTENCY_KEY',
        'Idempotency-Key must be 8-128 URL-safe characters',
      );
    }
    const userId = currentUserId(req);
    const requestHash = createHash('sha256')
      .update(JSON.stringify([req.method, req.originalUrl, req.body ?? null]))
      .digest('hex');

    const row = await claimKey(prisma, userId, key, requestHash);
    if ('replay' in row) {
      const { status, body } = row.replay;
      res.set('Idempotent-Replayed', 'true').status(status);
      if (body === null) res.end();
      else res.json(body);
      return;
    }

    let stored = false;
    const store = (body: unknown) => {
      stored = true;
      const done =
        res.statusCode >= 500
          ? prisma.idempotencyKey.delete({ where: { id: row.id } })
          : prisma.idempotencyKey.update({
              where: { id: row.id },
              data: {
                responseStatus: res.statusCode,
                responseBody: body === undefined ? Prisma.DbNull : (body as Prisma.InputJsonValue),
              },
            });
      return done.catch((err: unknown) => {
        req.log?.error({ err }, 'Failed to store idempotent response');
      });
    };

    // Store JSON responses before sending, so a retry that arrives after the reply is replayed.
    const json = res.json.bind(res);
    res.json = (payload: unknown) => {
      void store(payload).then(() => json(payload));
      return res;
    };
    // Bodiless responses (204) are stored once sent.
    res.on('finish', () => {
      if (!stored) void store(undefined);
    });
    next();
  };
}

type Claim = { id: string } | { replay: { status: number; body: Prisma.JsonValue } };

async function claimKey(
  prisma: PrismaClient,
  userId: string,
  key: string,
  requestHash: string,
  retried = false,
): Promise<Claim> {
  const now = new Date();
  try {
    const created = await prisma.idempotencyKey.create({
      data: { userId, key, requestHash, expiresAt: new Date(now.getTime() + TTL_MS) },
    });
    return { id: created.id };
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
  }

  const existing = await prisma.idempotencyKey.findUnique({
    where: { userId_key: { userId, key } },
  });
  if (!existing || existing.expiresAt <= now) {
    if (retried)
      throw new AppError(409, 'REQUEST_IN_PROGRESS', 'Request is already being processed');
    await prisma.idempotencyKey.deleteMany({ where: { userId, key, expiresAt: { lte: now } } });
    return claimKey(prisma, userId, key, requestHash, true);
  }
  if (existing.requestHash !== requestHash) {
    throw new AppError(
      422,
      'IDEMPOTENCY_KEY_REUSED',
      'Idempotency-Key was used for a different request',
    );
  }
  if (existing.responseStatus === null) {
    throw new AppError(409, 'REQUEST_IN_PROGRESS', 'Request is already being processed');
  }
  return { replay: { status: existing.responseStatus, body: existing.responseBody } };
}
