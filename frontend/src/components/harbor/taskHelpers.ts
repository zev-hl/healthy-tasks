import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  dutyLabel,
  type TaskPriority,
  type TaskRowDto,
  type TaskStatus,
} from '@healthy-tasks/shared';
import type { SelectOption } from './Select';
import { PRIORITY_DOT, STATUS_DOT } from './ui';
import { toYmd } from './DatePicker';

/** Not finished: everything but Completed and Canceled. */
export const ACTIVE_STATUSES: TaskStatus[] = ['Open', 'InProgress', 'OnHold', 'Review'];

/**
 * Statuses a person can pick directly. Review is entered by sending a task to a
 * reviewer (the task page) and left with Reviewed, so it is never offered here.
 */
export function statusOptions(current?: TaskStatus): SelectOption<TaskStatus>[] {
  return TASK_STATUSES.filter((s) => s !== 'Review' || s === current).map((s) => ({
    value: s,
    label: TASK_STATUS_LABELS[s],
    dot: STATUS_DOT[s],
  }));
}

export const PRIORITY_OPTIONS: SelectOption<TaskPriority>[] = TASK_PRIORITIES.map((p) => ({
  value: p,
  label: p,
  dot: PRIORITY_DOT[p],
}));

export type Period = 'today' | 'week' | 'month';

export const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
];

/**
 * The period in the viewer's own time zone: today; this week, Sunday to
 * Saturday; this month. `from`/`to` are calendar days (inclusive) for date
 * filters; `heading` is the line above the tiles.
 */
export function periodRange(
  p: Period,
  now = new Date(),
): { from: string; to: string; heading: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === 'today') {
    return {
      from: toYmd(today),
      to: toYmd(today),
      heading: today.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      }),
    };
  }
  if (p === 'week') {
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return { from: toYmd(start), to: toYmd(end), heading: `Week of ${fmt(start)} – ${fmt(end)}` };
  }
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return {
    from: toYmd(start),
    to: toYmd(end),
    heading: `${today.toLocaleDateString(undefined, { month: 'long' })} so far`,
  };
}

const DAY = 86_400_000;

/** "Today", "Tomorrow", "Fri, Nov 13", or "Oct 31 · 5 days overdue". */
export function dueInfo(
  iso: string | null,
  status?: TaskStatus,
): { text: string; late: boolean; today: boolean } | null {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayOf = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayOf - startToday) / DAY);
  const done = status === 'Completed' || status === 'Canceled';
  const short = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (!done && d.getTime() < now.getTime()) {
    const late = Math.max(0, -days);
    return {
      text:
        late === 0
          ? 'Due today · late'
          : `${short} · ${late} ${late === 1 ? 'day' : 'days'} overdue`,
      late: true,
      today: late === 0,
    };
  }
  if (days === 0) return { text: 'Today', late: false, today: true };
  if (days === 1) return { text: 'Tomorrow', late: false, today: false };
  if (days > 1 && days < 7) {
    return {
      text: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      late: false,
      today: false,
    };
  }
  return { text: short, late: false, today: false };
}

/** "#4412 · Finance › Reporting" */
export function taskSub(t: Pick<TaskRowDto, 'id' | 'duty'>): string {
  return t.duty ? `#${t.id} · ${dutyLabel(t.duty)}` : `#${t.id}`;
}

/** Keep the day, move the time to end of business (17:00) when a date is picked. */
export function dueIsoFromYmd(ymd: string | null, previousIso?: string | null): string | null {
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const prev = previousIso ? new Date(previousIso) : null;
  const at = new Date(y!, m! - 1, d!, prev ? prev.getHours() : 17, prev ? prev.getMinutes() : 0);
  return at.toISOString();
}

export function ymdFromIso(iso: string | null): string | null {
  return iso ? toYmd(new Date(iso)) : null;
}
