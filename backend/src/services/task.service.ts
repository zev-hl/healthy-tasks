import { randomUUID } from 'node:crypto';
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
  type Actor,
  assertAssigneeAllowed,
  assertCanEditTask,
  buildTaskAccessWhere,
  canTogglePrivate,
  computeTaskAccess,
  getMentionCandidateIds,
  getReviewerCandidateIds,
  getTaskAccessScope,
  isInSupervisorChain,
  isTaskVisible,
  scopeTaskLevel,
} from './access-control.service.js';
import {
  BLOCKED_RESTRICTED_STATUSES,
  DEFAULT_TASK_STATUS,
  TASK_HISTORY_FIELDS,
  TASK_STATUS_LABELS,
  TERMINAL_TASK_STATUSES,
  type ActiveUserDto,
  type Role,
  type TaskDetailDto,
  type TaskDto,
  type TaskStatus,
} from '@healthy-tasks/shared';
import { toActiveUserDto } from './user.mapper.js';

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
 *
 * IMPORTANT (follow-up): this enforcement evaluates the predecessors' REAL,
 * current status regardless of whether `actor` can see them — restricted
 * visibility must never let a task slip past the rule. Only the message is
 * visibility-aware: a blocker the actor cannot see is named "#id" without its
 * name, so the rule still fires but no name leaks.
 */
async function assertStatusAllowedByPredecessors(
  actor: Actor,
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
    const scope = await getTaskAccessScope(actor);
    const list = blocking
      .map((p) => {
        const name = isTaskVisible(scope, p.id) ? ` ${p.name}` : '';
        return `#${p.id}${name} (${TASK_STATUS_LABELS[p.status]})`;
      })
      .join(', ');
    throw HttpError.badRequest(
      `Cannot set status to ${TASK_STATUS_LABELS[newStatus]} while blocked by incomplete task(s): ${list}`,
    );
  }
}

