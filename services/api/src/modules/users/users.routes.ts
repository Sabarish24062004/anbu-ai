import { updateMeSchema, updatePreferencesSchema } from '@anbu/shared';
import { Router } from 'express';
import { currentUserId } from '../../common/middleware/require-auth';
import { parseInput } from '../../common/validate';
import type { PrismaClient } from '../../database/prisma';
import { resyncUserReminders } from '../reminders/sync';
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
    const userId = currentUserId(req);
    const me = await updatePreferences(prisma, userId, input);
    // Date-based reminders fire at the preferred time of day, so they move with it.
    if (input.importantDateNotifyMinutes !== undefined) await resyncUserReminders(prisma, userId);
    res.json(me);
  });

  return router;
}
