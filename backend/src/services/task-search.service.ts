import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { toUserRef } from './user.mapper.js';
import { listAllTags } from './task.service.js';
import {
  DEFAULT_PAGE_SIZE,
  TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  type PaginatedResult,
  type SortDirection,
  type TaskDashboardDto,
  type TaskRowDto,
  type TaskSortField,
  type TaskStatus,
} from '@healthy-tasks/shared';
import type {
  DueDateReportInput,
  TaskDashboardInput,
  TaskSearchInput,
} from '../validation/schemas.js';
import {
  type Actor,
  type TaskAccessScope,
  buildTaskAccessWhere,
  classifyRow,
  getTaskAccessScope,
} from './access-control.service.js';

// Hard cap on export size to bound memory (well above realistic result sets).
const EXPORT_MAX_ROWS = 10000;
// Nested mode fetches the whole result set to build the tree; bound it too.
const NEST_MAX_ROWS = 5000;

// --- Row shape & mapping ---------------------------------------------------

export const rowInclude = {
  creator: { select: { id: true, email: true, firstName: true, lastName: true, title: true } },
  assignee: { select: { id: true, email: true, firstName: true, lastName: true, title: true } },
  _count: { select: { children: true } },
  // Phase 10: the predecessor ids that feed the Gantt view's dependency arrows.
  blockedBy: { select: { blockerId: true } },
} as const;

export type TaskRow = Prisma.TaskGetPayload<{ include: typeof rowInclude }>;

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

export function toTaskRowDto(t: TaskRow, scope: TaskAccessScope): TaskRowDto {
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    statusChangedAt: iso(t.statusChangedAt),
    priority: t.priority,
    assignee: t.assignee ? toUserRef(t.assignee) : null,
    creator: toUserRef(t.creator),
    createdAt: t.createdAt.toISOString(),
    startAt: iso(t.startAt),
    dueAt: iso(t.dueAt),
    parentId: t.parentId,
    childrenCount: t._count.children,
    tags: t.tags,
    blockedByIds: t.blockedBy.map((b) => b.blockerId),
    instanceLabel: t.instanceLabel,
    templateId: t.templateId,
    // Read-only cues: mention-only and/or tree-inherited (both false for full access / Admin).
    ...classifyRow(scope, t.id),
  };
}

// --- WHERE construction ----------------------------------------------------

/**
 * A date-range condition as a top-level Task filter. `includeNull` controls
 * whether tasks with a null value are kept:
 *  - no range + includeNull  → no constraint (null)
 *  - no range + !includeNull → field must be non-null
 *  - range + includeNull     → null OR within range
 *  - range + !includeNull    → within range (nulls implicitly excluded)
 */
function dateRangeWhere(
  field: 'startAt' | 'dueAt' | 'statusChangedAt',
  from: Date | null | undefined,
  to: Date | null | undefined,
  includeNull: boolean,
  // Date-only filters (Start/Due) send a bare YYYY-MM-DD → UTC midnight; the
  // "To" bound must cover the whole day, so treat it as exclusive of the NEXT
  // midnight (i.e. through 23:59:59.999). statusChanged uses a datetime and
  // keeps its exact upper bound.
  toEndOfDay = false,
): Prisma.TaskWhereInput | null {
  const range: Prisma.DateTimeFilter = {};
  if (from) range.gte = from;
  if (to) {
    if (toEndOfDay) range.lt = new Date(to.getTime() + 24 * 60 * 60 * 1000);
    else range.lte = to;
  }
  const hasRange = range.gte !== undefined || range.lt !== undefined || range.lte !== undefined;

  if (!hasRange) {
    return includeNull ? null : { [field]: { not: null } };
  }
  if (includeNull) {
    return { OR: [{ [field]: null }, { [field]: range }] };
  }
  return { [field]: range };
}

// --- Dashboard quick-filter fragments (Phase 7) ----------------------------
// Shared by buildWhere (when a quick-filter is the active filter) and by the
// dashboard tallies, so each count matches exactly what its filter would show.

