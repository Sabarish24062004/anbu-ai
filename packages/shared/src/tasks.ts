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

export const TASK_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const taskFields = {
  title: z.string().trim().min(1).max(200),
  description: optionalText(2000),
  dueAt: dateTimeInputSchema.nullable(),
  timezone: timezoneSchema,
  priority: prioritySchema,
  estimatedMinutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 7)
    .nullable(),
  category: optionalText(50),
  /** Requires dueAt. Completing a recurring task moves it to its next due date. */
  rrule: rruleSchema.nullable(),
  blockedById: z.uuid().nullable(),
  remindersEnabled: z.boolean(),
  reminderOffsets: reminderOffsetsSchema,
};

export const createTaskSchema = z
  .strictObject(taskFields)
  .partial()
  .required({ title: true })
  .refine((t) => !t.rrule || t.dueAt, { message: 'a recurring task needs dueAt', path: ['rrule'] });
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export const updateTaskSchema = z
  .strictObject({
    ...taskFields,
    // COMPLETED is set through POST /tasks/:id/complete so recurrence is handled.
    status: z.enum(['PENDING', 'IN_PROGRESS', 'CANCELLED']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'no fields to update');
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

export const listTasksQuerySchema = z.strictObject({
  /** Comma-separated statuses; defaults to open tasks (PENDING,IN_PROGRESS). */
  status: z
    .string()
    .transform((s) => s.split(',').map((x) => x.trim()))
    .pipe(z.array(z.enum(TASK_STATUSES)).min(1))
    .optional(),
  dueBefore: dateTimeInputSchema.optional(),
});

export interface TaskDto {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  timezone: string;
  priority: Priority;
  estimatedMinutes: number | null;
  category: string | null;
  status: TaskStatus;
  rrule: string | null;
  blockedById: string | null;
  remindersEnabled: boolean;
  reminderOffsets: number[];
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompleteTaskResponse {
  task: TaskDto;
  /** True when a recurring task was moved to its next due date instead of being closed. */
  rescheduled: boolean;
}
