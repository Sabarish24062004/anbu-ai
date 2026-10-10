import { Router } from 'express';
import type { PrismaClient } from '../../database/prisma';
import { getHealth } from './health.service';

export function healthRouter(prisma: PrismaClient, meta: { appName: string; version: string }) {
  const router = Router();
  router.get('/', async (_req, res) => {
    const health = await getHealth(prisma, meta);
    res.status(health.status === 'ok' ? 200 : 503).json(health);
  });
  return router;
}
