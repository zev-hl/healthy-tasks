import type { Prisma } from '@prisma/client';
import {
  EVENT_KIND_LABELS,
  EVENT_MAX_DAYS,
  type CalendarDto,
  type CalendarScope,
  type EventDto,
  type EventKind,
  type EventNoticeType,
  type SaveEventRequest,
  type ScheduleCallRequest,
  type ScheduleCallResultDto,
} from '@healthy-tasks/shared';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { queueEmail } from '../queue/email-queue.js';
import { HttpError } from '../utils/http-error.js';
import { STALE_WRITE_CODE } from '../utils/optimistic.js';
import { eventEmail } from '../utils/notification-emails.js';
import { formatBusinessTimestamp } from '../utils/business-time.js';
import { userDisplayName } from '../utils/user-name.js';
import { computeTaskAccess, getDownlineIds, type Actor } from './access-control.service.js';
import { getPreferencesMap, wants } from './notification-preference.service.js';
import { pushTo } from './push.service.js';
import {
  bookConnectCall,
  cancelConnectCall,
  connectAvailable,
  ConnectError,
  moveConnectCall,
  ringConnectCall,
} from './connect.service.js';
import { notifyByConnect } from './connect-notify.service.js';
import { myTeamIds } from './task-search.service.js';
import { invalidateUnread } from './unread-cache.js';
import { toUserRef } from './user.mapper.js';

/**
 * Events on the calendar (Nov 2026 plan, H4a): a meeting, a call, a deadline or
 * anything else, with a time or whole days, attendees, a place or link, an
 * optional linked task and notes. Everyone signed in sees an event, as with
 * tasks, unless it is private: then its creator, its attendees and Admins.
 * Its creator or an Admin changes or cancels it. Attendees are told when they
 * are added, when it moves, and when it is canceled (the `event` setting).
 */

const DAY_MS = 86_400_000;
/** Longest stretch the calendar reads at once (a month grid spans six weeks). */
const MAX_RANGE_DAYS = 62;

const userSelect = { id: true, email: true, firstName: true, lastName: true, title: true } as const;
const CALL_HOURS_AHEAD_MAX = 24 * 365;
const eventInclude = {
  task: { select: { id: true, name: true, deletedAt: true } },
  createdBy: { select: userSelect },
  attendees: { select: { user: { select: userSelect } } },
} satisfies Prisma.EventInclude;
type EventRow = Prisma.EventGetPayload<{ include: typeof eventInclude }>;

const canEditEvent = (actor: Actor, e: { createdById: string }) =>
  actor.role === 'Admin' || e.createdById === actor.id;

function canSeeEvent(actor: Actor, e: EventRow): boolean {
  return (
    !e.isPrivate ||
    actor.role === 'Admin' ||
    e.createdById === actor.id ||
    e.attendees.some((a) => a.user.id === actor.id)
  );
}

/** The events the reader may see, as a where clause. */
function visibleWhere(actor: Actor): Prisma.EventWhereInput {
  if (actor.role === 'Admin') return {};
  return {
    OR: [
      { isPrivate: false },
      { createdById: actor.id },
      { attendees: { some: { userId: actor.id } } },
    ],
  };
}

export function toEventDto(e: EventRow, actor: Actor): EventDto {
  return {
    id: e.id,
    kind: e.kind as EventKind,
    title: e.title,
    startAt: e.startAt.toISOString(),
    endAt: e.endAt.toISOString(),
    allDay: e.allDay,
    location: e.location,
    notes: e.notes,
    isPrivate: e.isPrivate,
    task: e.task && !e.task.deletedAt ? { id: e.task.id, name: e.task.name } : null,
    createdBy: toUserRef(e.createdBy),
    attendees: e.attendees
      .map((a) => toUserRef(a.user))
      .sort((a, b) => (a.firstName ?? a.email).localeCompare(b.firstName ?? b.email)),
    canEdit: canEditEvent(actor, e),
    updatedAt: e.updatedAt.toISOString(),
    connect:
      e.connectCallKind === 'convene' || e.connectCallKind === 'ring'
        ? { kind: e.connectCallKind, joinUrl: e.connectJoinUrl }
        : null,
  };
}

