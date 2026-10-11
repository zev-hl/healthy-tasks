import type { Prisma } from '@prisma/client';
import {
  TIME_DAY_MAX_MINUTES,
  dutyLabel,
  type CalendarDateString,
  type DutyRef,
  type RelatedTaskDto,
  type TimeDayDto,
  type TimeReviewDto,
  type TimeReviewPeopleDto,
  type TimeReviewPersonDto,
} from '@healthy-tasks/shared';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { STALE_WRITE_CODE } from '../utils/optimistic.js';
import type { SaveTimeDayInput, TimeReviewInput } from '../validation/schemas.js';
import {
  type Actor,
  buildTaskAccessWhere,
  getDownlineIds,
  getTaskAccessScope,
} from './access-control.service.js';
import { dutyRefSelect, toDutyRef } from './duty.mapper.js';
import { toUserRef } from './user.mapper.js';

/**
 * Time logging (Department Duties). Each person logs minutes against the duties
 * they hold, per calendar day, and marks each day Completed. Dates are plain
 * calendar dates (Postgres DATE) — the person's own day, never shifted through
 * a time zone. Future days are locked; a Completed day is read-only until its
 * owner reopens it. Supervisors read their team's days (Phase 13 hierarchy);
 * Admins read everyone's.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Longest range one read may cover (a month grid spans six weeks). */
const MAX_RANGE_DAYS = 62;
const RELATED_TASKS_MAX = 500;

export const toDbDate = (d: CalendarDateString): Date => new Date(`${d}T00:00:00.000Z`);
export const fromDbDate = (d: Date): CalendarDateString => d.toISOString().slice(0, 10);

/**
 * The latest calendar date it is anywhere on Earth (UTC+14). Staff work in
 * several countries and the server can't know a person's zone, so "not in the
 * future" is judged against the furthest-ahead zone: nobody is ever locked out
 * of their own today, and nobody can log a day that hasn't begun anywhere.
 */
function latestToday(now = new Date()): CalendarDateString {
  return fromDbDate(new Date(now.getTime() + 14 * 60 * 60 * 1000));
}

function assertNotFuture(date: CalendarDateString): void {
  if (date > latestToday()) throw HttpError.badRequest("You can't log time on a future day");
}

function assertRange(from: CalendarDateString, to: CalendarDateString): void {
  if (from > to) throw HttpError.badRequest('`from` must be on or before `to`');
  if ((toDbDate(to).getTime() - toDbDate(from).getTime()) / DAY_MS + 1 > MAX_RANGE_DAYS) {
    throw HttpError.badRequest(`A range can cover at most ${MAX_RANGE_DAYS} days`);
  }
}

/** Self, an Admin, or anyone above `userId` in the org chart. */
async function assertCanViewTimeOf(actor: Actor, userId: string): Promise<void> {
  if (actor.id === userId || actor.role === 'Admin') return;
  if (actor.role === 'Manager' && (await getDownlineIds(actor.id)).includes(userId)) return;
  throw HttpError.forbidden('You can only see the time of people who report to you');
}

// --- Reading days ------------------------------------------------------------

async function loadDays(
  userIds: string[],
  from: CalendarDateString,
  to: CalendarDateString,
): Promise<TimeDayDto[]> {
  const range = { gte: toDbDate(from), lte: toDbDate(to) };
  const [days, entries] = await Promise.all([
    prisma.timeDay.findMany({ where: { userId: { in: userIds }, date: range } }),
    prisma.timeEntry.findMany({
      where: { userId: { in: userIds }, date: range },
      select: { userId: true, date: true, dutyId: true, minutes: true },
    }),
  ]);
  const out = new Map<string, TimeDayDto>();
  const get = (userId: string, date: Date): TimeDayDto => {
    const key = `${userId}|${fromDbDate(date)}`;
    let d = out.get(key);
    if (!d) {
      d = {
        userId,
        date: fromDbDate(date),
        entries: [],
        completed: false,
        completedAt: null,
        note: null,
        updatedAt: null,
      };
      out.set(key, d);
    }
    return d;
  };
  for (const d of days) {
    const dto = get(d.userId, d.date);
    dto.completed = d.completedAt !== null;
    dto.completedAt = d.completedAt?.toISOString() ?? null;
    dto.note = d.note;
    dto.updatedAt = d.updatedAt.toISOString();
  }
  for (const e of entries)
    get(e.userId, e.date).entries.push({ dutyId: e.dutyId, minutes: e.minutes });
  return [...out.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.userId.localeCompare(b.userId),
  );
}

