import { dayPlanQuerySchema } from '@anbu/shared';
import { Router } from 'express';
import { currentUserId } from '../../common/middleware/require-auth';
import { parseInput } from '../../common/validate';
import type { PrismaClient } from '../../database/prisma';
import { getDayPlan } from './planning.service';

export function planningRouter(prisma: PrismaClient) {
  const router = Router();

  router.get('/day', async (req, res) => {
    const { date } = parseInput(dayPlanQuerySchema, req.query);
    res.json({ plan: await getDayPlan(prisma, currentUserId(req), date) });
  });

  return router;
}
