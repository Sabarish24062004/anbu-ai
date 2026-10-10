import { DateTime } from 'luxon';
import { z } from 'zod';
import {
  createEventSchema,
  createImportantDateSchema,
  createTaskSchema,
  dateTimeInputSchema,
  IMPORTANT_DATE_TYPES,
  PRIORITIES,
  WEEKDAYS,
  type AssistantActionDto,
  type CreateEventInput,
  type EventDto,
  type Language,
  type PendingActionDto,
  type ScheduleConflict,
  type UpdateEventInput,
  updateEventSchema,
} from '@anbu/shared';
import { AppError } from '../../common/errors';
import { parseDateTimeInput } from '../../common/time';
import { parseInput } from '../../common/validate';
import type { PrismaClient } from '../../database/prisma';
import {
  createEvent,
  getEvent,
  listOccurrences,
  searchEvents,
  updateEvent,
} from '../events/events.service';
import { createImportantDate, listUpcoming } from '../important-dates/important-dates.service';
import { forgetMemory, listMemories, saveMemory } from '../memory/memory.service';
import { getDayPlan } from '../planning/planning.service';
import { completeTask, createTask, listTasks } from '../tasks/tasks.service';
import type { ToolSpec } from './llm/types';
import { formatWhen, messages } from './messages';

export interface ToolContext {
  prisma: PrismaClient;
  userId: string;
  timezone: string;
  language: Language;
}

/** A change that waits for the user's "yes": a cancellation, or saving despite a clash. */
export type PendingSpec =
  | { kind: 'create_event'; input: CreateEventInput }
  | { kind: 'update_event'; eventId: string; input: UpdateEventInput }
  | { kind: 'cancel_event'; eventId: string };

export interface ToolOutcome {
  /** What the model sees. Never includes another user's data (every call is user-scoped). */
  result: unknown;
  action?: AssistantActionDto;
  pending?: { spec: PendingSpec; summary: string; conflicts: ScheduleConflict[] };
}

interface Tool<A extends z.ZodType> {
  spec: ToolSpec;
  args: A;
  run(ctx: ToolContext, args: z.output<A>): Promise<ToolOutcome>;
}

const tool = <A extends z.ZodType>(t: Tool<A>) => t;

// ---------------------------------------------------------------------------------------------
// Argument schemas. Models sometimes send null for omitted fields; nulls are stripped first.

const localDateTime = dateTimeInputSchema.describe('local time');
const REPEATS = ['none', 'daily', 'weekly', 'monthly', 'yearly'] as const;

function repeatRule(repeat?: (typeof REPEATS)[number], days?: string[]): string | null {
  if (!repeat || repeat === 'none') return null;
  const byDay = repeat === 'weekly' && days?.length ? `;BYDAY=${days.join(',')}` : '';
  return `FREQ=${repeat.toUpperCase()}${byDay}`;
}

const eventSummary = (e: EventDto) => ({
  id: e.id,
  title: e.title,
  start: e.startAt,
  end: e.endAt,
  allDay: e.allDay,
  repeats: e.rrule,
  location: e.location,
});

const conflictSummary = (conflicts: ScheduleConflict[]) =>
  conflicts.map((c) => ({ title: c.title, start: c.start, end: c.end }));

/** Runs a create/update and turns a schedule clash into a pending confirmation. */
async function withConflictCheck(
  run: () => Promise<{ event: EventDto }>,
  onConflict: (conflicts: ScheduleConflict[]) => ToolOutcome,
): Promise<{ event: EventDto } | ToolOutcome> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof AppError && e.code === 'SCHEDULE_CONFLICT') {
      const conflicts = (e.details as { conflicts: ScheduleConflict[] }).conflicts;
      return onConflict(conflicts);
    }
    throw e;
  }
}

const needsConfirmation = (summary: string, conflicts: ScheduleConflict[]) => ({
  status: 'needs_confirmation',
  summary,
  conflicts: conflictSummary(conflicts),
  instruction:
    'Nothing is saved yet. Tell the user briefly and ask them to confirm. If they agree, call confirm_pending_action.',
});

// ---------------------------------------------------------------------------------------------