/** One person's days in [from, to] (only days that have anything on them). */
export async function listDays(
  actor: Actor,
  userId: string,
  from: CalendarDateString,
  to: CalendarDateString,
): Promise<TimeDayDto[]> {
  assertRange(from, to);
  await assertCanViewTimeOf(actor, userId);
  return loadDays([userId], from, to);
}

async function getDay(userId: string, date: CalendarDateString): Promise<TimeDayDto> {
  const [day] = await loadDays([userId], date, date);
  return (
    day ?? {
      userId,
      date,
      entries: [],
      completed: false,
      completedAt: null,
      note: null,
      updatedAt: null,
    }
  );
}

// --- Writing days ------------------------------------------------------------

/**
 * Replace the caller's own entries (and note) for one day. Only duties the
 * person currently holds (and that aren't archived) can be logged. An entry on a
 * duty they no longer hold may be lowered or cleared, never raised. The day
 * total is capped at 24h, and a Completed day must be reopened first.
 */
export async function saveDay(
  actor: Actor,
  date: CalendarDateString,
  input: SaveTimeDayInput,
): Promise<TimeDayDto> {
  const userId = actor.id;
  assertNotFuture(date);
  const dbDate = toDbDate(date);

  const [existingDay, existingEntries, held] = await Promise.all([
    prisma.timeDay.findUnique({ where: { userId_date: { userId, date: dbDate } } }),
    prisma.timeEntry.findMany({ where: { userId, date: dbDate } }),
    prisma.userDuty.findMany({
      where: { userId, duty: { archivedAt: null, department: { archivedAt: null } } },
      select: { dutyId: true },
    }),
  ]);

  // Optimistic concurrency: the day changed in another tab since it was opened.
  if (input.expectedUpdatedAt !== undefined) {
    const current = existingDay?.updatedAt.toISOString() ?? null;
    const expected = input.expectedUpdatedAt
      ? new Date(input.expectedUpdatedAt).toISOString()
      : null;
    if (current !== expected) {
      throw new HttpError(409, 'This day was changed somewhere else. Reload it and try again.', {
        code: STALE_WRITE_CODE,
      });
    }
  }
  if (existingDay?.completedAt) {
    throw HttpError.conflict('This day is marked completed. Reopen it to make changes.');
  }

  const heldIds = new Set(held.map((h) => h.dutyId));
  const before = new Map(existingEntries.map((e) => [e.dutyId, e.minutes]));
  const seen = new Set<string>();
  const entries = input.entries.filter((e) => e.minutes > 0);
  for (const e of input.entries) {
    if (seen.has(e.dutyId)) throw HttpError.badRequest('Each duty can appear only once per day');
    seen.add(e.dutyId);
  }
  for (const e of entries) {
    if (heldIds.has(e.dutyId)) continue;
    const prior = before.get(e.dutyId);
    if (prior === undefined) {
      throw HttpError.badRequest('You can only log time on duties you currently hold');
    }
    if (e.minutes > prior) {
      const duty = await prisma.duty.findUnique({ where: { id: e.dutyId }, ...dutyRefSelect });
      const what = duty ? dutyLabel(toDutyRef(duty)) : 'that duty';
      throw HttpError.badRequest(
        `You no longer hold ${what}: you can lower or clear that entry, not add to it`,
      );
    }
  }
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  if (total > TIME_DAY_MAX_MINUTES) throw HttpError.badRequest('A day can hold at most 24 hours');

  const note = input.note !== undefined ? input.note : (existingDay?.note ?? null);
  const completedAt = input.completed ? new Date() : null;
  const keepDay = entries.length > 0 || !!note || completedAt !== null;

  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.deleteMany({
      where: { userId, date: dbDate, dutyId: { notIn: entries.map((e) => e.dutyId) } },
    });
    for (const e of entries) {
      await tx.timeEntry.upsert({
        where: { userId_date_dutyId: { userId, date: dbDate, dutyId: e.dutyId } },
        create: { userId, date: dbDate, dutyId: e.dutyId, minutes: e.minutes },
        update: { minutes: e.minutes },
      });
    }
    if (keepDay) {
      await tx.timeDay.upsert({
        where: { userId_date: { userId, date: dbDate } },
        create: { userId, date: dbDate, note, completedAt },
        update: { note, completedAt },
      });
    } else if (existingDay) {
      await tx.timeDay.delete({ where: { userId_date: { userId, date: dbDate } } });
    }
  });
  return getDay(userId, date);
}

