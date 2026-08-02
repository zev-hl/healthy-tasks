// Local date/time <-> ISO helpers shared by the task create form and the task
// detail editor. Conversions happen in the browser so "local" is the user's
// actual timezone.
import type { TaskStatus } from '@healthy-tasks/shared';

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

/* --- Redesign relative dates ---------------------------------------------- */

const DAY_MS = 86_400_000;
function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}
function timeStr(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Absolute short form for the secondary line / tooltips: `Jul 12, 7:00 PM`
 * (adds the year only when it isn't the current year). */
export function absoluteShort(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${date}, ${timeStr(d)}`;
}

export type DateTone = 'overdue' | 'due-today' | 'late' | 'normal';
export interface DueParts {
  primary: string;
  secondary: string;
  tone: DateTone;
}

export interface FormatDueOptions {
  /** Expand "17d" → "17 days" (detail view). */
  long?: boolean;
  /** The task's current status, so terminal tasks aren't shown as "Overdue". */
  status?: TaskStatus;
  /** The Status-Change Timestamp (completion time for a Completed task). */
  completedAt?: string | null;
  /** True when this value is the Due date, so a late completion reads "Late". */
  isDue?: boolean;
}

/**
 * Relative-first treatment for a Start/Due date. Status-aware so wording stays
 * consistent with the rest of the app:
 *  - a **Completed** task is never "Overdue" — if it finished after its Due date
 *    it reads "Late Nd" (matching the Due Date report), otherwise just the date;
 *  - a **Canceled** task is neither Overdue nor Late — the date is shown plainly;
 *  - any other status keeps the live Overdue / due-today / upcoming treatment.
 */
export function formatDue(
  iso: string | null | undefined,
  opts: FormatDueOptions = {},
): DueParts | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const secondary = absoluteShort(iso);
  const plainDate = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  // Canceled: show the date, but it is neither overdue nor late.
  if (opts.status === 'Canceled') {
    return { primary: plainDate, secondary, tone: 'normal' };
  }
  // Completed: "Late Nd" only if it finished after the Due date; else just the date.
  if (opts.status === 'Completed') {
    if (opts.isDue && opts.completedAt) {
      const doneMs = new Date(opts.completedAt).getTime();
      if (!Number.isNaN(doneMs) && doneMs > d.getTime()) {
        const days = Math.abs(Math.trunc((d.getTime() - doneMs) / DAY_MS));
        const primary =
          days >= 1
            ? opts.long
              ? `Late ${days} ${days === 1 ? 'day' : 'days'}`
              : `Late ${days}d`
            : 'Late';
        return { primary, secondary, tone: 'late' };
      }
    }
    return { primary: plainDate, secondary, tone: 'normal' };
  }

  const dayDiff = Math.round((startOfDay(d) - startOfDay(now)) / DAY_MS);
  const msDiff = d.getTime() - now.getTime();

  if (msDiff < 0) {
    if (dayDiff === 0) {
      const hrs = Math.round(-msDiff / 3_600_000);
      return { primary: hrs >= 1 ? `Overdue ${hrs}h` : 'Overdue', secondary, tone: 'overdue' };
    }
    const days = Math.max(1, -dayDiff);
    return {
      primary: opts.long ? `Overdue ${days} ${days === 1 ? 'day' : 'days'}` : `Overdue ${days}d`,
      secondary,
      tone: 'overdue',
    };
  }

  if (dayDiff === 0) {
    if (msDiff < 3_600_000) {
      const mins = Math.max(1, Math.round(msDiff / 60_000));
      return { primary: `in ${mins}m`, secondary, tone: 'due-today' };
    }
    return { primary: `Today, ${timeStr(d)}`, secondary, tone: 'due-today' };
  }
  if (dayDiff === 1) return { primary: `Tomorrow, ${timeStr(d)}`, secondary, tone: 'normal' };
  if (dayDiff < 7)
    return { primary: d.toLocaleDateString(undefined, { weekday: 'long' }), secondary, tone: 'normal' };
  if (dayDiff < 14)
    return {
      primary: `Next ${d.toLocaleDateString(undefined, { weekday: 'long' })}`,
      secondary,
      tone: 'normal',
    };
  return {
    primary: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    secondary,
    tone: 'normal',
  };
}

/** Past-event relative form for created/edited/activity timestamps:
 * `now`, `22m ago`, `3h ago`, `Yesterday`, `Mon`, `Jul 12`. */
export function formatAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 45) return 'now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(d)) / DAY_MS);
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
