import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { invalidateUnread } from './unread-cache.js';
import {
  reminderAddBlock,
  REMINDER_BLOCK_LABELS,
  type ReminderCancelReason,
  type ReminderDto,
  type ReminderKind,
  type TaskPriority,
} from '@healthy-tasks/shared';
import {
  computeTaskAccess,
  getTaskAccessScope,
  isTaskVisible,
  type Actor,
} from './access-control.service.js';

// A reminder with the bits of its task needed to decide due-ness and render the
// Reminders list. `kind` distinguishes a live/time-based reminder from a
// soft-canceled notice raised when a task's Start Date was cleared or the task
// was Canceled.
export interface DueReminder {
  id: string;
  taskId: number;
  taskName: string;
  startAt: Date | null;
  priority: TaskPriority;
  remindAt: Date;
  note: string | null;
  source: ReminderKind;
  readAt: Date | null;
  emailSentAt: Date | null;
  kind: 'due' | 'canceled';
  canceledReason: ReminderCancelReason | null;
  canceledAt: Date | null;
}

const reminderTaskSelect = {
  id: true,
  remindAt: true,
  note: true,
  kind: true,
  readAt: true,
  emailSentAt: true,
  snoozedUntil: true,
  canceledAt: true,
  canceledReason: true,
  taskId: true,
  task: {
    select: { name: true, startAt: true, priority: true, assigneeId: true, isPrivate: true },
  },
} as const;

/** Whether a reminder has gone off: its time has come (Nov 2026 plan, E4). */
export function isReminderDue(remindAt: Date, now: Date): boolean {
  return now.getTime() >= remindAt.getTime();
}

function toDto(r: {
  id: string;
  taskId: number;
  remindAt: Date;
  note: string | null;
  kind: string;
  createdAt: Date;
}): ReminderDto {
  return {
    id: r.id,
    taskId: r.taskId,
    remindAt: r.remindAt.toISOString(),
    note: r.note,
    kind: r.kind as ReminderKind,
    createdAt: r.createdAt.toISOString(),
  };
}

/** The current user's reminders on a task (for the Task Detail page). */
export async function listRemindersForTask(userId: string, taskId: number): Promise<ReminderDto[]> {
  const rows = await prisma.reminder.findMany({
    // Soft-canceled reminders are notices, not manageable reminders; the Task
    // Detail management list shows only the live ones.
    where: { userId, taskId, canceledAt: null },
    orderBy: [{ remindAt: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(toDto);
}

/**
 * Add a reminder for the current user on a task they can see, at an exact time
 * with an optional note (E4). Enforces the access gate (A1: no-access -> 404,
 * mirroring the rest of the app so a hidden task can't be enumerated); a
 * Canceled task takes none, and the time must be ahead (a minute's grace).
 */
export async function addReminder(
  actor: Actor,
  taskId: number,
  input: { remindAt: Date; note?: string | null },
): Promise<ReminderDto> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, assigneeId: true, isPrivate: true, startAt: true, status: true },
  });
  if (!task) throw HttpError.notFound('Task not found');
  // A1: the actor must be able to SEE the task at all.
  const level = await computeTaskAccess(actor, {
    id: task.id,
    assigneeId: task.assigneeId,
    isPrivate: task.isPrivate,
  });
  if (!level) throw HttpError.notFound('Task not found');
  const block = reminderAddBlock(task.status);
  if (block) throw HttpError.badRequest(REMINDER_BLOCK_LABELS[block]);
  if (input.remindAt.getTime() < Date.now() - 60_000) {
    throw HttpError.badRequest('Pick a time that hasn’t passed');
  }
  const note = input.note?.trim() || null;
  const row = await prisma.reminder.create({
    data: { userId: actor.id, taskId, remindAt: input.remindAt, note },
  });
  invalidateUnread(actor.id);
  return toDto(row);
}

/**
 * Remove one of the current user's reminders (from task detail, the due list, or
 * a cancel notice — dismissing a notice hard-deletes it, the only cleanup path).
 */
export async function removeReminder(userId: string, reminderId: string): Promise<void> {
  const r = await prisma.reminder.findUnique({
    where: { id: reminderId },
    select: { userId: true },
  });
  if (!r || r.userId !== userId) throw HttpError.notFound('Reminder not found');
  await prisma.reminder.delete({ where: { id: reminderId } });
  invalidateUnread(userId);
}