const TOOLS = {
  get_agenda: tool({
    spec: {
      name: 'get_agenda',
      description:
        "List the user's events (with repeating events expanded) between two local dates. Use for any question about what is scheduled.",
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'First local date, YYYY-MM-DD.' },
          days: { type: 'integer', description: 'Number of days to include, 1-31. Default 1.' },
        },
        required: ['from'],
      },
    },
    args: z.object({ from: localDateTime, days: z.number().int().min(1).max(31).optional() }),
    async run(ctx, { from, days }) {
      const start = parseDateTimeInput(from, ctx.timezone, 'from').startOf('day');
      const to = start.plus({ days: days ?? 1 });
      const res = await listOccurrences(ctx.prisma, ctx.userId, {
        from: start.toISO() ?? from,
        to: to.toISO() ?? undefined,
      });
      return {
        result: {
          occurrences: res.occurrences.map((o) => ({
            eventId: o.eventId,
            title: o.event.title,
            start: o.start,
            end: o.end,
            allDay: o.event.allDay,
            status: o.event.status,
            location: o.event.location,
          })),
        },
      };
    },
  }),

  search_events: tool({
    spec: {
      name: 'search_events',
      description:
        'Find scheduled events by words in the title, location or person, to get the eventId needed to change or cancel one. Searches the next 90 days unless a range is given.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words to look for, e.g. "dentist".' },
          from: { type: 'string', description: 'Optional first local date, YYYY-MM-DD.' },
          to: { type: 'string', description: 'Optional last local date, YYYY-MM-DD.' },
        },
        required: ['query'],
      },
    },
    args: z.object({
      query: z.string().trim().min(1).max(100),
      from: localDateTime.optional(),
      to: localDateTime.optional(),
    }),
    async run(ctx, { query, from, to }) {
      const start = from
        ? parseDateTimeInput(from, ctx.timezone, 'from').startOf('day')
        : DateTime.now().setZone(ctx.timezone).startOf('day');
      const end = to
        ? parseDateTimeInput(to, ctx.timezone, 'to').endOf('day')
        : start.plus({ days: 90 });
      const found = await searchEvents(ctx.prisma, ctx.userId, query, start, end);
      return {
        result: {
          events: found.map((f) => ({ ...eventSummary(f.event), nextStart: f.nextStart })),
        },
      };
    },
  }),

  create_event: tool({
    spec: {
      name: 'create_event',
      description:
        'Add an event or appointment to the calendar. Times are local wall-clock times in the user timezone, formatted YYYY-MM-DDTHH:mm (or YYYY-MM-DD for all-day). If the time clashes with other events the result is needs_confirmation.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short title in the user’s language.' },
          startAt: { type: 'string', description: 'Local start, YYYY-MM-DDTHH:mm.' },
          endAt: { type: 'string', description: 'Optional local end, YYYY-MM-DDTHH:mm.' },
          allDay: { type: 'boolean' },
          repeat: { type: 'string', enum: [...REPEATS] },
          repeatDays: {
            type: 'array',
            items: { type: 'string', enum: [...WEEKDAYS] },
            description: 'For weekly repeats on specific days, e.g. ["MO","WE"].',
          },
          location: { type: 'string' },
          personName: { type: 'string', description: 'Person the event is with, if any.' },
          reminderMinutesBefore: {
            type: 'integer',
            description: 'Only if the user asked for a specific reminder time.',
          },
          travelMinutes: { type: 'integer', description: 'Travel time to block before it.' },
        },
        required: ['title', 'startAt'],
      },
    },
    args: z.object({
      title: z.string(),
      startAt: z.string(),
      endAt: z.string().optional(),
      allDay: z.boolean().optional(),
      repeat: z.enum(REPEATS).optional(),
      repeatDays: z.array(z.enum(WEEKDAYS)).optional(),
      location: z.string().optional(),
      personName: z.string().optional(),
      reminderMinutesBefore: z.number().int().optional(),
      travelMinutes: z.number().int().optional(),
    }),
    async run(ctx, a) {
      const input = parseInput(createEventSchema, {
        title: a.title,
        startAt: a.startAt,
        endAt: a.endAt,
        allDay: a.allDay,
        rrule: repeatRule(a.repeat, a.repeatDays),
        location: a.location,
        personName: a.personName,
        reminderOffsets:
          a.reminderMinutesBefore === undefined ? undefined : [a.reminderMinutesBefore],
        travelBufferMinutes: a.travelMinutes,
      });
      const outcome = await withConflictCheck(
        () => createEvent(ctx.prisma, ctx.userId, input),
        (conflicts) => {
          const when = formatWhen(input.startAt, ctx.language);
          const summary = messages(ctx.language).confirmCreate(input.title, when);
          return {
            result: needsConfirmation(summary, conflicts),
            pending: { spec: { kind: 'create_event', input }, summary, conflicts },
          };
        },
      );
      if (!('event' in outcome)) return outcome;
      const e = outcome.event;
      return {
        result: { status: 'created', event: eventSummary(e) },
        action: eventAction('event.created', e),
      };
    },
  }),

  update_event: tool({
    spec: {
      name: 'update_event',
      description:
        'Change an existing event (find its eventId with search_events or get_agenda first). Only include fields that change. Moving the start keeps the duration.',
      parameters: {
        type: 'object',
        properties: {
          eventId: { type: 'string' },
          title: { type: 'string' },
          startAt: { type: 'string', description: 'New local start, YYYY-MM-DDTHH:mm.' },
          endAt: { type: 'string', description: 'New local end, YYYY-MM-DDTHH:mm.' },
          location: { type: 'string' },
        },
        required: ['eventId'],
      },
    },
    args: z.object({
      eventId: z.uuid(),
      title: z.string().optional(),
      startAt: z.string().optional(),
      endAt: z.string().optional(),
      location: z.string().optional(),
    }),
    async run(ctx, { eventId, ...changes }) {
      const current = await getEvent(ctx.prisma, ctx.userId, eventId); // 404 if not the user's
      const input: UpdateEventInput = parseInput(updateEventSchema, changes);
      const outcome = await withConflictCheck(
        () => updateEvent(ctx.prisma, ctx.userId, eventId, input),
        (conflicts) => {
          const title = input.title ?? current.title;
          const when = formatWhen(input.startAt ?? current.startAt, ctx.language);
          const summary = messages(ctx.language).confirmUpdate(title, when);
          return {
            result: needsConfirmation(summary, conflicts),
            pending: { spec: { kind: 'update_event', eventId, input }, summary, conflicts },
          };
        },
      );
      if (!('event' in outcome)) return outcome;
      return {
        result: { status: 'updated', event: eventSummary(outcome.event) },
        action: eventAction('event.updated', outcome.event),
      };
    },
  }),

  cancel_event: tool({
    spec: {
      name: 'cancel_event',
      description:
        'Cancel an event. Always needs the user’s confirmation: the result is needs_confirmation and nothing changes until they agree.',
      parameters: {
        type: 'object',
        properties: { eventId: { type: 'string' } },
        required: ['eventId'],
      },
    },
    args: z.object({ eventId: z.uuid() }),
    async run(ctx, { eventId }) {
      const event = await getEvent(ctx.prisma, ctx.userId, eventId);
      const summary = messages(ctx.language).confirmCancel(
        event.title,
        formatWhen(event.startAt, ctx.language),
      );
      return {
        result: needsConfirmation(summary, []),
        pending: { spec: { kind: 'cancel_event', eventId }, summary, conflicts: [] },
      };
    },
  }),

  list_tasks: tool({
    spec: {
      name: 'list_tasks',
      description: 'List the user’s open tasks (to-dos), soonest due first.',
      parameters: { type: 'object', properties: {} },
    },
    args: z.object({}),
    async run(ctx) {
      const tasks = await listTasks(ctx.prisma, ctx.userId, {});
      return {
        result: {
          tasks: tasks.slice(0, 50).map((t) => ({
            id: t.id,
            title: t.title,
            due: t.dueAt,
            priority: t.priority,
            repeats: t.rrule,
          })),
        },
      };
    },
  }),

  create_task: tool({
    spec: {
      name: 'create_task',
      description:
        'Add a to-do. dueAt is an optional local time YYYY-MM-DDTHH:mm. Use for things to do rather than appointments at a fixed time.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          dueAt: { type: 'string', description: 'Optional local due time, YYYY-MM-DDTHH:mm.' },
          priority: { type: 'string', enum: [...PRIORITIES] },
          repeat: { type: 'string', enum: [...REPEATS], description: 'Needs dueAt.' },
        },
        required: ['title'],
      },
    },
    args: z.object({
      title: z.string(),
      dueAt: z.string().optional(),
      priority: z.enum(PRIORITIES).optional(),
      repeat: z.enum(REPEATS).optional(),
    }),
    async run(ctx, a) {
      const input = parseInput(createTaskSchema, {
        title: a.title,
        dueAt: a.dueAt ?? null,
        priority: a.priority,
        rrule: repeatRule(a.repeat),
      });
      const task = await createTask(ctx.prisma, ctx.userId, input);
      return {
        result: { status: 'created', task: { id: task.id, title: task.title, due: task.dueAt } },
        action: {
          kind: 'task.created',
          entityType: 'task',
          entityId: task.id,
          title: task.title,
          when: task.dueAt,
        },
      };
    },
  }),

  complete_task: tool({
    spec: {
      name: 'complete_task',
      description:
        'Mark a task done (get its id from list_tasks). A repeating task moves to its next due date.',
      parameters: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
        required: ['taskId'],
      },
    },
    args: z.object({ taskId: z.uuid() }),
    async run(ctx, { taskId }) {
      const { task, rescheduled } = await completeTask(ctx.prisma, ctx.userId, taskId);
      return {
        result: { status: rescheduled ? 'rescheduled' : 'completed', nextDue: task.dueAt },
        action: {
          kind: rescheduled ? 'task.rescheduled' : 'task.completed',
          entityType: 'task',
          entityId: task.id,
          title: task.title,
          when: rescheduled ? task.dueAt : null,
        },
      };
    },
  }),

  create_important_date: tool({
    spec: {
      name: 'create_important_date',
      description:
        'Save a birthday, anniversary or other yearly date so the user is reminded. Include the year only if the user said it.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'e.g. "Karthik’s birthday".' },
          type: { type: 'string', enum: [...IMPORTANT_DATE_TYPES] },
          month: { type: 'integer' },
          day: { type: 'integer' },
          year: { type: 'integer' },
          personName: { type: 'string' },
          relationship: { type: 'string' },
        },
        required: ['title', 'type', 'month', 'day'],
      },
    },
    args: z.object({
      title: z.string(),
      type: z.enum(IMPORTANT_DATE_TYPES),
      month: z.number().int(),
      day: z.number().int(),
      year: z.number().int().optional(),
      personName: z.string().optional(),
      relationship: z.string().optional(),
    }),
    async run(ctx, a) {
      const input = parseInput(createImportantDateSchema, a);
      const d = await createImportantDate(ctx.prisma, ctx.userId, input);
      const pad = (n: number) => String(n).padStart(2, '0');
      return {
        result: { status: 'created', importantDate: { id: d.id, title: d.title } },
        action: {
          kind: 'important_date.created',
          entityType: 'importantDate',
          entityId: d.id,
          title: d.title,
          when: `${d.year ?? 2000}-${pad(d.month)}-${pad(d.day)}`,
        },
      };
    },
  }),

  plan_day: tool({
    spec: {
      name: 'plan_day',
      description:
        'Plan a day: events (with travel time), free time between them within the user’s waking hours, and suggested times for overdue, due and high-priority tasks. Use for "plan my day", "am I free…", "when can I…". Suggestions are not saved.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Local date YYYY-MM-DD; default today.' },
        },
      },
    },
    args: z.object({
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    }),
    async run(ctx, { date }) {
      const plan = await getDayPlan(ctx.prisma, ctx.userId, date);
      return { result: plan };
    },
  }),

  remember: tool({
    spec: {
      name: 'remember',
      description:
        'Save a lasting fact or preference the user explicitly told you (e.g. wake time, gym location, how they like reminders). Only when the user states it about themselves or asks you to remember. Never store passwords, PINs, OTPs, bank, card or ID numbers, or health details unless the user explicitly asks you to remember that exact thing. Saving an existing key replaces it.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Short snake_case name, e.g. "wake_time".' },
          value: { type: 'string', description: 'The fact, in the user’s words.' },
          category: {
            type: 'string',
            description: 'Optional: routine, people, places, preferences.',
          },
        },
        required: ['key', 'value'],
      },
    },
    args: z.object({ key: z.string(), value: z.string(), category: z.string().optional() }),
    async run(ctx, a) {
      const m = await saveMemory(ctx.prisma, ctx.userId, a);
      return {
        result: { status: 'saved', key: m.key, value: m.value },
        action: {
          kind: 'memory.saved',
          entityType: 'memory',
          entityId: m.id,
          title: memoryLabel(m.key, m.value),
          when: null,
        },
      };
    },
  }),

  forget: tool({
    spec: {
      name: 'forget',
      description: 'Forget one saved fact, by its key (see the facts in your instructions).',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
      },
    },
    args: z.object({ key: z.string().min(1).max(60) }),
    async run(ctx, { key }) {
      const memories = await listMemories(ctx.prisma, ctx.userId);
      const match = memories.find((m) => m.key === key.trim().toLowerCase());
      if (!match || !(await forgetMemory(ctx.prisma, ctx.userId, { id: match.id }))) {
        return { result: { error: 'NOT_FOUND', message: `Nothing saved under ${key}` } };
      }
      return {
        result: { status: 'forgotten', key: match.key },
        action: {
          kind: 'memory.forgotten',
          entityType: 'memory',
          entityId: match.id,
          title: memoryLabel(match.key, match.value),
          when: null,
        },
      };
    },
  }),

  list_upcoming_dates: tool({
    spec: {
      name: 'list_upcoming_dates',
      description: 'List birthdays, anniversaries and other important dates coming up soon.',
      parameters: {
        type: 'object',
        properties: { days: { type: 'integer', description: 'How many days ahead, 1-366.' } },
      },
    },
    args: z.object({ days: z.number().int().min(1).max(366).optional() }),
    async run(ctx, { days }) {
      const upcoming = await listUpcoming(ctx.prisma, ctx.userId, days ?? 30);
      return {
        result: {
          upcoming: upcoming.map((u) => ({
            title: u.importantDate.title,
            type: u.importantDate.type,
            date: u.date,
            daysUntil: u.daysUntil,
            yearsSince: u.yearsSince,
          })),
        },
      };
    },
  }),
};