/**
 * Mark the caller's own day Completed, or reopen it. Completed is a status flag
 * on the day, separate from how much was logged (an empty weekday off can be
 * completed). Reopening is the only way to edit a completed day again.
 */
export async function setDayCompleted(
  actor: Actor,
  date: CalendarDateString,
  completed: boolean,
): Promise<TimeDayDto> {
  const userId = actor.id;
  assertNotFuture(date);
  const dbDate = toDbDate(date);
  const existing = await prisma.timeDay.findUnique({
    where: { userId_date: { userId, date: dbDate } },
  });
  if (completed) {
    if (!existing?.completedAt) {
      await prisma.timeDay.upsert({
        where: { userId_date: { userId, date: dbDate } },
        create: { userId, date: dbDate, completedAt: new Date() },
        update: { completedAt: new Date() },
      });
    }
  } else if (existing?.completedAt) {
    const entryCount = await prisma.timeEntry.count({ where: { userId, date: dbDate } });
    if (entryCount === 0 && !existing.note) {
      await prisma.timeDay.delete({ where: { userId_date: { userId, date: dbDate } } });
    } else {
      await prisma.timeDay.update({
        where: { userId_date: { userId, date: dbDate } },
        data: { completedAt: null },
      });
    }
  }
  return getDay(userId, date);
}

// --- Time Review ---------------------------------------------------------------

const personSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  title: true,
  supervisorId: true,
} as const;

function toPerson(u: Prisma.UserGetPayload<{ select: typeof personSelect }>): TimeReviewPersonDto {
  return { ...toUserRef(u), supervisorId: u.supervisorId };
}

/** Who the viewer may review: everyone below them (Admins: everyone else). */
export async function getReviewPeople(actor: Actor): Promise<TimeReviewPeopleDto> {
  const isAdmin = actor.role === 'Admin';
  const me = await prisma.user.findUnique({ where: { id: actor.id }, select: personSelect });
  if (!me) throw HttpError.unauthorized();
  const teamIds = isAdmin ? null : await getDownlineIds(actor.id);
  const team = await prisma.user.findMany({
    where: { isActive: true, id: teamIds ? { in: teamIds } : { not: actor.id } },
    select: personSelect,
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }],
  });
  return {
    me: toPerson(me),
    team: team.map(toPerson),
    directIds: team.filter((u) => u.supervisorId === actor.id).map((u) => u.id),
    isAdmin,
  };
}

async function resolveScope(actor: Actor, scope: TimeReviewInput['scope']): Promise<string[]> {
  const isAdmin = actor.role === 'Admin';
  const below = async (): Promise<string[]> =>
    (
      await prisma.user.findMany({
        where: { isActive: true, id: { in: await getDownlineIds(actor.id) } },
        select: { id: true },
      })
    ).map((u) => u.id);
  switch (scope) {
    case 'team':
      return below();
    case 'withme':
      return [actor.id, ...(await below())];
    case 'direct':
      return (
        await prisma.user.findMany({
          where: { isActive: true, supervisorId: actor.id },
          select: { id: true },
        })
      ).map((u) => u.id);
    case 'all':
      if (!isAdmin) throw HttpError.forbidden('Only an admin can review everyone');
      return (await prisma.user.findMany({ where: { isActive: true }, select: { id: true } })).map(
        (u) => u.id,
      );
    default: {
      const userId = scope.slice('user:'.length);
      await assertCanViewTimeOf(actor, userId);
      return [userId];
    }
  }
}

/**
 * Tasks with a duty, assigned to these people, whose start–due range falls
 * inside or across [from, to] (no start = open-ended back, no due = open-ended
 * forward). Access-scoped: a task the viewer can't see never appears. The range
 * is widened by the spread of world time zones so a task due late on the last
 * day (in anyone's zone) isn't dropped.
 */
