import { DateTime } from 'luxon';
import type { z } from 'zod';
import {
  isValidMonthDay,
  type createImportantDateSchema,
  type ImportantDateDto,
  type UpcomingImportantDateDto,
  type updateImportantDateSchema,
} from '@anbu/shared';
import { audit } from '../../common/audit';
import { notFound } from '../../common/errors';
import { observedDate } from '../../common/time';
import { invalidField } from '../../common/validate';
import type { PrismaClient } from '../../database/prisma';
import type { ImportantDate } from '../../generated/prisma/client';
import { getUserDefaults } from '../users/users.service';
import { planContext, syncImportantDateReminders } from '../reminders/sync';

type CreateImportantDate = z.output<typeof createImportantDateSchema>;
type UpdateImportantDate = z.output<typeof updateImportantDateSchema>;

const DEFAULT_UPCOMING_DAYS = 30;

export function toImportantDateDto(d: ImportantDate): ImportantDateDto {
  return {
    id: d.id,
    title: d.title,
    type: d.type,
    personName: d.personName,
    relationship: d.relationship,
    month: d.month,
    day: d.day,
    year: d.year,
    recursAnnually: d.recursAnnually,
    timezone: d.timezone,
    contactInfo: d.contactInfo,
    notes: d.notes,
    remindersEnabled: d.remindersEnabled,
    reminderOffsets: d.reminderOffsets,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

type DateParts = Pick<ImportantDate, 'month' | 'day' | 'year' | 'recursAnnually' | 'timezone'>;

/** The next occurrence on or after today (in the date's own timezone), or null if it has passed. */
export function nextOccurrence(d: DateParts, now: DateTime) {
  const today = now.setZone(d.timezone).startOf('day');
  const years = d.recursAnnually ? [today.year, today.year + 1] : d.year ? [d.year] : [];
  for (const year of years) {
    const date = observedDate(year, d.month, d.day, d.timezone);
    if (date < today) continue;
    return {
      date,
      daysUntil: Math.round(date.diff(today, 'days').days),
      yearsSince: d.recursAnnually && d.year != null ? year - d.year : null,
    };
  }
  return null;
}

async function findOwnedDate(prisma: PrismaClient, userId: string, id: string) {
  const row = await prisma.importantDate.findFirst({ where: { id, userId } });
  if (!row) throw notFound('Important date');
  return row;
}

export async function createImportantDate(
  prisma: PrismaClient,
  userId: string,
  input: CreateImportantDate,
): Promise<ImportantDateDto> {
  const { timezone } = await getUserDefaults(prisma, userId);
  // Reminder rows change in the same transaction as the item, so they never disagree.
  const ctx = await planContext(prisma, userId);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.importantDate.create({
      data: { ...input, userId, timezone: input.timezone ?? timezone },
    });
    await audit(tx, {
      userId,
      action: 'important_date.create',
      entityType: 'ImportantDate',
      entityId: created.id,
    });
    await syncImportantDateReminders(tx, created, ctx);
    return created;
  });
  return toImportantDateDto(row);
}

export async function updateImportantDate(
  prisma: PrismaClient,
  userId: string,
  id: string,
  input: UpdateImportantDate,
): Promise<ImportantDateDto> {
  const existing = await findOwnedDate(prisma, userId, id);
  // Validate the combination the record will end up with, not just the fields sent.
  const merged = { ...existing, ...input };
  if (!isValidMonthDay(merged.month, merged.day, merged.year)) {
    throw invalidField('day', 'not a valid day for that month');
  }
  if (!merged.recursAnnually && merged.year == null) {
    throw invalidField('year', 'a one-off date needs a year');
  }
  // Reminder rows change in the same transaction as the item, so they never disagree.
  const ctx = await planContext(prisma, userId);
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.importantDate.update({ where: { id }, data: input });
    await audit(tx, {
      userId,
      action: 'important_date.update',
      entityType: 'ImportantDate',
      entityId: id,
      metadata: { fields: Object.keys(input) },
    });
    await syncImportantDateReminders(tx, updated, ctx);
    return updated;
  });
  return toImportantDateDto(row);
}

export async function getImportantDate(prisma: PrismaClient, userId: string, id: string) {
  return toImportantDateDto(await findOwnedDate(prisma, userId, id));
}

export async function listImportantDates(prisma: PrismaClient, userId: string) {
  const rows = await prisma.importantDate.findMany({
    where: { userId },
    orderBy: [{ month: 'asc' }, { day: 'asc' }, { title: 'asc' }],
  });
  return rows.map(toImportantDateDto);
}

export async function listUpcoming(
  prisma: PrismaClient,
  userId: string,
  days = DEFAULT_UPCOMING_DAYS,
  now: DateTime = DateTime.now(),
): Promise<UpcomingImportantDateDto[]> {
  const rows = await prisma.importantDate.findMany({ where: { userId } });
  const upcoming: UpcomingImportantDateDto[] = [];
  for (const row of rows) {
    const next = nextOccurrence(row, now);
    if (!next || next.daysUntil > days) continue;
    upcoming.push({
      importantDate: toImportantDateDto(row),
      date: next.date.toISODate() ?? '',
      daysUntil: next.daysUntil,
      yearsSince: next.yearsSince,
    });
  }
  return upcoming.sort(
    (a, b) =>
      a.daysUntil - b.daysUntil || a.importantDate.title.localeCompare(b.importantDate.title),
  );
}

export async function deleteImportantDate(prisma: PrismaClient, userId: string, id: string) {
  await findOwnedDate(prisma, userId, id);
  await prisma.$transaction(async (tx) => {
    await tx.importantDate.delete({ where: { id } });
    await audit(tx, {
      userId,
      action: 'important_date.delete',
      entityType: 'ImportantDate',
      entityId: id,
    });
  });
}
