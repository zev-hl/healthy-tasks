import {
  EXCLUSIVES_ALERT_TYPE_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type TaskPriority,
  type TaskSearchFilters,
  type TaskSort,
  type TaskSortField,
  type TaskStatus,
} from '@healthy-tasks/shared';
import { ACTIVE_STATUSES, periodRange } from '../../components/harbor/taskHelpers';
import { effectiveFilters } from '../../lib/taskSearch';
import type { SelectOption } from '../../components/harbor/Select';
import { STATUS_DOT } from '../../components/harbor/ui';

/** Whose tasks a tab shows. Views are about whose tasks and which filters, never statuses. */
export type Scope = 'mine' | 'all' | 'team';

export type StatusPreset = 'open' | 'overdue' | 'dueToday' | 'dueWeek' | 'any' | `s:${TaskStatus}`;

export type TaskView = 'list' | 'kanban' | 'calendar' | 'gantt';

export const ALL = '__all';
export const UNASSIGNED = '__unassigned';

/** Everything that decides what the Tasks page shows; a saved view stores one. */
export interface ViewState {
  scope: Scope;
  status: StatusPreset;
  dept: string; // department id or ALL
  duty: string; // duty id or ALL
  owner: string; // user id, UNASSIGNED, or ALL
  priority: TaskPriority | typeof ALL;
  /** Less common filters, each shown as its own chip. */
  extra: TaskSearchFilters;
  sortField: TaskSortField;
  sortDir: 'asc' | 'desc';
}

export interface SavedView {
  id: string;
  name: string;
  state: ViewState;
}

export const defaultState = (scope: Scope = 'mine'): ViewState => ({
  scope,
  status: 'open',
  dept: ALL,
  duty: ALL,
  owner: ALL,
  priority: ALL,
  extra: {},
  sortField: 'dueAt',
  sortDir: 'asc',
});

export const STATUS_PRESETS: SelectOption<StatusPreset>[] = [
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue', dot: '#b42318' },
  { value: 'dueToday', label: 'Due today' },
  { value: 'dueWeek', label: 'Due this week' },
  ...TASK_STATUSES.map((s) => ({
    value: `s:${s}` as StatusPreset,
    label: TASK_STATUS_LABELS[s],
    dot: STATUS_DOT[s],
  })),
  { value: 'any', label: 'Any' },
];

