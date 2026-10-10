import type { DayPlanDto, Language, ReminderDto } from '@anbu/shared';
import type { Strings } from '@/i18n/strings';
import { formatTime } from './datetime';

/* Wording for reminders and the morning brief. No React Native imports: unit tested. */

/** The app route a reminder opens when tapped. */
export function pathFor(r: ReminderDto): string {
  switch (r.source.type) {
    case 'event':
      return `/event/${r.source.id}`;
    case 'task':
      return `/task/${r.source.id}`;
    case 'importantDate':
      return `/date/${r.source.id}`;
  }
}

export function reminderBody(r: ReminderDto, t: Strings, lang: Language): string {
  switch (r.source.type) {
    case 'event':
      if (r.source.dateOnly) return t.reminderDateBody(Math.round(r.offsetMinutes / 1440));
      return r.offsetMinutes === 0
        ? t.reminderEventNow
        : t.reminderEventBody(formatTime(r.occurrenceAt, lang));
    case 'task':
      return t.reminderTaskBody(formatTime(r.occurrenceAt, lang));
    case 'importantDate':
      return t.reminderDateBody(Math.round(r.offsetMinutes / 1440));
  }
}

/** One-line summary of a day plan, e.g. "3 events, first at 9:00 · 2 tasks to fit in". */
export function briefBody(plan: DayPlanDto, t: Strings, lang: Language): string {
  const first = plan.events[0];
  const parts = [t.briefEvents(plan.events.length, first ? formatTime(first.start, lang) : '')];
  const tasks = plan.suggestions.length + plan.unscheduled.length;
  if (tasks) parts.push(t.briefTasks(tasks));
  const date = plan.importantDates[0];
  if (date && date.daysUntil <= 1) parts.push(t.briefDate(date.title, date.daysUntil));
  return parts.join(' · ');
}
