import type { Prisma, TaskPriority, TaskStatus } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import {
  TASK_HISTORY_FIELDS,
  type TaskHistoryChangeType,
  type TaskHistoryEntryDto,
} from '@healthy-tasks/shared';
import { taskHistoryInclude, toTaskHistoryDto, type TaskHistoryWithUser } from './task-history.mapper.js';

/**
 * Central change-history capture (Phase 5). Every task-mutating endpoint funnels
 * its audit writes through `recordHistory` here rather than hand-rolling a
 * `taskHistory.create` at each call site, so the shape and rules live in one
 * place. Rich text (descriptions, comment bodies) is never stored — only the
 * fact that a change happened.
 */

// Accepts either the base client or a transaction client, so callers already
// inside a `$transaction` write history atomically with their mutation.
type Db = Prisma.TransactionClient | typeof prisma;

export interface HistoryEntryInput {
  taskId: number;
  /** The acting user's id. Nullable to tolerate system writes, but normally set. */
  userId: string | null;
  field: string;
  changeType: TaskHistoryChangeType;
  previousValue?: string | null;
  newValue?: string | null;
  detail?: string | null;
}

/** Write one or more history entries. A no-op for an empty list. */
export async function recordHistory(
  db: Db,
  entries: HistoryEntryInput | HistoryEntryInput[],
): Promise<void> {
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return;
  await db.taskHistory.createMany({
    data: list.map((e) => ({
      taskId: e.taskId,
      userId: e.userId,
      field: e.field,
      changeType: e.changeType,
      previousValue: e.previousValue ?? null,
      newValue: e.newValue ?? null,
      detail: e.detail ?? null,
    })),
  });
}

/** Window (ms) within which a repeated date change coalesces into one entry. */
export const DATE_COALESCE_WINDOW_MS = 60_000;

/**
 * Record a Start/Due date change with coalescing (Phase 10, Gantt drag). A drag
 * fires many intermediate updates, so instead of one entry per movement we merge
 * into the most recent entry for the same task+user+field when it was created
 * within the last 60s: keep its original `previousValue` (the true "before"),
 * refresh `newValue` to the latest and bump `changedAt`. Older than that — or no
 * such entry — starts a fresh one. Only ever used for `updated` date fields.
 */
export async function recordCoalescedDateChange(db: Db, entry: HistoryEntryInput): Promise<void> {
  const cutoff = new Date(Date.now() - DATE_COALESCE_WINDOW_MS);
  const recent = await db.taskHistory.findFirst({
    where: {
      taskId: entry.taskId,
      userId: entry.userId,
      field: entry.field,
      changeType: 'updated',
      changedAt: { gt: cutoff },
    },
    orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
  });
  if (recent) {
    // Keep the original previousValue; update only the latest value + timestamp.
    await db.taskHistory.update({
      where: { id: recent.id },
      data: { newValue: entry.newValue ?? null, changedAt: new Date() },
    });
    return;
  }
  await recordHistory(db, entry);
}

// --- Task scalar-field diffing --------------------------------------------

/** The set of scalar task values a history diff compares. */
export interface TaskFieldValues {
  name: string;
  assignee: string | null; // resolved email, or null when unassigned
  priority: TaskPriority;
  status: TaskStatus;
  tags: string[];
  startAt: Date | null;
  dueAt: Date | null;
}

function dateValue(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function tagsValue(tags: string[]): string | null {
  return tags.length > 0 ? tags.join(', ') : null;
}

/** Order-insensitive comparison of two tag lists. */
function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/**
 * Build the `updated` history entries for a task's scalar fields by diffing the
 * before/after snapshots. Description is handled separately (via
 * `descriptionChanged`) so its (potentially large) HTML is never stored — the
 * entry records only that it changed.
 */
export function buildTaskFieldEntries(params: {
  actorId: string;
  taskId: number;
  before: TaskFieldValues;
  after: TaskFieldValues;
  descriptionChanged: boolean;
  /**
   * Optional note attached to the Status entry (Phase 10): "Reviewed" or
   * "Recalled from review", distinguishing the two ways a task leaves Review.
   */
  statusDetail?: string | null;
}): HistoryEntryInput[] {
  const { actorId, taskId, before, after, descriptionChanged, statusDetail } = params;
  const F = TASK_HISTORY_FIELDS;
  const entries: HistoryEntryInput[] = [];

  const updated = (
    field: string,
    previousValue: string | null,
    newValue: string | null,
    detail?: string | null,
  ): void => {
    entries.push({ taskId, userId: actorId, field, changeType: 'updated', previousValue, newValue, detail });
  };

  if (before.name !== after.name) updated(F.name, before.name, after.name);
  if (descriptionChanged) {
    // No before/after value for description, per the storage rule.
    entries.push({ taskId, userId: actorId, field: F.description, changeType: 'updated' });
  }
  if (before.assignee !== after.assignee) updated(F.assignee, before.assignee, after.assignee);
  if (before.priority !== after.priority) updated(F.priority, before.priority, after.priority);
  if (before.status !== after.status) updated(F.status, before.status, after.status, statusDetail);
  if (!sameTags(before.tags, after.tags)) updated(F.tags, tagsValue(before.tags), tagsValue(after.tags));
  if (dateValue(before.startAt) !== dateValue(after.startAt))
    updated(F.startAt, dateValue(before.startAt), dateValue(after.startAt));
  if (dateValue(before.dueAt) !== dateValue(after.dueAt))
    updated(F.dueAt, dateValue(before.dueAt), dateValue(after.dueAt));

  return entries;
}

// --- Read -----------------------------------------------------------------

/** All history entries for a task, most recent first. */
export async function getTaskHistory(taskId: number): Promise<TaskHistoryEntryDto[]> {
  const rows = await prisma.taskHistory.findMany({
    where: { taskId },
    include: taskHistoryInclude,
    orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
  });
  return (rows as TaskHistoryWithUser[]).map(toTaskHistoryDto);
}