function parseRange(from: string, to: string): { from: Date; to: Date } {
  const f = new Date(from);
  const t = new Date(to);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) {
    throw HttpError.badRequest('`from` and `to` must be dates');
  }
  if (t < f) throw HttpError.badRequest('`to` must be after `from`');
  if (t.getTime() - f.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw HttpError.badRequest(`A range can cover at most ${MAX_RANGE_DAYS} days`);
  }
  return { from: f, to: t };
}

/**
 * The people "Team" covers: you, your department colleagues, and everyone
 * below you; for an Admin, everyone (null).
 */
async function teamIds(actor: Actor): Promise<string[] | null> {
  if (actor.role === 'Admin') return null;
  const [team, below] = await Promise.all([
    myTeamIds(actor),
    actor.role === 'Member' ? Promise.resolve([]) : getDownlineIds(actor.id),
  ]);
  return [...new Set([actor.id, ...team, ...below])];
}

/**
 * GET /api/calendar — the reader's events and reminders between two moments.
 * Me: events they made or are in, and their reminders. Team: the events of
 * everyone on their team (that they may see), and still only their own
 * reminders (reminders are private).
 */
export async function getCalendar(
  actor: Actor,
  input: { from: string; to: string; scope: CalendarScope },
): Promise<CalendarDto> {
  const { from, to } = parseRange(input.from, input.to);
  const ids = input.scope === 'team' ? await teamIds(actor) : [actor.id];
  const whose: Prisma.EventWhereInput = ids
    ? {
        OR: [{ createdById: { in: ids } }, { attendees: { some: { userId: { in: ids } } } }],
      }
    : {};
  const [events, reminders] = await Promise.all([
    prisma.event.findMany({
      where: {
        AND: [
          visibleWhere(actor),
          { canceledAt: null, startAt: { lte: to }, endAt: { gte: from } },
          whose,
        ],
      },
      include: eventInclude,
      orderBy: { startAt: 'asc' },
      take: 1000,
    }),
    prisma.reminder.findMany({
      where: {
        userId: actor.id,
        remindAt: { gte: from, lte: to },
        task: { deletedAt: null },
      },
      select: {
        id: true,
        taskId: true,
        remindAt: true,
        note: true,
        kind: true,
        task: { select: { name: true } },
      },
      orderBy: { remindAt: 'asc' },
      take: 1000,
    }),
  ]);
  return {
    events: events.map((e) => toEventDto(e, actor)),
    reminders: reminders.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      taskName: r.task.name,
      remindAt: r.remindAt.toISOString(),
      note: r.note,
      kind: r.kind === 'snooze' ? 'snooze' : 'reminder',
    })),
  };
}

async function loadEvent(actor: Actor, id: string): Promise<EventRow> {
  const e = await prisma.event.findUnique({ where: { id }, include: eventInclude });
  if (!e || e.canceledAt || !canSeeEvent(actor, e)) throw HttpError.notFound('Event not found');
  return e;
}

/** GET /api/events/:id */
export async function getEvent(actor: Actor, id: string): Promise<EventDto> {
  return toEventDto(await loadEvent(actor, id), actor);
}

/** GET /api/tasks/:id/events — the coming events linked to a task. */
export async function listTaskEvents(actor: Actor, taskId: number): Promise<EventDto[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, assigneeId: true, isPrivate: true },
  });
  if (!task || !(await computeTaskAccess(actor, task))) throw HttpError.notFound('Task not found');
  const rows = await prisma.event.findMany({
    where: {
      AND: [
        visibleWhere(actor),
        { taskId, canceledAt: null, endAt: { gte: new Date(Date.now() - DAY_MS) } },
      ],
    },
    include: eventInclude,
    orderBy: { startAt: 'asc' },
    take: 50,
  });
  return rows.map((e) => toEventDto(e, actor));
}

