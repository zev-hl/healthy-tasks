// Local date/time <-> ISO helpers shared by the task create form and the task
// detail editor. Conversions happen in the browser so "local" is the user's
// actual timezone.

const pad = (n: number) => String(n).padStart(2, '0');

export const DEFAULT_START_HOUR = 7; // 7:00 AM
export const DEFAULT_DUE_HOUR = 19; // 7:00 PM

export const defaultTime = (hour: number) => `${pad(hour)}:00`;

/** Split an ISO timestamp into local date ("YYYY-MM-DD") and time ("HH:mm") parts. */
export function isoToParts(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/**
 * Combine local date + time fields into an absolute UTC ISO string. Returns null
 * if no date is set. A missing time falls back to the field's default hour.
 */
export function partsToIso(date: string, time: string, defaultHour: number): string | null {
  if (date === '') return null;
  const t = time === '' ? defaultTime(defaultHour) : time;
  const d = new Date(`${date}T${t}`); // no offset → parsed as local time
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Compact, human-friendly timestamp for display. Year-aware: dates in the
 * current year drop the year ("Jul 28, 12:25 PM"); dates in any other year keep
 * it ("Nov 3, 2025, 9:10 AM") so the two are never confused. Returns "—" for
 * empty/invalid values. Pair with `fullTimestamp` for an exact-time tooltip.
 */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Full, unambiguous timestamp (with weekday + year) for hover tooltips. */
export function fullTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });
}
