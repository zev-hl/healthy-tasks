import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { getStorage } from '../storage/index.js';
import { sanitizeAndValidate } from '../utils/rich-text.js';
import {
  buildTaskFieldEntries,
  recordHistory,
  recordCoalescedDateChange,
  type TaskFieldValues,
} from './task-history.service.js';
import { createAssignedNotification } from './notification.service.js';
import type { CreateTaskInput, UpdateTaskInput } from '../validation/schemas.js';
import {
  taskInclude,
  taskDetailInclude,
  toTaskDto,
  toTaskDetailDto,
  type TaskWithRefs,
  type TaskWithDetail,
} from './task.mapper.js';
import {
  BLOCKED_RESTRICTED_STATUSES,
  DEFAULT_TASK_STATUS,
  TASK_HISTORY_FIELDS,
  TASK_STATUS_LABELS,
  TERMINAL_TASK_STATUSES,
  type Role,
  type TaskDetailDto,
  type TaskDto,
  type TaskStatus,
} from '@healthy-tasks/shared';

/**
 * Normalize a Description value: `undefined` = leave unchanged (PATCH), `null` =
 * clear, string = sanitize to allowed rich text and enforce the length limit.
 */
function cleanDescription(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return sanitizeAndValidate(value, { fieldLabel: 'Description' });
}

/** Assignee must be an existing, active user (chosen from the active-user list). */
async function assertValidAssignee(assigneeId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: assigneeId } });
  if (!user) throw HttpError.badRequest('Selected assignee does not exist');
  if (!user.isActive) throw HttpError.badRequest('Selected assignee is inactive');
}

/** When both are set, Start must be strictly before Due. */
function assertStartBeforeDue(startAt: Date | null, dueAt: Date | null): void {
  if (startAt && dueAt && startAt.getTime() >= dueAt.getTime()) {
    throw HttpError.badRequest('Start time must be earlier than Due time');
  }
}

/**
 * Blocked-status rule (Phase 3): a task may not move to Review/Completed while
 * any of its predecessors (its "Is Blocked By" list) is not yet terminal
 * (Completed/Canceled). Rejects with a message naming the blocking task(s).
 */
async function assertStatusAllowedByPredecessors(
  taskId: number,
  newStatus: TaskStatus,
): Promise<void> {
  if (!BLOCKED_RESTRICTED_STATUSES.includes(newStatus)) return;

  const deps = await prisma.taskDependency.findMany({
    where: { blockedId: taskId },
    include: { blocker: { select: { id: true, name: true, status: true } } },
  });
  const blocking = deps
    .map((d) => d.blocker)
    .filter((p) => !TERMINAL_TASK_STATUSES.includes(p.status));

  if (blocking.length > 0) {
    const list = blocking
      .map((p) => `#${p.id} ${p.name} (${TASK_STATUS_LABELS[p.status]})`)
      .join(', ');
    throw HttpError.badRequest(
      `Cannot set status to ${TASK_STATUS_LABELS[newStatus]} while blocked by incomplete task(s): ${list}`,
    );
  }
}

export async function createTask(creatorId: string, input: CreateTaskInput): Promise<TaskDto> {
  if (input.assigneeId) {
    await assertValidAssignee(input.assigneeId);
  }
  assertStartBeforeDue(input.startAt ?? null, input.dueAt ?? null);

  const task = await prisma.task.create({
    data: {
      name: input.name,
      description: cleanDescription(input.description) ?? null,
      creatorId,
      assigneeId: input.assigneeId ?? null,
      // priority/status fall back to the schema defaults (Medium / Open) when omitted.
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.status ? { status: input.status } : {}),
      tags: input.tags ?? [],
      startAt: input.startAt ?? null,
      dueAt: input.dueAt ?? null,
      // statusChangedAt intentionally left null: it is blank until the first
      // status *change*, and creation is the initial value, not a change.
    },
    include: taskInclude,
  });

  // Assigned notification for the initial assignee (skipped if they assigned
  // themselves; handled inside createAssignedNotification).
  if (task.assigneeId) {
    await createAssignedNotification({
      recipientId: task.assigneeId,
      actorId: creatorId,
      taskId: task.id,
      action: 'added',
    });
  }

  return toTaskDto(task as TaskWithRefs);
}

