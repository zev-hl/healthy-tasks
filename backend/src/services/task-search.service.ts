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
import type { TaskDashboardInput, TaskSearchInput } from '../validation/schemas.js';

// Hard cap on export size to bound memory (well above realistic result sets).
const EXPORT_MAX_ROWS = 10000;
// Nested mode fetches the whole result set to build the tree; bound it too.
const NEST_MAX_ROWS = 5000;

// --- Row shape & mapping ---------------------------------------------------

const rowInclude = {
  creator: { select: { id: true, email: true, title: true } },
  assignee: { select: { id: true, email: true, title: true } },
  _count: { select: { children: true } },
} as const;

type TaskRow = Prisma.TaskGetPayload<{ include: typeof rowInclude }>;

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function toTaskRowDto(t: TaskRow): TaskRowDto {
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
): Prisma.TaskWhereInput | null {
  const range: Prisma.DateTimeFilter = {};
  if (from) range.gte = from;
  if (to) range.lte = to;
  const hasRange = range.gte !== undefined || range.lte !== undefined;

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

async function buildWhere(input: TaskSearchInput | TaskDashboardInput): Promise<Prisma.TaskWhereInput> {
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

  const startRange = dateRangeWhere('startAt', f.startFrom, f.startTo, f.includeNoStart ?? true);
  if (startRange) and.push(startRange);

  const dueRange = dateRangeWhere('dueAt', f.dueFrom, f.dueTo, f.includeNoDue ?? true);
  if (dueRange) and.push(dueRange);

  // Dashboard quick-filters. `overdue`/`completedToday` are time-relative and
  // use the client-supplied clock context (falling back to server "now" if a
  // caller omits it); a missing calendar-day window makes completedToday a no-op.
  if (f.overdue) and.push(overdueWhere(input.now ?? new Date()));
  if (f.completedToday && input.todayStart && input.todayEnd) {
    and.push(completedTodayWhere(input.todayStart, input.todayEnd));
  }
  if (f.relation) and.push(relationWhere(f.relation));

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

function buildOrderBy(sort: { field: TaskSortField; dir: SortDirection }[]): Prisma.TaskOrderByWithRelationInput[] {
  const orderBy = sort.map((s) => mapSort(s.field, s.dir));
  // Default: Due ascending with no-due tasks pinned to the top.
  if (orderBy.length === 0) orderBy.push({ dueAt: { sort: 'asc', nulls: 'first' } });
  // Stable tiebreaker for deterministic pagination.
  orderBy.push({ id: 'asc' });
  return orderBy;
}

// --- Public API ------------------------------------------------------------

export async function searchTasks(input: TaskSearchInput): Promise<PaginatedResult<TaskRowDto>> {
  const where = await buildWhere(input);
  const orderBy = buildOrderBy(input.sort ?? []);
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;

  if (input.nest) return nestedPage(where, orderBy, page, pageSize);

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

  return { rows: rows.map(toTaskRowDto), total, page, pageSize };
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
): Promise<PaginatedResult<TaskRowDto>> {
  const all = await prisma.task.findMany({ where, orderBy, take: NEST_MAX_ROWS, include: rowInclude });
  const nested = buildNestedOrder(all.map(toTaskRowDto));
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
export async function getTaskDashboard(input: TaskDashboardInput): Promise<TaskDashboardDto> {
  const where = await buildWhere(input);
  const and = (extra: Prisma.TaskWhereInput): Prisma.TaskWhereInput => ({ AND: [where, extra] });

  // One consistent snapshot so the Parent/Child buckets and status tallies sum
  // exactly to the total even under concurrent writes.
  const { byStatusGroups, child, parent, standalone, overdue, completedToday } =
    await prisma.$transaction(async (tx) => {
      const [byStatusGroups, child, parent, standalone, overdue, completedToday] = await Promise.all([
        tx.task.groupBy({ by: ['status'], where, _count: { _all: true }, orderBy: { status: 'asc' } }),
        tx.task.count({ where: and(relationWhere('child')) }),
        tx.task.count({ where: and(relationWhere('parent')) }),
        tx.task.count({ where: and(relationWhere('standalone')) }),
        tx.task.count({ where: and(overdueWhere(input.now)) }),
        tx.task.count({ where: and(completedTodayWhere(input.todayStart, input.todayEnd)) }),
      ]);
      return { byStatusGroups, child, parent, standalone, overdue, completedToday };
    });

  const byStatus = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
  let total = 0;
  for (const g of byStatusGroups) {
    byStatus[g.status] = g._count._all;
    total += g._count._all;
  }

  return { total, parent, child, standalone, byStatus, overdue, completedToday };
}

/** Same query as searchTasks but unpaginated (capped) — for Excel export. */
export async function searchTasksForExport(input: TaskSearchInput): Promise<TaskRowDto[]> {
  const where = await buildWhere(input);
  const orderBy = buildOrderBy(input.sort ?? []);
  const rows = await prisma.task.findMany({
    where,
    orderBy,
    take: EXPORT_MAX_ROWS,
    include: rowInclude,
  });
  return rows.map(toTaskRowDto);
}
