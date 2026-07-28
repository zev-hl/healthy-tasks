import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import type { ReminderDto, TaskPriority } from '@healthy-tasks/shared';

// A reminder with the bits of its task needed to decide due-ness and render the
// Reminders list.
export interface DueReminder {
  id: string;
  taskId: number;
  taskName: string;
  startAt: Date | null;
  priority: TaskPriority;
  leadMinutes: number;
  readAt: Date | null;
  emailSentAt: Date | null;
}

const reminderTaskSelect = {
  id: true,
  leadMinutes: true,
  readAt: true,
  emailSentAt: true,
  taskId: true,
  task: { select: { name: true, startAt: true, priority: true } },
} as const;

/**
 * Whether a reminder has surfaced: its task has a Start Date/Time and the
 * current time has reached (startAt - leadMinutes). A task with no startAt is
 * treated as not-yet-due (never surfaces) rather than an error.
 */
export function isReminderDue(startAt: Date | null, leadMinutes: number, now: Date): boolean {
  if (!startAt) return false;
  return now.getTime() >= startAt.getTime() - leadMinutes * 60_000;
}

function toDto(r: { id: string; taskId: number; leadMinutes: number; createdAt: Date }): ReminderDto {
  return { id: r.id, taskId: r.taskId, leadMinutes: r.leadMinutes, createdAt: r.createdAt.toISOString() };
}

/** The current user's reminders on a task (for the Task Detail page). */
export async function listRemindersForTask(userId: string, taskId: number): Promise<ReminderDto[]> {
  const rows = await prisma.reminder.findMany({
    where: { userId, taskId },
    orderBy: [{ leadMinutes: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(toDto);
}

/** Add a reminder for the current user on a task they can see. */
export async function addReminder(
  userId: string,
  taskId: number,
  leadMinutes: number,
): Promise<ReminderDto> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
  if (!task) throw HttpError.notFound('Task not found');
  const row = await prisma.reminder.create({ data: { userId, taskId, leadMinutes } });
  return toDto(row);
}

/** Remove one of the current user's reminders (from task detail or the list). */
export async function removeReminder(userId: string, reminderId: string): Promise<void> {
  const r = await prisma.reminder.findUnique({ where: { id: reminderId }, select: { userId: true } });
  if (!r || r.userId !== userId) throw HttpError.notFound('Reminder not found');
  await prisma.reminder.delete({ where: { id: reminderId } });
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
  }
}

/** All of the user's reminders that have surfaced (are due) as of `now`. */
export async function listDueReminders(userId: string, now: Date): Promise<DueReminder[]> {
  const rows = await prisma.reminder.findMany({
    where: { userId },
    select: reminderTaskSelect,
  });
  return rows
    .filter((r) => isReminderDue(r.task.startAt, r.leadMinutes, now))
    .map((r) => ({
      id: r.id,
      taskId: r.taskId,
      taskName: r.task.name,
      startAt: r.task.startAt,
      priority: r.task.priority,
      leadMinutes: r.leadMinutes,
      readAt: r.readAt,
      emailSentAt: r.emailSentAt,
    }));
}
