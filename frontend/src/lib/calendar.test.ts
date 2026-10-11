import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysInRange,
  formatRange,
  isWeekend,
  monthGrid,
  monthWeekColumns,
  splitMinutes,
  weekStart,
} from './calendar';

describe('calendar dates', () => {
  it('runs weeks Sunday → Saturday', () => {
    expect(weekStart('2026-09-22')).toBe('2026-09-20'); // a Tuesday → its Sunday
    expect(weekStart('2026-09-20')).toBe('2026-09-20'); // Sunday is its own start
    expect(weekStart('2026-09-26')).toBe('2026-09-20'); // Saturday ends that week
  });

  it('does day and month arithmetic on calendar dates, across month and year ends', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01');
    // Across the US DST change (Nov 1, 2026) a day is still one day.
    expect(daysInRange('2026-10-31', '2026-11-02')).toEqual([
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  it('knows weekends', () => {
    expect(isWeekend('2026-09-19')).toBe(true);
    expect(isWeekend('2026-09-20')).toBe(true);
    expect(isWeekend('2026-09-21')).toBe(false);
  });

  it('covers a month with whole Sun–Sat weeks', () => {
    expect(monthGrid('2026-09-15')).toEqual({ start: '2026-08-30', end: '2026-10-03' });
  });

  it("cuts the month's week columns at the month's edges", () => {
    const cols = monthWeekColumns('2026-09-10');
    expect(cols[0]).toEqual({ key: 'w0', label: 'Week 1', from: '2026-09-01', to: '2026-09-05' });
    expect(cols[cols.length - 1]).toMatchObject({ from: '2026-09-27', to: '2026-09-30' });
    expect(cols).toHaveLength(5);
  });

  it('formats ranges compactly', () => {
    expect(formatRange('2026-09-20', '2026-09-26', 2026)).toBe('Sep 20–26');
    expect(formatRange('2026-09-27', '2026-10-03', 2026)).toBe('Sep 27 – Oct 3');
  });

  it('splits minutes into hours and minutes', () => {
    expect(splitMinutes(105)).toEqual({ h: 1, m: 45 });
    expect(splitMinutes(0)).toEqual({ h: 0, m: 0 });
  });
});
