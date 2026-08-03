// Helpers shared by the Task Search screen and its dashboard (Phase 6/7).
//
// Date handling stays in the browser so "local" is the user's actual time zone,
// consistent with lib/datetime.ts and the rest of the Search screen.

import type { TaskRelationFilter, TaskSearchFilters, TaskStatus } from '@healthy-tasks/shared';

/**
 * Convert a bare YYYY-MM-DD Start/Due filter bound to a precise UTC instant in
 * the browser's LOCAL time zone, so the backend compares it directly (it does
 * NOT re-expand). A "from" bound → local start of that day (00:00:00.000); a
 * "to" bound → local end of that day (23:59:59.999) so it covers the whole local
 * day. Anything that isn't a bare date (already an instant / null / empty)
 * passes through unchanged.
 */
export function startOfLocalDay(v: string | null | undefined): string | null | undefined {
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-');
    return new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0).toISOString();
  }
  return v;
}
export function endOfLocalDay(v: string | null | undefined): string | null | undefined {
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-');
    return new Date(Number(y), Number(m) - 1, Number(d), 23, 59, 59, 999).toISOString();
  }
  return v;
}

/**
 * The filters as actually sent to the API: each bare-date Start/Due bound is
 * converted to a precise local-time instant (from = start of day, to = end of
 * day). Keeping the time-zone math in the browser means "local" is the user's
 * actual zone, and the backend compares the instants as-is with NO further
 * end-of-day expansion (doing it in both places pushed the range a day too far).
 * Used by the grid query, the export, and the dashboard counts alike.
 */
export function effectiveFilters(filters: TaskSearchFilters): TaskSearchFilters {
  return {
    ...filters,
    startFrom: startOfLocalDay(filters.startFrom),
    startTo: endOfLocalDay(filters.startTo),
    dueFrom: startOfLocalDay(filters.dueFrom),
    dueTo: endOfLocalDay(filters.dueTo),
  };
}

/** Browser clock context for the time-relative quick-filters (local time zone). */
export function nowContext(): { now: string; todayStart: string; todayEnd: string } {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  return {
    now: now.toISOString(),
    todayStart: todayStart.toISOString(),
    todayEnd: todayEnd.toISOString(),
  };
}

// --- Dashboard quick-filter selection --------------------------------------
//
// The dashboard counts form three independent groups, each mapping to its own
// filter dimension:
//   - Total     → `relation`  (parent | child | standalone)
//   - Status    → `statuses`  (a lone selected status)
//   - Attention → `overdue` / `completedToday`
// Within a group the selection is mutually exclusive (at most one active), but
// the groups are independent — e.g. Parent + On Hold + Overdue can all be on at
// once. Each applied value lives in the shared `filters` object, so it layers on
// top of (and never disturbs) the popover filters or the other groups.

export const OVERDUE_STAT = 'overdue';
export const DUE_TODAY_STAT = 'dueToday';
export const COMPLETED_TODAY_STAT = 'completedToday';
export const statusStat = (s: TaskStatus): string => `status:${s}`;
export const relationStat = (r: TaskRelationFilter): string => `relation:${r}`;

/** Today as a local YYYY-MM-DD, matching the date inputs' value format. */
function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** True when the filters are exactly the "due today" range (both bounds = today). */
function isDueTodayActive(f: TaskSearchFilters): boolean {
  const today = localToday();
  return f.dueFrom === today && f.dueTo === today && f.includeNoDue === false;
}

/** Every dashboard count currently applied as a filter (at most one per group). */
export function dashboardActiveStats(f: TaskSearchFilters): Set<string> {
  const active = new Set<string>();
  if (f.relation) active.add(relationStat(f.relation));
  if (f.statuses && f.statuses.length === 1 && f.statuses[0]) active.add(statusStat(f.statuses[0]));
  if (f.overdue) active.add(OVERDUE_STAT);
  if (f.completedToday) active.add(COMPLETED_TODAY_STAT);
  if (isDueTodayActive(f)) active.add(DUE_TODAY_STAT);
  return active;
}

/**
 * The filter patch for clicking dashboard count `key`. Only the clicked count's
 * group is touched: clicking toggles that count off if it was already active,
 * otherwise applies it and (within the Attention group) clears the sibling. All
 * other groups and any popover filters are left untouched.
 */
export function dashboardStatPatch(
  filters: TaskSearchFilters,
  key: string,
): Partial<TaskSearchFilters> {
  // Total group → relation.
  if (key.startsWith('relation:')) {
    const rel = key.slice('relation:'.length) as TaskRelationFilter;
    return { relation: filters.relation === rel ? undefined : rel };
  }
  // Status group → a lone selected status (replaces the Status dimension).
  if (key.startsWith('status:')) {
    const s = key.slice('status:'.length) as TaskStatus;
    const isActive = filters.statuses?.length === 1 && filters.statuses[0] === s;
    return { statuses: isActive ? undefined : [s] };
  }
  // Attention group → overdue XOR completedToday.
  if (key === OVERDUE_STAT) {
    return filters.overdue ? { overdue: undefined } : { overdue: true, completedToday: undefined };
  }
  if (key === COMPLETED_TODAY_STAT) {
    return filters.completedToday
      ? { completedToday: undefined }
      : { completedToday: true, overdue: undefined };
  }
  // Due-today → its own due-date range; toggling clears it back to the default.
  if (key === DUE_TODAY_STAT) {
    const today = localToday();
    return isDueTodayActive(filters)
      ? { dueFrom: null, dueTo: null, includeNoDue: true }
      : { dueFrom: today, dueTo: today, includeNoDue: false };
  }
  return {};
}
