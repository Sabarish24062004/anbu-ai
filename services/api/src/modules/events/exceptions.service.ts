import { DateTime } from 'luxon';
import type { z } from 'zod';
import {
  parseRRule,
  type EventExceptionDto,
  type moveOccurrenceSchema,
  type ScheduleConflict,
} from '@anbu/shared';
import { audit } from '../../common/audit';
import { AppError, notFound } from '../../common/errors';
import { occurrencesInRange } from '../../common/recurrence';
import { parseDateTimeInput, toZonedIso } from '../../common/time';
import { invalidField } from '../../common/validate';
import type { PrismaClient } from '../../database/prisma';
import type { EventException } from '../../generated/prisma/client';
import { planContext, syncEventReminders } from '../reminders/sync';
import { findConflicts } from './conflicts';
import { withExceptions, type EventWithExceptions } from './occurrences';

type MoveOccurrence = z.output<typeof moveOccurrenceSchema>;

export function toExceptionDto(x: EventException, zone: string): EventExceptionDto {
  return {
    id: x.id,
    originalStart: toZonedIso(x.originalStart, zone),
    kind: x.kind,
    startAt: x.startAt ? toZonedIso(x.startAt, zone) : null,
    endAt: x.endAt ? toZonedIso(x.endAt, zone) : null,
  };
}

async function findRecurringEvent(prisma: PrismaClient, userId: string, id: string) {
  const event = await prisma.event.findFirst({ where: { id, userId }, include: withExceptions });
  if (!event) throw notFound('Event');
  if (!event.rrule) {
    throw new AppError(400, 'NOT_RECURRING', 'Only a repeating event has separate occurrences');
  }
  if (event.status !== 'SCHEDULED') {
    throw new AppError(409, 'INVALID_STATE', 'Only scheduled events can be changed');
  }
  return event;
}

/**
 * Resolves a reference to the original start of a real occurrence of the series: an exact start
 * (either where the rule puts it, or where it was moved to) or a local date with an occurrence.
 */
export function resolveOccurrence(e: EventWithExceptions, ref: string): DateTime {
  const zone = e.timezone;
  const seriesStart = DateTime.fromJSDate(e.startAt, { zone });
  const rule = parseRRule(e.rrule!);
  const at = parseDateTimeInput(ref, zone, 'occurrence');
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(ref);
  const from = dateOnly ? at.startOf('day') : at.minus({ minutes: 1 });
  const to = dateOnly ? from.plus({ days: 1 }) : at.plus({ minutes: 1 });

  const moved = e.exceptions.find(
    (x) =>
      x.startAt &&
      (dateOnly
        ? DateTime.fromJSDate(x.startAt, { zone }).hasSame(at, 'day')
        : x.startAt.getTime() === at.toMillis()),
  );
  // Starts only (duration 0): an occurrence that merely runs into the window is not "on" it.
  const original = occurrencesInRange(seriesStart, 0, rule, from, to).find(
    (s) => dateOnly || s.toMillis() === at.toMillis(),
  );
  if (original) return original;
  if (moved) return DateTime.fromJSDate(moved.originalStart, { zone });
  throw invalidField('occurrence', 'the event has no occurrence at that time');
}

async function saveException(
  prisma: PrismaClient,
  userId: string,
  event: EventWithExceptions,
  originalStart: DateTime,
  data: { kind: 'SKIPPED' | 'MOVED'; startAt: Date | null; endAt: Date | null },
  action: string,
) {
  const ctx = await planContext(prisma, userId);
  return prisma.$transaction(async (tx) => {
    const exception = await tx.eventException.upsert({
      where: {
        eventId_originalStart: { eventId: event.id, originalStart: originalStart.toJSDate() },
      },
      create: { eventId: event.id, userId, originalStart: originalStart.toJSDate(), ...data },
      update: data,
    });
    const fresh = await tx.event.findUniqueOrThrow({
      where: { id: event.id },
      include: withExceptions,
    });
    await syncEventReminders(tx, fresh, ctx);
    await audit(tx, {
      userId,
      action,
      entityType: 'Event',
      entityId: event.id,
      metadata: { originalStart: originalStart.toISO() },
    });
    return exception;
  });
}