/**
 * Distinct tags currently in use across all tasks, sorted alphabetically
 * (case-insensitive). Because it is derived from live task rows, a tag that is
 * no longer on any task simply stops appearing.
 */
export async function listAllTags(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ tag: string }[]>(
    'SELECT tag FROM (SELECT DISTINCT unnest(tags) AS tag FROM "Task") t ORDER BY lower(tag), tag',
  );
  return rows.map((r) => r.tag).filter((t) => t.length > 0);
}

export async function listTasks(): Promise<TaskDto[]> {
  // Phase 2 scaffolding: return everything, newest first. Replaced by the real
  // Search screen (filters/sort/pagination) in Phase 6.
  const tasks = await prisma.task.findMany({ include: taskInclude, orderBy: { id: 'desc' } });
  return tasks.map((t) => toTaskDto(t as TaskWithRefs));
}

export async function getTask(id: number): Promise<TaskDto> {
  const task = await prisma.task.findUnique({ where: { id }, include: taskInclude });
  if (!task) throw HttpError.notFound('Task not found');
  return toTaskDto(task as TaskWithRefs);
}

/** Full task view with relationships (parent, children, blocks, isBlockedBy). */
export async function getTaskDetail(id: number): Promise<TaskDetailDto> {
  const task = await prisma.task.findUnique({ where: { id }, include: taskDetailInclude });
  if (!task) throw HttpError.notFound('Task not found');
  return toTaskDetailDto(task as unknown as TaskWithDetail);
}

/** Internal options for the two review-exit call sites; never set by HTTP callers. */
interface UpdateTaskOptions {
  /**
   * Permits changing Status/Assignee on a task that is currently in Review. Only
   * the Reviewed / Recall-from-Review actions (via `exitReview`) set this — every
   * ordinary PATCH is rejected while a task is in Review (the lock).
   */
  allowReviewExit?: boolean;
  /** Note attached to the Status history entry: "Reviewed" / "Recalled from review". */
  statusDetail?: string | null;
}

