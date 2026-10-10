import { z } from 'zod';

/**
 * A deliberately small subset of RFC 5545 RRULE that covers personal schedules:
 * FREQ (DAILY|WEEKLY|MONTHLY|YEARLY), INTERVAL, BYDAY (WEEKLY only), and COUNT or UNTIL.
 * The day of month / month for MONTHLY and YEARLY comes from the first occurrence; months that
 * lack that day (e.g. the 31st, or Feb 29) are skipped, as RFC 5545 specifies.
 */
export const RECURRENCE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Frequency = (typeof RECURRENCE_FREQUENCIES)[number];
export type Weekday = (typeof WEEKDAYS)[number];

export interface RecurrenceRule {
  freq: Frequency;
  interval: number;
  byDay?: Weekday[]; // sorted Monday-first
  count?: number;
  /** "YYYYMMDD" (inclusive local date) or "YYYYMMDDTHHMMSSZ" (inclusive UTC instant). */
  until?: string;
}

const UNTIL_RE = /^\d{8}(T\d{6}Z)?$/;

export function parseRRule(input: string): RecurrenceRule {
  const body = input
    .trim()
    .toUpperCase()
    .replace(/^RRULE:/, '');
  const parts = new Map<string, string>();
  for (const pair of body.split(';')) {
    const [name, value, ...rest] = pair.split('=');
    if (!name || !value || rest.length) throw new Error(`Malformed rule part "${pair}"`);
    if (parts.has(name)) throw new Error(`Duplicate rule part ${name}`);
    parts.set(name, value);
  }

  const freq = parts.get('FREQ');
  if (!freq || !(RECURRENCE_FREQUENCIES as readonly string[]).includes(freq)) {
    throw new Error('FREQ must be DAILY, WEEKLY, MONTHLY or YEARLY');
  }
  const rule: RecurrenceRule = { freq: freq as Frequency, interval: 1 };

  for (const [name, value] of parts) {
    switch (name) {
      case 'FREQ':
        break;
      case 'INTERVAL':
        rule.interval = parseIntInRange(value, 1, 366, 'INTERVAL');
        break;
      case 'COUNT':
        rule.count = parseIntInRange(value, 1, 1000, 'COUNT');
        break;
      case 'UNTIL':
        if (!UNTIL_RE.test(value)) throw new Error('UNTIL must be YYYYMMDD or YYYYMMDDTHHMMSSZ');
        rule.until = value;
        break;
      case 'BYDAY': {
        const days = value.split(',');
        if (!days.every((d) => (WEEKDAYS as readonly string[]).includes(d))) {
          throw new Error('BYDAY must be a list of MO,TU,WE,TH,FR,SA,SU');
        }
        rule.byDay = WEEKDAYS.filter((d) => days.includes(d));
        break;
      }
      default:
        throw new Error(`Unsupported rule part ${name}`);
    }
  }

  if (rule.byDay && rule.freq !== 'WEEKLY') throw new Error('BYDAY is only supported with WEEKLY');
  if (rule.count !== undefined && rule.until !== undefined) {
    throw new Error('COUNT and UNTIL cannot both be set');
  }
  return rule;
}

export function formatRRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay?.length) parts.push(`BYDAY=${rule.byDay.join(',')}`);
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  if (rule.until !== undefined) parts.push(`UNTIL=${rule.until}`);
  return parts.join(';');
}

function parseIntInRange(value: string, min: number, max: number, name: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a whole number`);
  const n = Number(value);
  if (n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return n;
}

/** Validates an RRULE string and normalises it to canonical form. */
export const rruleSchema = z
  .string()
  .max(200)
  .transform((value, ctx) => {
    try {
      return formatRRule(parseRRule(value));
    } catch (e) {
      ctx.addIssue({ code: 'custom', message: (e as Error).message });
      return z.NEVER;
    }
  });
