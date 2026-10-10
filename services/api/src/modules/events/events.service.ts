import { DateTime } from 'luxon';
import type { z } from 'zod';
import {
  parseRRule,
  type createEventSchema,
  type EventMutationResponse,
  type EventOccurrenceDto,
  type listEventsQuerySchema,
  type ScheduleConflict,
  type updateEventSchema,
} from '@anbu/shared';
import { audit } from '../../common/audit';
import { AppError, notFound } from '../../common/errors';
import { occurrencesInRange } from '../../common/recurrence';
import { parseDateTimeInput } from '../../common/time';
import { invalidField } from '../../common/validate';
import type { PrismaClient } from '../../database/prisma';
import type { EventStatus } from '../../generated/prisma/client';
import { getUserDefaults } from '../users/users.service';
import { findConflicts, scheduleOf, type Schedule } from './conflicts';
import { toEventDto } from './events.mapper';

type CreateEvent = z.output<typeof createEventSchema>;
type UpdateEvent = z.output<typeof updateEventSchema>;
type ListEventsQuery = z.output<typeof listEventsQuerySchema>;

const MAX_LIST_RANGE_DAYS = 366;
const DEFAULT_LIST_RANGE_DAYS = 7;
const SCHEDULE_FIELDS = [
  'startAt',
  'endAt',
  'allDay',
  'timezone',
  'rrule',
  'travelBufferMinutes',
  'prepBufferMinutes',
] as const;

/**
 * All-day events are stored as local midnight to the following midnight. `endIsInclusiveDate`
 * marks an end supplied by the client, which names the last day rather than the exclusive end.
 */
function normalizeTimes(
  start: DateTime,
  end: DateTime | null,
  allDay: boolean,
  endIsInclusiveDate: boolean,
): { start: DateTime; end: DateTime | null } {
  if (allDay) {
    const s = start.startOf('day');
    let e = end?.startOf('day') ?? s;
    if (endIsInclusiveDate && e < s) throw invalidField('endAt', 'must not be before startAt');
    if (endIsInclusiveDate) e = e.plus({ days: 1 });
    if (e <= s) e = s.plus({ days: 1 });
    return { start: s, end: e };
  }
  if (end && end < start) throw invalidField('endAt', 'must not be before startAt');
  return { start, end };
}

function scheduleFor(
  start: DateTime,
  end: DateTime | null,
  rrule: string | null,
  buffers: number,
): Schedule {
  return {
    start,
    durationMs: end ? end.toMillis() - start.toMillis() : 0,
    rule: rrule ? parseRRule(rrule) : null,
    bufferMs: buffers * 60_000,
  };
}

function assertNoUnconfirmedConflicts(conflicts: ScheduleConflict[], allowConflicts?: boolean) {
  if (conflicts.length && !allowConflicts) {
    throw new AppError(
      409,
      'SCHEDULE_CONFLICT',
      'This time overlaps other events. Confirm to save anyway.',
      { conflicts },
    );
  }
}

async function findOwnedEvent(prisma: PrismaClient, userId: string, id: string) {
  const event = await prisma.event.findFirst({ where: { id, userId } });
  if (!event) throw notFound('Event');
  return event;
}

export async function createEvent(
  prisma: PrismaClient,
  userId: string,
  input: CreateEvent,
): Promise<EventMutationResponse> {
  const defaults = await getUserDefaults(prisma, userId);
  const timezone = input.timezone ?? defaults.timezone;
  const allDay = input.allDay ?? false;
  const { start, end } = normalizeTimes(
    parseDateTimeInput(input.startAt, timezone, 'startAt'),
    input.endAt ? parseDateTimeInput(input.endAt, timezone, 'endAt') : null,
    allDay,
    Boolean(input.endAt),
  );
  const travelBufferMinutes = input.travelBufferMinutes ?? 0;
  const prepBufferMinutes = input.prepBufferMinutes ?? 0;
  const rrule = input.rrule ?? null;

  const conflicts = allDay
    ? []
    : await findConflicts(
        prisma,
        userId,
        scheduleFor(start, end, rrule, travelBufferMinutes + prepBufferMinutes),
      );
  assertNoUnconfirmedConflicts(conflicts, input.allowConflicts);

  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.event.create({
      data: {
        userId,
        title: input.title,
        description: input.description ?? null,
        startAt: start.toJSDate(),
        endAt: end?.toJSDate() ?? null,
        allDay,
        timezone,
        rrule,
        kind: input.kind,
        location: input.location ?? null,
        category: input.category ?? null,
        priority: input.priority,
        personName: input.personName ?? null,
        travelBufferMinutes,
        prepBufferMinutes,
        remindersEnabled: input.remindersEnabled,
        reminderOffsets: input.reminderOffsets ?? [defaults.reminderLeadMinutes],
      },
    });
    await audit(tx, {
      userId,
      action: 'event.create',
      entityType: 'Event',
      entityId: created.id,
      metadata: { conflictsAccepted: conflicts.length },
    });
    return created;
  });
  return { event: toEventDto(event), conflicts };
}