async function relatedTasks(
  actor: Actor,
  userIds: string[],
  from: CalendarDateString,
  to: CalendarDateString,
  departmentId?: string | null,
  dutyId?: string | null,
): Promise<RelatedTaskDto[]> {
  if (userIds.length === 0) return [];
  const start = new Date(toDbDate(from).getTime() - 14 * 60 * 60 * 1000);
  const end = new Date(toDbDate(to).getTime() + DAY_MS + 12 * 60 * 60 * 1000);
  const scope = await getTaskAccessScope(actor);
  const access = buildTaskAccessWhere(scope, true);
  const where: Prisma.TaskWhereInput = {
    AND: [
      { dutyId: dutyId ?? { not: null }, assigneeId: { in: userIds } },
      ...(departmentId ? [{ duty: { departmentId } }] : []),
      { OR: [{ startAt: null }, { startAt: { lte: end } }] },
      { OR: [{ dueAt: null }, { dueAt: { gte: start } }] },
      ...(access ? [access] : []),
    ],
  };
  const rows = await prisma.task.findMany({
    where,
    select: {
      id: true,
      name: true,
      status: true,
      startAt: true,
      dueAt: true,
      assignee: { select: { id: true, email: true, firstName: true, lastName: true, title: true } },
      duty: dutyRefSelect,
    },
    orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    take: RELATED_TASKS_MAX,
  });
  return rows
    .filter((t) => t.assignee && t.duty)
    .map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      assignee: toUserRef(t.assignee!),
      duty: toDutyRef(t.duty!),
      startAt: t.startAt?.toISOString() ?? null,
      dueAt: t.dueAt?.toISOString() ?? null,
    }));
}

/** Related tasks for one person's day editor / read-only day view. */
export async function listRelatedTasks(
  actor: Actor,
  userId: string,
  from: CalendarDateString,
  to: CalendarDateString,
): Promise<RelatedTaskDto[]> {
  assertRange(from, to);
  await assertCanViewTimeOf(actor, userId);
  return relatedTasks(actor, [userId], from, to);
}

/**
 * Time Review for supervisors: every logged amount for the people in scope over
 * the period (narrowed by department/duty), per-day totals and Completed flags,
 * and the related tasks. The grid's pivots (Person › Dept › Duty etc.) are built
 * client-side from `records`.
 */
export async function getTimeReview(actor: Actor, input: TimeReviewInput): Promise<TimeReviewDto> {
  if (actor.role !== 'Admin' && actor.role !== 'Manager') {
    throw HttpError.forbidden('Only an admin or manager can review time');
  }
  const { from, to } = input;
  assertRange(from, to);
  const ids = await resolveScope(actor, input.scope);
  const range = { gte: toDbDate(from), lte: toDbDate(to) };

  const [people, entries, days] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: personSelect,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }],
    }),
    prisma.timeEntry.findMany({
      where: { userId: { in: ids }, date: range },
      select: {
        userId: true,
        date: true,
        dutyId: true,
        minutes: true,
        duty: { select: { departmentId: true } },
      },
    }),
    prisma.timeDay.findMany({
      where: { userId: { in: ids }, date: range },
      select: { userId: true, date: true, completedAt: true },
    }),
  ]);

  const dayMap = new Map<
    string,
    { userId: string; date: string; minutes: number; completed: boolean }
  >();
  const dayOf = (userId: string, date: Date) => {
    const key = `${userId}|${fromDbDate(date)}`;
    let d = dayMap.get(key);
    if (!d) {
      d = { userId, date: fromDbDate(date), minutes: 0, completed: false };
      dayMap.set(key, d);
    }
    return d;
  };
  for (const d of days) dayOf(d.userId, d.date).completed = d.completedAt !== null;
  for (const e of entries) dayOf(e.userId, e.date).minutes += e.minutes;

  const records = entries
    .filter(
      (e) =>
        (!input.departmentId || e.duty.departmentId === input.departmentId) &&
        (!input.dutyId || e.dutyId === input.dutyId),
    )
    .map((e) => ({
      userId: e.userId,
      date: fromDbDate(e.date),
      dutyId: e.dutyId,
      minutes: e.minutes,
    }));

  const related = await relatedTasks(actor, ids, from, to, input.departmentId, input.dutyId);

  const dutyIds = new Set<string>([
    ...records.map((r) => r.dutyId),
    ...related.map((t) => t.duty.id),
  ]);
  const dutyRows = dutyIds.size
    ? await prisma.duty.findMany({ where: { id: { in: [...dutyIds] } }, ...dutyRefSelect })
    : [];
  const duties: DutyRef[] = dutyRows.map(toDutyRef);

  return {
    from,
    to,
    people: people.map(toPerson),
    records,
    days: [...dayMap.values()],
    duties,
    relatedTasks: related,
  };
}