export async function createTask(actor: Actor, input: CreateTaskInput): Promise<TaskDto> {
  // Assignee is always required (Phase 13). A creator who names none defaults to
  // being their own assignee — the natural case for a Member self-assigning.
  const assigneeId = input.assigneeId ?? actor.id;
  await assertValidAssignee(assigneeId);
  // Enforce who this actor may assign to (Member/Manager/Admin scopes).
  await assertAssigneeAllowed(actor, assigneeId);
  assertStartBeforeDue(input.startAt ?? null, input.dueAt ?? null);

  const task = await prisma.task.create({
    data: {
      name: input.name,
      description: cleanDescription(input.description) ?? null,
      creatorId: actor.id,
      assigneeId,
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
      actorId: actor.id,
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

export async function listTasks(actor: Actor): Promise<TaskDto[]> {
  // Phase 2 scaffolding: newest first, scoped to the caller's access (Phase 13).
  // The real Search screen (Phase 6) is the primary list surface.
  const scope = await getTaskAccessScope(actor);
  const accessWhere = buildTaskAccessWhere(scope, true);
  const tasks = await prisma.task.findMany({
    where: accessWhere ?? {},
    include: taskInclude,
    orderBy: { id: 'desc' },
  });
  return tasks.map((t) => toTaskDto(t as TaskWithRefs));
}

export async function getTask(id: number): Promise<TaskDto> {
  const task = await prisma.task.findUnique({ where: { id }, include: taskInclude });
  if (!task) throw HttpError.notFound('Task not found');
  return toTaskDto(task as TaskWithRefs);
}

/**
 * Full task view with relationships (parent, children, blocks, isBlockedBy),
 * scoped to the requesting user (Phase 13). Throws 404 if `actor` has no access
 * — a hidden task is indistinguishable from a missing one. The returned DTO
 * carries the actor's live access level and whether they may toggle Private.
 */
export async function getTaskDetail(id: number, actor: Actor): Promise<TaskDetailDto> {
  const task = await prisma.task.findUnique({ where: { id }, include: taskDetailInclude });
  if (!task) throw HttpError.notFound('Task not found');
  // Compute the actor's access scope once, then derive both the main task's level
  // and the LIVE visibility of every referenced task (parent/children/blocks/
  // blockedBy) — inaccessible refs degrade to Id + lock + Status (no name/link).
  const scope = await getTaskAccessScope(actor);
  const level = scopeTaskLevel(scope, task.id);
  if (!level) throw HttpError.notFound('Task not found');
  const toggle = await canTogglePrivate(actor, task.assigneeId);
  return toTaskDetailDto(task as unknown as TaskWithDetail, {
    level,
    canTogglePrivate: toggle,
    canSee: (refId) => isTaskVisible(scope, refId),
  });
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
  actor: Actor,
  id: number,
  input: UpdateTaskInput,
  opts: UpdateTaskOptions = {},
): Promise<TaskDto> {
  const actorId = actor.id;
  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) throw HttpError.notFound('Task not found');

  // Access gate (Phase 13): editing a task requires FULL access. A user with no
  // access gets 404 (existence hidden); a mention-only user gets 403 (read-only).
  // Skipped for the sanctioned review-exit calls, which are permission-checked in
  // exitReview and only restore prior state.
  if (!opts.allowReviewExit) {
    const level = await computeTaskAccess(actor, {
      id: existing.id,
      assigneeId: existing.assigneeId,
      isPrivate: existing.isPrivate,
    });
    if (!level) throw HttpError.notFound('Task not found');
    if (level !== 'full') {
      throw HttpError.forbidden('You have read-only (comment-only) access to this task');
    }
  }

  const inReview = existing.status === 'Review';
  const enteringReview = input.status === 'Review' && existing.status !== 'Review';

  // Assignee locking (Phase 13): while a task is Completed or Cancelled its
  // Assignee is frozen for EVERYONE, including Admin — so the Due Date report can
  // trust "current Assignee" for terminal tasks. Reopening (moving Status away
  // from terminal, no assignee change in the same PATCH) unlocks it again.
  const assigneeChanging = input.assigneeId !== undefined && input.assigneeId !== existing.assigneeId;
  if (
    !opts.allowReviewExit &&
    TERMINAL_TASK_STATUSES.includes(existing.status) &&
    (assigneeChanging || enteringReview)
  ) {
    throw HttpError.badRequest(
      'Assignee cannot be changed while a task is Completed or Cancelled; reopen it first',
    );
  }

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
    await assertStatusAllowedByPredecessors(actor, id, input.status);
  }

  // Entering Review requires choosing a reviewer, who becomes the temporary
  // assignee. The assignee-change notifications and the status + assignee history
  // then flow through the normal diff below — no separate path.
  if (enteringReview) {
    if (!input.reviewerId) {
      throw HttpError.badRequest('A reviewer is required to send a task to Review');
    }
    await assertValidAssignee(input.reviewerId);
    // Phase 13: the reviewer-selection pool is Admin(s) + anyone in the current
    // assignee's supervisor chain — narrower than, and separate from, the
    // "who can click Reviewed" permission enforced in exitReview.
    const reviewerPool = await getReviewerCandidateIds(existing.assigneeId);
    if (!reviewerPool.has(input.reviewerId)) {
      throw HttpError.forbidden(
        'A reviewer must be an administrator or a supervisor above the current assignee',
      );
    }
  } else if (input.assigneeId && !opts.allowReviewExit) {
    // On a review-exit restore we deliberately skip the active check so a task
    // can still return to a since-deactivated prior assignee.
    await assertValidAssignee(input.assigneeId);
    // Phase 13: enforce the assignment restriction on any reassignment.
    if (assigneeChanging) await assertAssigneeAllowed(actor, input.assigneeId);
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
 * Toggle a task's Private flag (Phase 13). Permission is DIFFERENT from ordinary
 * editing: only an Admin or someone in the Assignee's supervisor chain may flip
 * it — never the Assignee themselves. Turning Private on immediately suspends any
 * mention-only access; turning it off restores it (both are live-computed, so no
 * extra work is needed here beyond flipping the flag).
 */
export async function setTaskPrivate(
  actor: Actor,
  id: number,
  isPrivate: boolean,
): Promise<TaskDetailDto> {
  const task = await prisma.task.findUnique({
    where: { id },
    select: { id: true, assigneeId: true },
  });
  if (!task) throw HttpError.notFound('Task not found');
  if (!(await canTogglePrivate(actor, task.assigneeId))) {
    throw HttpError.forbidden(
      'Only an administrator or a supervisor above the assignee can change privacy',
    );
  }
  await prisma.task.update({ where: { id }, data: { isPrivate } });
  return getTaskDetail(id, actor);
}

/**
 * The users who may be @mentioned on this task (Phase 13). A non-private task
 * offers all active users; a Private task restricts to its visibility set
 * {Admin(s), Assignee, Assignee's supervisor chain} so mentions cannot reach
 * outside it. The caller must already have view access to the task.
 */
export async function listMentionCandidates(taskId: number): Promise<ActiveUserDto[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { assigneeId: true, isPrivate: true },
  });
  if (!task) throw HttpError.notFound('Task not found');
  const allowed = await getMentionCandidateIds(task);
  const where =
    allowed === null ? { isActive: true } : { isActive: true, id: { in: [...allowed] } };
  const users = await prisma.user.findMany({ where, orderBy: { email: 'asc' } });
  return users.map(toActiveUserDto);
}

/**
 * The reviewer-selection pool for this task (Phase 13): Admin(s) plus anyone in
 * the current Assignee's supervisor chain. Narrower than, and separate from, the
 * "who can click Reviewed" permission.
 */
export async function listReviewerCandidates(taskId: number): Promise<ActiveUserDto[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { assigneeId: true },
  });
  if (!task) throw HttpError.notFound('Task not found');
  const allowed = await getReviewerCandidateIds(task.assigneeId);
  const users = await prisma.user.findMany({
    where: { isActive: true, id: { in: [...allowed] } },
    orderBy: { email: 'asc' },
  });
  return users.map(toActiveUserDto);
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
      (await isInSupervisorChain(actor.id, task.assigneeId));
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
    actor,
    id,
    { status: task.priorStatus ?? DEFAULT_TASK_STATUS, assigneeId: task.priorAssigneeId },
    {
      allowReviewExit: true,
      statusDetail: via === 'reviewed' ? 'Reviewed' : 'Recalled from review',
    },
  );

  return getTaskDetail(id, actor);
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