export const SORT_OPTIONS: SelectOption<TaskSortField>[] = [
  { value: 'dueAt', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
  { value: 'assignee', label: 'Owner' },
  { value: 'duty', label: 'Department › Duty' },
  { value: 'name', label: 'Task name' },
  { value: 'createdAt', label: 'Created' },
  { value: 'id', label: 'Number' },
];

/** The direction button's words for each sort. */
export function dirLabel(field: TaskSortField, dir: 'asc' | 'desc'): string {
  switch (field) {
    case 'dueAt':
      return dir === 'asc' ? '↑ Soonest' : '↓ Latest';
    case 'createdAt':
    case 'id':
      return dir === 'asc' ? '↑ Oldest' : '↓ Newest';
    case 'priority':
      // The API orders priority Urgent → Low ascending.
      return dir === 'asc' ? 'Highest first' : 'Lowest first';
    case 'status':
      return dir === 'asc' ? 'Open first' : 'Done first';
    default:
      return dir === 'asc' ? 'A–Z' : 'Z–A';
  }
}

/** Turn the page state into the API's filters. */
export function buildFilters(v: ViewState, me: string, teamIds: string[]): TaskSearchFilters {
  const f: TaskSearchFilters = { includeNoStart: true, includeNoDue: true, ...v.extra };
  if (v.scope === 'mine') f.assigneeIds = [me];
  if (v.scope === 'team')
    f.assigneeIds = teamIds.length > 0 ? teamIds : ['00000000-0000-0000-0000-000000000000'];
  if (v.scope !== 'mine' && v.owner !== ALL) {
    if (v.owner === UNASSIGNED) {
      f.assigneeIds = [];
      f.includeUnassigned = true;
    } else f.assigneeIds = [v.owner];
  }
  if (v.dept !== ALL) f.departmentIds = [v.dept];
  if (v.duty !== ALL) f.dutyIds = [v.duty];
  if (v.priority !== ALL) f.priorities = [v.priority];
  const week = periodRange('week');
  const today = periodRange('today');
  switch (v.status) {
    case 'open':
      f.statuses = ACTIVE_STATUSES;
      break;
    case 'overdue':
      f.overdue = true;
      break;
    case 'dueToday':
      Object.assign(f, {
        statuses: ACTIVE_STATUSES,
        dueFrom: today.from,
        dueTo: today.to,
        includeNoDue: false,
      });
      break;
    case 'dueWeek':
      Object.assign(f, {
        statuses: ACTIVE_STATUSES,
        dueFrom: week.from,
        dueTo: week.to,
        includeNoDue: false,
      });
      break;
    case 'any':
      break;
    default:
      f.statuses = [v.status.slice(2) as TaskStatus];
  }
  return effectiveFilters(f);
}

export function sortOf(v: ViewState): TaskSort[] {
  const s: TaskSort[] = [{ field: v.sortField, dir: v.sortDir }];
  if (v.sortField !== 'dueAt') s.push({ field: 'dueAt', dir: 'asc' });
  return s;
}

/**
 * Raw filters arriving from a link (the Dashboard, a notification) become page
 * state: what has a chip of its own goes there, the rest stays as extra chips.
 */
export function fromRawFilters(raw: TaskSearchFilters, me: string): ViewState {
  const v = defaultState('all');
  const extra: TaskSearchFilters = { ...raw };
  delete extra.includeNoStart;
  delete extra.includeNoDue;
  v.status = 'any';
  if (raw.assigneeIds?.length === 1 && !raw.includeUnassigned) {
    if (raw.assigneeIds[0] === me) v.scope = 'mine';
    else v.owner = raw.assigneeIds[0]!;
    delete extra.assigneeIds;
  }
  if (raw.overdue) {
    v.status = 'overdue';
    delete extra.overdue;
  } else if (
    raw.statuses &&
    raw.statuses.length === ACTIVE_STATUSES.length &&
    ACTIVE_STATUSES.every((s) => raw.statuses!.includes(s)) &&
    !raw.dueFrom &&
    !raw.dueTo
  ) {
    v.status = 'open';
    delete extra.statuses;
  } else if (raw.statuses?.length === 1 && !raw.statusChangedFrom) {
    v.status = `s:${raw.statuses[0]!}`;
    delete extra.statuses;
  }
  if (raw.departmentIds?.length === 1) {
    v.dept = raw.departmentIds[0]!;
    delete extra.departmentIds;
  }
  if (raw.dutyIds?.length === 1) {
    v.duty = raw.dutyIds[0]!;
    delete extra.dutyIds;
  }
  if (raw.priorities?.length === 1) {
    v.priority = raw.priorities[0]!;
    delete extra.priorities;
  }
  for (const k of Object.keys(extra) as (keyof TaskSearchFilters)[]) {
    const val = extra[k];
    if (val === undefined || val === null || (Array.isArray(val) && val.length === 0))
      delete extra[k];
  }
  v.extra = extra;
  return v;
}

/** Whether two states show the same thing (for "Save as view" / "Update"). */
export function sameState(a: ViewState, b: ViewState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A chip for each extra filter, with how to clear it. */
export function extraChips(
  extra: TaskSearchFilters,
  names: { user: (id: string) => string; group: (id: number) => string },
): { key: string; label: string; clear: (keyof TaskSearchFilters)[] }[] {
  const chips: { key: string; label: string; clear: (keyof TaskSearchFilters)[] }[] = [];
  const day = (s?: string | null) =>
    s
      ? new Date(s.length === 10 ? `${s}T12:00` : s).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        })
      : '…';
  if (extra.assigneeIds?.length || extra.includeUnassigned)
    chips.push({
      key: 'owners',
      label: `Owners: ${[...(extra.assigneeIds ?? []).map(names.user), ...(extra.includeUnassigned ? ['Unassigned'] : [])].join(', ')}`,
      clear: ['assigneeIds', 'includeUnassigned'],
    });
  if (extra.statuses?.length)
    chips.push({
      key: 'statuses',
      label: `Status: ${extra.statuses.map((s) => TASK_STATUS_LABELS[s]).join(', ')}`,
      clear: ['statuses'],
    });
  if (extra.tags?.length)
    chips.push({ key: 'tags', label: `Tag: ${extra.tags.join(', ')}`, clear: ['tags'] });
  if (extra.creatorIds?.length)
    chips.push({
      key: 'creator',
      label: `Created by: ${extra.creatorIds.map(names.user).join(', ')}`,
      clear: ['creatorIds'],
    });
  if (extra.alertGroupIds?.length || extra.includeNoAlertGroup)
    chips.push({
      key: 'group',
      label: `Alert group: ${[...(extra.alertGroupIds ?? []).map(names.group), ...(extra.includeNoAlertGroup ? ['(not set)'] : [])].join(', ')}`,
      clear: ['alertGroupIds', 'includeNoAlertGroup'],
    });
  if (extra.alertTypes?.length || extra.includeNoAlertType)
    chips.push({
      key: 'type',
      label: `Alert type: ${[...(extra.alertTypes ?? []).map((t) => EXCLUSIVES_ALERT_TYPE_LABELS[t]), ...(extra.includeNoAlertType ? ['(not set)'] : [])].join(', ')}`,
      clear: ['alertTypes', 'includeNoAlertType'],
    });
  if (extra.dueFrom || extra.dueTo)
    chips.push({
      key: 'due',
      label: `Due ${day(extra.dueFrom)} – ${day(extra.dueTo)}`,
      clear: ['dueFrom', 'dueTo'],
    });
  if (extra.startFrom || extra.startTo)
    chips.push({
      key: 'start',
      label: `Starts ${day(extra.startFrom)} – ${day(extra.startTo)}`,
      clear: ['startFrom', 'startTo'],
    });
  if (extra.statusChangedFrom || extra.statusChangedTo)
    chips.push({
      key: 'changed',
      label: `Status changed ${day(extra.statusChangedFrom)} – ${day(extra.statusChangedTo)}`,
      clear: ['statusChangedFrom', 'statusChangedTo'],
    });
  if (extra.relation)
    chips.push({
      key: 'relation',
      label: { parent: 'Parent tasks', child: 'Sub-tasks', standalone: 'Standalone tasks' }[
        extra.relation
      ],
      clear: ['relation'],
    });
  if (extra.blocked)
    chips.push({ key: 'blocked', label: 'Blocked by another task', clear: ['blocked'] });
  if (extra.dutyMismatch)
    chips.push({ key: 'mismatch', label: 'Owner doesn’t hold the duty', clear: ['dutyMismatch'] });
  if (extra.completedToday)
    chips.push({ key: 'completedToday', label: 'Completed today', clear: ['completedToday'] });
  if (extra.instanceLabel)
    chips.push({
      key: 'batch',
      label: `PO / batch: ${extra.instanceLabel}`,
      clear: ['instanceLabel'],
    });
  if (extra.templateId)
    chips.push({
      key: 'template',
      label: `From template #${extra.templateId}`,
      clear: ['templateId'],
    });
  if (extra.departmentIds?.length)
    chips.push({
      key: 'depts',
      label: `${extra.departmentIds.length} departments`,
      clear: ['departmentIds'],
    });
  if (extra.dutyIds?.length)
    chips.push({ key: 'duties', label: `${extra.dutyIds.length} duties`, clear: ['dutyIds'] });
  if (extra.priorities?.length)
    chips.push({
      key: 'prios',
      label: `Priority: ${extra.priorities.join(', ')}`,
      clear: ['priorities'],
    });
  if (extra.hierarchyUserIds?.length)
    chips.push({
      key: 'hier',
      label: `${extra.hierarchyUserIds.length} people`,
      clear: ['hierarchyUserIds'],
    });
  return chips;
}

/** True when the state differs from its tab's defaults (drives Clear). */
export function isFiltered(v: ViewState): boolean {
  const d = defaultState(v.scope);
  return (
    v.status !== d.status ||
    v.dept !== ALL ||
    v.duty !== ALL ||
    v.owner !== ALL ||
    v.priority !== ALL ||
    Object.keys(v.extra).length > 0
  );
}

export function readViewState(x: unknown): ViewState | null {
  if (!x || typeof x !== 'object') return null;
  const v = x as Partial<ViewState>;
  if (v.scope !== 'mine' && v.scope !== 'all' && v.scope !== 'team') return null;
  return { ...defaultState(v.scope), ...v, extra: v.extra ?? {} };
}
