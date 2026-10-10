import { Router } from 'express';
import { currentUserId } from '../../common/middleware/require-auth';
import { parseId } from '../../common/params';
import type { PrismaClient } from '../../database/prisma';
import { deleteMemoryById, forgetAllMemories, listMemories, saveMemory } from './memory.service';

export function memoryRouter(prisma: PrismaClient) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json({ memories: await listMemories(prisma, currentUserId(req)) });
  });

  router.post('/', async (req, res) => {
    res.status(201).json({ memory: await saveMemory(prisma, currentUserId(req), req.body) });
  });

  router.delete('/', async (req, res) => {
    res.json({ deleted: await forgetAllMemories(prisma, currentUserId(req)) });
  });

  router.delete('/:id', async (req, res) => {
    await deleteMemoryById(prisma, currentUserId(req), parseId(req.params.id, 'Memory'));
    res.status(204).end();
  });

  return router;
}
