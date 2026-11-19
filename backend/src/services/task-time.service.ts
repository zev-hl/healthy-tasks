import {
  TIMED_STRETCH_MAX_MINUTES,
  TIMER_CHANGED_CODE,
  type CalendarDateString,
  type MyTimerDto,
  type RunningTimerDto,
  type TaskTimeDto,
  type TimedStretchSavedDto,
} from '@healthy-tasks/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { computeTaskAccess, type Actor } from './access-control.service.js';
import { dutyRefSelect, toDutyRef } from './duty.mapper.js';
import { assertNotFuture, toDbDate } from './time.service.js';
import { toUserRef } from './user.mapper.js';

/**
 * The timer (Nov 2026 plan, L2). Each person has at most one timer running,
 * kept here (`RunningTimer`), so every browser shows the same one. A start
 * names the timer it replaces, and a stop the one it stops: if that isn't the
 * one running (another browser changed it), the server refuses with 409
 * `TIMER_CHANGED` and the current timer, so nothing is overwritten. A stop (or
 * a switch) saves the stretch with its task and the duty the task has at that
 * moment, so a later duty change never moves past hours. A task
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
 * Save one stretch for `userId`. Under a minute counts as one; a timer left
 * running past a day is cut to 24 hours.
 */
async function recordStretch(
  actor: Actor,
  taskId: number,
  startedAt: Date,
  endedAt: Date,
  date: CalendarDateString,
): Promise<TimedStretchSavedDto> {
  const task = await loadReadableTask(actor, taskId);
  const minutes = Math.min(
    TIMED_STRETCH_MAX_MINUTES,
    Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000)),
  );
  const stretch = await prisma.timedStretch.create({
    data: {
      userId: actor.id,
      taskId,
      dutyId: task.dutyId,
      date: toDbDate(date),
      startedAt,
      // The CHECK wants end after start, even for a stop in the same instant.
      endedAt: endedAt > startedAt ? endedAt : new Date(startedAt.getTime() + 1),
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

const timerSelect = {
  taskId: true,
  startedAt: true,
  task: { select: { name: true } },
} as const;

async function currentTimer(userId: string): Promise<RunningTimerDto | null> {
  const t = await prisma.runningTimer.findUnique({ where: { userId }, select: timerSelect });
  return t
    ? { taskId: t.taskId, taskName: t.task.name, startedAt: t.startedAt.toISOString() }
    : null;
}

async function changed(userId: string): Promise<HttpError> {
  const timer = await currentTimer(userId);
  return new HttpError(
    409,
    timer
      ? `Your timer is now running on “${timer.taskName}” (changed somewhere else).`
      : 'Your timer was already stopped somewhere else.',
    { code: TIMER_CHANGED_CODE, timer, now: new Date().toISOString() },
  );
}

/**
 * Take the caller's running timer away if it is the one on `taskId`, and save
 * its stretch. Null when it isn't running there (or the task can no longer be
 * read: the time can't be kept on a task they can't see).
 */
async function takeAndSave(
  actor: Actor,
  taskId: number,
  date: CalendarDateString,
): Promise<MyTimerDto['saved'] | undefined> {
  const t = await prisma.runningTimer.findUnique({
    where: { userId: actor.id },
    select: timerSelect,
  });
  if (!t || t.taskId !== taskId) return undefined;
  // Only the request that deletes the row saves the stretch.
  const gone = await prisma.runningTimer.deleteMany({
    where: { userId: actor.id, taskId, startedAt: t.startedAt },
  });
  if (gone.count === 0) return undefined;
  try {
    const saved = await recordStretch(actor, taskId, t.startedAt, new Date(), date);
    return { ...saved, taskId, taskName: t.task.name };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

/** GET /api/timer */
export async function getMyTimer(actor: Actor): Promise<MyTimerDto> {
  return { timer: await currentTimer(actor.id), now: new Date().toISOString() };
}

/** POST /api/timer/start */
export async function startTimer(
  actor: Actor,
  input: { taskId: number; replacing: number | null; date: CalendarDateString },
): Promise<MyTimerDto> {
  assertNotFuture(input.date);
  const current = await prisma.runningTimer.findUnique({ where: { userId: actor.id } });
  if ((current?.taskId ?? null) !== input.replacing) throw await changed(actor.id);
  // Already timing this task: nothing to do.
  if (current?.taskId === input.taskId) return getMyTimer(actor);
  await loadReadableTask(actor, input.taskId);

  let saved: MyTimerDto['saved'] = null;
  if (current) {
    const s = await takeAndSave(actor, current.taskId, input.date);
    if (s === undefined) throw await changed(actor.id);
    saved = s;
  }
  try {
    await prisma.runningTimer.create({
      data: { userId: actor.id, taskId: input.taskId, startedAt: new Date() },
    });
  } catch (err) {
    // Another browser started one in the same moment.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw await changed(actor.id);
    }
    throw err;
  }
  return { ...(await getMyTimer(actor)), saved };
}

/** POST /api/timer/stop */
export async function stopTimer(
  actor: Actor,
  input: { taskId: number; date: CalendarDateString },
): Promise<MyTimerDto> {
  assertNotFuture(input.date);
  const saved = await takeAndSave(actor, input.taskId, input.date);
  if (saved === undefined) throw await changed(actor.id);
  return { ...(await getMyTimer(actor)), saved };
}
