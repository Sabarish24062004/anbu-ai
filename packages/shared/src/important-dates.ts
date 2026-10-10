import { z } from 'zod';
import { optionalText, reminderOffsetsSchema, timezoneSchema } from './validation';

export const IMPORTANT_DATE_TYPES = [
  'BIRTHDAY',
  'ANNIVERSARY',
  'MILESTONE',
  'FESTIVAL',
  'CUSTOM',
] as const;
export type ImportantDateType = (typeof IMPORTANT_DATE_TYPES)[number];

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function isValidMonthDay(month: number, day: number, year?: number | null): boolean {
  const max = DAYS_IN_MONTH[month - 1];
  if (max === undefined || day < 1 || day > max) return false;
  return !(month === 2 && day === 29 && year != null && !isLeapYear(year));
}

const importantDateFields = {
  title: z.string().trim().min(1).max(200),
  type: z.enum(IMPORTANT_DATE_TYPES),
  personName: optionalText(100),
  relationship: optionalText(50),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  /** The original year (e.g. birth year), if known. Required for one-off dates. */
  year: z.number().int().min(1900).max(2200).nullish(),
  recursAnnually: z.boolean(),
  timezone: timezoneSchema,
  contactInfo: optionalText(200),
  notes: optionalText(2000),
  remindersEnabled: z.boolean(),
  /** Minutes before the user's notify time on the day: 1440 = previous day, 0 = on the day. */
  reminderOffsets: reminderOffsetsSchema,
};

type DateParts = { month?: number; day?: number; year?: number | null; recursAnnually?: boolean };
const checkDateParts = (v: DateParts, ctx: z.RefinementCtx) => {
  if (v.month !== undefined && v.day !== undefined && !isValidMonthDay(v.month, v.day, v.year)) {
    ctx.addIssue({ code: 'custom', path: ['day'], message: 'not a valid day for that month' });
  }
  if (v.recursAnnually === false && v.year == null) {
    ctx.addIssue({ code: 'custom', path: ['year'], message: 'a one-off date needs a year' });
  }
};

export const createImportantDateSchema = z
  .strictObject(importantDateFields)
  .partial({
    recursAnnually: true,
    timezone: true,
    remindersEnabled: true,
    reminderOffsets: true,
  })
  .superRefine(checkDateParts);
export type CreateImportantDateInput = z.input<typeof createImportantDateSchema>;

/** Date parts are re-validated against the stored record by the service when only some change. */
export const updateImportantDateSchema = z
  .strictObject(importantDateFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'no fields to update');
export type UpdateImportantDateInput = z.input<typeof updateImportantDateSchema>;

export const upcomingImportantDatesQuerySchema = z.strictObject({
  days: z.coerce.number().int().min(1).max(366).optional(),
});

export interface ImportantDateDto {
  id: string;
  title: string;
  type: ImportantDateType;
  personName: string | null;
  relationship: string | null;
  month: number;
  day: number;
  year: number | null;
  recursAnnually: boolean;
  timezone: string;
  contactInfo: string | null;
  notes: string | null;
  remindersEnabled: boolean;
  reminderOffsets: number[];
  createdAt: string;
  updatedAt: string;
}

export interface UpcomingImportantDateDto {
  importantDate: ImportantDateDto;
  /** Local date of the next occurrence, "YYYY-MM-DD". Feb 29 falls on Feb 28 in common years. */
  date: string;
  daysUntil: number;
  /** e.g. the age turned on a birthday; null when the original year is unknown. */
  yearsSince: number | null;
}
