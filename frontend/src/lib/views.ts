import type { TaskSearchFilters } from '@healthy-tasks/shared';

/**
 * Saved sidebar Views — each is a `TaskSearchFilters` shape that navigates to
 * /tasks. `blocked` and `creatorIds` are backed by filter fields added in
 * Phase 10 (shared type + zod + query), so all five map to real queries:
 *   - Overdue          → { overdue: true }
 *   - Assigned to me   → { assigneeIds: [me] }
 *   - Needs my review  → { statuses: ['Review'], assigneeIds: [me] }
 *   - Blocked          → { blocked: true }
 *   - Created by me    → { creatorIds: [me] }
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
  { key: 'blocked', label: 'Blocked', color: 'var(--warn)', filters: () => ({ blocked: true }) },
  {
    key: 'created',
    label: 'Created by me',
    color: 'var(--faint)',
    filters: (me) => ({ creatorIds: [me] }),
  },
];
