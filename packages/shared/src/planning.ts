import { z } from 'zod';
import type { Priority } from './validation';

export const dayPlanQuerySchema = z.strictObject({
  /** Local date, YYYY-MM-DD. Defaults to today in the user's timezone. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
    .optional(),
});

export interface PlanBlock {
  start: string;
  end: string;
}

export interface PlanEvent extends PlanBlock {
  eventId: string;
  title: string;
  location: string | null;
  /** Travel + prep time blocked before the start, in minutes. */
  bufferMinutes: number;
}

export interface PlanSuggestion extends PlanBlock {
  taskId: string;
  title: string;
  priority: Priority;
  /** Why it was placed: overdue, due today, or high priority without a due date. */
  reason: 'overdue' | 'due_today' | 'high_priority';
  /** True when the only time left is after the task's due time. */
  afterDue: boolean;
}

export interface PlanUnscheduled {
  taskId: string;
  title: string;
  reason: 'no_time' | 'blocked';
}

export interface DayPlanDto {
  /** YYYY-MM-DD in the user's timezone. */
  date: string;
  timezone: string;
  /** The part of the day being planned: wake → sleep, starting now if the day has begun. */
  window: PlanBlock | null;
  events: PlanEvent[];
  allDayEvents: { eventId: string; title: string }[];
  /** Free time still open after the suggested tasks are placed. */
  freeSlots: PlanBlock[];
  suggestions: PlanSuggestion[];
  unscheduled: PlanUnscheduled[];
  importantDates: { title: string; date: string; daysUntil: number }[];
  /** Minutes of free time left after the suggestions. */
  freeMinutes: number;
}
