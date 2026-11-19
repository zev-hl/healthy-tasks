import type { DashboardAttentionDto, TaskRowDto } from '@healthy-tasks/shared';
import { prisma } from '../db/prisma.js';
import { addCalendarDays, fromBusinessDate, toBusinessDate } from '../utils/business-time.js';
import { getTaskAccessScope, type Actor } from './access-control.service.js';
import { finishRows, rowInclude, toTaskRowDto } from './task-search.service.js';

/**
 * The Dashboard's "needs you" numbers (Nov 2026 plan, H1), each with its tasks
 * so the Dashboard can list them in place (H2):
 *  - Unread: my open tasks with activity since I last opened them (for the
 *    assignee only), or never opened when someone else made them.
 *  - Stale: my open tasks quiet for 2+ business days.
 *  - Mentions awaiting reply: tasks where I was mentioned and haven't
 *    commented since.
 */

const OPEN = ['Open', 'InProgress', 'OnHold', 'Review'] as const;
const LIST_MAX = 50;

/** Start of the business day `n` business days (Mon–Fri) before today. */
export function businessDaysAgo(n: number, now: Date): Date {
  let day = toBusinessDate(now);
  let left = n;
  while (left > 0) {
    day = addCalendarDays(day, -1);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return fromBusinessDate(day, 0);
}

/** Opening a task marks it seen for the reader (only kept for their own tasks). */
export async function markTaskSeen(userId: string, taskId: number): Promise<void> {
  await prisma.taskSeen.upsert({
    where: { userId_taskId: { userId, taskId } },
    create: { userId, taskId },
    update: { seenAt: new Date() },
  });
}

export async function getDashboardAttention(
  actor: Actor,
  now = new Date(),
): Promise<DashboardAttentionDto> {
  const mine = await prisma.task.findMany({
    where: {
      assigneeId: actor.id,
      status: { in: [...OPEN] },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
    },
    select: {
      id: true,
      creatorId: true,
      lastActivityAt: true,
      seenBy: { where: { userId: actor.id }, select: { seenAt: true } },
    },
  });
  const unreadIds = mine
    .filter((t) => {
      const seen = t.seenBy[0]?.seenAt;
      return seen ? t.lastActivityAt > seen : t.creatorId !== actor.id;
    })
    .map((t) => t.id);
  const cutoff = businessDaysAgo(2, now);
  const staleIds = mine.filter((t) => t.lastActivityAt < cutoff).map((t) => t.id);

  const mentions = await prisma.notification.findMany({
    where: {
      userId: actor.id,
      type: 'mentioned',
      commentId: { not: null },
      task: { deletedAt: null },
    },
    select: { taskId: true, comment: { select: { createdAt: true } } },
  });
  const latestMention = new Map<number, Date>();
  for (const m of mentions) {
    const at = m.comment?.createdAt;
    if (!at) continue;
    const cur = latestMention.get(m.taskId);
    if (!cur || at > cur) latestMention.set(m.taskId, at);
  }
  const awaitingIds: number[] = [];
  if (latestMention.size > 0) {
    const replies = await prisma.comment.groupBy({
      by: ['taskId'],
      where: { authorId: actor.id, taskId: { in: [...latestMention.keys()] } },
      _max: { createdAt: true },
    });
    const lastReply = new Map(replies.map((r) => [r.taskId, r._max.createdAt]));
    for (const [taskId, at] of latestMention) {
      const reply = lastReply.get(taskId);
      if (!reply || reply < at) awaitingIds.push(taskId);
    }
  }

  const scope = await getTaskAccessScope(actor);
  const rowsFor = async (ids: number[]): Promise<TaskRowDto[]> => {
    if (ids.length === 0) return [];
    const rows = await prisma.task.findMany({
      where: { id: { in: ids.slice(0, LIST_MAX) } },
      include: rowInclude,
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    });
    return finishRows(
      rows.map((r) => toTaskRowDto(r, scope)),
      scope,
      actor,
    );
  };
  const [unread, stale, mentionsAwaiting] = await Promise.all([
    rowsFor(unreadIds),
    rowsFor(staleIds),
    rowsFor(awaitingIds),
  ]);
  return {
    unread: { count: unreadIds.length, rows: unread },
    stale: { count: staleIds.length, rows: stale },
    mentionsAwaiting: { count: awaitingIds.length, rows: mentionsAwaiting },
  };
}
