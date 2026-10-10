import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import {
  freeSlots,
  planDay,
  type PlannerEvent,
  type PlannerInput,
  type PlannerTask,
} from '../src/modules/planning/planner';

const zone = 'Asia/Kolkata';
const at = (hhmm: string, day = '2027-03-10') => DateTime.fromISO(`${day}T${hhmm}`, { zone });
const hm = (iso: string) => iso.slice(11, 16);

const event = (
  start: string,
  end: string | null,
  extra: Partial<PlannerEvent> = {},
): PlannerEvent => ({
  eventId: `e-${start}`,
  title: `Event ${start}`,
  location: null,
  start: at(start),
  end: end ? at(end) : null,
  allDay: false,
  bufferMinutes: 0,
  ...extra,
});

const task = (id: string, extra: Partial<PlannerTask> = {}): PlannerTask => ({
  id,
  title: id,
  priority: 'MEDIUM',
  dueAt: null,
  estimatedMinutes: null,
  blocked: false,
  createdAt: at('00:00', '2027-01-01'),
  ...extra,
});

const base = (over: Partial<PlannerInput> = {}): PlannerInput => ({
  day: at('00:00'),
  now: at('06:00'),
  wakeMinutes: 7 * 60,
  sleepMinutes: 22 * 60,
  events: [],
  tasks: [],
  ...over,
});

describe('freeSlots', () => {
  it('subtracts busy time and drops gaps shorter than 10 minutes', () => {
    const slots = freeSlots({ start: at('07:00'), end: at('12:00') }, [
      { start: at('08:00'), end: at('09:00') },
      { start: at('09:05'), end: at('10:00') }, // leaves a 5-minute gap
      { start: at('09:30'), end: at('10:30') }, // overlaps the previous one
    ]);
    expect(slots.map((s) => [s.start.toFormat('HH:mm'), s.end.toFormat('HH:mm')])).toEqual([
      ['07:00', '08:00'],
      ['10:30', '12:00'],
    ]);
  });
});

describe('planDay', () => {
  it('blocks travel time and gives point-in-time events 30 minutes', () => {
    const plan = planDay(
      base({
        events: [event('09:00', '10:00', { bufferMinutes: 30 }), event('12:00', null)],
      }),
    );
    expect(plan.freeSlots.map((s) => [s.start.toFormat('HH:mm'), s.end.toFormat('HH:mm')])).toEqual(
      [
        ['07:00', '08:30'],
        ['10:00', '12:00'],
        ['12:30', '22:00'],
      ],
    );
  });

  it('starts from now (rounded up) once the day has begun', () => {
    const plan = planDay(base({ now: at('13:07') }));
    expect(plan.window?.start.toFormat('HH:mm')).toBe('13:10');
  });

  it('has no window for a day that is over', () => {
    expect(planDay(base({ now: at('23:00') })).window).toBeNull();
  });

  it('handles a sleep time after midnight', () => {
    const plan = planDay(base({ sleepMinutes: 30 }));
    expect(plan.window?.end.toISO()).toBe(at('00:30', '2027-03-11').toISO());
  });

  it('places overdue first, then due-today before its deadline, then high priority', () => {
    const plan = planDay(
      base({
        events: [event('07:00', '09:00')],
        tasks: [
          task('high', { priority: 'HIGH' }),
          task('due-noon', { dueAt: at('12:00'), estimatedMinutes: 60 }),
          task('overdue', { dueAt: at('18:00', '2027-03-09') }),
          task('low-undated', { priority: 'LOW' }), // not urgent: left out of the plan
          task('next-week', { dueAt: at('10:00', '2027-03-17') }),
        ],
      }),
    );
    expect(plan.suggestions.map((s) => [s.taskId, hm(s.start), hm(s.end), s.reason])).toEqual([
      ['overdue', '09:00', '09:30', 'overdue'],
      ['due-noon', '09:30', '10:30', 'due_today'],
      ['high', '10:30', '11:00', 'high_priority'],
    ]);
  });

  it('flags a task that can only fit after its due time, and lists what does not fit', () => {
    const plan = planDay(
      base({
        now: at('11:00'),
        sleepMinutes: 13 * 60,
        tasks: [
          task('due-1130', { dueAt: at('11:30'), estimatedMinutes: 90 }),
          task('too-big', { priority: 'URGENT', estimatedMinutes: 240 }),
          task('blocked', { priority: 'HIGH', blocked: true }),
        ],
      }),
    );
    expect(plan.suggestions).toEqual([
      expect.objectContaining({ taskId: 'due-1130', afterDue: true }),
    ]);
    expect(plan.unscheduled).toEqual([
      { taskId: 'too-big', title: 'too-big', reason: 'no_time' },
      { taskId: 'blocked', title: 'blocked', reason: 'blocked' },
    ]);
  });

  it('ignores all-day events when finding free time', () => {
    const plan = planDay(
      base({ events: [event('00:00', '23:59', { allDay: true })], sleepMinutes: 8 * 60 }),
    );
    expect(plan.freeMinutes).toBe(60);
  });
});
