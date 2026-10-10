import { DateTime } from 'luxon';
import type { DayPlanDto } from '@anbu/shared';
import { occurrencesInRange } from '../../common/recurrence';
import { invalidField } from '../../common/validate';
import type { PrismaClient } from '../../database/prisma';
import { scheduleOf } from '../events/conflicts';
import { listUpcoming } from '../important-dates/important-dates.service';
import { planDay, type PlannerEvent, type PlannerTask } from './planner';

const iso = (dt: DateTime) => dt.toISO() ?? '';

/** Builds the plan for one local day from the user's events, open tasks and routine. */
export async function getDayPlan(
  prisma: PrismaClient,
  userId: string,
  date?: string,
  nowJs = new Date(),
): Promise<DayPlanDto> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { preference: true },
  });
  const tz = user.timezone;
  const now = DateTime.fromJSDate(nowJs).setZone(tz);
  const day = date ? DateTime.fromISO(date, { zone: tz }).startOf('day') : now.startOf('day');
  if (!day.isValid) throw invalidField('date', 'is not a valid date');
  const dayEnd = day.plus({ days: 1 });

  const rows = await prisma.event.findMany({
    where: {
      userId,
      status: { not: 'CANCELLED' },
      startAt: { lt: dayEnd.plus({ days: 1 }).toJSDate() },
      OR: [
        { rrule: { not: null } },
        { startAt: { gte: day.minus({ days: 1 }).toJSDate() } },
        { endAt: { gt: day.toJSDate() } },
      ],
    },
  });
  const events: PlannerEvent[] = [];
  for (const e of rows) {
    const { start, durationMs, rule } = scheduleOf(e);
    for (const s of occurrencesInRange(start, durationMs, rule, day, dayEnd)) {
      const local = s.setZone(tz);
      events.push({
        eventId: e.id,
        title: e.title,
        location: e.location,
        start: local,
        end: durationMs ? local.plus({ milliseconds: durationMs }) : null,
        allDay: e.allDay,
        bufferMinutes: e.travelBufferMinutes + e.prepBufferMinutes,
      });
    }
  }
  events.sort((a, b) => a.start.toMillis() - b.start.toMillis());

  const taskRows = await prisma.task.findMany({
    where: { userId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    include: { blockedBy: { select: { status: true } } },
    take: 300,
  });
  const tasks: PlannerTask[] = taskRows.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    dueAt: t.dueAt ? DateTime.fromJSDate(t.dueAt).setZone(tz) : null,
    estimatedMinutes: t.estimatedMinutes,
    blocked: !!t.blockedBy && !['COMPLETED', 'CANCELLED'].includes(t.blockedBy.status),
    createdAt: DateTime.fromJSDate(t.createdAt),
  }));

  const plan = planDay({
    day,
    now,
    wakeMinutes: user.preference?.wakeMinutes ?? null,
    sleepMinutes: user.preference?.sleepMinutes ?? null,
    events,
    tasks,
  });
  const upcoming = await listUpcoming(prisma, userId, 7, day < now ? now : day);

  return {
    date: day.toISODate() ?? '',
    timezone: tz,
    window: plan.window ? { start: iso(plan.window.start), end: iso(plan.window.end) } : null,
    events: events
      .filter((e) => !e.allDay)
      .map((e) => ({
        eventId: e.eventId,
        title: e.title,
        location: e.location,
        start: iso(e.start),
        end: iso(e.end ?? e.start),
        bufferMinutes: e.bufferMinutes,
      })),
    allDayEvents: events
      .filter((e) => e.allDay)
      .map((e) => ({ eventId: e.eventId, title: e.title })),
    freeSlots: plan.freeSlots.map((s) => ({ start: iso(s.start), end: iso(s.end) })),
    suggestions: plan.suggestions,
    unscheduled: plan.unscheduled,
    importantDates: upcoming.map((u) => ({
      title: u.importantDate.title,
      date: u.date,
      daysUntil: u.daysUntil,
    })),
    freeMinutes: plan.freeMinutes,
  };
}
