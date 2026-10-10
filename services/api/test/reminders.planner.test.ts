import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { Event, ImportantDate, Task } from '../src/generated/prisma/client';
import {
  planEventReminders,
  planImportantDateReminders,
  planTaskReminders,
  type PlanContext,
} from '../src/modules/reminders/planner';

const zone = 'Asia/Kolkata';
const now = DateTime.fromISO('2027-03-10T08:00', { zone });
const ctx: PlanContext = { now, notifyMinutesOfDay: 9 * 60 };
const at = (iso: string) => DateTime.fromISO(iso, { zone }).toJSDate();
const local = (d: Date) => DateTime.fromJSDate(d, { zone }).toFormat("yyyy-MM-dd'T'HH:mm");

const event = (over: Partial<Event>): Event =>
  ({
    id: 'e1',
    userId: 'u1',
    startAt: at('2027-03-11T10:00'),
    endAt: null,
    allDay: false,
    timezone: zone,
    rrule: null,
    status: 'SCHEDULED',
    remindersEnabled: true,
    reminderOffsets: [15],
    ...over,
  }) as Event;

describe('planEventReminders', () => {
  it('reminds the chosen minutes before the start', () => {
    const plan = planEventReminders(event({ reminderOffsets: [60, 15] }), ctx);
    expect(plan.map((p) => [local(p.triggerAt), p.offsetMinutes])).toEqual([
      ['2027-03-11T09:45', 15],
      ['2027-03-11T09:00', 60],
    ]);
  });

  it('fires immediately when the event is too close for its reminder', () => {
    const plan = planEventReminders(event({ startAt: at('2027-03-10T08:05') }), ctx);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.triggerAt).toEqual(now.toJSDate());
  });

  it('only materialises recurring occurrences inside the 7-day horizon', () => {
    const plan = planEventReminders(
      event({ startAt: at('2027-03-01T07:00'), rrule: 'FREQ=DAILY' }),
      ctx,
    );
    expect(plan.map((p) => local(p.occurrenceAt))).toEqual([
      '2027-03-11T07:00',
      '2027-03-12T07:00',
      '2027-03-13T07:00',
      '2027-03-14T07:00',
      '2027-03-15T07:00',
      '2027-03-16T07:00',
      '2027-03-17T07:00',
    ]);
  });

  it('reminds about all-day events at the preferred time of day', () => {
    const plan = planEventReminders(
      event({ allDay: true, startAt: at('2027-03-12T00:00'), endAt: at('2027-03-13T00:00') }),
      ctx,
    );
    expect(plan.map((p) => local(p.triggerAt))).toEqual(['2027-03-12T08:45']);
  });

  it('plans nothing for cancelled events or when reminders are off', () => {
    expect(planEventReminders(event({ status: 'CANCELLED' }), ctx)).toEqual([]);
    expect(planEventReminders(event({ remindersEnabled: false }), ctx)).toEqual([]);
  });
});

describe('planTaskReminders', () => {
  const task = (over: Partial<Task>): Task =>
    ({
      id: 't1',
      userId: 'u1',
      dueAt: at('2027-03-10T18:00'),
      timezone: zone,
      status: 'PENDING',
      remindersEnabled: true,
      reminderOffsets: [30],
      ...over,
    }) as Task;

  it('reminds before the due time of open tasks only', () => {
    expect(planTaskReminders(task({}), ctx).map((p) => local(p.triggerAt))).toEqual([
      '2027-03-10T17:30',
    ]);
    expect(planTaskReminders(task({ status: 'COMPLETED' }), ctx)).toEqual([]);
    expect(planTaskReminders(task({ dueAt: null }), ctx)).toEqual([]);
  });
});

describe('planImportantDateReminders', () => {
  it('reminds the day before and on the day at the notify time', () => {
    const date = {
      id: 'd1',
      userId: 'u1',
      month: 3,
      day: 12,
      year: 1990,
      recursAnnually: true,
      timezone: zone,
      remindersEnabled: true,
      reminderOffsets: [1440, 0],
    } as ImportantDate;
    expect(planImportantDateReminders(date, ctx).map((p) => local(p.triggerAt))).toEqual([
      '2027-03-12T09:00',
      '2027-03-11T09:00',
    ]);
  });
});
