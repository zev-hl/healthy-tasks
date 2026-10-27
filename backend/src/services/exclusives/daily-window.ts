import { env } from '../../config/env.js';
import {
  addCalendarDays,
  fromBusinessDate,
  toBusinessDate,
  type CalendarDate,
} from '../../utils/business-time.js';
import { formatClockTime, type ClockTime } from '../../utils/clock-time.js';

/**
 * HLAI-112: when the Daily alert tasks are made, on the business clock:
 * EXCLUSIVES_DAILY_TASKS_AT, 08:30 by default. Each covers the day before it,
 * from the same time the day before to a minute before it (8:30 AM yesterday to
 * 8:29 AM today), so every alert falls in exactly one day.
 *
 * Built from clock times on business dates, never by taking 24 hours off an
 * instant, so on a DST change day the window is 23 or 25 hours and no alert is
 * missed or counted twice.
 */

const on = (date: CalendarDate, t: ClockTime) =>
  fromBusinessDate(date, t.hour, env.businessTimeZone, t.minute);

/** The latest Daily run at or before `now`: where the last full day ended. */
export function lastDailyRunAt(now: Date, at: ClockTime = env.alertTasks.dailyAt): Date {
  const today = toBusinessDate(now);
  const run = on(today, at);
  return run.getTime() <= now.getTime() ? run : on(addCalendarDays(today, -1), at);
}

/** The first Daily run after `time`: when the task for an alert at `time` is made. */
export function nextDailyRunAt(time: Date, at: ClockTime = env.alertTasks.dailyAt): Date {
  const today = toBusinessDate(time);
  const run = on(today, at);
  return run.getTime() > time.getTime() ? run : on(addCalendarDays(today, 1), at);
}

/** Where the day ending at the run `end` starts: the same time the day before. */
export function dailyWindowStart(end: Date, at: ClockTime = env.alertTasks.dailyAt): Date {
  return on(addCalendarDays(toBusinessDate(end), -1), at);
}

/** "8:30 AM New York time, covering the day before (8:30 AM to 8:29 AM)", for the start-up log. */
export function describeDailyWindow(at: ClockTime = env.alertTasks.dailyAt): string {
  const city = env.businessTimeZone.split('/').pop()?.replace(/_/g, ' ') ?? env.businessTimeZone;
  const m = (at.hour * 60 + at.minute + 24 * 60 - 1) % (24 * 60);
  const lastMinute = { hour: Math.floor(m / 60), minute: m % 60 };
  return (
    `${formatClockTime(at)} ${city} time, covering the day before ` +
    `(${formatClockTime(at)} to ${formatClockTime(lastMinute)})`
  );
}