/** All task ids in the subtree rooted at `rootId` (root first, BFS order). The
 * Parent/Child graph is acyclic, so no cycle guard is needed. */
async function collectSubtreeIds(rootId: number): Promise<number[]> {
  const ids: number[] = [rootId];
  let frontier: number[] = [rootId];
  while (frontier.length > 0) {
    const children = await prisma.task.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    const childIds = children.map((c) => c.id);
    ids.push(...childIds);
    frontier = childIds;
  }
  return ids;
}

/** Filesystem/URL-safe attachment filename (mirrors attachment.service). */
function safeAttachmentName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';
}

/**
 * Copy the TASK-level attachments of the duplicated originals onto their clones.
 * `idMap` maps each original task id to its clone id. Each blob is copied to a
 * fresh storage key so the copy is fully independent (deleting one task's
 * attachment never touches the other's). Comment attachments are skipped —
 * comments aren't duplicated. Best-effort per attachment: if the underlying blob
 * can't be copied, that attachment is skipped rather than failing the duplicate.
 */
async function copyDuplicatedTaskAttachments(
  idMap: Map<number, number>,
  actorId: string,
): Promise<void> {
  const attachments = await prisma.attachment.findMany({
    where: { taskId: { in: [...idMap.keys()] }, commentId: null },
  });
  if (attachments.length === 0) return;
  const storage = getStorage();
  for (const a of attachments) {
    const newTaskId = a.taskId != null ? idMap.get(a.taskId) : undefined;
    if (newTaskId == null) continue;
    const destKey = `tasks/${newTaskId}/${randomUUID()}/${safeAttachmentName(a.filename)}`;
    try {
      await storage.copyObject(a.storageKey, destKey);
    } catch {
      continue; // best-effort: skip an attachment whose blob couldn't be copied
    }
    await prisma.attachment.create({
      data: {
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
        storageKey: destKey,
        uploadedById: actorId,
        taskId: newTaskId,
      },
    });
  }
}

