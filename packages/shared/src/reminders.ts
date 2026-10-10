import { z } from 'zod';

export const REMINDER_STATUSES = ['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const REMINDER_SOURCE_TYPES = ['event', 'task', 'importantDate'] as const;
export type ReminderSourceType = (typeof REMINDER_SOURCE_TYPES)[number];

export const upcomingRemindersQuerySchema = z.strictObject({
  /** How far ahead to look; the app schedules these as local notifications. */
  hours: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 7)
    .optional(),
});

export const acknowledgeReminderSchema = z.strictObject({
  action: z.enum(['COMPLETED', 'DISMISSED']),
});

export const snoozeReminderSchema = z.strictObject({
  minutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
});

export interface ReminderDto {
  id: string;
  status: ReminderStatus;
  /** UTC instant the reminder fires. */
  triggerAt: string;
  /** Start of the occurrence, with the source's timezone offset. */
  occurrenceAt: string;
  offsetMinutes: number;
  snoozeCount: number;
  sentAt: string | null;
  source: {
    type: ReminderSourceType;
    id: string;
    title: string;
    /** True for all-day events and important dates, where only the date matters. */
    dateOnly: boolean;
  };
}