/** Checks the input and works out its attendees; throws a plain reason. */
async function checkInput(actor: Actor, input: SaveEventRequest) {
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  if (endAt < startAt) throw HttpError.badRequest('It must end after it starts');
  if (endAt.getTime() - startAt.getTime() > EVENT_MAX_DAYS * DAY_MS) {
    throw HttpError.badRequest(`An event can last at most ${EVENT_MAX_DAYS} days`);
  }
  if (input.taskId != null) {
    const task = await prisma.task.findUnique({
      where: { id: input.taskId },
      select: { id: true, assigneeId: true, isPrivate: true },
    });
    if (!task || !(await computeTaskAccess(actor, task))) {
      throw HttpError.badRequest('That task can’t be linked: you can’t open it');
    }
  }
  const wanted = [...new Set(input.attendeeIds ?? [])];
  const people = wanted.length
    ? await prisma.user.findMany({
        where: { id: { in: wanted }, isActive: true },
        select: { id: true },
      })
    : [];
  if (people.length !== wanted.length) {
    throw HttpError.badRequest('Some of those people can’t be added (not found or not active)');
  }
  return { startAt, endAt, attendeeIds: wanted };
}

function whenText(e: { startAt: Date; allDay: boolean }): string {
  if (!e.allDay) return formatBusinessTimestamp(e.startAt);
  return e.startAt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Tell people about an event, by their `event` setting: in the app (a notice
 * on the event), by push for those who turned it on, and by email.
 */
async function notifyEvent(
  type: EventNoticeType,
  event: { id: string; title: string; kind: string; startAt: Date; allDay: boolean },
  to: string[],
  actorId: string,
): Promise<void> {
  const ids = [...new Set(to)].filter((id) => id !== actorId);
  if (ids.length === 0) return;
  const [people, actor] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, email: true },
    }),
    prisma.user.findUnique({
      where: { id: actorId },
      select: { email: true, firstName: true, lastName: true },
    }),
  ]);
  if (people.length === 0) return;
  const who = actor ? userDisplayName(actor) : 'Someone';
  const kind = EVENT_KIND_LABELS[event.kind as EventKind]?.toLowerCase() ?? 'event';
  const what =
    type === 'eventInvited'
      ? `${who} added you to the ${kind} “${event.title}”, ${whenText(event)}`
      : type === 'eventChanged'
        ? `${who} changed the ${kind} “${event.title}”: now ${whenText(event)}`
        : `${who} canceled the ${kind} “${event.title}” (${whenText(event)})`;
  const link = `${env.frontendUrl}/calendar?event=${event.id}`;
  notifyByConnect({
    userIds: people.map((p) => p.id),
    event: 'event',
    what,
    link,
    key: `${type}:${event.id}:${Date.now()}`,
  });
  const prefs = await getPreferencesMap(people.map((p) => p.id));
  for (const p of people) {
    const pref = prefs.get(p.id)!;
    if (wants(pref, 'event', 'inApp')) {
      await prisma.notification.create({
        data: { userId: p.id, type, eventId: event.id, actorId, detail: what },
      });
      invalidateUnread(p.id);
      if (pref.pushOn) {
        await pushTo(p.id, { title: event.title, body: what, url: link }).catch((err) =>
          console.error('push failed', err),
        );
      }
    }
    if (wants(pref, 'event', 'email')) {
      await queueEmail(eventEmail({ to: p.email, subject: what, what, link }), {
        kind: 'event',
      }).catch((err) => console.error('event email failed', err));
    }
  }
}