/** "gym time: 6 am": the value alone is often meaningless out of context. */
const memoryLabel = (key: string, value: string) => `${key.replace(/_/g, ' ')}: ${value}`;

export type ToolName = keyof typeof TOOLS | 'confirm_pending_action' | 'decline_pending_action';

function eventAction(kind: 'event.created' | 'event.updated', e: EventDto): AssistantActionDto {
  return {
    kind,
    entityType: 'event',
    entityId: e.id,
    title: e.title,
    when: e.allDay ? e.startAt.slice(0, 10) : e.startAt,
  };
}

/** Offered only while a confirmation is waiting, so the user can answer "yes"/"ஆமாம்" by voice. */
export const PENDING_TOOL_SPECS: ToolSpec[] = [
  {
    name: 'confirm_pending_action',
    description:
      'The user agreed to the action that is waiting for confirmation. Call only after a clear yes.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'decline_pending_action',
    description: 'The user said no to the action that is waiting for confirmation.',
    parameters: { type: 'object', properties: {} },
  },
];

export const TOOL_SPECS: ToolSpec[] = Object.values(TOOLS).map((t) => t.spec);

const stripNulls = (v: unknown): unknown =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null))
    : v;

/**
 * Validates and runs one tool call. Unknown tools, bad arguments and service errors become an
 * error result for the model (so it can correct itself or ask), never an exception.
 */
export async function runTool(
  ctx: ToolContext,
  name: string,
  rawArgs: unknown,
): Promise<ToolOutcome & { isError: boolean }> {
  const t = (TOOLS as Record<string, Tool<z.ZodType>>)[name];
  if (!t) return { isError: true, result: { error: 'UNKNOWN_TOOL', message: `No tool ${name}` } };
  const parsed = t.args.safeParse(stripNulls(rawArgs ?? {}));
  if (!parsed.success) {
    return {
      isError: true,
      result: {
        error: 'INVALID_ARGUMENTS',
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    };
  }
  try {
    return { ...(await t.run(ctx, parsed.data)), isError: false };
  } catch (e) {
    if (e instanceof AppError) {
      return { isError: true, result: { error: e.code, message: e.message, details: e.details } };
    }
    throw e;
  }
}

export type { PendingActionDto };
