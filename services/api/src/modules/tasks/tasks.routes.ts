import { createTaskSchema, listTasksQuerySchema, updateTaskSchema } from '@anbu/shared';
import { Router } from 'express';
import { currentUserId } from '../../common/middleware/require-auth';
import { parseId } from '../../common/params';
import { parseInput } from '../../common/validate';
import type { PrismaClient } from '../../database/prisma';
import {
  completeTask,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
} from './tasks.service';

export function tasksRouter(prisma: PrismaClient) {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = parseInput(listTasksQuerySchema, req.query);
    res.json({ tasks: await listTasks(prisma, currentUserId(req), query) });
  });

  router.post('/', async (req, res) => {
    const input = parseInput(createTaskSchema, req.body);
    res.status(201).json({ task: await createTask(prisma, currentUserId(req), input) });
  });

  router.get('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'Task');
    res.json({ task: await getTask(prisma, currentUserId(req), id) });
  });

  router.patch('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'Task');
    const input = parseInput(updateTaskSchema, req.body);
    res.json({ task: await updateTask(prisma, currentUserId(req), id, input) });
  });

  router.post('/:id/complete', async (req, res) => {
    const id = parseId(req.params.id, 'Task');
    res.json(await completeTask(prisma, currentUserId(req), id));
  });

  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'Task');
    await deleteTask(prisma, currentUserId(req), id);
    res.status(204).end();
  });

  return router;
}
