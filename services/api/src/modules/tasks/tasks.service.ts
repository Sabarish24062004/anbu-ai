import { DateTime } from 'luxon';
import type { z } from 'zod';
import {
  formatRRule,
  parseRRule,
  type CompleteTaskResponse,
  type createTaskSchema,
  type listTasksQuerySchema,
  type TaskDto,
  type updateTaskSchema,
} from '@anbu/shared';
import { audit } from '../../common/audit';
import { AppError, notFound } from '../../common/errors';
import { nextOccurrenceAfter } from '../../common/recurrence';
import { parseDateTimeInput, toIsoOrNull, toZonedIso } from '../../common/time';
import { invalidField } from '../../common/validate';
import type { PrismaClient } from '../../database/prisma';
import type { Task } from '../../generated/prisma/client';
import { getUserDefaults } from '../users/users.service';
import { planContext, syncTaskReminders } from '../reminders/sync';

type CreateTask = z.output<typeof createTaskSchema>;
type UpdateTask = z.output<typeof updateTaskSchema>;
type ListTasksQuery = z.output<typeof listTasksQuerySchema>;

const MAX_DEPENDENCY_DEPTH = 100;

export function toTaskDto(t: Task): TaskDto {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    dueAt: t.dueAt ? toZonedIso(t.dueAt, t.timezone) : null,
    timezone: t.timezone,
    priority: t.priority,
    estimatedMinutes: t.estimatedMinutes,
    category: t.category,
    status: t.status,
    rrule: t.rrule,
    blockedById: t.blockedById,
    remindersEnabled: t.remindersEnabled,
    reminderOffsets: t.reminderOffsets,
    completedAt: toIsoOrNull(t.completedAt),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

async function findOwnedTask(prisma: PrismaClient, userId: string, id: string) {
  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) throw notFound('Task');
  return task;
}

/** The blocker must be the user's own task and must not (transitively) depend on `taskId`. */
async function assertValidBlocker(
  prisma: PrismaClient,
  userId: string,
  blockerId: string,
  taskId?: string,
) {
  if (blockerId === taskId) throw invalidField('blockedById', 'a task cannot block itself');
  let current: string | null = blockerId;
  for (let depth = 0; current && depth < MAX_DEPENDENCY_DEPTH; depth++) {
    const t: { blockedById: string | null } | null = await prisma.task.findFirst({
      where: { id: current, userId },
      select: { blockedById: true },
    });
    if (!t) throw invalidField('blockedById', 'task not found');
    if (taskId && t.blockedById === taskId) {
      throw invalidField('blockedById', 'this would create a circular dependency');
    }
    current = t.blockedById;
  }
}

export async function createTask(
  prisma: PrismaClient,
  userId: string,
  input: CreateTask,
): Promise<TaskDto> {
  const defaults = await getUserDefaults(prisma, userId);
  const timezone = input.timezone ?? defaults.timezone;
  const dueAt = input.dueAt ? parseDateTimeInput(input.dueAt, timezone, 'dueAt') : null;
  if (input.blockedById) await assertValidBlocker(prisma, userId, input.blockedById);

  // Reminder rows change in the same transaction as the item, so they never disagree.
  const ctx = await planContext(prisma, userId);
  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        userId,
        title: input.title,
        description: input.description ?? null,
        dueAt: dueAt?.toJSDate() ?? null,
        timezone,
        priority: input.priority,
        estimatedMinutes: input.estimatedMinutes ?? null,
        category: input.category ?? null,
        rrule: input.rrule ?? null,
        blockedById: input.blockedById ?? null,
        remindersEnabled: input.remindersEnabled,
        reminderOffsets: input.reminderOffsets ?? [defaults.reminderLeadMinutes],
      },
    });
    await audit(tx, { userId, action: 'task.create', entityType: 'Task', entityId: created.id });
    await syncTaskReminders(tx, created, ctx);
    return created;
  });
  return toTaskDto(task);
}