/** Not Completed/Canceled, with a Due Date strictly before `now`. */
function overdueWhere(now: Date): Prisma.TaskWhereInput {
  // `dueAt < now` already excludes null due dates (null is never < now).
  return { status: { notIn: [...TERMINAL_TASK_STATUSES] }, dueAt: { lt: now } };
}

/** Completed, with a Status-changed timestamp within [start, end). */
function completedTodayWhere(start: Date, end: Date): Prisma.TaskWhereInput {
  return { status: 'Completed', statusChangedAt: { gte: start, lt: end } };
}

/** Not Completed/Canceled, with a Due Date within today's window [start, end). */
function dueTodayWhere(start: Date, end: Date): Prisma.TaskWhereInput {
  return { status: { notIn: [...TERMINAL_TASK_STATUSES] }, dueAt: { gte: start, lt: end } };
}

/** One of the mutually-exclusive Parent/Child buckets (see TaskRelationFilter). */
function relationWhere(rel: 'parent' | 'child' | 'standalone'): Prisma.TaskWhereInput {
  switch (rel) {
    case 'child':
      return { parentId: { not: null } };
    case 'parent':
      return { parentId: null, children: { some: {} } };
    case 'standalone':
      return { parentId: null, children: { none: {} } };
  }
}

export async function buildWhere(
  input: TaskSearchInput | TaskDashboardInput | DueDateReportInput,
): Promise<Prisma.TaskWhereInput> {
  const and: Prisma.TaskWhereInput[] = [];
  const f = input.filters ?? {};

  // Free-text: Task Name (partial), Task Id (exact when numeric), Tags (partial).
  const text = input.text?.trim();
  if (text) {
    const or: Prisma.TaskWhereInput[] = [{ name: { contains: text, mode: 'insensitive' } }];
    if (/^\d+$/.test(text)) or.push({ id: Number(text) });
    const lower = text.toLowerCase();
    const matchedTags = (await listAllTags()).filter((t) => t.toLowerCase().includes(lower));
    if (matchedTags.length > 0) or.push({ tags: { hasSome: matchedTags } });
    and.push({ OR: or });
  }

  // Assignee (multi + optional "Unassigned").
  const assigneeOr: Prisma.TaskWhereInput[] = [];
  if (f.assigneeIds && f.assigneeIds.length > 0) assigneeOr.push({ assigneeId: { in: f.assigneeIds } });
  if (f.includeUnassigned) assigneeOr.push({ assigneeId: null });
  if (assigneeOr.length > 0) and.push({ OR: assigneeOr });

  if (f.statuses && f.statuses.length > 0) and.push({ status: { in: f.statuses } });
  if (f.priorities && f.priorities.length > 0) and.push({ priority: { in: f.priorities } });
  if (f.tags && f.tags.length > 0) and.push({ tags: { hasSome: f.tags } });

  const statusRange = dateRangeWhere('statusChangedAt', f.statusChangedFrom, f.statusChangedTo, true);
  if (statusRange) and.push(statusRange);

  const startRange = dateRangeWhere('startAt', f.startFrom, f.startTo, f.includeNoStart ?? true, true);
  if (startRange) and.push(startRange);

  const dueRange = dateRangeWhere('dueAt', f.dueFrom, f.dueTo, f.includeNoDue ?? true, true);
  if (dueRange) and.push(dueRange);

  // Dashboard quick-filters. `overdue`/`completedToday` are time-relative and
  // use the client-supplied clock context (falling back to server "now" if a
  // caller omits it); a missing calendar-day window makes completedToday a no-op.
  if (f.overdue) and.push(overdueWhere(input.now ?? new Date()));
  if (f.completedToday && input.todayStart && input.todayEnd) {
    and.push(completedTodayWhere(input.todayStart, input.todayEnd));
  }
  if (f.relation) and.push(relationWhere(f.relation));

  // Saved-view filters (Phase 10).
  if (f.creatorIds && f.creatorIds.length > 0) and.push({ creatorId: { in: f.creatorIds } });
  // "Blocked" = has at least one incomplete blocker (a non-terminal isBlockedBy).
  if (f.blocked) {
    and.push({ blockedBy: { some: { blocker: { status: { notIn: [...TERMINAL_TASK_STATUSES] } } } } });
  }

  // Template provenance (Phase 11): filter by instance label (partial) or source
  // template — the "stored as its own filterable field" half of instance labels.
  if (f.instanceLabel && f.instanceLabel.trim()) {
    and.push({ instanceLabel: { contains: f.instanceLabel.trim(), mode: 'insensitive' } });
  }
  if (f.templateId) and.push({ templateId: f.templateId });

  return and.length > 0 ? { AND: and } : {};
}

