import { describe, expect, it } from 'vitest';
import type { DayPlanDto, ReminderDto } from '@anbu/shared';
import { STRINGS } from '@/i18n/strings';
import { briefBody, pathFor, reminderBody } from './reminder-text';

const reminder = (over: Partial<ReminderDto> & { source: ReminderDto['source'] }): ReminderDto => ({
  id: 'r1',
  status: 'PENDING',
  triggerAt: '2027-01-04T01:15:00.000Z',
  occurrenceAt: '2027-01-04T07:00:00.000+05:30',
  offsetMinutes: 15,
  snoozeCount: 0,
  sentAt: null,
  ...over,
});

const event = { type: 'event', id: 'e1', title: 'Doctor', dateOnly: false } as const;

describe('reminder wording', () => {
  it('links each kind of reminder to its screen', () => {
    expect(pathFor(reminder({ source: event }))).toBe('/event/e1');
    expect(pathFor(reminder({ source: { ...event, type: 'task', id: 't1' } }))).toBe('/task/t1');
    expect(pathFor(reminder({ source: { ...event, type: 'importantDate', id: 'd1' } }))).toBe(
      '/date/d1',
    );
  });

  it('says when an event starts, in the user’s language', () => {
    expect(reminderBody(reminder({ source: event }), STRINGS.en, 'en')).toMatch(/^Starts at 7:00/i);
    expect(reminderBody(reminder({ source: event }), STRINGS.ta, 'ta')).toContain('தொடங்கும்');
    expect(reminderBody(reminder({ source: event, offsetMinutes: 0 }), STRINGS.en, 'en')).toBe(
      'Starting now',
    );
  });

  it('uses days for birthdays and all-day events', () => {
    const date = { type: 'importantDate', id: 'd1', title: 'Amma', dateOnly: true } as const;
    expect(reminderBody(reminder({ source: date, offsetMinutes: 1440 }), STRINGS.en, 'en')).toBe(
      'Tomorrow',
    );
    expect(reminderBody(reminder({ source: date, offsetMinutes: 0 }), STRINGS.ta, 'ta')).toBe(
      'இன்று',
    );
  });
});

describe('morning brief', () => {
  const plan = (over: Partial<DayPlanDto>): DayPlanDto => ({
    date: '2027-01-04',
    timezone: 'Asia/Kolkata',
    window: null,
    events: [],
    allDayEvents: [],
    freeSlots: [],
    suggestions: [],
    unscheduled: [],
    importantDates: [],
    freeMinutes: 0,
    ...over,
  });

  it('summarises events, tasks and a birthday that is close', () => {
    const body = briefBody(
      plan({
        events: [
          {
            eventId: 'e',
            title: 'Standup',
            location: null,
            start: '2027-01-04T09:00:00.000+05:30',
            end: '2027-01-04T09:30:00.000+05:30',
            bufferMinutes: 0,
          },
        ],
        unscheduled: [{ taskId: 't', title: 'Report', reason: 'no_time' }],
        importantDates: [{ title: 'Amma', date: '2027-01-05', daysUntil: 1 }],
      }),
      STRINGS.en,
      'en',
    );
    expect(body).toMatch(/^1 event, first at 9:00\s?am · 1 task to fit in · Tomorrow: Amma$/i);
  });

  it('handles a free day', () => {
    expect(briefBody(plan({}), STRINGS.en, 'en')).toBe('No events today');
  });
});
