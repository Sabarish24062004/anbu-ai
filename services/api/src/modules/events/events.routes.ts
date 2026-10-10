import {
  createEventSchema,
  listEventsQuerySchema,
  moveOccurrenceSchema,
  skipOccurrenceSchema,
  updateEventSchema,
} from '@anbu/shared';
import { Router } from 'express';
import { currentUserId } from '../../common/middleware/require-auth';
import { parseId } from '../../common/params';
import { parseInput } from '../../common/validate';
import type { PrismaClient } from '../../database/prisma';
import {
  cancelEvent,
  completeEvent,
  createEvent,
  deleteEvent,
  getEvent,
  listOccurrences,
  updateEvent,
} from './events.service';
import {
  listExceptions,
  moveOccurrence,
  restoreOccurrence,
  skipOccurrence,
} from './exceptions.service';

export function eventsRouter(prisma: PrismaClient) {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = parseInput(listEventsQuerySchema, req.query);
    res.json(await listOccurrences(prisma, currentUserId(req), query));
  });

  router.post('/', async (req, res) => {
    const input = parseInput(createEventSchema, req.body);
    res.status(201).json(await createEvent(prisma, currentUserId(req), input));
  });

  router.get('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'Event');
    const userId = currentUserId(req);
    res.json({
      event: await getEvent(prisma, userId, id),
      exceptions: await listExceptions(prisma, userId, id),
    });
  });

  // One occurrence of a recurring event.
  router.post('/:id/occurrences/skip', async (req, res) => {
    const id = parseId(req.params.id, 'Event');
    const { occurrence } = parseInput(skipOccurrenceSchema, req.body);
    res.json(await skipOccurrence(prisma, currentUserId(req), id, occurrence));
  });

  router.post('/:id/occurrences/move', async (req, res) => {
    const id = parseId(req.params.id, 'Event');
    const input = parseInput(moveOccurrenceSchema, req.body);
    res.json(await moveOccurrence(prisma, currentUserId(req), id, input));
  });

  router.delete('/:id/exceptions/:exceptionId', async (req, res) => {
    const id = parseId(req.params.id, 'Event');
    const exceptionId = parseId(req.params.exceptionId, 'Changed occurrence');
    await restoreOccurrence(prisma, currentUserId(req), id, exceptionId);
    res.status(204).end();
  });

  router.patch('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'Event');
    const input = parseInput(updateEventSchema, req.body);
    res.json(await updateEvent(prisma, currentUserId(req), id, input));
  });

  router.post('/:id/cancel', async (req, res) => {
    const id = parseId(req.params.id, 'Event');
    res.json({ event: await cancelEvent(prisma, currentUserId(req), id) });
  });

  router.post('/:id/complete', async (req, res) => {
    const id = parseId(req.params.id, 'Event');
    res.json({ event: await completeEvent(prisma, currentUserId(req), id) });
  });

  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'Event');
    await deleteEvent(prisma, currentUserId(req), id);
    res.status(204).end();
  });

  return router;
}