export async function updateTask(
  prisma: PrismaClient,
  userId: string,
  id: string,
  input: UpdateTask,
): Promise<TaskDto> {
  const existing = await findOwnedTask(prisma, userId, id);
  if (existing.status === 'COMPLETED') {
    throw new AppError(409, 'INVALID_STATE', 'A completed task cannot be changed');
  }
  const timezone = input.timezone ?? existing.timezone;
  const dueAt =
    input.dueAt === undefined
      ? existing.dueAt
      : input.dueAt && parseDateTimeInput(input.dueAt, timezone, 'dueAt').toJSDate();
  const rrule = input.rrule === undefined ? existing.rrule : input.rrule;
  if (rrule && !dueAt) throw invalidField('rrule', 'a recurring task needs dueAt');
  if (input.blockedById) await assertValidBlocker(prisma, userId, input.blockedById, id);

  // Reminder rows change in the same transaction as the item, so they never disagree.
  const ctx = await planContext(prisma, userId);
  const task = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id }, data: { ...input, dueAt, rrule } });
    await audit(tx, {
      userId,
      action: 'task.update',
      entityType: 'Task',
      entityId: id,
      metadata: { fields: Object.keys(input) },
    });
    await syncTaskReminders(tx, updated, ctx);
    return updated;
  });
  return toTaskDto(task);
}

/**
 * Completes a task. A recurring task instead moves to its next due date (its rule's COUNT is
 * reduced by one, since each completion uses up an occurrence); it closes when the rule runs out.
 */
export async function completeTask(
  prisma: PrismaClient,
  userId: string,
  id: string,
): Promise<CompleteTaskResponse> {
  const existing = await findOwnedTask(prisma, userId, id);
  if (existing.status === 'COMPLETED') return { task: toTaskDto(existing), rescheduled: false };
  if (existing.status === 'CANCELLED') {
    throw new AppError(409, 'INVALID_STATE', 'A cancelled task cannot be completed');
  }
  if (existing.blockedById) {
    const blocker = await prisma.task.findUnique({ where: { id: existing.blockedById } });
    if (blocker && blocker.status !== 'COMPLETED' && blocker.status !== 'CANCELLED') {
      throw new AppError(409, 'TASK_BLOCKED', `Finish "${blocker.title}" first`, {
        blockedById: blocker.id,
      });
    }
  }

  let next: { dueAt: Date; rrule: string } | null = null;
  if (existing.rrule && existing.dueAt) {
    const rule = parseRRule(existing.rrule);
    const due = DateTime.fromJSDate(existing.dueAt, { zone: existing.timezone });
    const nextDue = rule.count === 1 ? null : nextOccurrenceAfter(due, rule, due);
    if (nextDue) {
      const remaining = rule.count === undefined ? rule : { ...rule, count: rule.count - 1 };
      next = { dueAt: nextDue.toJSDate(), rrule: formatRRule(remaining) };
    }
  }

  // Reminder rows change in the same transaction as the item, so they never disagree.
  const ctx = await planContext(prisma, userId);
  const task = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id },
      data: next
        ? { dueAt: next.dueAt, rrule: next.rrule, status: 'PENDING' }
        : { status: 'COMPLETED', completedAt: new Date() },
    });
    await audit(tx, {
      userId,
      action: next ? 'task.complete_occurrence' : 'task.complete',
      entityType: 'Task',
      entityId: id,
    });
    await syncTaskReminders(tx, updated, ctx);
    return updated;
  });
  return { task: toTaskDto(task), rescheduled: next !== null };
}

export async function getTask(prisma: PrismaClient, userId: string, id: string) {
  return toTaskDto(await findOwnedTask(prisma, userId, id));
}

export async function listTasks(prisma: PrismaClient, userId: string, query: ListTasksQuery) {
  const { timezone } = await getUserDefaults(prisma, userId);
  const dueBefore = query.dueBefore
    ? parseDateTimeInput(query.dueBefore, timezone, 'dueBefore').toJSDate()
    : undefined;
  const tasks = await prisma.task.findMany({
    where: {
      userId,
      status: { in: query.status ?? ['PENDING', 'IN_PROGRESS'] },
      ...(dueBefore ? { dueAt: { lt: dueBefore } } : {}),
    },
    // Enum order is LOW..URGENT, so descending puts urgent first among equal due dates.
    orderBy: [
      { dueAt: { sort: 'asc', nulls: 'last' } },
      { priority: 'desc' },
      { createdAt: 'asc' },
    ],
    take: 500,
  });
  return tasks.map(toTaskDto);
}

export async function deleteTask(prisma: PrismaClient, userId: string, id: string) {
  await findOwnedTask(prisma, userId, id);
  await prisma.$transaction(async (tx) => {
    await tx.task.delete({ where: { id } });
    await audit(tx, { userId, action: 'task.delete', entityType: 'Task', entityId: id });
  });
}
