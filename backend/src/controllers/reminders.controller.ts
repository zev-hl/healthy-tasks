import type { Request, Response } from 'express';
import { HttpError } from '../utils/http-error.js';
import type { ReminderDto } from '@healthy-tasks/shared';
import {
  addReminder,
  listRemindersForTask,
  markReminderRead,
  markReminderUnread,
  removeReminder,
  snoozeReminder,
} from '../services/reminder.service.js';
import type { Actor } from '../services/access-control.service.js';
import type { AddReminderInput, SnoozeReminderInput } from '../validation/schemas.js';

function currentUserId(req: Request): string {
  if (!req.user) throw HttpError.unauthorized();
  return req.user.id;
}

function actorOf(req: Request): Actor {
  if (!req.user) throw HttpError.unauthorized();
  return { id: req.user.id, role: req.user.role };
}

function parseTaskId(req: Request): number {
  const id = Number((req.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw HttpError.badRequest('Invalid task id');
  return id;
}

/** GET /api/tasks/:id/reminders — the current user's reminders on the task. */
export async function listTaskRemindersController(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  res.json((await listRemindersForTask(userId, parseTaskId(req))) satisfies ReminderDto[]);
}

/** POST /api/tasks/:id/reminders — add a reminder for the current user. */
export async function addTaskReminderController(req: Request, res: Response): Promise<void> {
  const { leadMinutes } = req.body as AddReminderInput;
  res
    .status(201)
    .json((await addReminder(actorOf(req), parseTaskId(req), leadMinutes)) satisfies ReminderDto);
}

/** DELETE /api/reminders/:id — remove one of the current user's reminders. */
export async function removeReminderController(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  await removeReminder(userId, (req.params as { id: string }).id);
  res.status(204).send();
}

/** POST /api/reminders/:id/read — mark a reminder read (on click-through). */
export async function markReminderReadController(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  await markReminderRead(userId, (req.params as { id: string }).id);
  res.status(204).send();
}

/** POST /api/reminders/:id/unread — re-mark a reminder as unread. */
export async function markReminderUnreadController(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  await markReminderUnread(userId, (req.params as { id: string }).id);
  res.status(204).send();
}

/** POST /api/reminders/:id/snooze — hide a due reminder for `minutes` from now. */
export async function snoozeReminderController(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  const { minutes } = req.body as SnoozeReminderInput;
  await snoozeReminder(userId, (req.params as { id: string }).id, minutes, new Date());
  res.status(204).send();
}
