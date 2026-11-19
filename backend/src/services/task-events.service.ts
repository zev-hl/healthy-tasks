import type { NotificationType } from '@prisma/client';
import type { NotifyEvent } from '@healthy-tasks/shared';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { queueEmail } from '../queue/email-queue.js';
import { taskEventEmail } from '../utils/notification-emails.js';
import { computeTaskAccess } from './access-control.service.js';
import { getPreferencesMap, wants } from './notification-preference.service.js';
import { pushTo } from './push.service.js';
import { invalidateUnread } from './unread-cache.js';
import { userDisplayName } from '../utils/user-name.js';
import { formatBusinessTimestamp } from '../utils/business-time.js';

/**
 * The Stage 2 task events (Nov 2026 plan, E3, E7): status changed, a new
 * comment, an update requested, due soon, overdue, a snooze. One place sends
 * them, by each person's settings: in the app (a Notification row, the Activity
 * list), by email, and by browser push for those who switched it on. Connect
 * messages are Stage 4 (K3); the choice is already kept.
 *
 * Never to the person who caused it, only to active people who can see the
 * task, and never twice to the same person for one event.
 */

export type TaskEventType = Extract<
  NotificationType,
  'updateRequested' | 'statusChanged' | 'commented' | 'dueSoon' | 'overdue' | 'snoozed'
>;

const EVENT_OF: Record<TaskEventType, NotifyEvent> = {
  updateRequested: 'updateRequested',
  statusChanged: 'status',
  commented: 'comment',
  dueSoon: 'due',
  overdue: 'overdue',
  snoozed: 'snooze',
};

export interface TaskEventInput {
  type: TaskEventType;
  taskId: number;
  /** Who it may go to; the actor and anyone who can't see the task are dropped. */
  to: (string | null | undefined)[];
  actorId: string | null;
  /** One sentence for the email and push ("Ada asked you for an update on …"). */
  what: string;
  note?: string | null;
  detail?: string | null;
}

/** A person's name for an event's sentence. */
export async function nameOf(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, firstName: true, lastName: true },
  });
  return u ? userDisplayName(u) : 'Someone';
}

/** A comment's opening words, as plain text. */
export function excerpt(html: string, max = 140): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export async function notifyTaskEvent(e: TaskEventInput): Promise<string[]> {
  const ids = [...new Set(e.to.filter((x): x is string => !!x && x !== e.actorId))];
  if (ids.length === 0) return [];
  const task = await prisma.task.findUnique({
    where: { id: e.taskId },
    select: { id: true, name: true, assigneeId: true, isPrivate: true },
  });
  if (!task) return [];
  const people = await prisma.user.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true, email: true, role: true },
  });
  const seeing: typeof people = [];
  for (const p of people) {
    if (await computeTaskAccess({ id: p.id, role: p.role }, task)) seeing.push(p);
  }
  if (seeing.length === 0) return [];
  const prefs = await getPreferencesMap(seeing.map((p) => p.id));
  const event = EVENT_OF[e.type];
  const link = `${env.frontendUrl}/tasks/${task.id}`;
  const reached: string[] = [];
  for (const p of seeing) {
    const pref = prefs.get(p.id)!;
    const inApp = wants(pref, event, 'inApp');
    if (inApp) {
      await prisma.notification.create({
        data: {
          userId: p.id,
          type: e.type,
          taskId: task.id,
          actorId: e.actorId,
          note: e.note ?? null,
          detail: e.detail ?? null,
        },
      });
      invalidateUnread(p.id);
      if (pref.pushOn) {
        await pushTo(p.id, { title: task.name, body: e.what, url: link }).catch((err) =>
          console.error('push failed', err),
        );
      }
    }
    if (wants(pref, event, 'email')) {
      await queueEmail(
        taskEventEmail({ to: p.email, subject: `${e.what}`, what: e.what, note: e.note, link }),
        { kind: 'task-event' },
      ).catch((err) => console.error('task event email failed', err));
    }
    if (inApp || wants(pref, event, 'email')) reached.push(p.id);
  }
  return reached;
}

const DAY = 86_400_000;
const OPEN_STATUSES = ['Open', 'InProgress', 'OnHold', 'Review'] as const;

/**
 * Due soon and overdue notices (E7), from the scheduler pass: a day before the
 * due date to the assignee, and when it passes to the assignee and the
 * creator. Each goes once per due date (`dueSoonNoticeFor` / `overdueNoticeFor`
 * hold the due date it went for); a task snoozed or already closed gets none.
 */
export async function dispatchDueNotices(now: Date): Promise<void> {
  const notSnoozed = { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] };
  const soon = await prisma.task.findMany({
    where: {
      status: { in: [...OPEN_STATUSES] },
      dueAt: { gt: now, lte: new Date(now.getTime() + DAY) },
      ...notSnoozed,
    },
    select: { id: true, name: true, assigneeId: true, dueAt: true, dueSoonNoticeFor: true },
    take: 500,
  });
  for (const t of soon) {
    if (!t.dueAt || t.dueSoonNoticeFor?.getTime() === t.dueAt.getTime()) continue;
    await prisma.task.updateMany({ where: { id: t.id }, data: { dueSoonNoticeFor: t.dueAt } });
    await notifyTaskEvent({
      type: 'dueSoon',
      taskId: t.id,
      to: [t.assigneeId],
      actorId: null,
      what: `“${t.name}” is due ${formatBusinessTimestamp(t.dueAt)}`,
      detail: t.dueAt.toISOString(),
    });
  }
  const late = await prisma.task.findMany({
    where: { status: { in: [...OPEN_STATUSES] }, dueAt: { lte: now }, ...notSnoozed },
    select: {
      id: true,
      name: true,
      assigneeId: true,
      creatorId: true,
      dueAt: true,
      overdueNoticeFor: true,
    },
    take: 500,
  });
  for (const t of late) {
    if (!t.dueAt || t.overdueNoticeFor?.getTime() === t.dueAt.getTime()) continue;
    await prisma.task.updateMany({ where: { id: t.id }, data: { overdueNoticeFor: t.dueAt } });
    // One that was already long overdue when this arrived says so once, quietly:
    // only tasks that became overdue in the last day are announced.
    if (now.getTime() - t.dueAt.getTime() > DAY) continue;
    await notifyTaskEvent({
      type: 'overdue',
      taskId: t.id,
      to: [t.assigneeId, t.creatorId],
      actorId: null,
      what: `“${t.name}” is overdue (due ${formatBusinessTimestamp(t.dueAt)})`,
      detail: t.dueAt.toISOString(),
    });
  }
}

/** When the next due-soon or overdue notice falls, for the scheduler's wake. */
export async function nextDueNoticeAt(now: Date): Promise<Date | null> {
  const next = await prisma.task.findFirst({
    where: { status: { in: [...OPEN_STATUSES] }, dueAt: { gt: now } },
    orderBy: { dueAt: 'asc' },
    select: { dueAt: true, dueSoonNoticeFor: true },
  });
  if (!next?.dueAt) return null;
  const soonAt = next.dueAt.getTime() - DAY;
  return new Date(
    soonAt > now.getTime() && next.dueSoonNoticeFor?.getTime() !== next.dueAt.getTime()
      ? soonAt
      : next.dueAt.getTime(),
  );
}
