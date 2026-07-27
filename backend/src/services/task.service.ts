import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
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
  type TaskDetailDto,
  type TaskDto,
  type TaskStatus,
} from '@healthy-tasks/shared';

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
      description: input.description ?? null,
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
  return toTaskDto(task as TaskWithRefs);
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

export async function updateTask(id: number, input: UpdateTaskInput): Promise<TaskDto> {
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

  const task = await prisma.task.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
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
  return toTaskDto(task as TaskWithRefs);
}
