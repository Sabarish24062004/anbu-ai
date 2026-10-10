import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { parseRRule, rruleSchema } from '@anbu/shared';
import { nextOccurrenceAfter, occurrencesInRange } from '../src/common/recurrence';

const local = (iso: string, zone = 'Asia/Kolkata') => DateTime.fromISO(iso, { zone });
const isoList = (dts: DateTime[]) => dts.map((d) => d.toISO());

function expand(startIso: string, rrule: string, fromIso: string, toIso: string, zone?: string) {
  return occurrencesInRange(
    local(startIso, zone),
    0,
    parseRRule(rrule),
    local(fromIso, zone),
    local(toIso, zone),
  );
}

describe('parseRRule', () => {
  it('normalises a valid rule', () => {
    expect(rruleSchema.parse('rrule:freq=weekly;byday=fr,mo;interval=2')).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR',
    );
  });

  it.each([
    ['FREQ=HOURLY', /FREQ/],
    ['FREQ=DAILY;BYDAY=MO', /BYDAY/],
    ['FREQ=DAILY;COUNT=2;UNTIL=20270101', /COUNT and UNTIL/],
    ['FREQ=MONTHLY;BYMONTHDAY=1', /Unsupported/],
    ['FREQ=DAILY;INTERVAL=0', /INTERVAL/],
  ])('rejects %s', (rule, message) => {
    expect(() => parseRRule(rule)).toThrow(message);
  });
});

describe('occurrencesInRange', () => {
  it('repeats daily at the same local time', () => {
    const result = expand('2026-10-11T07:00', 'FREQ=DAILY', '2026-10-12', '2026-10-15');
    expect(isoList(result)).toEqual([
      '2026-10-12T07:00:00.000+05:30',
      '2026-10-13T07:00:00.000+05:30',
      '2026-10-14T07:00:00.000+05:30',
    ]);
  });

  it('keeps the wall-clock time across a DST change', () => {
    const zone = 'America/New_York'; // DST starts 2027-03-14
    const result = expand('2027-03-12T09:00', 'FREQ=DAILY', '2027-03-12', '2027-03-16', zone);
    expect(result.map((d) => d.toFormat('HH:mm'))).toEqual(['09:00', '09:00', '09:00', '09:00']);
    expect(result.map((d) => d.toUTC().hour)).toEqual([14, 14, 13, 13]);
  });

  it('expands weekly BYDAY with COUNT', () => {
    // 2026-10-12 is a Monday.
    const result = expand(
      '2026-10-12T18:00',
      'FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=5',
      '2026-10-01',
      '2026-12-01',
    );
    expect(result.map((d) => d.toISODate())).toEqual([
      '2026-10-12',
      '2026-10-14',
      '2026-10-16',
      '2026-10-19',
      '2026-10-21',
    ]);
  });

  it('skips months that lack the day instead of clamping', () => {
    const result = expand('2027-01-31T10:00', 'FREQ=MONTHLY;COUNT=4', '2027-01-01', '2028-01-01');
    expect(result.map((d) => d.toISODate())).toEqual([
      '2027-01-31',
      '2027-03-31',
      '2027-05-31',
      '2027-07-31',
    ]);
  });

  it('only repeats Feb 29 in leap years', () => {
    const result = expand('2028-02-29T09:00', 'FREQ=YEARLY', '2028-01-01', '2037-01-01');
    expect(result.map((d) => d.toISODate())).toEqual(['2028-02-29', '2032-02-29', '2036-02-29']);
  });

  it('treats a date UNTIL as inclusive', () => {
    const result = expand(
      '2026-10-11T07:00',
      'FREQ=DAILY;UNTIL=20261013',
      '2026-10-01',
      '2026-11-01',
    );
    expect(result.map((d) => d.toISODate())).toEqual(['2026-10-11', '2026-10-12', '2026-10-13']);
  });

  it('jumps ahead to a distant window with the same result as walking', () => {
    const result = expand('2020-01-01T06:30', 'FREQ=DAILY;INTERVAL=3', '2026-10-10', '2026-10-17');
    // 2020-01-01 + 3n days: 2026-10-10 is day 2474 = 3 * 824 + 2, so the first hit is 2026-10-11.
    expect(result.map((d) => d.toISODate())).toEqual(['2026-10-11', '2026-10-14']);
  });

  it('includes an occurrence that started before the window but is still running', () => {
    const start = local('2026-10-11T23:00');
    const result = occurrencesInRange(
      start,
      2 * 3600_000,
      null,
      local('2026-10-12'),
      local('2026-10-13'),
    );
    expect(result).toHaveLength(1);
  });
});

describe('nextOccurrenceAfter', () => {
  it('finds the next occurrence and stops when the rule ends', () => {
    const start = local('2026-10-12T09:00');
    const rule = parseRRule('FREQ=WEEKLY;COUNT=2');
    expect(nextOccurrenceAfter(start, rule, start)?.toISODate()).toBe('2026-10-19');
    expect(nextOccurrenceAfter(start, rule, local('2026-10-19T09:00'))).toBeNull();
  });
});
