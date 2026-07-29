import type { TaskSearchFilters } from '@healthy-tasks/shared';

/**
 * Saved sidebar Views — each is just a `TaskSearchFilters` shape that navigates
 * to /tasks (no new backend). Only the shapes expressible with the current
 * filter contract are wired here:
 *   - Overdue          → { overdue: true }
 *   - Assigned to me   → { assigneeIds: [me] }
 *   - Needs my review  → { statuses: ['Review'], assigneeIds: [me] }
 *
 * The handoff also lists "Blocked" (tasks with an incomplete `isBlockedBy`) and
 * "Created by me" (creator = me). Neither maps to a field on
 * `TaskSearchFilters` today, so they'd require a new filter — deliberately left
 * out until that's decided, since the brief says no new backend work.
 */
export interface SavedView {
  key: string;
  label: string;
  color: string;
  filters: (meId: string) => TaskSearchFilters;
}

export const SAVED_VIEWS: SavedView[] = [
  { key: 'overdue', label: 'Overdue', color: 'var(--danger)', filters: () => ({ overdue: true }) },
  {
    key: 'assigned',
    label: 'Assigned to me',
    color: 'var(--accent)',
    filters: (me) => ({ assigneeIds: [me] }),
  },
  {
    key: 'review',
    label: 'Needs my review',
    color: 'var(--review)',
    filters: (me) => ({ statuses: ['Review'], assigneeIds: [me] }),
  },
];
