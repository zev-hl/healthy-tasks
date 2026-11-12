import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type TaskRowDto,
  type TaskSortField,
} from '@healthy-tasks/shared';
import { userLabel } from '../../components/ui/Avatar';
import { STATUS_DOT } from '../../components/harbor/ui';
import type { SelectOption } from '../../components/harbor/Select';

/** Group by on the Tasks list (meeting decision, Nov 11). */
export type GroupBy = 'none' | 'status' | 'owner' | 'dept' | 'due';

export const GROUP_OPTIONS: SelectOption<GroupBy>[] = [
  { value: 'none', label: 'None' },
  { value: 'status', label: 'Status' },
  { value: 'owner', label: 'Owner' },
  { value: 'dept', label: 'Department' },
  { value: 'due', label: 'Due date' },
];

export const isGroupBy = (v: unknown): v is GroupBy => GROUP_OPTIONS.some((o) => o.value === v);

/**
 * The sort that keeps a grouping's groups together across pages: the list is
 * paged by the server, so picking a grouping also sorts by it.
 */
export const GROUP_SORT: Record<Exclude<GroupBy, 'none'>, TaskSortField> = {
  status: 'status',
  owner: 'assignee',
  dept: 'duty',
  due: 'dueAt',
};

export interface RowGroup {
  key: string;
  label: string;
  dot?: string;
  rows: TaskRowDto[];
}

const DUE_GROUPS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Next 7 days' },
  { key: 'later', label: 'Later' },
  { key: 'past', label: 'Earlier (done)' },
  { key: 'none', label: 'No due date' },
] as const;

function dueGroup(t: TaskRowDto, now: Date): string {
  if (!t.dueAt) return 'none';
  const due = new Date(t.dueAt);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const week = new Date(today);
  week.setDate(today.getDate() + 8);
  const done = t.status === 'Completed' || t.status === 'Canceled';
  if (due < today) return done ? 'past' : 'overdue';
  if (due < tomorrow) return 'today';
  if (due < week) return 'week';
  return 'later';
}

function keyOf(t: TaskRowDto, by: Exclude<GroupBy, 'none'>, now: Date) {
  switch (by) {
    case 'status':
      return { key: t.status, label: TASK_STATUS_LABELS[t.status], dot: STATUS_DOT[t.status] };
    case 'owner':
      return t.assignee
        ? { key: t.assignee.id, label: userLabel(t.assignee) }
        : { key: '', label: 'Unassigned' };
    case 'dept':
      return t.duty
        ? { key: t.duty.departmentId, label: t.duty.departmentName, dot: t.duty.color }
        : { key: '', label: 'No department' };
    case 'due': {
      const k = dueGroup(t, now);
      return { key: k, label: DUE_GROUPS.find((g) => g.key === k)!.label };
    }
  }
}

/**
 * Splits the shown rows into groups. A sub-task shown nested under its parent
 * stays with the parent's group, so a tree is never cut apart. Status and due
 * groups keep a fixed order; people and departments keep the list's order, with
 * "Unassigned" / "No department" last.
 */
export function groupRows(rows: TaskRowDto[], by: GroupBy, now = new Date()): RowGroup[] {
  if (by === 'none') return [{ key: 'all', label: '', rows }];
  const groups = new Map<string, RowGroup>();
  let current: RowGroup | null = null;
  for (const t of rows) {
    if (!t.depth || !current) {
      const k = keyOf(t, by, now);
      current = groups.get(k.key) ?? { ...k, rows: [] };
      groups.set(k.key, current);
    }
    current.rows.push(t);
  }
  const list = [...groups.values()];
  const fixed: readonly string[] | null =
    by === 'status' ? TASK_STATUSES : by === 'due' ? DUE_GROUPS.map((g) => g.key) : null;
  if (fixed) return list.sort((a, b) => fixed.indexOf(a.key) - fixed.indexOf(b.key));
  return [...list.filter((g) => g.key !== ''), ...list.filter((g) => g.key === '')];
}
