import { TASK_HISTORY_FIELDS } from '@healthy-tasks/shared';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { computeTaskAccess, type Actor } from './access-control.service.js';
import { recordHistory } from './task-history.service.js';
import { notifyTaskEvent } from './task-events.service.js';
import { toUserRef } from './user.mapper.js';
import { userDisplayName } from '../utils/user-name.js';

/**
 * Request update (Nov 2026 plan, E3): ask the assignee how a task is going,
 * with a note. Sent by their settings (in the app, email; Connect in Stage 4),
 * at most once every 5 minutes per task, and logged on the task ("Asked X for
 * an update").
 */

export const UPDATE_REQUEST_GAP_MS = 5 * 60_000;
export const UPDATE_REQUEST_NOTE_MAX = 1000;

export async function requestUpdate(
  actor: Actor,
  taskId: number,
  note: string | null,
): Promise<{ askedAt: string; assignee: ReturnType<typeof toUserRef> }> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      name: true,
      assigneeId: true,
      isPrivate: true,
      assignee: { select: { id: true, email: true, firstName: true, lastName: true, title: true } },
    },
  });
  if (!task) throw HttpError.notFound('Task not found');
  if (!(await computeTaskAccess(actor, task))) throw HttpError.notFound('Task not found');
  if (!task.assignee) throw HttpError.badRequest('This task has no assignee to ask');
  if (task.assigneeId === actor.id) {
    throw HttpError.badRequest('You are the assignee: post a comment with the update instead');
  }
  const last = await prisma.taskHistory.findFirst({
    where: { taskId, field: TASK_HISTORY_FIELDS.updateRequested },
    orderBy: { changedAt: 'desc' },
    select: { changedAt: true },
  });
  const now = new Date();
  if (last && now.getTime() - last.changedAt.getTime() < UPDATE_REQUEST_GAP_MS) {
    const mins = Math.ceil(
      (UPDATE_REQUEST_GAP_MS - (now.getTime() - last.changedAt.getTime())) / 60_000,
    );
    throw new HttpError(
      429,
      `An update was asked for a moment ago. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
    );
  }
  const asker = await prisma.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: { email: true, firstName: true, lastName: true },
  });
  const assigneeName = userDisplayName(task.assignee);
  const text = note?.trim() || null;
  await recordHistory(prisma, {
    taskId,
    userId: actor.id,
    field: TASK_HISTORY_FIELDS.updateRequested,
    changeType: 'added',
    newValue: assigneeName,
    detail: text,
  });
  await notifyTaskEvent({
    type: 'updateRequested',
    taskId,
    to: [task.assigneeId],
    actorId: actor.id,
    what: `${userDisplayName(asker)} asked you for an update on “${task.name}”`,
    note: text,
  });
  return { askedAt: now.toISOString(), assignee: toUserRef(task.assignee) };
}
