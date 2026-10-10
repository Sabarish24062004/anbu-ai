import { updateMeSchema, updatePreferencesSchema } from '@anbu/shared';
import { Router } from 'express';
import { currentUserId } from '../../common/middleware/require-auth';
import { parseInput } from '../../common/validate';
import type { PrismaClient } from '../../database/prisma';
import { getMe, updateMe, updatePreferences } from './users.service';

export function usersRouter(prisma: PrismaClient) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await getMe(prisma, currentUserId(req)));
  });

  router.patch('/', async (req, res) => {
    const input = parseInput(updateMeSchema, req.body);
    res.json(await updateMe(prisma, currentUserId(req), input));
  });

  router.patch('/preferences', async (req, res) => {
    const input = parseInput(updatePreferencesSchema, req.body);
    res.json(await updatePreferences(prisma, currentUserId(req), input));
  });

  return router;
}