export async function updateTask(
  actorId: string,
  id: number,
  input: UpdateTaskInput,
  opts: UpdateTaskOptions = {},
): Promise<TaskDto> {
  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) throw HttpError.notFound('Task not found');

  const inReview = existing.status === 'Review';
  const enteringReview = input.status === 'Review' && existing.status !== 'Review';

  // Review lock (Phase 10): while a task is in Review, its Status and Assignee
  // are frozen. The only sanctioned exits are the Reviewed / Recall-from-Review
  // actions, which call through with allowReviewExit set.
  if (inReview && !opts.allowReviewExit) {
    if (input.status !== undefined && input.status !== existing.status) {
      throw HttpError.badRequest(
        'Task is in Review; use the Reviewed or Recall from Review action to change its status',
      );
    }
    if (input.assigneeId !== undefined && input.assigneeId !== existing.assigneeId) {
      throw HttpError.badRequest('Assignee is locked while a task is in Review');
    }
  }

  // Blocked-status rule first: a blocked task dragged/set to Review or Completed
  // is rejected with the "blocked by #X" message — this takes priority over the
  // reviewer requirement so the reason is the real blocker, not a missing reviewer.
  if (input.status !== undefined) {
    await assertStatusAllowedByPredecessors(id, input.status);
  }

  // Entering Review requires choosing a reviewer, who becomes the temporary
  // assignee. The assignee-change notifications and the status + assignee history
  // then flow through the normal diff below — no separate path.
  if (enteringReview) {
    if (!input.reviewerId) {
      throw HttpError.badRequest('A reviewer is required to send a task to Review');
    }
    await assertValidAssignee(input.reviewerId);
  } else if (input.assigneeId && !opts.allowReviewExit) {
    // On a review-exit restore we deliberately skip the active check so a task
    // can still return to a since-deactivated prior assignee.
    await assertValidAssignee(input.assigneeId);
  }

  // Validate Start < Due using the values that WILL be in effect after this
  // patch (incoming value if provided, otherwise the existing stored value).
  const effectiveStart = input.startAt !== undefined ? input.startAt : existing.startAt;
  const effectiveDue = input.dueAt !== undefined ? input.dueAt : existing.dueAt;
  assertStartBeforeDue(effectiveStart, effectiveDue);

  // Bump statusChangedAt only when the status actually changes.
  const statusChanged = input.status !== undefined && input.status !== existing.status;

  // Effective assignee after this patch. Entering Review forces it to the chosen
  // reviewer; otherwise it's the incoming value, or the unchanged existing one.
  const assigneeProvided = enteringReview || input.assigneeId !== undefined;
  const afterAssigneeId = enteringReview
    ? input.reviewerId!
    : input.assigneeId !== undefined
      ? input.assigneeId
      : existing.assigneeId;

  // Resolve assignee emails (before + after) for readable history snapshots.
  const cleanedDescription =
    input.description !== undefined ? cleanDescription(input.description) : undefined;
  const descriptionChanged =
    cleanedDescription !== undefined && (cleanedDescription ?? null) !== existing.description;

  const assigneeEmails = await resolveAssigneeEmails([existing.assigneeId, afterAssigneeId]);
  const before: TaskFieldValues = {
    name: existing.name,
    assignee: existing.assigneeId ? (assigneeEmails.get(existing.assigneeId) ?? null) : null,
    priority: existing.priority,
    status: existing.status,
    tags: existing.tags,
    startAt: existing.startAt,
    dueAt: existing.dueAt,
  };
  const after: TaskFieldValues = {
    name: input.name ?? existing.name,
    assignee: afterAssigneeId ? (assigneeEmails.get(afterAssigneeId) ?? null) : null,
    priority: input.priority ?? existing.priority,
    status: input.status ?? existing.status,
    tags: input.tags ?? existing.tags,
    startAt: input.startAt !== undefined ? input.startAt : existing.startAt,
    dueAt: input.dueAt !== undefined ? input.dueAt : existing.dueAt,
  };

  // Review bookkeeping: capture prior state on the way IN, clear it on the way OUT.
  const reviewData: {
    reviewInitiatorId?: string | null;
    priorAssigneeId?: string | null;
    priorStatus?: TaskStatus | null;
  } = enteringReview
    ? {
        reviewInitiatorId: actorId,
        priorAssigneeId: existing.assigneeId,
        priorStatus: existing.status,
      }
    : opts.allowReviewExit && inReview
      ? { reviewInitiatorId: null, priorAssigneeId: null, priorStatus: null }
      : {};

  const task = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(cleanedDescription !== undefined ? { description: cleanedDescription } : {}),
        ...(assigneeProvided ? { assigneeId: afterAssigneeId } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
        ...(statusChanged ? { statusChangedAt: new Date() } : {}),
        ...reviewData,
        // creatorId, createdAt, and id are never updatable.
      },
      include: taskInclude,
    });
    const entries = buildTaskFieldEntries({
      actorId,
      taskId: id,
      before,
      after,
      descriptionChanged,
      statusDetail: opts.statusDetail,
    });
    if (input.coalesceHistory) {
      // Gantt drag: coalesce Start/Due entries with a recent one; log the rest normally.
      const dateFields: string[] = [TASK_HISTORY_FIELDS.startAt, TASK_HISTORY_FIELDS.dueAt];
      await recordHistory(
        tx,
        entries.filter((e) => !dateFields.includes(e.field)),
      );
      for (const entry of entries.filter((e) => dateFields.includes(e.field))) {
        await recordCoalescedDateChange(tx, entry);
      }
    } else {
      await recordHistory(tx, entries);
    }
    return updated;
  });

  // Assigned notifications for an assignee change (post-commit side effect).
  // Self-changes are skipped inside createAssignedNotification.
  if (assigneeProvided && afterAssigneeId !== existing.assigneeId) {
    if (existing.assigneeId) {
      await createAssignedNotification({
        recipientId: existing.assigneeId,
        actorId,
        taskId: id,
        action: 'removed',
      });
    }
    if (afterAssigneeId) {
      await createAssignedNotification({
        recipientId: afterAssigneeId,
        actorId,
        taskId: id,
        action: 'added',
      });
    }
  }

  return toTaskDto(task as TaskWithRefs);
}

