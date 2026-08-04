import type { Request, Response } from 'express';
import { HttpError } from '../utils/http-error.js';
import {
  MENTIONED_FILTERS,
  type MentionedFilter,
  type NotificationPreferencesDto,
  type NotificationsDto,
  type UnreadCountDto,
} from '@healthy-tasks/shared';
import {
  getUnreadCounts,
  listNotifications,
  markNotificationRead,
  markNotificationUnread,
  processDueReminderEmails,
} from '../services/notification.service.js';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../services/notification-preference.service.js';
import { checkSchedulerHealth, isSchedulerDown } from '../services/scheduler.service.js';
import type { UpdateNotificationPreferencesInput } from '../validation/schemas.js';

function currentUserId(req: Request): string {
  if (!req.user) throw HttpError.unauthorized();
  return req.user.id;
}

/** GET /api/notifications?filter=all|unread|read (filter applies to Mentioned). */
export async function listNotificationsController(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  const raw = typeof req.query.filter === 'string' ? req.query.filter : 'all';
  const filter: MentionedFilter = (MENTIONED_FILTERS as readonly string[]).includes(raw)
    ? (raw as MentionedFilter)
    : 'all';
  // Visiting the screen is also a polling opportunity for reminder emails.
  await processDueReminderEmails(userId, new Date());
  res.json((await listNotifications(userId, filter)) satisfies NotificationsDto);
}

/** GET /api/notifications/unread-count — the 30s bell poll (and email heartbeat). */
export async function unreadCountController(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  const now = new Date();
  await processDueReminderEmails(userId, now);
  // Watchdog for the recurrence timer: if it has gone stale, email admins (once
  // per outage) AND report `schedulerDown` so every client shows a global banner.
  await checkSchedulerHealth(now);
  const counts = await getUnreadCounts(userId);
  const schedulerDown = await isSchedulerDown(now);
  res.json({ ...counts, schedulerDown } satisfies UnreadCountDto);
}

/** POST /api/notifications/:id/read — mark a Mentioned/Assigned entry read. */
export async function markNotificationReadController(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  await markNotificationRead(userId, (req.params as { id: string }).id);
  res.status(204).send();
}

/** POST /api/notifications/:id/unread — re-mark a Mentioned/Assigned entry unread. */
export async function markNotificationUnreadController(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  await markNotificationUnread(userId, (req.params as { id: string }).id);
  res.status(204).send();
}

export async function getNotificationPreferencesController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = currentUserId(req);
  res.json((await getNotificationPreferences(userId)) satisfies NotificationPreferencesDto);
}

export async function updateNotificationPreferencesController(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = currentUserId(req);
  const updated = await updateNotificationPreferences(
    userId,
    req.body as UpdateNotificationPreferencesInput,
  );
  res.json(updated satisfies NotificationPreferencesDto);
}
