import type { ReminderDto } from '@anbu/shared';
import { audit } from '../../common/audit';
import { AppError, notFound } from '../../common/errors';
import { toZonedIso } from '../../common/time';
import type { PrismaClient } from '../../database/prisma';
import type { Prisma } from '../../generated/prisma/client';

const DEFAULT_UPCOMING_HOURS = 72;
const DUE_WINDOW_MS = 24 * 60 * 60_000;

const withSource = {
  event: { select: { id: true, title: true, timezone: true, allDay: true } },
  task: { select: { id: true, title: true, timezone: true } },
  importantDate: { select: { id: true, title: true, timezone: true } },
} satisfies Prisma.ReminderInclude;

type ReminderWithSource = Prisma.ReminderGetPayload<{ include: typeof withSource }>;

export function toReminderDto(r: ReminderWithSource): ReminderDto {
  const source = r.event
    ? { type: 'event' as const, ...r.event, dateOnly: r.event.allDay }
    : r.task
      ? { type: 'task' as const, ...r.task, dateOnly: false }
      : { type: 'importantDate' as const, ...r.importantDate!, dateOnly: true };
  return {
    id: r.id,
    status: r.status,
    triggerAt: r.triggerAt.toISOString(),
    occurrenceAt: toZonedIso(r.occurrenceAt, source.timezone),
    offsetMinutes: r.offsetMinutes,
    snoozeCount: r.snoozeCount,
    sentAt: r.sentAt?.toISOString() ?? null,
    source: { type: source.type, id: source.id, title: source.title, dateOnly: source.dateOnly },
  };
}

/** Pending reminders the phone should schedule as local notifications, soonest first. */
export async function listUpcoming(
  prisma: PrismaClient,
  userId: string,
  hours = DEFAULT_UPCOMING_HOURS,
  now = new Date(),
) {
  const rows = await prisma.reminder.findMany({
    where: {
      userId,
      status: 'PENDING',
      triggerAt: { gt: now, lte: new Date(now.getTime() + hours * 3_600_000) },
    },
    include: withSource,
    orderBy: { triggerAt: 'asc' },
    take: 200,
  });
  return rows.map(toReminderDto);
}

/** Reminders that have fired in the last day and still await a response. */
export async function listDue(prisma: PrismaClient, userId: string, now = new Date()) {
  const rows = await prisma.reminder.findMany({
    where: {
      userId,
      status: 'SENT',
      acknowledgement: null,
      sentAt: { gte: new Date(now.getTime() - DUE_WINDOW_MS) },
    },
    include: withSource,
    orderBy: { triggerAt: 'desc' },
    take: 50,
  });
  return rows.map(toReminderDto);
}

async function findOwned(prisma: PrismaClient, userId: string, id: string) {
  const row = await prisma.reminder.findFirst({ where: { id, userId }, include: withSource });
  if (!row) throw notFound('Reminder');
  return row;
}

export async function acknowledgeReminder(
  prisma: PrismaClient,
  userId: string,
  id: string,
  action: 'COMPLETED' | 'DISMISSED',
) {
  const row = await findOwned(prisma, userId, id);
  if (row.acknowledgement) return toReminderDto(row);
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.reminder.update({
      where: { id },
      data: { acknowledgement: action, acknowledgedAt: new Date() },
      include: withSource,
    });
    await audit(tx, {
      userId,
      action: 'reminder.acknowledge',
      entityType: 'Reminder',
      entityId: id,
      metadata: { action },
    });
    return r;
  });
  return toReminderDto(updated);
}

/** Fires the reminder again after `minutes`. Only a reminder that has already fired can snooze. */
export async function snoozeReminder(
  prisma: PrismaClient,
  userId: string,
  id: string,
  minutes: number,
  now = new Date(),
) {
  const row = await findOwned(prisma, userId, id);
  if (row.status !== 'SENT') {
    throw new AppError(409, 'INVALID_STATE', 'Only a reminder that has gone off can be snoozed');
  }
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.reminder.update({
      where: { id },
      data: {
        status: 'PENDING',
        triggerAt: new Date(now.getTime() + minutes * 60_000),
        snoozeCount: { increment: 1 },
        sentAt: null,
        acknowledgement: null,
        acknowledgedAt: null,
      },
      include: withSource,
    });
    await audit(tx, {
      userId,
      action: 'reminder.snooze',
      entityType: 'Reminder',
      entityId: id,
      metadata: { minutes },
    });
    return r;
  });
  return toReminderDto(updated);
}
