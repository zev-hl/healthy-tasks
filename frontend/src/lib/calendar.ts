/**
 * Calendar-date math for Department Duties time logging. Dates are plain
 * `YYYY-MM-DD` strings — a person's own calendar day — and every operation here
 * works in local calendar terms, never through UTC, so a day can't slide across
 * midnight. Weeks run Sunday → Saturday.
 */

export const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
export const MONTH_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DOW_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Parse `YYYY-MM-DD` as a LOCAL date (midnight in the browser's zone). */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export function formatISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): string {
  return formatISODate(new Date());
}

export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return formatISODate(d);
}

/** Same day-of-month `n` months away, clamped; used for month navigation (always day 1). */
export function addMonths(s: string, n: number): string {
  const d = parseDate(s);
  return formatISODate(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

export const dayOfWeek = (s: string): number => parseDate(s).getDay();
export const isWeekend = (s: string): boolean => {
  const w = dayOfWeek(s);
  return w === 0 || w === 6;
};

/** The Sunday on or before `s`. */
export const weekStart = (s: string): string => addDays(s, -dayOfWeek(s));

export const monthStart = (s: string): string => {
  const d = parseDate(s);
  return formatISODate(new Date(d.getFullYear(), d.getMonth(), 1));
};

export const monthEnd = (s: string): string => {
  const d = parseDate(s);
  return formatISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
};

/** Every date from `from` to `to`, inclusive. */
export function daysInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000);
}

/** The Sun–Sat grid that covers a month: first Sunday on/before the 1st to the last Saturday on/after month end. */
export function monthGrid(s: string): { start: string; end: string } {
  return { start: weekStart(monthStart(s)), end: addDays(weekStart(monthEnd(s)), 6) };
}

/** "Sep 22" (with the year when it isn't the current one). */
export function formatDay(s: string, currentYear = new Date().getFullYear()): string {
  const d = parseDate(s);
  const base = `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === currentYear ? base : `${base}, ${d.getFullYear()}`;
}

/** "Sep 20–26" or "Sep 27 – Oct 3". */
export function formatRange(a: string, b: string, currentYear = new Date().getFullYear()): string {
  const A = parseDate(a);
  const B = parseDate(b);
  if (A.getFullYear() === B.getFullYear() && A.getMonth() === B.getMonth()) {
    return `${MONTH_SHORT[A.getMonth()]} ${A.getDate()}–${B.getDate()}`;
  }
  return `${formatDay(a, currentYear)} – ${formatDay(b, currentYear)}`;
}

/** "Tuesday, September 22". */
export function formatLongDay(s: string): string {
  const d = parseDate(s);
  return `${DOW_LONG[d.getDay()]}, ${MONTH_LONG[d.getMonth()]} ${d.getDate()}`;
}

/**
 * The Sun–Sat week columns of a month, cut off at the month's edges — the
 * Time Review "Month" grid. Keys are `w0`, `w1`, …
 */
export function monthWeekColumns(anyDayInMonth: string): {
  key: string;
  label: string;
  from: string;
  to: string;
}[] {
  const ms = monthStart(anyDayInMonth);
  const me = monthEnd(anyDayInMonth);
  const cols = [];
  for (let w = 0, ws = weekStart(ms); ws <= me; w++, ws = addDays(ws, 7)) {
    const from = ws < ms ? ms : ws;
    const we = addDays(ws, 6);
    const to = we > me ? me : we;
    cols.push({ key: `w${w}`, label: `Week ${w + 1}`, from, to });
  }
  return cols;
}

/** Split minutes into whole hours and remaining minutes, for h/m inputs. */
export function splitMinutes(total: number): { h: number; m: number } {
  return { h: Math.floor(total / 60), m: total % 60 };
}
