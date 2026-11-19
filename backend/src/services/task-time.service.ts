import {
  TIMED_STRETCH_MAX_MINUTES,
  type CalendarDateString,
  type TaskTimeDto,
  type TimedStretchSavedDto,
} from '@healthy-tasks/shared';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { computeTaskAccess, type Actor } from './access-control.service.js';
import { dutyRefSelect, toDutyRef } from './duty.mapper.js';
import { assertNotFuture, toDbDate } from './time.service.js';
import { toUserRef } from './user.mapper.js';

/**
 * The timer's saved time (Nov 2026 plan, L2). The clock runs in the browser;
 * when it stops, the stretch is saved here with its task and the duty the task
 * has at that moment, so a later duty change never moves past hours. A task
 * shows its total (and per person) to everyone who can read it, and My Time
 * adds a person's stretches up by duty for the day (`time.service` loadDays).
 */

const userSelect = { id: true, email: true, firstName: true, lastName: true, title: true } as const;

async function loadReadableTask(actor: Actor, taskId: number) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, assigneeId: true, isPrivate: true, dutyId: true },
  });
  if (!task || !(await computeTaskAccess(actor, task))) throw HttpError.notFound('Task not found');
  return task;
}

async function totalsOf(taskId: number): Promise<TaskTimeDto> {
  const groups = await prisma.timedStretch.groupBy({
    by: ['userId'],
    where: { taskId },
    _sum: { minutes: true },
  });
  const users = groups.length
    ? await prisma.user.findMany({
        where: { id: { in: groups.map((g) => g.userId) } },
        select: userSelect,
      })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const people = groups
    .flatMap((g) => {
      const u = byId.get(g.userId);
      return u ? [{ user: toUserRef(u), minutes: g._sum.minutes ?? 0 }] : [];
    })
    .sort((a, b) => b.minutes - a.minutes);
  return { totalMinutes: people.reduce((s, p) => s + p.minutes, 0), people };
}

/** GET /api/tasks/:id/time */
export async function getTaskTime(actor: Actor, taskId: number): Promise<TaskTimeDto> {
  await loadReadableTask(actor, taskId);
  return totalsOf(taskId);
}

/**
 * POST /api/tasks/:id/time — save one stretch for the caller. Under a minute
 * counts as one; a timer left running past a day is cut to 24 hours.
 */
export async function saveTimedStretch(
  actor: Actor,
  taskId: number,
  input: { startedAt: string; endedAt: string; date: CalendarDateString },
): Promise<TimedStretchSavedDto> {
  const task = await loadReadableTask(actor, taskId);
  const startedAt = new Date(input.startedAt);
  const endedAt = new Date(input.endedAt);
  if (!(endedAt > startedAt)) throw HttpError.badRequest('The timer must stop after it started');
  // A little slack for clocks that run slightly ahead.
  if (endedAt.getTime() > Date.now() + 5 * 60_000) {
    throw HttpError.badRequest("The timer can't stop in the future");
  }
  assertNotFuture(input.date);
  const minutes = Math.min(
    TIMED_STRETCH_MAX_MINUTES,
    Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000)),
  );
  const stretch = await prisma.timedStretch.create({
    data: {
      userId: actor.id,
      taskId,
      dutyId: task.dutyId,
      date: toDbDate(input.date),
      startedAt,
      endedAt,
      minutes,
    },
    select: { minutes: true, duty: dutyRefSelect },
  });
  return {
    ...(await totalsOf(taskId)),
    minutes: stretch.minutes,
    duty: stretch.duty ? toDutyRef(stretch.duty) : null,
  };
}
