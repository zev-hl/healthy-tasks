import { env } from '../config/env.js';

/**
 * Calendar-date arithmetic in the BUSINESS timezone.
 *
 * The problem this exists to solve: a date someone picks on a calendar ("Oct 8")
 * is a LABEL, not a moment. Storing it needs an instant, and `new Date('2026-10-08')`
 * silently picks midnight UTC — which in New York is 8:00 PM on Oct 7. Every
 * template-generated task therefore landed a day early and at a nonsense hour.
 *
 * Why a fixed business zone rather than the user's: a template tree is ONE
 * schedule whose nodes are assigned across several countries. If each node used
 * its assignee's zone, offsets 0 and 1 would stop being exactly a day apart, and
 * reassigning a task would silently move its deadline. One anchor keeps the
 * tree's internal spacing meaningful. See BUSINESS_TIMEZONE in config/env.
 *
 * NOT for dates a user types into a task form — the browser already converts
 * those in the user's own zone, which is correct for an absolute deadline.
 *
 * The day arithmetic deliberately runs on the calendar date (a plain string),
 * never on instants: adding 24h blocks across a DST boundary shifts the wall
 * clock, while adding calendar days cannot. The zone is applied once, at the end.
 */

/** A date as shown on a calendar, `YYYY-MM-DD`. Not an instant. */
export type CalendarDate = string;

export const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number): string => String(n).padStart(2, '0');

/** How far `timeZone` is from UTC at this instant, in ms (negative west of UTC). */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const n = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // `hour` can come back as 24 for midnight in some ICU builds.
  const wallClockAsUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
  return wallClockAsUtc - instant.getTime();
}

/** The calendar date this instant falls on, in the business timezone. */
export function toBusinessDate(instant: Date, timeZone: string = env.businessTimeZone): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const g = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/**
 * The instant at `hour`:00 on this calendar date, in the business timezone.
 *
 * Resolves the zone offset twice because the first guess can land on the wrong
 * side of a DST transition. Our default hours (07:00 / 19:00) are nowhere near
 * the 02:00 transitions used by the zones we care about, so neither the
 * spring-forward gap nor the fall-back ambiguity can arise in practice.
 */
export function fromBusinessDate(
  date: CalendarDate,
  hour: number,
  timeZone: string = env.businessTimeZone,
): Date {
  const wallClock = new Date(`${date}T${pad(hour)}:00:00.000Z`);
  const firstGuess = new Date(wallClock.getTime() - zoneOffsetMs(wallClock, timeZone));
  const corrected = zoneOffsetMs(firstGuess, timeZone);
  return new Date(wallClock.getTime() - corrected);
}

/** Add (or subtract) whole calendar days. Pure date math — DST cannot affect it. */
export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * The LAST moment of this calendar day in the business timezone.
 *
 * For an inclusive end date: "ends on Oct 31" should admit anything anchored on
 * Oct 31, whatever time of day. Resolving such a date at an hour instead would
 * only work while every anchor happens to sit at that same hour, which is the
 * kind of coincidence that breaks quietly later.
 */
export function endOfBusinessDay(date: CalendarDate, timeZone: string = env.businessTimeZone): Date {
  const nextMidnight = fromBusinessDate(addCalendarDays(date, 1), 0, timeZone);
  return new Date(nextMidnight.getTime() - 1);
}

/**
 * The instant `offsetDays` calendar days from `anchor`, at `hour` business time.
 * This is what turns a template node's relative offset into a real start/due.
 *
 * Note it reads only the DATE off `anchor` and re-applies `hour`, so an anchor
 * whose time has drifted (e.g. a recurrence stepped by whole weeks across a DST
 * boundary) still yields a clean 7:00 AM / 7:00 PM.
 */
export function offsetFromAnchor(
  anchor: Date,
  offsetDays: number,
  hour: number,
  timeZone: string = env.businessTimeZone,
): Date {
  return fromBusinessDate(addCalendarDays(toBusinessDate(anchor, timeZone), offsetDays), hour, timeZone);
}
