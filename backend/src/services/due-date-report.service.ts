import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import {
  DUE_DATE_BUCKETS,
  type DueDateBucket,
  type DueDateBucketTotals,
  type DueDateReportResult,
  type DueDateReportRow,
} from '@healthy-tasks/shared';
import type { DueDateReportInput } from '../validation/schemas.js';
import { type Actor, buildTaskAccessWhere, getTaskAccessScope } from './access-control.service.js';
import {
  REPORT_MAX_ROWS,
  buildOrderBy,
  buildWhere,
  rowInclude,
  toTaskRowDto,
  type TaskRow,
} from './task-search.service.js';

/**
 * Due Date Performance Report (Phase 13). Buckets every access-scoped task by
 * comparing its Due Date to its actual completion, using ONLY the task's current
 * Status + Status-Change Timestamp + Due Date (never past history). Assignee
 * locking (task.service) guarantees the current Assignee of a Completed/Cancelled
 * task never drifted after completion, so "current" values are authoritative.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

interface BucketSubject {
  status: TaskRow['status'];
  statusChangedAt: Date | null;
  startAt: Date | null;
  dueAt: Date | null;
}

/**
 * Classify one task into exactly one of the seven buckets, plus the whole-day
 * gap for the On Time / Late buckets (positive = early / on time, negative =
 * late). A Due Date exactly equal to the completion timestamp counts as On Time.
 */
export function bucketFor(
  task: BucketSubject,
  now: Date,
): { bucket: DueDateBucket; daysDelta: number | null } {
  // Cancelled is decided by status alone, and wins over No Due Date when a task
  // is both Cancelled and has no due date.
  if (task.status === 'Canceled') return { bucket: 'Cancelled', daysDelta: null };

  // Any remaining task with no Due Date lands in its own bucket rather than
  // being force-fit or excluded (covers Completed-without-due and active tasks).
  if (!task.dueAt) return { bucket: 'NoDueDate', daysDelta: null };

  if (task.status === 'Completed') {
    // The completion timestamp is statusChangedAt (set on the move to Completed).
    // Guard for the theoretical null with `now`, though Completed always stamps it.
    const completion = task.statusChangedAt ?? now;
    const delta = Math.trunc((task.dueAt.getTime() - completion.getTime()) / DAY_MS);
    // On OR before the Due Date = On Time (equality counts as On Time).
    return completion.getTime() <= task.dueAt.getTime()
      ? { bucket: 'OnTime', daysDelta: delta }
      : { bucket: 'Late', daysDelta: delta };
  }

  // Non-terminal (Open / In Progress / On Hold / Review) with a Due Date that
  // has already passed.
  if (task.dueAt.getTime() < now.getTime()) return { bucket: 'Overdue', daysDelta: null };

  // Due date still in the future. Not Started is reserved for tasks that are
  // specifically Open and whose work has not begun — no Start Date, or a Start
  // Date still in the future. Every other non-terminal status (In Progress / On
  // Hold / Review) always lands in Not Completed regardless of Start Date, as
  // does an Open task whose Start Date has already passed. (Start Date must be
  // earlier than Due Date, so a future Start Date can never coexist with a
  // passed Due Date — no extra tiebreaker is needed.)
  const notStarted =
    task.status === 'Open' && (!task.startAt || task.startAt.getTime() > now.getTime());
  return notStarted
    ? { bucket: 'NotStarted', daysDelta: null }
    : { bucket: 'NotCompleted', daysDelta: null };
}

export function emptyBucketTotals(): DueDateBucketTotals {
  return Object.fromEntries(DUE_DATE_BUCKETS.map((b) => [b, 0])) as DueDateBucketTotals;
}

/** The extra WHERE from the Team Hierarchy selection (assignee ids), if any. */
function hierarchyWhere(ids: string[] | undefined): Prisma.TaskWhereInput | null {
  if (!ids || ids.length === 0) return null;
  return { assigneeId: { in: ids } };
}

/**
 * Run the report: fetch access-scoped tasks matching the filters + Team Hierarchy
 * selection, bucket each, and tally per-bucket totals. Returns a flat row list
 * (the frontend groups by assignee when that toggle is on); the Excel export
 * reuses these rows.
 */
export async function runDueDateReport(
  input: DueDateReportInput,
  actor: Actor,
): Promise<DueDateReportResult> {
  const scope = await getTaskAccessScope(actor);
  const base = await buildWhere(input);
  const accessWhere = buildTaskAccessWhere(scope, input.includeReadOnly ?? true);
  const hierWhere = hierarchyWhere(input.hierarchyUserIds);
  const where: Prisma.TaskWhereInput = {
    AND: [base, ...(accessWhere ? [accessWhere] : []), ...(hierWhere ? [hierWhere] : [])],
  };
  const orderBy = buildOrderBy(input.sort ?? []);
  const now = input.now ?? new Date();

  const rows = await prisma.task.findMany({
    where,
    orderBy,
    take: REPORT_MAX_ROWS,
    include: rowInclude,
  });

  const bucketTotals = emptyBucketTotals();
  const reportRows: DueDateReportRow[] = rows.map((t) => {
    const { bucket, daysDelta } = bucketFor(t, now);
    bucketTotals[bucket] += 1;
    return { ...toTaskRowDto(t, scope), bucket, daysDelta };
  });

  return { rows: reportRows, total: reportRows.length, bucketTotals };
}
