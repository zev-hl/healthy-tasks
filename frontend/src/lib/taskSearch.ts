// Helpers shared by the Task Search screen and its dashboard (Phase 6/7).
//
// Date handling stays in the browser so "local" is the user's actual time zone,
// consistent with lib/datetime.ts and the rest of the Search screen.

import type { TaskRelationFilter, TaskSearchFilters, TaskStatus } from '@healthy-tasks/shared';

/** Append end-of-day to a bare YYYY-MM-DD "to" bound so the range is inclusive. */
export function endOfDay(v: string | null | undefined): string | null | undefined {
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T23:59:59.999`;
  return v;
}

/**
 * The filters as actually sent to the API: the two bare-date upper bounds are
 * pushed to end-of-day so the ranges are inclusive. Used by the grid query, the
 * export, and the dashboard counts alike so all three agree.
 */
export function effectiveFilters(filters: TaskSearchFilters): TaskSearchFilters {
  return { ...filters, startTo: endOfDay(filters.startTo), dueTo: endOfDay(filters.dueTo) };
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
export const COMPLETED_TODAY_STAT = 'completedToday';
export const statusStat = (s: TaskStatus): string => `status:${s}`;
export const relationStat = (r: TaskRelationFilter): string => `relation:${r}`;

/** Every dashboard count currently applied as a filter (at most one per group). */
export function dashboardActiveStats(f: TaskSearchFilters): Set<string> {
  const active = new Set<string>();
  if (f.relation) active.add(relationStat(f.relation));
  if (f.statuses && f.statuses.length === 1 && f.statuses[0]) active.add(statusStat(f.statuses[0]));
  if (f.overdue) active.add(OVERDUE_STAT);
  if (f.completedToday) active.add(COMPLETED_TODAY_STAT);
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
  return {};
}