export async function skipOccurrence(
  prisma: PrismaClient,
  userId: string,
  eventId: string,
  occurrence: string,
): Promise<{ exception: EventExceptionDto }> {
  const event = await findRecurringEvent(prisma, userId, eventId);
  const originalStart = resolveOccurrence(event, occurrence);
  const exception = await saveException(
    prisma,
    userId,
    event,
    originalStart,
    { kind: 'SKIPPED', startAt: null, endAt: null },
    'event.occurrence_skip',
  );
  return { exception: toExceptionDto(exception, event.timezone) };
}

export async function moveOccurrence(
  prisma: PrismaClient,
  userId: string,
  eventId: string,
  input: MoveOccurrence,
): Promise<{ exception: EventExceptionDto; conflicts: ScheduleConflict[] }> {
  const event = await findRecurringEvent(prisma, userId, eventId);
  const originalStart = resolveOccurrence(event, input.occurrence);
  const zone = event.timezone;
  const seriesMs = event.endAt ? event.endAt.getTime() - event.startAt.getTime() : 0;

  let start = parseDateTimeInput(input.startAt, zone, 'startAt');
  if (event.allDay) start = start.startOf('day');
  const end = input.endAt
    ? parseDateTimeInput(input.endAt, zone, 'endAt')
    : seriesMs
      ? start.plus({ milliseconds: seriesMs })
      : null;
  if (end && end < start) throw invalidField('endAt', 'must not be before startAt');

  const conflicts = event.allDay
    ? []
    : await findConflicts(
        prisma,
        userId,
        {
          start,
          durationMs: end ? end.toMillis() - start.toMillis() : 0,
          rule: null,
          bufferMs: (event.travelBufferMinutes + event.prepBufferMinutes) * 60_000,
        },
        event.id,
      );
  if (conflicts.length && !input.allowConflicts) {
    throw new AppError(
      409,
      'SCHEDULE_CONFLICT',
      'This time overlaps other events. Confirm to save anyway.',
      {
        conflicts,
      },
    );
  }
  const exception = await saveException(
    prisma,
    userId,
    event,
    originalStart,
    { kind: 'MOVED', startAt: start.toJSDate(), endAt: end?.toJSDate() ?? null },
    'event.occurrence_move',
  );
  return { exception: toExceptionDto(exception, zone), conflicts };
}

/** Undoes a skip or move: the occurrence goes back to where the series puts it. */
export async function restoreOccurrence(
  prisma: PrismaClient,
  userId: string,
  eventId: string,
  exceptionId: string,
) {
  const exception = await prisma.eventException.findFirst({
    where: { id: exceptionId, eventId, userId },
  });
  if (!exception) throw notFound('Changed occurrence');
  const ctx = await planContext(prisma, userId);
  await prisma.$transaction(async (tx) => {
    await tx.eventException.delete({ where: { id: exception.id } });
    const fresh = await tx.event.findUniqueOrThrow({
      where: { id: eventId },
      include: withExceptions,
    });
    await syncEventReminders(tx, fresh, ctx);
    await audit(tx, {
      userId,
      action: 'event.occurrence_restore',
      entityType: 'Event',
      entityId: eventId,
      metadata: { originalStart: exception.originalStart.toISOString() },
    });
  });
}

export async function listExceptions(prisma: PrismaClient, userId: string, eventId: string) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, userId },
    include: { exceptions: { orderBy: { originalStart: 'asc' } } },
  });
  if (!event) throw notFound('Event');
  return event.exceptions.map((x) => toExceptionDto(x, event.timezone));
}