/**
 * Walk the supervisor chain upward from `subordinateId`; true if `actorId`
 * appears at any level above them. Cycle-guarded with a visited set.
 */
async function isSupervisorAtAnyLevel(
  actorId: string,
  subordinateId: string | null,
): Promise<boolean> {
  const visited = new Set<string>();
  let currentId = subordinateId;
  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const current = await prisma.user.findUnique({
      where: { id: currentId },
      select: { supervisorId: true },
    });
    const supId = current?.supervisorId ?? null;
    if (!supId) break;
    if (supId === actorId) return true;
    currentId = supId;
  }
  return false;
}

/**
 * Leave the Review state (Phase 10). Both exits restore the stored Prior
 * Assignee + Prior Status and clear the review bookkeeping, reusing the normal
 * update/notification/history paths; they differ only in who may trigger them
 * and the note left in History:
 *  - `reviewed`: Admin, the current assignee (the reviewer), or a supervisor at
 *    any level above the current assignee.
 *  - `recall`: the Review Initiator or the Prior Assignee.
 */
export async function exitReview(
  actor: { id: string; role: Role },
  id: number,
  via: 'reviewed' | 'recall',
): Promise<TaskDetailDto> {
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) throw HttpError.notFound('Task not found');
  if (task.status !== 'Review') {
    throw HttpError.badRequest('Task is not in Review');
  }

  if (via === 'reviewed') {
    const allowed =
      actor.role === 'Admin' ||
      actor.id === task.assigneeId ||
      (await isSupervisorAtAnyLevel(actor.id, task.assigneeId));
    if (!allowed) {
      throw HttpError.forbidden(
        'Only an admin, the current assignee, or a supervisor above them can mark this reviewed',
      );
    }
  } else {
    const allowed = actor.id === task.reviewInitiatorId || actor.id === task.priorAssigneeId;
    if (!allowed) {
      throw HttpError.forbidden(
        'Only the person who sent this to Review or its prior assignee can recall it from Review',
      );
    }
  }

  await updateTask(
    actor.id,
    id,
    { status: task.priorStatus ?? DEFAULT_TASK_STATUS, assigneeId: task.priorAssigneeId },
    {
      allowReviewExit: true,
      statusDetail: via === 'reviewed' ? 'Reviewed' : 'Recalled from review',
    },
  );

  return getTaskDetail(id);
}

/** Look up emails for a set of (possibly null/duplicate) user ids. */
async function resolveAssigneeEmails(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => v !== null))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u.email]));
}

/**
 * Delete a task. Admin-only (enforced here as well as at the route). Deletes the
 * task row — the DB cascades its comments, attachments, mentions, and
 * mention-event rows — then best-effort removes every associated storage object
 * (both task-level and comment-level attachment files).
 */
export async function deleteTask(actor: { id: string; role: Role }, id: number): Promise<void> {
  if (actor.role !== 'Admin') {
    throw HttpError.forbidden('Only an administrator can delete a task');
  }

  const task = await prisma.task.findUnique({
    where: { id },
    select: {
      id: true,
      attachments: { select: { storageKey: true } },
      comments: { select: { attachments: { select: { storageKey: true } } } },
    },
  });
  if (!task) throw HttpError.notFound('Task not found');

  const storageKeys = [
    ...task.attachments.map((a) => a.storageKey),
    ...task.comments.flatMap((c) => c.attachments.map((a) => a.storageKey)),
  ];

  // No history entry on delete: the task (and its cascading TaskHistory rows) is
  // being removed entirely, so there is nowhere for a "deleted" entry to live.
  await prisma.task.delete({ where: { id } });

  const storage = getStorage();
  for (const key of storageKeys) {
    try {
      await storage.deleteObject(key);
    } catch (err) {
      console.error('Failed to delete storage object during task delete', key, err);
    }
  }
}