/** Mark one of the current user's reminders read (on click-through). */
export async function markReminderRead(userId: string, reminderId: string): Promise<void> {
  const r = await prisma.reminder.findUnique({
    where: { id: reminderId },
    select: { userId: true, readAt: true },
  });
  if (!r || r.userId !== userId) throw HttpError.notFound('Reminder not found');
  if (!r.readAt) {
    await prisma.reminder.update({ where: { id: reminderId }, data: { readAt: new Date() } });
    invalidateUnread(userId);
  }
}

/** Re-mark one of the current user's reminders as unread. */
export async function markReminderUnread(userId: string, reminderId: string): Promise<void> {
  const r = await prisma.reminder.findUnique({
    where: { id: reminderId },
    select: { userId: true, readAt: true },
  });
  if (!r || r.userId !== userId) throw HttpError.notFound('Reminder not found');
  if (r.readAt) {
    await prisma.reminder.update({ where: { id: reminderId }, data: { readAt: null } });
    invalidateUnread(userId);
  }
}

/** Snooze one of the current user's reminders for `minutes` from `now`. */
export async function snoozeReminder(
  userId: string,
  reminderId: string,
  minutes: number,
  now: Date,
): Promise<void> {
  const r = await prisma.reminder.findUnique({
    where: { id: reminderId },
    select: { userId: true },
  });
  if (!r || r.userId !== userId) throw HttpError.notFound('Reminder not found');
  const until = new Date(now.getTime() + minutes * 60_000);
  await prisma.reminder.update({ where: { id: reminderId }, data: { snoozedUntil: until } });
  invalidateUnread(userId);
}

/**
 * Everything that should surface in the user's Reminders list as of `now`: due
 * reminders (not snoozed, not canceled) AND soft-canceled notices. This is the
 * ONE chokepoint governing reminder surfacing — the A2 access gate is applied
 * here, so a user who has since lost access to a task sees neither its due
 * reminder nor its cancel notice.
 */
export async function listDueReminders(actor: Actor, now: Date): Promise<DueReminder[]> {
  const rows = await prisma.reminder.findMany({
    where: { userId: actor.id },
    select: reminderTaskSelect,
  });
  if (rows.length === 0) return [];

  // A2: keep only reminders whose task the actor can CURRENTLY see. Compute the
  // access scope once and test each reminder's task against it.
  const scope = await getTaskAccessScope(actor);

  const out: DueReminder[] = [];
  for (const r of rows) {
    if (!isTaskVisible(scope, r.taskId)) continue;
    const base = {
      id: r.id,
      taskId: r.taskId,
      taskName: r.task.name,
      startAt: r.task.startAt,
      priority: r.task.priority,
      remindAt: r.remindAt,
      note: r.note,
      source: r.kind as ReminderKind,
      readAt: r.readAt,
      emailSentAt: r.emailSentAt,
    };
    if (r.canceledAt) {
      // A soft-canceled notice surfaces immediately (no time gate) while access holds.
      out.push({
        ...base,
        kind: 'canceled',
        canceledReason: r.canceledReason as ReminderCancelReason | null,
        canceledAt: r.canceledAt,
      });
    } else if (
      isReminderDue(r.remindAt, now) &&
      !(r.snoozedUntil && r.snoozedUntil.getTime() > now.getTime())
    ) {
      out.push({ ...base, kind: 'due', canceledReason: null, canceledAt: null });
    }
  }
  return out;
}

/**
 * Remove a task's reminders when a Save Cancels it (reminders no longer hang
 * on the start date, so clearing it leaves them be).
 * Runs inside `updateTask`'s transaction (atomic with the task write):
 *  - the actor's own reminders are hard-deleted (they consented via the confirm
 *    dialog),
 *  - everyone else's live reminders are soft-canceled into a notice.
 * The `canceledAt: null` guard keeps an already-canceled reminder terminal, and
 * resetting read/snooze makes the notice surface fresh.
 */
export async function applyReminderRemovalOnTaskChange(
  tx: Prisma.TransactionClient,
  actorId: string,
  taskId: number,
  reason: ReminderCancelReason,
  now: Date,
): Promise<void> {
  await tx.reminder.deleteMany({ where: { taskId, userId: actorId } });
  await tx.reminder.updateMany({
    where: { taskId, userId: { not: actorId }, canceledAt: null },
    data: { canceledAt: now, canceledReason: reason, readAt: null, snoozedUntil: null },
  });
}
