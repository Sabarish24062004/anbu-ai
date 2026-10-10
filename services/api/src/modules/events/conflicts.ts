import { DateTime } from 'luxon';
import { parseRRule, type RecurrenceRule, type ScheduleConflict } from '@anbu/shared';
import { occurrencesInRange } from '../../common/recurrence';
import type { PrismaClient } from '../../database/prisma';
import type { Event } from '../../generated/prisma/client';

// Recurring events are checked this far ahead; further clashes surface when they get closer.
const RECURRING_HORIZON_DAYS = 90;
const MAX_CANDIDATE_OCCURRENCES = 500;
const MAX_CONFLICTS = 10;
const MAX_BUFFER_MS = 2 * 720 * 60_000; // travel + prep upper bounds

export interface Schedule {
  start: DateTime;
  durationMs: number;
  rule: RecurrenceRule | null;
  /** Travel + prep time blocked before each occurrence. */
  bufferMs: number;
}

export function scheduleOf(e: Event): Schedule {
  return {
    start: DateTime.fromJSDate(e.startAt, { zone: e.timezone }),
    durationMs: e.endAt ? e.endAt.getTime() - e.startAt.getTime() : 0,
    rule: e.rrule ? parseRRule(e.rrule) : null,
    bufferMs: (e.travelBufferMinutes + e.prepBufferMinutes) * 60_000,
  };
}

/**
 * Busy spans are [start - buffers, end). Spans that merely touch do not clash, but two items
 * starting at the same moment always do, even when they have no duration.
 */
function clashes(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return (aStart < bEnd && bStart < aEnd) || aStart === bStart;
}

/**
 * Scheduled timed events that overlap the proposed schedule. All-day events never conflict.
 * Conflicts are advisory: the caller decides whether to ask the user before saving.
 */
export async function findConflicts(
  prisma: PrismaClient,
  userId: string,
  proposed: Schedule,
  excludeEventId?: string,
): Promise<ScheduleConflict[]> {
  const horizon = proposed.rule
    ? proposed.start.plus({ days: RECURRING_HORIZON_DAYS })
    : proposed.start.plus({ milliseconds: 1 });
  const starts = occurrencesInRange(
    proposed.start,
    proposed.durationMs,
    proposed.rule,
    proposed.start,
    horizon,
    MAX_CANDIDATE_OCCURRENCES,
  );
  const first = starts[0];
  const last = starts.at(-1);
  if (!first || !last) return [];

  const windowStart = first.toMillis() - proposed.bufferMs;
  const windowEnd = last.toMillis() + proposed.durationMs;
  const others = await prisma.event.findMany({
    where: {
      userId,
      status: 'SCHEDULED',
      allDay: false,
      ...(excludeEventId ? { id: { not: excludeEventId } } : {}),
      startAt: { lte: new Date(windowEnd + MAX_BUFFER_MS) },
      OR: [
        { rrule: { not: null } },
        { endAt: { gte: new Date(windowStart) } },
        { endAt: null, startAt: { gte: new Date(windowStart) } },
      ],
    },
    orderBy: { startAt: 'asc' },
  });

  const conflicts: ScheduleConflict[] = [];
  for (const other of others) {
    const o = scheduleOf(other);
    const otherStarts = occurrencesInRange(
      o.start,
      o.durationMs,
      o.rule,
      DateTime.fromMillis(windowStart),
      DateTime.fromMillis(windowEnd + o.bufferMs + 1),
    );
    for (const os of otherStarts) {
      const osMs = os.toMillis();
      const hit = starts.find((cs) => {
        const csMs = cs.toMillis();
        return clashes(
          csMs - proposed.bufferMs,
          csMs + proposed.durationMs,
          osMs - o.bufferMs,
          osMs + o.durationMs,
        );
      });
      if (!hit) continue;
      conflicts.push({
        occurrenceStart: hit.toISO() ?? '',
        eventId: other.id,
        title: other.title,
        kind: other.kind,
        start: os.toISO() ?? '',
        end: os.plus({ milliseconds: o.durationMs }).toISO() ?? '',
      });
      if (conflicts.length >= MAX_CONFLICTS) return conflicts;
    }
  }
  return conflicts.sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart));
}