/** POST /api/events */
export async function createEvent(actor: Actor, input: SaveEventRequest): Promise<EventDto> {
  const { startAt, endAt, attendeeIds } = await checkInput(actor, input);
  const e = await prisma.event.create({
    data: {
      kind: input.kind,
      title: input.title.trim(),
      startAt,
      endAt,
      allDay: input.allDay ?? false,
      location: input.location?.trim() || null,
      notes: input.notes?.trim() || null,
      isPrivate: input.isPrivate ?? false,
      taskId: input.taskId ?? null,
      createdById: actor.id,
      attendees: { create: attendeeIds.map((userId) => ({ userId })) },
    },
    include: eventInclude,
  });
  await notifyEvent('eventInvited', e, attendeeIds, actor.id);
  return toEventDto(e, actor);
}

/** PATCH /api/events/:id — the whole event, as the form holds it. */
export async function updateEvent(
  actor: Actor,
  id: string,
  input: SaveEventRequest,
): Promise<EventDto> {
  const before = await loadEvent(actor, id);
  if (!canEditEvent(actor, before)) {
    throw HttpError.forbidden('Only the person who made it, or an Admin, can change it');
  }
  if (
    input.expectedUpdatedAt &&
    new Date(input.expectedUpdatedAt).getTime() !== before.updatedAt.getTime()
  ) {
    throw new HttpError(409, 'This event was changed somewhere else. Reload it and try again.', {
      code: STALE_WRITE_CODE,
    });
  }
  const { startAt, endAt, attendeeIds } = await checkInput(actor, input);
  const had = new Set(before.attendees.map((a) => a.user.id));
  const added = attendeeIds.filter((u) => !had.has(u));
  const kept = attendeeIds.filter((u) => had.has(u));
  const removed = [...had].filter((u) => !attendeeIds.includes(u));
  const e = await prisma.event.update({
    where: { id },
    data: {
      kind: input.kind,
      title: input.title.trim(),
      startAt,
      endAt,
      allDay: input.allDay ?? false,
      location: input.location?.trim() || null,
      notes: input.notes?.trim() || null,
      isPrivate: input.isPrivate ?? false,
      taskId: input.taskId ?? null,
      attendees: {
        deleteMany: removed.length ? { userId: { in: removed } } : undefined,
        create: added.map((userId) => ({ userId })),
      },
    },
    include: eventInclude,
  });
  const moved =
    before.startAt.getTime() !== e.startAt.getTime() ||
    before.endAt.getTime() !== e.endAt.getTime() ||
    before.allDay !== e.allDay ||
    (before.location ?? '') !== (e.location ?? '');
  // K2: a booked Connect call follows the event's time, title and people.
  if (e.connectCallId && e.connectCallKind === 'convene' && e.startAt > new Date()) {
    const emails = e.attendees.map((a) => a.user.email);
    try {
      const call = await moveConnectCall(e.connectCallId, {
        title: e.title,
        ...(moved && { startAt: e.startAt, endAt: e.endAt }),
        ...((added.length > 0 || removed.length > 0) &&
          emails.length > 0 && { participants: emails }),
      });
      if (call.joinUrl !== e.connectJoinUrl) {
        await prisma.event.update({
          where: { id: e.id },
          data: { connectJoinUrl: call.joinUrl, location: call.joinUrl },
        });
        e.connectJoinUrl = call.joinUrl;
        e.location = call.joinUrl;
      }
    } catch (err) {
      console.error('Connect call not moved:', (err as Error).message);
    }
  }
  await notifyEvent('eventInvited', e, added, actor.id);
  if (moved) await notifyEvent('eventChanged', e, kept, actor.id);
  if (removed.length) await notifyEvent('eventCanceled', e, removed, actor.id);
  return toEventDto(e, actor);
}

