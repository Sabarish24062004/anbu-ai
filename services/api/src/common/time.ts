import { DateTime } from 'luxon';
import { invalidField } from './validate';

/**
 * Resolves client input to a DateTime in `zone`. A value with an offset ("Z", "+05:30") is an exact
 * instant; a value without one is local wall-clock time in `zone`. A local time skipped by a DST
 * transition is moved forward by the gap (luxon's behaviour).
 */
export function parseDateTimeInput(value: string, zone: string, field: string): DateTime {
  const dt = DateTime.fromISO(value, { zone });
  if (!dt.isValid) throw invalidField(field, 'is not a valid date or time');
  return dt;
}

/** ISO 8601 with the zone's offset, so clients see both the instant and the local time. */
export function toZonedIso(date: Date, zone: string): string {
  return DateTime.fromJSDate(date, { zone }).toISO() ?? date.toISOString();
}

export const toIsoOrNull = (date: Date | null) => date?.toISOString() ?? null;

/** The date in `year`; Feb 29 is observed on Feb 28 in common years. */
export function observedDate(year: number, month: number, day: number, zone: string): DateTime {
  const exact = DateTime.fromObject({ year, month, day }, { zone });
  return exact.isValid ? exact : DateTime.fromObject({ year, month, day: day - 1 }, { zone });
}
