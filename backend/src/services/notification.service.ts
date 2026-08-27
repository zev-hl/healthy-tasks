import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { mailer } from '../utils/mailer.js';
import { env } from '../config/env.js';
import { toUserRef } from './user.mapper.js';
import { getNotificationPreferences, getPreferencesMap } from './notification-preference.service.js';
import { listDueReminders, type DueReminder } from './reminder.service.js';
import { getCachedUnread, invalidateUnread, setCachedUnread } from './unread-cache.js';
import type { Actor } from './access-control.service.js';
import {
  reminderLeadLabel,
  TERMINAL_TASK_STATUSES,
  type AssignAction,
  type AssignedNotificationDto,
  type MentionedFilter,
  type MentionedNotificationDto,
  type NotificationsDto,
  type ReminderNotificationDto,
  type UnreadCountDto,
} from '@healthy-tasks/shared';

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function taskLink(taskId: number): string {
  return `${env.frontendUrl}/tasks/${taskId}`;
}

// --- Creation hooks (called post-commit by comment/task services) -----------

/**
 * Create Mentioned notifications for the users whose @mention fired an event on
 * this comment save (the 15-minute gate having already been applied upstream).
 * The comment author is never notified of their own mention. Each recipient
 * gets an in-app row only if opted in, and an email only if opted in AND their
 * "also email me" flag is on.
 */
export async function createMentionNotifications(
  taskId: number,
  commentId: string,
  firedUserIds: string[],
  actorId: string,
): Promise<void> {
  const recipients = [...new Set(firedUserIds)].filter((id) => id !== actorId);
  if (recipients.length === 0) return;

  const prefs = await getPreferencesMap(recipients);
  const inApp = recipients.filter((id) => prefs.get(id)?.mentionedInApp);
  for (const userId of inApp) {
    await prisma.notification.create({ data: { userId, type: 'mentioned', taskId, commentId } });
    invalidateUnread(userId);
  }

  const emailIds = recipients.filter((id) => {
    const p = prefs.get(id);
    return p?.mentionedInApp && p?.mentionedEmail;
  });
  if (emailIds.length > 0) await emailMention(taskId, commentId, emailIds);
}

/**
 * Create an Assigned notification for a user added/removed as a task's assignee.
 * Self-assignment (recipient === actor) is skipped. In-app requires opt-in;
 * email requires opt-in AND the "also email me" flag.
 */
export async function createAssignedNotification(params: {
  recipientId: string;
  actorId: string;
  taskId: number;
  action: AssignAction;
}): Promise<void> {
  const { recipientId, actorId, taskId, action } = params;
  if (recipientId === actorId) return;

  const prefs = await getNotificationPreferences(recipientId);
  if (!prefs.assignedInApp) return; // opted out of Assigned entirely

  await prisma.notification.create({
    data: { userId: recipientId, type: 'assigned', taskId, assignAction: action, actorId },
  });
  invalidateUnread(recipientId);
  if (prefs.assignedEmail) await emailAssignment(recipientId, taskId, action);
}

// --- Reading ---------------------------------------------------------------

function mentionedWhere(userId: string, filter: MentionedFilter) {
  const base = { userId, type: 'mentioned' as const };
  if (filter === 'read') return { ...base, readAt: { not: null } };
  if (filter === 'unread') return { ...base, readAt: null };
  return base;
}

