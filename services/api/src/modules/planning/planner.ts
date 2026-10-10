import { DateTime } from 'luxon';
import type { PlanSuggestion, PlanUnscheduled, Priority } from '@anbu/shared';

/*
 * Deterministic day planner: no model involved, so it works offline and gives the same answer
 * every time. It only suggests; nothing is saved.
 */

export const DEFAULT_WAKE_MINUTES = 7 * 60;
export const DEFAULT_SLEEP_MINUTES = 22 * 60;
const DEFAULT_TASK_MINUTES = 30;
const MIN_TASK_MINUTES = 5;
const MAX_TASK_MINUTES = 240;
// A point-in-time event (no end) still takes some of the day.
const POINT_EVENT_MINUTES = 30;
const MIN_SLOT_MINUTES = 10;
const ROUND_TO_MINUTES = 5;

const PRIORITY_RANK: Record<Priority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export interface PlannerEvent {
  eventId: string;
  title: string;
  location: string | null;
  start: DateTime;
  end: DateTime | null;
  allDay: boolean;
  bufferMinutes: number;
}

export interface PlannerTask {
  id: string;
  title: string;
  priority: Priority;
  dueAt: DateTime | null;
  estimatedMinutes: number | null;
  blocked: boolean;
  createdAt: DateTime;
}

export interface PlannerInput {
  /** Local midnight of the day to plan, in the user's timezone. */
  day: DateTime;
  now: DateTime;
  wakeMinutes: number | null;
  sleepMinutes: number | null;
  events: PlannerEvent[];
  tasks: PlannerTask[];
}

interface Interval {
  start: DateTime;
  end: DateTime;
}

const minutes = (i: Interval) => i.end.diff(i.start, 'minutes').minutes;

function roundUp(dt: DateTime): DateTime {
  const rounded = dt.startOf('minute');
  const extra = (ROUND_TO_MINUTES - (rounded.minute % ROUND_TO_MINUTES)) % ROUND_TO_MINUTES;
  return rounded.plus({ minutes: extra || (dt > rounded ? ROUND_TO_MINUTES : 0) });
}

/** Wake → sleep for the day; a sleep time at or before the wake time means after midnight. */
export function dayWindow(input: PlannerInput): Interval | null {
  const wake = input.day.plus({ minutes: input.wakeMinutes ?? DEFAULT_WAKE_MINUTES });
  let sleep = input.day.plus({ minutes: input.sleepMinutes ?? DEFAULT_SLEEP_MINUTES });
  if (sleep <= wake) sleep = sleep.plus({ days: 1 });
  const start = input.now > wake ? roundUp(input.now) : wake;
  return start < sleep ? { start, end: sleep } : null;
}

/** The window minus every busy interval, as sorted gaps of at least MIN_SLOT_MINUTES. */
export function freeSlots(window: Interval, busy: Interval[]): Interval[] {
  const sorted = [...busy].sort((a, b) => a.start.toMillis() - b.start.toMillis());
  const slots: Interval[] = [];
  let cursor = window.start;
  for (const b of sorted) {
    if (b.end <= cursor) continue;
    if (b.start >= window.end) break;
    if (b.start > cursor) slots.push({ start: cursor, end: b.start });
    if (b.end > cursor) cursor = b.end;
  }
  if (cursor < window.end) slots.push({ start: cursor, end: window.end });
  return slots.filter((s) => minutes(s) >= MIN_SLOT_MINUTES);
}

function reasonFor(task: PlannerTask, input: PlannerInput): PlanSuggestion['reason'] | null {
  const dayEnd = input.day.plus({ days: 1 });
  const overdueBefore = input.day.hasSame(input.now, 'day') ? input.now : input.day;
  if (task.dueAt && task.dueAt < overdueBefore) return 'overdue';
  if (task.dueAt && task.dueAt < dayEnd) return 'due_today';
  if (!task.dueAt && (task.priority === 'HIGH' || task.priority === 'URGENT')) {
    return 'high_priority';
  }
  return null;
}

export function planDay(input: PlannerInput) {
  const window = dayWindow(input);
  const timed = input.events.filter((e) => !e.allDay);
  const busy = timed.map((e) => ({
    start: e.start.minus({ minutes: e.bufferMinutes }),
    end: e.end && e.end > e.start ? e.end : e.start.plus({ minutes: POINT_EVENT_MINUTES }),
  }));
  let slots = window ? freeSlots(window, busy) : [];

  const candidates = input.tasks
    .map((task) => ({ task, reason: reasonFor(task, input) }))
    .filter((c): c is { task: PlannerTask; reason: PlanSuggestion['reason'] } => c.reason !== null)
    .sort(
      (a, b) =>
        Number(b.reason === 'overdue') - Number(a.reason === 'overdue') ||
        (a.task.dueAt?.toMillis() ?? Infinity) - (b.task.dueAt?.toMillis() ?? Infinity) ||
        PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority] ||
        a.task.createdAt.toMillis() - b.task.createdAt.toMillis(),
    );

  const suggestions: PlanSuggestion[] = [];
  const unscheduled: PlanUnscheduled[] = [];
  for (const { task, reason } of candidates) {
    if (task.blocked) {
      unscheduled.push({ taskId: task.id, title: task.title, reason: 'blocked' });
      continue;
    }
    const length = Math.min(
      MAX_TASK_MINUTES,
      Math.max(MIN_TASK_MINUTES, task.estimatedMinutes ?? DEFAULT_TASK_MINUTES),
    );
    const fits = (s: Interval) => minutes(s) >= length;
    const beforeDue = (s: Interval) =>
      !task.dueAt || reason !== 'due_today' || s.start.plus({ minutes: length }) <= task.dueAt;
    const slot = slots.find((s) => fits(s) && beforeDue(s)) ?? slots.find(fits);
    if (!slot) {
      unscheduled.push({ taskId: task.id, title: task.title, reason: 'no_time' });
      continue;
    }
    const end = slot.start.plus({ minutes: length });
    suggestions.push({
      taskId: task.id,
      title: task.title,
      priority: task.priority,
      reason,
      start: slot.start.toISO() ?? '',
      end: end.toISO() ?? '',
      afterDue: reason === 'due_today' && !!task.dueAt && end > task.dueAt,
    });
    // Use the start of the slot; keep the rest if it is still worth having.
    slots = slots
      .map((s) => (s === slot ? { start: end, end: s.end } : s))
      .filter((s) => minutes(s) >= MIN_SLOT_MINUTES);
  }

  return {
    window,
    freeSlots: slots,
    suggestions: suggestions.sort((a, b) => a.start.localeCompare(b.start)),
    unscheduled,
    freeMinutes: Math.round(slots.reduce((sum, s) => sum + minutes(s), 0)),
  };
}
