import { DateTime } from 'luxon';
import { expandEvent, type EventWithExceptions } from '../events/occurrences';
import { observedDate } from '../../common/time';
import type { ImportantDate, Task } from '../../generated/prisma/client';

/**
 * Reminders are materialised as rows this far ahead; an hourly job extends the window, so
 * recurring items never need an unbounded number of rows.
 */
export const HORIZON_DAYS = 7;

export interface PlanContext {
  now: DateTime;
  /** Minutes after local midnight at which date-only items (birthdays, all-day events) notify. */
  notifyMinutesOfDay: number;
}

export interface DesiredReminder {
  /** The moment the reminder is about: an event start, a due time, or a date's notify time. */
  occurrenceAt: Date;
  offsetMinutes: number;
  triggerAt: Date;
}

/**
 * Turns anchor instants into reminder triggers within the horizon. When every trigger for an
 * upcoming occurrence has already passed (e.g. an event created 5 minutes before it starts), one
 * reminder fires immediately rather than none at all.
 */
function remindersFor(anchors: DateTime[], offsets: number[], ctx: PlanContext): DesiredReminder[] {
  const horizonEnd = ctx.now.plus({ days: HORIZON_DAYS });
  const ascending = [...new Set(offsets)].sort((a, b) => a - b);
  const result: DesiredReminder[] = [];
  for (const anchor of anchors) {
    if (anchor <= ctx.now) continue;
    let planned = 0;
    for (const offset of ascending) {
      const trigger = anchor.minus({ minutes: offset });
      if (trigger < ctx.now || trigger > horizonEnd) continue;
      result.push({
        occurrenceAt: anchor.toJSDate(),
        offsetMinutes: offset,
        triggerAt: trigger.toJSDate(),
      });
      planned++;
    }
    const smallest = ascending[0];
    if (planned === 0 && smallest !== undefined && anchor.minus({ minutes: smallest }) < ctx.now) {
      result.push({
        occurrenceAt: anchor.toJSDate(),
        offsetMinutes: smallest,
        triggerAt: ctx.now.toJSDate(),
      });
    }
  }
  return result;
}

/** How far ahead anchors are needed so that every trigger inside the horizon is found. */
const lookahead = (offsets: number[], ctx: PlanContext) =>
  ctx.now.plus({ days: HORIZON_DAYS, minutes: Math.max(0, ...offsets) });

export function planEventReminders(
  event: EventWithExceptions,
  ctx: PlanContext,
): DesiredReminder[] {
  if (event.status !== 'SCHEDULED' || !event.remindersEnabled) return [];
  // All-day occurrences start at midnight; look back a day so today's notify time is included.
  const from = event.allDay ? ctx.now.minus({ days: 1 }) : ctx.now;
  // Skipped occurrences get no reminder; moved ones are reminded at their new time.
  const starts = expandEvent(event, from, lookahead(event.reminderOffsets, ctx)).map(
    (o) => o.start,
  );
  const anchors = event.allDay
    ? starts.map((s) => s.startOf('day').plus({ minutes: ctx.notifyMinutesOfDay }))
    : starts;
  return remindersFor(anchors, event.reminderOffsets, ctx);
}

export function planTaskReminders(task: Task, ctx: PlanContext): DesiredReminder[] {
  const open = task.status === 'PENDING' || task.status === 'IN_PROGRESS';
  if (!open || !task.remindersEnabled || !task.dueAt) return [];
  return remindersFor(
    [DateTime.fromJSDate(task.dueAt, { zone: task.timezone })],
    task.reminderOffsets,
    ctx,
  );
}

export function planImportantDateReminders(d: ImportantDate, ctx: PlanContext): DesiredReminder[] {
  if (!d.remindersEnabled) return [];
  const today = ctx.now.setZone(d.timezone);
  const years = d.recursAnnually ? [today.year, today.year + 1] : d.year ? [d.year] : [];
  const end = lookahead(d.reminderOffsets, ctx);
  const anchors = years
    .map((y) =>
      observedDate(y, d.month, d.day, d.timezone).plus({ minutes: ctx.notifyMinutesOfDay }),
    )
    .filter((a) => a <= end);
  return remindersFor(anchors, d.reminderOffsets, ctx);
}