/** All three lists for the Notifications screen. */
export async function listNotifications(
  actor: Actor,
  filter: MentionedFilter,
): Promise<NotificationsDto> {
  const userId = actor.id;
  const prefs = await getNotificationPreferences(userId);

  const mentionedRows = await prisma.notification.findMany({
    where: mentionedWhere(userId, filter),
    include: {
      task: { select: { name: true } },
      comment: {
        select: {
          createdAt: true,
          body: true,
          author: {
            select: { id: true, email: true, firstName: true, lastName: true, title: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  const mentioned: MentionedNotificationDto[] = mentionedRows
    .filter((r) => r.comment !== null)
    .map((r) => ({
      id: r.id,
      taskId: r.taskId,
      taskName: r.task.name,
      commentAt: r.comment!.createdAt.toISOString(),
      commenter: toUserRef(r.comment!.author),
      commentHtml: r.comment!.body,
      read: r.readAt !== null,
    }));

  const assignedRows = await prisma.notification.findMany({
    where: { userId, type: 'assigned' },
    include: { task: { select: { name: true, startAt: true, dueAt: true, priority: true } } },
    orderBy: { createdAt: 'desc' },
  });

  // Resolve actors (assigners) and count each task's open blockers in one pass.
  const actorIds = [...new Set(assignedRows.map((r) => r.actorId).filter((x): x is string => !!x))];
  const taskIds = [...new Set(assignedRows.map((r) => r.taskId))];
  const [actorRows, blockerGroups] = await Promise.all([
    actorIds.length
      ? prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true, firstName: true, lastName: true, title: true },
        })
      : Promise.resolve([]),
    taskIds.length
      ? prisma.taskDependency.groupBy({
          by: ['blockedId'],
          where: {
            blockedId: { in: taskIds },
            blocker: { status: { notIn: [...TERMINAL_TASK_STATUSES] } },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);
  const actorById = new Map(actorRows.map((u) => [u.id, toUserRef(u)]));
  const blockedByCount = new Map(blockerGroups.map((g) => [g.blockedId, g._count._all]));

  const assigned: AssignedNotificationDto[] = assignedRows.map((r) => ({
    id: r.id,
    taskId: r.taskId,
    taskName: r.task.name,
    startAt: iso(r.task.startAt),
    dueAt: iso(r.task.dueAt),
    priority: r.task.priority,
    action: (r.assignAction ?? 'added') as AssignAction,
    actor: r.actorId ? (actorById.get(r.actorId) ?? null) : null,
    blockedByCount: blockedByCount.get(r.taskId) ?? 0,
    createdAt: r.createdAt.toISOString(),
    read: r.readAt !== null,
  }));

  // Reminders are live/time-conditional; opting out suppresses the whole list.
  // The list carries both due reminders and soft-canceled notices (access-gated
  // inside listDueReminders). Canceled notices sort by when they were canceled;
  // due reminders by their task's Start time.
  let reminders: ReminderNotificationDto[] = [];
  if (prefs.remindersInApp) {
    const due = await listDueReminders(actor, new Date());
    const sortKey = (r: DueReminder): number =>
      (r.canceledAt ?? r.startAt)?.getTime() ?? 0;
    due.sort((a, b) => sortKey(a) - sortKey(b));
    reminders = due.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      taskName: r.taskName,
      startAt: iso(r.startAt),
      priority: r.priority,
      leadMinutes: r.leadMinutes,
      read: r.readAt !== null,
      kind: r.kind,
      canceledReason: r.canceledReason,
      canceledAt: iso(r.canceledAt),
    }));
  }

  return { mentioned, reminders, assigned };
}

/** Unread tallies for the bell badge. `schedulerDown` is layered on by the
 * controller (which owns the scheduler-health read), so this stays count-only. */
export async function getUnreadCounts(
  actor: Actor,
): Promise<Omit<UnreadCountDto, 'schedulerDown'>> {
  const userId = actor.id;
  // S5: every open tab polls this, and the work below is the heaviest on that
  // path. Memoized briefly per user; every mutation that can change this user's
  // own count calls `invalidateUnread`, so a mark-read is never masked.
  const cached = getCachedUnread<Omit<UnreadCountDto, 'schedulerDown'>>(userId);
  if (cached) return cached;

  const prefs = await getNotificationPreferences(userId);
  const [mentioned, assigned] = await Promise.all([
    prisma.notification.count({ where: { userId, type: 'mentioned', readAt: null } }),
    prisma.notification.count({ where: { userId, type: 'assigned', readAt: null } }),
  ]);
  let reminders = 0;
  if (prefs.remindersInApp) {
    // Counts unread due reminders AND unread cancel notices (both access-gated).
    const due = await listDueReminders(actor, new Date());
    reminders = due.filter((r) => r.readAt === null).length;
  }
  const counts = { total: mentioned + assigned + reminders, mentioned, reminders, assigned };
  setCachedUnread(userId, counts);
  return counts;
}

/** Mark one of the user's Mentioned/Assigned notifications read. */
export async function markNotificationRead(userId: string, id: string): Promise<void> {
  const n = await prisma.notification.findUnique({
    where: { id },
    select: { userId: true, readAt: true },
  });
  if (!n || n.userId !== userId) throw HttpError.notFound('Notification not found');
  if (!n.readAt) {
    await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    invalidateUnread(userId);
  }
}

/** Re-mark one of the user's Mentioned/Assigned notifications as unread. */
export async function markNotificationUnread(userId: string, id: string): Promise<void> {
  const n = await prisma.notification.findUnique({
    where: { id },
    select: { userId: true, readAt: true },
  });
  if (!n || n.userId !== userId) throw HttpError.notFound('Notification not found');
  if (n.readAt) {
    await prisma.notification.update({ where: { id }, data: { readAt: null } });
    invalidateUnread(userId);
  }
}

/**
 * Send "also email me" reminder emails for reminders that have just become due
 * and haven't been emailed yet. Called on the polling heartbeat (the unread
 * count endpoint), which is the delivery trigger for time-based reminders. Each
 * reminder is claimed (emailSentAt stamped) before sending so concurrent polls
 * don't double-send.
 */
export async function processDueReminderEmails(actor: Actor, now: Date): Promise<void> {
  const userId = actor.id;
  const prefs = await getNotificationPreferences(userId);
  if (!prefs.remindersInApp || !prefs.remindersEmail) return;

  // Only real (due) reminders are emailed; cancel notices are in-app only.
  const due = await listDueReminders(actor, now);
  const pending = due.filter((r) => r.kind === 'due' && r.emailSentAt === null);
  if (pending.length === 0) return;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return;

  for (const r of pending) {
    // Claim first so a concurrent poll can't also send this one.
    const claimed = await prisma.reminder.updateMany({
      where: { id: r.id, emailSentAt: null },
      data: { emailSentAt: now },
    });
    if (claimed.count !== 1) continue;
    try {
      await emailReminder(user.email, r);
    } catch (err) {
      console.error('Failed to send reminder email', r.id, err);
    }
  }
}

/**
 * Dispatch due reminder emails for EVERY user (Phase 14 / S4a), from the
 * scheduler pass.
 *
 * This used to run only in the request path, scoped to the polling actor, which
 * meant a user's reminder email was sent only while that user happened to be
 * polling - close the app and it never arrived. Reducing poll frequency (C1/C2/C3)
 * would have made that worse, so delivery moved server-side.
 *
 * The candidate query is only a COARSE pre-filter - "users who still have an
 * un-emailed reminder on a task with a start date". It deliberately does not try
 * to evaluate due-ness in SQL: a reminder's due time is derived
 * (`startAt - leadMinutes`), and comparing that against a bound parameter makes
 * the query timezone-fragile. Due-ness, notification preferences and the A2
 * task-access gate are all decided by `processDueReminderEmails` /
 * `listDueReminders`, which stay the single source of truth, and the
 * `emailSentAt` claim keeps dispatch idempotent across passes.
 */
export async function dispatchDueReminderEmails(now: Date): Promise<void> {
  const rows = await prisma.reminder.findMany({
    where: { canceledAt: null, emailSentAt: null, task: { startAt: { not: null } } },
    select: { userId: true },
    distinct: ['userId'],
  });
  if (rows.length === 0) return;

  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.userId) }, isActive: true },
    select: { id: true, role: true },
  });
  for (const u of users) {
    try {
      await processDueReminderEmails({ id: u.id, role: u.role }, now);
    } catch (err) {
      // One user's failure must not stall the rest of the dispatch.
      console.error('Failed to dispatch reminder emails for user', u.id, err);
    }
  }
}

