import {
  createImportantDateSchema,
  upcomingImportantDatesQuerySchema,
  updateImportantDateSchema,
} from '@anbu/shared';
import { Router } from 'express';
import { currentUserId } from '../../common/middleware/require-auth';
import { parseId } from '../../common/params';
import { parseInput } from '../../common/validate';
import type { PrismaClient } from '../../database/prisma';
import {
  createImportantDate,
  deleteImportantDate,
  getImportantDate,
  listImportantDates,
  listUpcoming,
  updateImportantDate,
} from './important-dates.service';

export function importantDatesRouter(prisma: PrismaClient) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json({ importantDates: await listImportantDates(prisma, currentUserId(req)) });
  });

  router.get('/upcoming', async (req, res) => {
    const { days } = parseInput(upcomingImportantDatesQuerySchema, req.query);
    res.json({ upcoming: await listUpcoming(prisma, currentUserId(req), days) });
  });

  router.post('/', async (req, res) => {
    const input = parseInput(createImportantDateSchema, req.body);
    res
      .status(201)
      .json({ importantDate: await createImportantDate(prisma, currentUserId(req), input) });
  });

  router.get('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'Important date');
    res.json({ importantDate: await getImportantDate(prisma, currentUserId(req), id) });
  });

  router.patch('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'Important date');
    const input = parseInput(updateImportantDateSchema, req.body);
    res.json({ importantDate: await updateImportantDate(prisma, currentUserId(req), id, input) });
  });

  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'Important date');
    await deleteImportantDate(prisma, currentUserId(req), id);
    res.status(204).end();
  });

  return router;
}
