import type { Language } from '@anbu/shared';

/*
 * The API returns times as ISO strings carrying the record's own offset, e.g.
 * "2027-01-04T07:00:00.000+05:30". The leading "YYYY-MM-DDTHH:mm" is therefore the wall-clock time
 * in the record's timezone, which is what the user expects to see. Formatting works on those wall
 * parts directly, so it does not depend on the phone's timezone.
 */

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;

export const localeFor = (lang: Language) => (lang === 'ta' ? 'ta-IN' : 'en-IN');

/** A Date whose UTC fields equal the wall-clock fields of `iso`; format it with timeZone UTC. */
function wallAsUtc(iso: string): Date {
  const m = WALL_RE.exec(iso);
  if (!m) return new Date(NaN);
  const [, y, mo, d, h = '0', mi = '0'] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)));
}

export function formatTime(iso: string, lang: Language): string {
  return new Intl.DateTimeFormat(localeFor(lang), {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(wallAsUtc(iso));
}

export function formatDate(iso: string, lang: Language, withYear = false): string {
  return new Intl.DateTimeFormat(localeFor(lang), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(wallAsUtc(iso));
}

export function formatMonthDay(month: number, day: number, lang: Language): string {
  return new Intl.DateTimeFormat(localeFor(lang), {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, month - 1, day)));
}

/** "YYYY-MM-DD" of a wall-clock ISO string. */
export const dayKey = (iso: string) => iso.slice(0, 10);

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" for a Date using the phone's local calendar. */
export const toLocalDateString = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * "YYYY-MM-DDTHH:mm" without an offset: the API reads it as wall-clock time in the user's
 * timezone, which is what the user picked on the phone.
 */
export const toLocalDateTimeString = (d: Date) =>
  `${toLocalDateString(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** A phone-local Date with the same wall-clock fields as `iso`, to seed a picker. */
export function wallToLocalDate(iso: string): Date {
  const m = WALL_RE.exec(iso);
  if (!m) return new Date();
  const [, y, mo, d, h = '0', mi = '0'] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
}

/** A Date today at `minutes` after midnight (for time pickers). */
export function minutesToDate(minutes: number): Date {
  const d = startOfToday();
  d.setMinutes(minutes);
  return d;
}

export const dateToMinutes = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** "1 h 30 min" style duration. */
export function formatDuration(totalMinutes: number, lang: Language): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (lang === 'ta')
    return [h ? `${h} மணி` : '', m ? `${m} நிமி` : ''].filter(Boolean).join(' ') || '0';
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ') || '0 min';
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The next quarter hour, a sensible default for a new event. */
export function nextQuarterHour(): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15);
  return d;
}

/** The phone's IANA timezone, if the runtime exposes it. */
export function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