// --- ORDER BY construction -------------------------------------------------

function mapSort(field: TaskSortField, dir: SortDirection): Prisma.TaskOrderByWithRelationInput {
  switch (field) {
    case 'id':
      return { id: dir };
    case 'name':
      return { name: dir };
    case 'status':
      return { status: dir };
    case 'priority':
      // Enum ordering follows the declaration order (Urgent→High→Medium→Low).
      return { priority: dir };
    case 'createdAt':
      return { createdAt: dir };
    case 'statusChangedAt':
      return { statusChangedAt: { sort: dir, nulls: 'last' } };
    case 'assignee':
      return { assignee: { email: dir } };
    case 'creator':
      return { creator: { email: dir } };
    case 'startAt':
      // Spec: tasks with no Start Date sort to the top.
      return { startAt: { sort: dir, nulls: 'first' } };
    case 'dueAt':
      // Spec: tasks with no Due Date sort to the top.
      return { dueAt: { sort: dir, nulls: 'first' } };
    case 'parentChild':
      return { parentId: { sort: dir, nulls: 'last' } };
  }
}

export function buildOrderBy(
  sort: { field: TaskSortField; dir: SortDirection }[],
): Prisma.TaskOrderByWithRelationInput[] {
  const orderBy = sort.map((s) => mapSort(s.field, s.dir));
  // Default: Due ascending with no-due tasks pinned to the top.
  if (orderBy.length === 0) orderBy.push({ dueAt: { sort: 'asc', nulls: 'first' } });
  // Stable tiebreaker for deterministic pagination.
  orderBy.push({ id: 'asc' });
  return orderBy;
}

// --- Public API ------------------------------------------------------------

/**
 * Build the effective WHERE for a multi-task query: the user-supplied filters
 * (buildWhere) ANDed with the caller's Phase 13 access predicate. Returns the
 * where plus the scope (needed to flag mention-only rows).
 */
export async function scopedTaskWhere(
  input: TaskSearchInput | TaskDashboardInput,
  actor: Actor,
): Promise<{ where: Prisma.TaskWhereInput; scope: TaskAccessScope }> {
  const scope = await getTaskAccessScope(actor);
  const base = await buildWhere(input);
  const accessWhere = buildTaskAccessWhere(scope, input.includeReadOnly ?? true);
  return { where: accessWhere ? { AND: [base, accessWhere] } : base, scope };
}

export async function searchTasks(
  input: TaskSearchInput,
  actor: Actor,
): Promise<PaginatedResult<TaskRowDto>> {
  const { where, scope } = await scopedTaskWhere(input, actor);
  const orderBy = buildOrderBy(input.sort ?? []);
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;

  if (input.nest) return nestedPage(where, orderBy, page, pageSize, scope);

  const [rows, total] = await prisma.$transaction([
    prisma.task.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: rowInclude,
    }),
    prisma.task.count({ where }),
  ]);

  return { rows: rows.map((r) => toTaskRowDto(r, scope)), total, page, pageSize };
}

/**
 * Nested mode: fetch the whole (sorted) result set, group every child under its
 * parent — but only when the parent is also in the result set — with each
 * sibling layer preserving the top-level sort order, then paginate the flattened
 * nested sequence. Every matching task appears exactly once, so `total` equals
 * the number of matches (capped at NEST_MAX_ROWS).
 */