/**
 * Duplicate a task (Phase 11 follow-on). `includeDescendants` clones the whole
 * sub-tree (parent/child structure preserved, internal dependencies remapped to
 * the copies); otherwise just the task itself. `copyAttachments` also clones each
 * duplicated task's attachments to independent blobs (off by default). Copies
 * name/description/priority/tags/dates/assignee; each copy starts fresh (status
 * Open, its own creator, no history/comments/template links). The root copy
 * becomes a sibling of the original (same parent). Returns the new root task.
 */
export async function duplicateTask(
  actor: Actor,
  rootId: number,
  includeDescendants: boolean,
  copyAttachments = false,
): Promise<TaskDetailDto> {
  const actorId = actor.id;
  // Cloning requires full (edit) access to the source task.
  await assertCanEditTask(actor, rootId);
  const root = await prisma.task.findUnique({ where: { id: rootId }, select: { id: true, parentId: true } });
  if (!root) throw HttpError.notFound('Task not found');

  const ids = includeDescendants ? await collectSubtreeIds(rootId) : [rootId];
  const idSet = new Set(ids);
  const originals = await prisma.task.findMany({ where: { id: { in: ids } } });
  const byId = new Map(originals.map((o) => [o.id, o]));

  const idMap = new Map<number, number>(); // original id → clone id
  const created: { taskId: number; assigneeId: string | null }[] = [];

  await prisma.$transaction(async (tx) => {
    // BFS order (from collectSubtreeIds) guarantees a parent is cloned before its
    // children, so the remapped parentId always exists.
    for (const oid of ids) {
      const o = byId.get(oid);
      if (!o) continue;
      const parentId =
        oid === rootId
          ? o.parentId // the root copy is a sibling of the original
          : o.parentId != null && idMap.has(o.parentId)
            ? idMap.get(o.parentId)!
            : null;
      const clone = await tx.task.create({
        data: {
          name: o.name,
          description: o.description,
          creatorId: actorId,
          assigneeId: o.assigneeId,
          priority: o.priority,
          tags: o.tags,
          startAt: o.startAt,
          dueAt: o.dueAt,
          parentId,
          // status/statusChangedAt reset to the defaults: a copy is fresh work.
        },
        select: { id: true },
      });
      idMap.set(o.id, clone.id);
      created.push({ taskId: clone.id, assigneeId: o.assigneeId });
    }

    // Carry internal dependencies (both endpoints within the duplicated set).
    if (idSet.size > 1) {
      const edges = await tx.taskDependency.findMany({
        where: { blockerId: { in: ids }, blockedId: { in: ids } },
      });
      for (const e of edges) {
        const blockerId = idMap.get(e.blockerId);
        const blockedId = idMap.get(e.blockedId);
        if (blockerId && blockedId) await tx.taskDependency.create({ data: { blockerId, blockedId } });
      }
    }
  });

  // Copy attachments onto the clones (independent blobs) when requested. Done
  // after the transaction since it performs external (S3) copies.
  if (copyAttachments) await copyDuplicatedTaskAttachments(idMap, actorId);

  // Assignment notifications for the copies (self-assignments skipped inside).
  for (const c of created) {
    if (c.assigneeId) {
      await createAssignedNotification({ recipientId: c.assigneeId, actorId, taskId: c.taskId, action: 'added' });
    }
  }

  return getTaskDetail(idMap.get(rootId)!, actor);
}