// --- Email bodies (dev: printed to console via the shared mailer) -----------

async function emailMention(taskId: number, commentId: string, userIds: string[]): Promise<void> {
  const [task, comment, users] = await Promise.all([
    prisma.task.findUnique({ where: { id: taskId }, select: { name: true } }),
    prisma.comment.findUnique({
      where: { id: commentId },
      select: { author: { select: { email: true } } },
    }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { email: true } }),
  ]);
  if (!task) return;
  const by = comment?.author.email ?? 'someone';
  for (const u of users) {
    await mailer.send({
      to: u.email,
      subject: `You were mentioned on “${task.name}”`,
      text: [
        `${by} mentioned you in a comment on task #${taskId} (“${task.name}”).`,
        '',
        `Open the task: ${taskLink(taskId)}`,
      ].join('\n'),
    });
  }
}

async function emailAssignment(userId: string, taskId: number, action: AssignAction): Promise<void> {
  const [task, user] = await Promise.all([
    prisma.task.findUnique({ where: { id: taskId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
  ]);
  if (!task || !user) return;
  const verb = action === 'added' ? 'assigned to' : 'unassigned from';
  await mailer.send({
    to: user.email,
    subject: `You were ${verb} “${task.name}”`,
    text: [
      `You were ${verb} task #${taskId} (“${task.name}”).`,
      '',
      `Open the task: ${taskLink(taskId)}`,
    ].join('\n'),
  });
}

async function emailReminder(to: string, r: DueReminder): Promise<void> {
  await mailer.send({
    to,
    subject: `Reminder: “${r.taskName}”`,
    text: [
      `Reminder for task #${r.taskId} (“${r.taskName}”).`,
      r.startAt ? `Starts: ${r.startAt.toISOString()} (${reminderLeadLabel(r.leadMinutes)})` : '',
      '',
      `Open the task: ${taskLink(r.taskId)}`,
    ]
      .filter(Boolean)
      .join('\n'),
  });
}
