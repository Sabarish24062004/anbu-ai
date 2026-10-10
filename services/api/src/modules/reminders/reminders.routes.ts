import {
  acknowledgeReminderSchema,
  snoozeReminderSchema,
  upcomingRemindersQuerySchema,
} from '@anbu/shared';
import { Router } from 'express';
import { currentUserId } from '../../common/middleware/require-auth';
import { parseId } from '../../common/params';
import { parseInput } from '../../common/validate';
import type { PrismaClient } from '../../database/prisma';
import { acknowledgeReminder, listDue, listUpcoming, snoozeReminder } from './reminders.service';

export function remindersRouter(prisma: PrismaClient) {
  const router = Router();

  router.get('/upcoming', async (req, res) => {
    const { hours } = parseInput(upcomingRemindersQuerySchema, req.query);
    res.json({ reminders: await listUpcoming(prisma, currentUserId(req), hours) });
  });

  router.get('/due', async (req, res) => {
    res.json({ reminders: await listDue(prisma, currentUserId(req)) });
  });

  router.post('/:id/acknowledge', async (req, res) => {
    const id = parseId(req.params.id, 'Reminder');
    const { action } = parseInput(acknowledgeReminderSchema, req.body);
    res.json({ reminder: await acknowledgeReminder(prisma, currentUserId(req), id, action) });
  });

  router.post('/:id/snooze', async (req, res) => {
    const id = parseId(req.params.id, 'Reminder');
    const { minutes } = parseInput(snoozeReminderSchema, req.body);
    res.json({ reminder: await snoozeReminder(prisma, currentUserId(req), id, minutes) });
  });

  return router;
}