export async function updateEvent(
  prisma: PrismaClient,
  userId: string,
  id: string,
  input: UpdateEvent,
): Promise<EventMutationResponse> {
  const existing = await findOwnedEvent(prisma, userId, id);
  if (existing.status !== 'SCHEDULED') {
    throw new AppError(409, 'INVALID_STATE', 'Only scheduled events can be changed');
  }
  const { allowConflicts, ...changes } = input;
  // Changing only the timezone keeps the same instant; the wall-clock time follows the new zone.
  const timezone = changes.timezone ?? existing.timezone;
  const allDay = changes.allDay ?? existing.allDay;

  let start: DateTime = DateTime.fromJSDate(existing.startAt, { zone: timezone });
  let end: DateTime | null = existing.endAt
    ? DateTime.fromJSDate(existing.endAt, { zone: timezone })
    : null;
  if (changes.startAt !== undefined) {
    const newStart = parseDateTimeInput(changes.startAt, timezone, 'startAt');
    // Moving an event without a new end keeps its duration.
    if (changes.endAt === undefined && end) end = newStart.plus(end.diff(start));
    start = newStart;
  }
  if (changes.endAt !== undefined) {
    end = changes.endAt === null ? null : parseDateTimeInput(changes.endAt, timezone, 'endAt');
  }
  ({ start, end } = normalizeTimes(start, end, allDay, Boolean(changes.endAt)));

  const rrule = changes.rrule !== undefined ? changes.rrule : existing.rrule;
  const travel = changes.travelBufferMinutes ?? existing.travelBufferMinutes;
  const prep = changes.prepBufferMinutes ?? existing.prepBufferMinutes;
  const scheduleChanged = SCHEDULE_FIELDS.some((f) => changes[f] !== undefined);
  const conflicts =
    scheduleChanged && !allDay
      ? await findConflicts(prisma, userId, scheduleFor(start, end, rrule, travel + prep), id)
      : [];
  assertNoUnconfirmedConflicts(conflicts, allowConflicts);

  const event = await prisma.$transaction(async (tx) => {
    const updated = await tx.event.update({
      where: { id },
      data: {
        ...changes,
        startAt: start.toJSDate(),
        endAt: end?.toJSDate() ?? null,
        allDay,
        timezone,
        rrule,
      },
    });
    await audit(tx, {
      userId,
      action: 'event.update',
      entityType: 'Event',
      entityId: id,
      metadata: { fields: Object.keys(changes), conflictsAccepted: conflicts.length },
    });
    return updated;
  });
  return { event: toEventDto(event), conflicts };
}

export async function getEvent(prisma: PrismaClient, userId: string, id: string) {
  return toEventDto(await findOwnedEvent(prisma, userId, id));
}

/** Expands events (including recurrences) into concrete occurrences within [from, to). */
export async function listOccurrences(
  prisma: PrismaClient,
  userId: string,
  query: ListEventsQuery,
): Promise<{ from: string; to: string; occurrences: EventOccurrenceDto[] }> {
  const { timezone } = await getUserDefaults(prisma, userId);
  const from = query.from
    ? parseDateTimeInput(query.from, timezone, 'from')
    : DateTime.now().setZone(timezone).startOf('day');
  const to = query.to
    ? parseDateTimeInput(query.to, timezone, 'to')
    : from.plus({ days: DEFAULT_LIST_RANGE_DAYS });
  if (to <= from) throw invalidField('to', 'must be after from');
  if (to.diff(from, 'days').days > MAX_LIST_RANGE_DAYS) {
    throw invalidField('to', `range must be at most ${MAX_LIST_RANGE_DAYS} days`);
  }

  const statuses: EventStatus[] =
    query.includeCancelled === 'true'
      ? ['SCHEDULED', 'COMPLETED', 'CANCELLED']
      : ['SCHEDULED', 'COMPLETED'];
  const events = await prisma.event.findMany({
    where: {
      userId,
      status: { in: statuses },
      startAt: { lt: to.toJSDate() },
      OR: [
        { rrule: { not: null } },
        { endAt: { gt: from.toJSDate() } },
        { startAt: { gte: from.toJSDate() } },
      ],
    },
    orderBy: { startAt: 'asc' },
  });

  const occurrences: EventOccurrenceDto[] = [];
  for (const event of events) {
    const { start, durationMs, rule } = scheduleOf(event);
    const dto = toEventDto(event);
    for (const s of occurrencesInRange(start, durationMs, rule, from, to)) {
      occurrences.push({
        eventId: event.id,
        start: s.toISO() ?? '',
        end: s.plus({ milliseconds: durationMs }).toISO() ?? '',
        event: dto,
      });
    }
  }
  occurrences.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { from: from.toISO() ?? '', to: to.toISO() ?? '', occurrences };
}

async function transition(
  prisma: PrismaClient,
  userId: string,
  id: string,
  target: 'COMPLETED' | 'CANCELLED',
) {
  const existing = await findOwnedEvent(prisma, userId, id);
  if (existing.status === target) return toEventDto(existing); // repeating the command is harmless
  if (existing.status !== 'SCHEDULED') {
    throw new AppError(
      409,
      'INVALID_STATE',
      `A ${existing.status.toLowerCase()} event cannot be ${target.toLowerCase()}`,
    );
  }
  const now = new Date();
  const event = await prisma.$transaction(async (tx) => {
    const updated = await tx.event.update({
      where: { id },
      data:
        target === 'COMPLETED'
          ? { status: target, completedAt: now }
          : { status: target, cancelledAt: now },
    });
    const action = target === 'COMPLETED' ? 'event.complete' : 'event.cancel';
    await audit(tx, { userId, action, entityType: 'Event', entityId: id });
    return updated;
  });
  return toEventDto(event);
}

export const cancelEvent = (prisma: PrismaClient, userId: string, id: string) =>
  transition(prisma, userId, id, 'CANCELLED');

export const completeEvent = (prisma: PrismaClient, userId: string, id: string) =>
  transition(prisma, userId, id, 'COMPLETED');

export async function deleteEvent(prisma: PrismaClient, userId: string, id: string) {
  await findOwnedEvent(prisma, userId, id);
  await prisma.$transaction(async (tx) => {
    await tx.event.delete({ where: { id } });
    await audit(tx, { userId, action: 'event.delete', entityType: 'Event', entityId: id });
  });
}
