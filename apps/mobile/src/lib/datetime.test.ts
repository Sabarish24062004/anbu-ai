import { describe, expect, it } from 'vitest';
import {
  dateToMinutes,
  dayKey,
  formatDuration,
  formatTime,
  minutesToDate,
  nextQuarterHour,
  toLocalDateTimeString,
  wallToLocalDate,
} from './datetime';

describe('wall-clock formatting', () => {
  it("shows the record's local time, whatever the phone's timezone", () => {
    // 07:00 in India is 01:30 UTC; the label must say 7, not 1:30 or the phone's local hour.
    const iso = '2027-01-04T07:00:00.000+05:30';
    expect(formatTime(iso, 'en')).toMatch(/^7:00\s?am$/i);
    expect(formatTime(iso, 'ta')).toContain('7:00');
    expect(dayKey(iso)).toBe('2027-01-04');
  });

  it('round-trips picker values without an offset', () => {
    const d = new Date(2027, 0, 4, 7, 5);
    expect(toLocalDateTimeString(d)).toBe('2027-01-04T07:05');
    expect(wallToLocalDate('2027-01-04T07:05:00.000+05:30').getHours()).toBe(7);
    expect(dateToMinutes(minutesToDate(9 * 60 + 30))).toBe(570);
  });

  it('formats durations in both languages', () => {
    expect(formatDuration(90, 'en')).toBe('1 h 30 min');
    expect(formatDuration(45, 'en')).toBe('45 min');
    expect(formatDuration(120, 'ta')).toBe('2 மணி');
  });

  it('proposes the next quarter hour in the future', () => {
    const d = nextQuarterHour();
    expect(d.getMinutes() % 15).toBe(0);
    expect(d.getTime()).toBeGreaterThan(Date.now());
  });
});
