import { DateTime, type DurationLikeObject } from 'luxon';
import { WEEKDAYS, type RecurrenceRule } from '@anbu/shared';

// Upper bound on generated periods, so a pathological rule can never spin forever.
const MAX_PERIODS = 50_000;

const UNIT: Record<RecurrenceRule['freq'], keyof DurationLikeObject> = {
  DAILY: 'days',
  WEEKLY: 'weeks',
  MONTHLY: 'months',
  YEARLY: 'years',
};

function isAfterUntil(dt: DateTime, until: string): boolean {
  if (until.length === 8) {
    const untilDate = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
    return (dt.toISODate() ?? '') > untilDate;
  }
  return (
    dt.toMillis() > DateTime.fromFormat(until, "yyyyMMdd'T'HHmmss'Z'", { zone: 'utc' }).toMillis()
  );
}

/** Occurrence starts for one period `offset` units after `start` (wall-clock arithmetic). */
function periodCandidates(start: DateTime, rule: RecurrenceRule, offset: number): DateTime[] {
  switch (rule.freq) {
    case 'DAILY':
      return [start.plus({ days: offset })];
    case 'WEEKLY': {
      if (!rule.byDay?.length) return [start.plus({ weeks: offset })];
      const weekStart = start.startOf('week').plus({ weeks: offset }); // ISO weeks start Monday
      const time = { hour: start.hour, minute: start.minute, second: start.second, millisecond: 0 };
      return rule.byDay.map((d) => weekStart.plus({ days: WEEKDAYS.indexOf(d) }).set(time));
    }
    case 'MONTHLY': {
      const dt = start.plus({ months: offset });
      return dt.day === start.day ? [dt] : []; // luxon clamps the 31st; RFC 5545 skips the month
    }
    case 'YEARLY': {
      const dt = start.plus({ years: offset });
      return dt.day === start.day ? [dt] : []; // Feb 29 only in leap years
    }
  }
}

/**
 * Yields occurrence starts in order, keeping the local wall-clock time of `start` across DST.
 * `skipTo` lets rules without COUNT jump close to a later window instead of walking from the start.
 */
export function* occurrenceStarts(
  start: DateTime,
  rule: RecurrenceRule,
  skipTo?: DateTime,
): Generator<DateTime> {
  const unit = UNIT[rule.freq];
  let period = 0;
  if (skipTo && rule.count === undefined && skipTo > start) {
    const elapsed = skipTo.diff(start, unit).get(unit);
    period = Math.max(0, Math.floor(elapsed / rule.interval) - 1);
  }
  let emitted = 0;
  for (let i = 0; i < MAX_PERIODS; i++, period++) {
    for (const dt of periodCandidates(start, rule, period * rule.interval)) {
      if (dt < start) continue;
      if (rule.until && isAfterUntil(dt, rule.until)) return;
      yield dt;
      if (rule.count !== undefined && ++emitted >= rule.count) return;
    }
  }
}

/**
 * Starts of occurrences whose span [start, start + durationMs] intersects [from, to).
 * A non-recurring item is a single occurrence at `start`.
 */
export function occurrencesInRange(
  start: DateTime,
  durationMs: number,
  rule: RecurrenceRule | null,
  from: DateTime,
  to: DateTime,
  limit = 1000,
): DateTime[] {
  const fromMs = from.toMillis();
  const toMs = to.toMillis();
  const intersects = (s: DateTime) => {
    const ms = s.toMillis();
    return ms < toMs && (ms >= fromMs || ms + durationMs > fromMs);
  };
  if (!rule) return intersects(start) ? [start] : [];

  const result: DateTime[] = [];
  for (const s of occurrenceStarts(start, rule, from.minus({ milliseconds: durationMs }))) {
    if (s.toMillis() >= toMs || result.length >= limit) break;
    if (intersects(s)) result.push(s);
  }
  return result;
}

/** The first occurrence strictly after `after`, or null when the rule has ended. */
export function nextOccurrenceAfter(
  start: DateTime,
  rule: RecurrenceRule,
  after: DateTime,
): DateTime | null {
  for (const s of occurrenceStarts(start, rule, after)) {
    if (s > after) return s;
  }
  return null;
}
