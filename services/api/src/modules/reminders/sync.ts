import { DateTime } from 'luxon';
import type { PrismaClient } from '../../database/prisma';
import type { ImportantDate, Prisma, Task } from '../../generated/prisma/client';
import { withExceptions, type EventWithExceptions } from '../events/occurrences';
import { getUserDefaults } from '../users/users.service';
import {
  planEventReminders,
  planImportantDateReminders,
  planTaskReminders,
  type DesiredReminder,
  type PlanContext,
} from './planner';

type Tx = Prisma.TransactionClient;
type Target = { eventId: string } | { taskId: string } | { importantDateId: string };

const keyOf = (occurrenceAt: Date, offsetMinutes: number) =>
  `${occurrenceAt.getTime()}:${offsetMinutes}`;

/**
 * Reconciles an item's future reminder rows with the desired set, inside the caller's transaction.
 * Rows are keyed by (occurrence, offset), so a reminder that was already sent is never re-created,
 * and a snoozed reminder keeps its snoozed time.
 *   desired + missing        → create
 *   desired + PENDING        → move trigger if it changed (unless snoozed)
 *   desired + CANCELLED      → reinstate
 *   not desired + PENDING    → cancel
 *   SENT / FAILED / PROCESSING rows are history and left alone.
 */
export async function syncReminders(
  tx: Tx,
  userId: string,
  target: Target,
  desired: DesiredReminder[],
  now: Date,
) {
  const wanted = new Map(desired.map((d) => [keyOf(d.occurrenceAt, d.offsetMinutes), d]));
  const existing = await tx.reminder.findMany({ where: { ...target, occurrenceAt: { gt: now } } });

  const toCancel: string[] = [];
  for (const row of existing) {
    const key = keyOf(row.occurrenceAt, row.offsetMinutes);
    const want = wanted.get(key);
    wanted.delete(key);
    if (!want) {
      if (row.status === 'PENDING') toCancel.push(row.id);
      continue;
    }
    if (row.status === 'CANCELLED') {
      await tx.reminder.update({
        where: { id: row.id },
        data: { status: 'PENDING', triggerAt: want.triggerAt, snoozeCount: 0, lastError: null },
      });
    } else if (
      row.status === 'PENDING' &&
      row.snoozeCount === 0 &&
      row.triggerAt.getTime() !== want.triggerAt.getTime()
    ) {
      await tx.reminder.update({ where: { id: row.id }, data: { triggerAt: want.triggerAt } });
    }
  }
  if (toCancel.length) {
    await tx.reminder.updateMany({
      where: { id: { in: toCancel }, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
  }
  if (wanted.size) {
    await tx.reminder.createMany({
      data: [...wanted.values()].map((d) => ({ userId, ...target, ...d })),
      skipDuplicates: true, // a concurrent sync may have created the same row
    });
  }
}

export async function planContext(
  prisma: PrismaClient,
  userId: string,
  now = new Date(),
): Promise<PlanContext> {
  const { importantDateNotifyMinutes } = await getUserDefaults(prisma, userId);
  return { now: DateTime.fromJSDate(now), notifyMinutesOfDay: importantDateNotifyMinutes };
}

export const syncEventReminders = (tx: Tx, event: EventWithExceptions, ctx: PlanContext) =>
  syncReminders(
    tx,
    event.userId,
    { eventId: event.id },
    planEventReminders(event, ctx),
    ctx.now.toJSDate(),
  );

export const syncTaskReminders = (tx: Tx, task: Task, ctx: PlanContext) =>
  syncReminders(
    tx,
    task.userId,
    { taskId: task.id },
    planTaskReminders(task, ctx),
    ctx.now.toJSDate(),
  );

export const syncImportantDateReminders = (tx: Tx, date: ImportantDate, ctx: PlanContext) =>
  syncReminders(
    tx,
    date.userId,
    { importantDateId: date.id },
    planImportantDateReminders(date, ctx),
    ctx.now.toJSDate(),
  );

/**
 * Re-plans every active item of one user: extends the horizon for recurring items and applies
 * preference changes (such as the notify time for birthdays). Each item syncs in its own short
 * transaction.
 */
export async function resyncUserReminders(prisma: PrismaClient, userId: string, now = new Date()) {
  const ctx = await planContext(prisma, userId, now);
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const [events, tasks, dates] = await Promise.all([
    prisma.event.findMany({
      where: {
        userId,
        status: 'SCHEDULED',
        OR: [{ rrule: { not: null } }, { startAt: { gt: dayAgo } }],
      },
      include: withExceptions,
    }),
    prisma.task.findMany({
      where: { userId, status: { in: ['PENDING', 'IN_PROGRESS'] }, dueAt: { gt: now } },
    }),
    prisma.importantDate.findMany({ where: { userId } }),
  ]);
  for (const e of events) await prisma.$transaction((tx) => syncEventReminders(tx, e, ctx));
  for (const t of tasks) await prisma.$transaction((tx) => syncTaskReminders(tx, t, ctx));
  for (const d of dates) await prisma.$transaction((tx) => syncImportantDateReminders(tx, d, ctx));
}

/** Hourly horizon extension for all active users. */
export async function resyncAllReminders(prisma: PrismaClient, now = new Date()) {
  const users = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true } });
  for (const u of users) await resyncUserReminders(prisma, u.id, now);
  return users.length;
}
