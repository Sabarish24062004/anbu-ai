import { DateTime } from 'luxon';
import { parseRRule } from '@anbu/shared';
import { occurrencesInRange } from '../../common/recurrence';
import type { Event, EventException } from '../../generated/prisma/client';

/** Prisma include that loads what `expandEvent` needs. */
export const withExceptions = { exceptions: true } as const;

/** Exceptions must be loaded: forgetting them would silently show skipped or moved occurrences. */
export type EventWithExceptions = Event & { exceptions: EventException[] };

export interface Occurrence {
  /** Where the rule puts this occurrence; identifies it for skip/move. */
  originalStart: DateTime;
  /** When it actually happens (differs from originalStart when moved). */
  start: DateTime;
  durationMs: number;
  moved: boolean;
}

/**
 * Occurrences of an event (recurring or not) whose span intersects [from, to), with skipped
 * occurrences removed and moved ones at their new time. Times are in the event's timezone.
 */
export function expandEvent(
  e: EventWithExceptions,
  from: DateTime,
  to: DateTime,
  limit = 1000,
): Occurrence[] {
  const zone = e.timezone;
  const start = DateTime.fromJSDate(e.startAt, { zone });
  const durationMs = e.endAt ? e.endAt.getTime() - e.startAt.getTime() : 0;
  const rule = e.rrule ? parseRRule(e.rrule) : null;
  const changed = new Map(e.exceptions.map((x) => [x.originalStart.getTime(), x]));

  const result: Occurrence[] = occurrencesInRange(start, durationMs, rule, from, to)
    .filter((s) => !changed.has(s.toMillis()))
    .map((s) => ({ originalStart: s, start: s, durationMs, moved: false }));

  const fromMs = from.toMillis();
  const toMs = to.toMillis();
  for (const x of e.exceptions) {
    if (x.kind !== 'MOVED' || !x.startAt) continue;
    const s = x.startAt.getTime();
    const dur = x.endAt ? x.endAt.getTime() - s : durationMs;
    if (s < toMs && (s >= fromMs || s + dur > fromMs)) {
      result.push({
        originalStart: DateTime.fromJSDate(x.originalStart, { zone }),
        start: DateTime.fromJSDate(x.startAt, { zone }),
        durationMs: dur,
        moved: true,
      });
    }
  }
  return result.sort((a, b) => a.start.toMillis() - b.start.toMillis()).slice(0, limit);
}