async function nestedPage(
  where: Prisma.TaskWhereInput,
  orderBy: Prisma.TaskOrderByWithRelationInput[],
  page: number,
  pageSize: number,
  scope: TaskAccessScope,
): Promise<PaginatedResult<TaskRowDto>> {
  const all = await prisma.task.findMany({ where, orderBy, take: NEST_MAX_ROWS, include: rowInclude });
  const nested = buildNestedOrder(all.map((r) => toTaskRowDto(r, scope)));
  const start = (page - 1) * pageSize;
  return { rows: nested.slice(start, start + pageSize), total: nested.length, page, pageSize };
}

/**
 * Flatten `dtos` (already in global sort order) into DFS/tree order with a
 * `depth` on each row. Roots are tasks whose parent is absent from the set;
 * children hang off their parent, preserving the incoming (sorted) order.
 */
function buildNestedOrder(dtos: TaskRowDto[]): TaskRowDto[] {
  const idSet = new Set(dtos.map((d) => d.id));
  const childrenByParent = new Map<number, TaskRowDto[]>();
  for (const d of dtos) {
    if (d.parentId != null && idSet.has(d.parentId)) {
      const list = childrenByParent.get(d.parentId) ?? [];
      list.push(d);
      childrenByParent.set(d.parentId, list);
    }
  }
  const out: TaskRowDto[] = [];
  const emit = (d: TaskRowDto, depth: number): void => {
    out.push({ ...d, depth });
    for (const c of childrenByParent.get(d.id) ?? []) emit(c, depth + 1);
  };
  for (const d of dtos) {
    if (d.parentId == null || !idSet.has(d.parentId)) emit(d, 0);
  }
  return out;
}

/**
 * Dashboard counts for the current filtered/searched result set (Phase 7).
 *
 * Everything is computed against the same `where` the grid uses, so every tally
 * reflects the active search text + filters. The Parent/Child buckets partition
 * the set (child ∪ parent ∪ standalone = all), and the per-status counts also
 * sum to the total. Overdue and Completed-Today use the caller's clock context.
 */
export async function getTaskDashboard(
  input: TaskDashboardInput,
  actor: Actor,
): Promise<TaskDashboardDto> {
  const { where } = await scopedTaskWhere(input, actor);
  const and = (extra: Prisma.TaskWhereInput): Prisma.TaskWhereInput => ({ AND: [where, extra] });

  // One consistent snapshot so the Parent/Child buckets and status tallies sum
  // exactly to the total even under concurrent writes.
  const { byStatusGroups, child, parent, standalone, overdue, completedToday, dueToday } =
    await prisma.$transaction(async (tx) => {
      const [byStatusGroups, child, parent, standalone, overdue, completedToday, dueToday] =
        await Promise.all([
          tx.task.groupBy({ by: ['status'], where, _count: { _all: true }, orderBy: { status: 'asc' } }),
          tx.task.count({ where: and(relationWhere('child')) }),
          tx.task.count({ where: and(relationWhere('parent')) }),
          tx.task.count({ where: and(relationWhere('standalone')) }),
          tx.task.count({ where: and(overdueWhere(input.now)) }),
          tx.task.count({ where: and(completedTodayWhere(input.todayStart, input.todayEnd)) }),
          tx.task.count({ where: and(dueTodayWhere(input.todayStart, input.todayEnd)) }),
        ]);
      return { byStatusGroups, child, parent, standalone, overdue, completedToday, dueToday };
    });

  const byStatus = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
  let total = 0;
  for (const g of byStatusGroups) {
    byStatus[g.status] = g._count._all;
    total += g._count._all;
  }

  return { total, parent, child, standalone, byStatus, overdue, completedToday, dueToday };
}

/** Same query as searchTasks but unpaginated (capped) — for Excel export. */
export async function searchTasksForExport(
  input: TaskSearchInput,
  actor: Actor,
): Promise<TaskRowDto[]> {
  const { where, scope } = await scopedTaskWhere(input, actor);
  const orderBy = buildOrderBy(input.sort ?? []);
  const rows = await prisma.task.findMany({
    where,
    orderBy,
    take: EXPORT_MAX_ROWS,
    include: rowInclude,
  });
  return rows.map((r) => toTaskRowDto(r, scope));
}

/** The export row cap, reused by the report service. */
export const REPORT_MAX_ROWS = EXPORT_MAX_ROWS;
