import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { getStorage } from '../storage/index.js';
import { sanitizeAndValidate } from '../utils/rich-text.js';
import {
  buildTaskFieldEntries,
  recordHistory,
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

export async function updateTask(
  actorId: string,
  id: number,
  input: UpdateTaskInput,
): Promise<TaskDto> {
  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) throw HttpError.notFound('Task not found');

  if (input.assigneeId) {
    await assertValidAssignee(input.assigneeId);
  }

  // Validate Start < Due using the values that WILL be in effect after this
  // patch (incoming value if provided, otherwise the existing stored value).
  const effectiveStart = input.startAt !== undefined ? input.startAt : existing.startAt;
  const effectiveDue = input.dueAt !== undefined ? input.dueAt : existing.dueAt;
  assertStartBeforeDue(effectiveStart, effectiveDue);

  // Blocked-status rule: gate Review/Completed on predecessors being terminal.
  if (input.status !== undefined) {
    await assertStatusAllowedByPredecessors(id, input.status);
  }

  // Bump statusChangedAt only when the status actually changes.
  const statusChanged = input.status !== undefined && input.status !== existing.status;

  // Resolve assignee emails (before + after) for readable history snapshots.
  const cleanedDescription =
    input.description !== undefined ? cleanDescription(input.description) : undefined;
  const descriptionChanged =
    cleanedDescription !== undefined && (cleanedDescription ?? null) !== existing.description;

  const assigneeEmails = await resolveAssigneeEmails([
    existing.assigneeId,
    input.assigneeId !== undefined ? input.assigneeId : null,
  ]);
  const before: TaskFieldValues = {
    name: existing.name,
    assignee: existing.assigneeId ? (assigneeEmails.get(existing.assigneeId) ?? null) : null,
    priority: existing.priority,
    status: existing.status,
    tags: existing.tags,
    startAt: existing.startAt,
    dueAt: existing.dueAt,
  };
  const afterAssigneeId = input.assigneeId !== undefined ? input.assigneeId : existing.assigneeId;
  const after: TaskFieldValues = {
    name: input.name ?? existing.name,
    assignee: afterAssigneeId ? (assigneeEmails.get(afterAssigneeId) ?? null) : null,
    priority: input.priority ?? existing.priority,
    status: input.status ?? existing.status,
    tags: input.tags ?? existing.tags,
    startAt: input.startAt !== undefined ? input.startAt : existing.startAt,
    dueAt: input.dueAt !== undefined ? input.dueAt : existing.dueAt,
  };

  const task = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(cleanedDescription !== undefined ? { description: cleanedDescription } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
        ...(statusChanged ? { statusChangedAt: new Date() } : {}),
        // creatorId, createdAt, and id are never updatable.
      },
      include: taskInclude,
    });
    await recordHistory(tx, buildTaskFieldEntries({ actorId, taskId: id, before, after, descriptionChanged }));
    return updated;
  });

  // Assigned notifications for an assignee change (post-commit side effect).
  // Self-changes are skipped inside createAssignedNotification.
  if (input.assigneeId !== undefined && afterAssigneeId !== existing.assigneeId) {
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
