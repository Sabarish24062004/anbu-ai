import { z } from 'zod';

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimezone, 'must be a valid IANA timezone');

/**
 * ISO 8601 date ("2026-10-11") or date-time, with or without an offset. A value without an offset
 * is a local wall-clock time in the record's timezone; the API resolves it to an instant.
 */
export const dateTimeInputSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/,
    'must be an ISO 8601 date or date-time',
  );

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const prioritySchema = z.enum(PRIORITIES);
export type Priority = z.infer<typeof prioritySchema>;

const MAX_REMINDER_OFFSET_MINUTES = 60 * 24 * 60; // 60 days

/** Minutes before the occurrence; de-duplicated and sorted earliest-first (largest offset first). */
export const reminderOffsetsSchema = z
  .array(z.number().int().min(0).max(MAX_REMINDER_OFFSET_MINUTES))
  .max(5)
  .transform((offsets) => [...new Set(offsets)].sort((a, b) => b - a));

export const optionalText = (max: number) => z.string().trim().max(max).nullish();

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
