import { z } from 'zod';
import { rruleSchema } from './recurrence';
import {
  dateTimeInputSchema,
  optionalText,
  prioritySchema,
  reminderOffsetsSchema,
  timezoneSchema,
  type Priority,
} from './validation';

export const EVENT_KINDS = ['FIXED', 'FLEXIBLE'] as const;
export const EVENT_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export type EventStatus = (typeof EVENT_STATUSES)[number];

const bufferMinutes = z.number().int().min(0).max(720);

const eventFields = {
  title: z.string().trim().min(1).max(200),
  description: optionalText(2000),
  /** Local wall-clock time in `timezone` unless an offset is given. For all-day events, a date. */
  startAt: dateTimeInputSchema,
  /** For all-day events, the inclusive last date. */
  endAt: dateTimeInputSchema.nullish(),
  allDay: z.boolean(),
  /** Defaults to the user's timezone. */
  timezone: timezoneSchema,
  rrule: rruleSchema.nullish(),
  kind: z.enum(EVENT_KINDS),
  location: optionalText(300),
  category: optionalText(50),
  priority: prioritySchema,
  personName: optionalText(100),
  travelBufferMinutes: bufferMinutes,
  prepBufferMinutes: bufferMinutes,
  remindersEnabled: z.boolean(),
  reminderOffsets: reminderOffsetsSchema,
};

/** Set to save despite schedule conflicts, after the user has confirmed. */
const allowConflicts = z.boolean().optional();

export const createEventSchema = z.strictObject({
  ...eventFields,
  allDay: eventFields.allDay.optional(),
  timezone: eventFields.timezone.optional(),
  kind: eventFields.kind.optional(),
  priority: eventFields.priority.optional(),
  travelBufferMinutes: bufferMinutes.optional(),
  prepBufferMinutes: bufferMinutes.optional(),
  remindersEnabled: eventFields.remindersEnabled.optional(),
  reminderOffsets: eventFields.reminderOffsets.optional(),
  allowConflicts,
});
export type CreateEventInput = z.input<typeof createEventSchema>;

export const updateEventSchema = z
  .strictObject(eventFields)
  .partial()
  .extend({ allowConflicts })
  .refine((v) => Object.keys(v).some((k) => k !== 'allowConflicts'), 'no fields to update');
export type UpdateEventInput = z.input<typeof updateEventSchema>;

export const listEventsQuerySchema = z.strictObject({
  from: dateTimeInputSchema.optional(),
  to: dateTimeInputSchema.optional(),
  includeCancelled: z.enum(['true', 'false']).optional(),
});

export interface EventDto {
  id: string;
  title: string;
  description: string | null;
  /** ISO 8601 with the offset of `timezone`, e.g. "2026-10-11T07:00:00.000+05:30". */
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  timezone: string;
  rrule: string | null;
  kind: EventKind;
  location: string | null;
  category: string | null;
  priority: Priority;
  personName: string | null;
  status: EventStatus;
  travelBufferMinutes: number;
  prepBufferMinutes: number;
  remindersEnabled: boolean;
  reminderOffsets: number[];
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleConflict {
  /** Start of the proposed occurrence that clashes. */
  occurrenceStart: string;
  eventId: string;
  title: string;
  kind: EventKind;
  start: string;
  end: string;
}

export interface EventMutationResponse {
  event: EventDto;
  conflicts: ScheduleConflict[];
}

export interface EventOccurrenceDto {
  eventId: string;
  start: string;
  end: string;
  event: EventDto;
}
