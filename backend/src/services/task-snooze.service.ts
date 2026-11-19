import { SNOOZE_MAX_DAYS, TASK_HISTORY_FIELDS } from '@healthy-tasks/shared';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { formatBusinessTimestamp } from '../utils/business-time.js';
import { isInSupervisorChain, type Actor } from './access-control.service.js';
import { recordHistory } from './task-history.service.js';
import { invalidateUnread } from './unread-cache.js';

/**
 * Snooze (Nov 2026 plan, E1, E2). A snoozed task leaves the active lists until
 * its time (the search hides it, `filters.snoozed`), then comes back by itself:
 * nothing has to run at that moment, since a snooze only counts while its time
 * is ahead. The due date and every overdue count stay as they are. Coming back
 * is a reminder (`Reminder.kind = snooze`) for whoever snoozed it and the
 * assignee, delivered like any reminder (Alerts, and email per settings).
 */

const DAY = 86_400_000;

/** Who may snooze: an Admin, the assignee, the creator, or someone above either. */
export async function canSnoozeTask(
  actor: Actor,
  task: { creatorId: string | null; assigneeId: string | null },
): Promise<boolean> {
  if (actor.role === 'Admin') return true;
  if (task.assigneeId === actor.id || task.creatorId === actor.id) return true;
  return (
    (await isInSupervisorChain(actor.id, task.assigneeId)) ||
    (await isInSupervisorChain(actor.id, task.creatorId))
  );
}

async function loadForSnooze(actor: Actor, id: number) {
  const task = await prisma.task.findUnique({
    where: { id },
    select: { id: true, creatorId: true, assigneeId: true, snoozedUntil: true },
  });
  if (!task) throw HttpError.notFound('Task not found');
  if (!(await canSnoozeTask(actor, task))) {
    throw HttpError.forbidden(
      'Only the assignee, the creator or someone above them can snooze this task',
    );
  }
  return task;
}

/** Drop the wake-up reminders a snooze left that haven't gone off yet. */
async function clearPendingWakes(taskId: number, now: Date): Promise<string[]> {
  const pending = await prisma.reminder.findMany({
    where: { taskId, kind: 'snooze', remindAt: { gt: now } },
    select: { id: true, userId: true },
  });
  if (pending.length > 0) {
    await prisma.reminder.deleteMany({ where: { id: { in: pending.map((p) => p.id) } } });
  }
  return pending.map((p) => p.userId);
}

export async function snoozeTask(actor: Actor, id: number, until: Date): Promise<void> {
  const task = await loadForSnooze(actor, id);
  const now = new Date();
  if (until.getTime() <= now.getTime())
    throw HttpError.badRequest('Pick a time that hasn’t passed');
  if (until.getTime() > now.getTime() + SNOOZE_MAX_DAYS * DAY + 60_000) {
    throw HttpError.badRequest(`A task can be snoozed for up to ${SNOOZE_MAX_DAYS} days`);
  }
  const people = [...new Set([actor.id, task.assigneeId].filter((x): x is string => !!x))];
  await prisma.$transaction(async (tx) => {
    await tx.reminder.deleteMany({ where: { taskId: id, kind: 'snooze', remindAt: { gt: now } } });
    await tx.task.update({
      where: { id },
      data: { snoozedUntil: until, snoozedById: actor.id },
    });
    await tx.reminder.createMany({
      data: people.map((userId) => ({ userId, taskId: id, remindAt: until, kind: 'snooze' })),
    });
    await recordHistory(tx, {
      taskId: id,
      userId: actor.id,
      field: TASK_HISTORY_FIELDS.snooze,
      changeType: 'added',
      newValue: until.toISOString(),
      detail: `until ${formatBusinessTimestamp(until)}`,
    });
  });
  people.forEach(invalidateUnread);
}

/** Bring a snoozed task back now. */
export async function unsnoozeTask(actor: Actor, id: number): Promise<void> {
  const task = await loadForSnooze(actor, id);
  const now = new Date();
  if (!task.snoozedUntil || task.snoozedUntil.getTime() <= now.getTime()) return;
  const touched = await clearPendingWakes(id, now);
  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id }, data: { snoozedUntil: null, snoozedById: null } });
    await recordHistory(tx, {
      taskId: id,
      userId: actor.id,
      field: TASK_HISTORY_FIELDS.snooze,
      changeType: 'removed',
      detail: null,
    });
  });
  touched.forEach(invalidateUnread);
}