/** DELETE /api/events/:id — cancels it; attendees are told. */
export async function cancelEvent(actor: Actor, id: string): Promise<void> {
  const e = await loadEvent(actor, id);
  if (!canEditEvent(actor, e)) {
    throw HttpError.forbidden('Only the person who made it, or an Admin, can cancel it');
  }
  await prisma.event.update({ where: { id }, data: { canceledAt: new Date() } });
  if (e.connectCallId && e.connectCallKind === 'convene') {
    await cancelConnectCall(e.connectCallId).catch((err) =>
      console.error('Connect call not canceled:', (err as Error).message),
    );
  }
  await notifyEvent(
    'eventCanceled',
    e,
    e.attendees.map((a) => a.user.id),
    actor.id,
  );
}

// --- "Schedule call" on a task (Stage 4, K2) -----------------------------------

/**
 * POST /api/tasks/:id/calls — a Connect call about a task, rung now or booked
 * for a time, hosted by the caller. It is saved first as a Call on the task
 * and the calendar; then Connect books it (or rings it). When Connect can't,
 * it stays saved, as a meeting, and the answer says why.
 */
export async function scheduleTaskCall(
  actor: Actor,
  taskId: number,
  input: ScheduleCallRequest,
): Promise<ScheduleCallResultDto> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, name: true, assigneeId: true, isPrivate: true },
  });
  if (!task || !(await computeTaskAccess(actor, task))) throw HttpError.notFound('Task not found');
  const now = new Date();
  const ringNow = input.when === 'now';
  const startAt = ringNow ? now : new Date(input.when);
  if (Number.isNaN(startAt.getTime())) throw HttpError.badRequest('Pick a time');
  if (!ringNow && startAt <= now) throw HttpError.badRequest('Pick a time that hasn’t passed');
  if (startAt.getTime() - now.getTime() > CALL_HOURS_AHEAD_MAX * 3_600_000) {
    throw HttpError.badRequest('A call can be booked at most a year ahead');
  }
  const others = [...new Set(input.participantIds)].filter((id) => id !== actor.id);
  if (others.length === 0) throw HttpError.badRequest('Pick at least one person to call');
  const title = input.title?.trim() || `Call: ${task.name}`;
  const endAt = new Date(startAt.getTime() + input.minutes * 60_000);

  const made = await createEvent(actor, {
    kind: 'call',
    title,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    taskId,
    attendeeIds: others,
  });

  const fallback = async (reason: string): Promise<ScheduleCallResultDto> => {
    // Still on the calendar, as a meeting: the people in it were told already.
    await prisma.event.update({ where: { id: made.id }, data: { kind: 'meeting' } });
    return { event: await getEvent(actor, made.id), booked: false, reason, skipped: [] };
  };
  if (!connectAvailable()) return fallback('Connect isn’t linked to HL Central yet');

  const people = await prisma.user.findMany({
    where: { id: { in: [actor.id, ...others] } },
    select: { id: true, email: true },
  });
  const host = people.find((p) => p.id === actor.id)!.email;
  const participants = people.filter((p) => p.id !== actor.id).map((p) => p.email);
  const externalRef = `hlcentral:event:${made.id}`;
  try {
    const call = ringNow
      ? await ringConnectCall({ host, participants, title, externalRef })
      : await bookConnectCall({
          title,
          startAt,
          endAt,
          host,
          participants,
          link: `${env.frontendUrl}/tasks/${taskId}`,
          externalRef,
        });
    await prisma.event.update({
      where: { id: made.id },
      data: {
        connectCallId: call.id,
        connectCallKind: ringNow ? 'ring' : 'convene',
        connectJoinUrl: call.joinUrl,
        location: call.joinUrl,
      },
    });
    return {
      event: await getEvent(actor, made.id),
      booked: true,
      reason: null,
      skipped: call.skipped ?? [],
    };
  } catch (err) {
    const why =
      err instanceof ConnectError
        ? err.status === 0
          ? err.message
          : `Connect said: ${err.message}`
        : 'Connect couldn’t book it';
    console.error('Connect call not booked:', why);
    return fallback(why);
  }
}
