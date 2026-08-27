import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { mailer } from '../utils/mailer.js';
import { env } from '../config/env.js';
import {
  addDays,
  addInterval,
  dueFixedSeqs,
  fixedAnchorForSeq,
  isWithinLeadTime,
  seqAllowed,
  upcomingFixedSeqs,
  type RecurrenceConfig,
} from './recurrence.js';
import { carryForwardAssignees, generateOccurrence } from './template-instantiation.service.js';
import { materializeDueTaskRecurrences } from './task-recurrence.service.js';
import { runGoalReviewPass } from './goal.service.js';
import { getMaterializeLeadDays } from './app-settings.service.js';
import { dispatchDueReminderEmails } from './notification.service.js';

/**
 * Recurrence scheduler (Phase 11; reworked in Phase 14).
 *
 * The timer is started from server.ts, NOT from createApp, so tests stay
 * deterministic and drive `runScheduler` directly.
 *
 * Phase 14 replaced the fixed 60s `setInterval` with TWO CLOCKS:
 *
 *  - A coarse ceiling (`SCHEDULER_MAX_SLEEP_MS`) that nothing can gate or
 *    invalidate. Every pass re-derives all state from the database, so it cannot
 *    drift. This is the correctness mechanism.
 *  - A fine clock (`computeNextWakeAt`) that wakes earlier when something is
 *    genuinely due sooner. It is recomputed from scratch every pass and NEVER
 *    incrementally maintained, so there is no cached value that can go stale, and
 *    it can only ever make work happen EARLIER than the ceiling would. If it
 *    computes wrong, behavior degrades to the coarse baseline, not to silence.
 *
 * The heartbeat also moved off Postgres: `lastTickAt` is module state rather than
 * a row written once a minute (which kept the Neon compute awake 24/7 and was
 * ~99.95% of the database bill). `SchedulerState.lastAlertAt` stays in the DB
 * because it is authoritative: it prevents duplicate outage emails across
 * restarts and instances. `SchedulerState.lastTickAt` is retained but UNUSED.
 */

// --- Tunables --------------------------------------------------------------

/** Never sleep less than this, however soon the next item claims to be due. */
export const SCHEDULER_MIN_SLEEP_MS = 60_000; // 1 minute
/** Never sleep longer than this. The backstop that bounds worst-case lateness. */
export const SCHEDULER_MAX_SLEEP_MS = 6 * 60 * 60 * 1000; // 6 hours
/** How far past its own scheduled wake the timer may drift before it is presumed down. */
export const SCHEDULER_OVERDUE_GRACE_MS = 5 * 60 * 1000; // 5 minutes
/** Minimum gap between admin alerts, so a prolonged problem doesn't spam. */
export const SCHEDULER_ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
/** Work found this late at the START of a pass means we woke too late. */
export const SCHEDULER_LATE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

const SCHEDULER_STATE_ID = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

// --- In-memory scheduler state (S1) ----------------------------------------
// Derived state, cheap to recompute, rebuilt at boot by the first pass. It is
// deliberately NOT persisted: surviving a restart would resurrect a belief formed
// before whatever caused the restart, and recomputing from the DB is correct.

let lastTickAt: Date | null = null;
let nextWakeAt: Date | null = null;
let timerArmed = false;
/** In-memory cooldown for late/invariant alerts (raised only by this process). */
let lastHealthAlertAt: Date | null = null;

export interface SchedulerStateSnapshot {
  lastTickAt: Date | null;
  nextWakeAt: Date | null;
  armed: boolean;
}

/** Read the in-memory heartbeat (diagnostics + tests). */
export function getSchedulerState(): SchedulerStateSnapshot {
  return { lastTickAt, nextWakeAt, armed: timerArmed };
}

/** Test seam: clear module state so each test starts from a cold scheduler. */
export function __resetSchedulerState(): void {
  lastTickAt = null;
  nextWakeAt = null;
  timerArmed = false;
  lastHealthAlertAt = null;
}

/** Test seam: pretend the background timer is armed without starting one. */
export function __setTimerArmed(armed: boolean): void {
  timerArmed = armed;
}

type TemplateForSchedule = {
  id: number;
  createdById: string;
  recurrenceType: RecurrenceConfig['recurrenceType'];
  intervalCount: number | null;
  intervalUnit: RecurrenceConfig['intervalUnit'];
  weekdays: number[];
  anchorDate: Date | null;
  endType: RecurrenceConfig['endType'];
  endDate: Date | null;
  maxOccurrences: number | null;
  labelPrefix: string | null;
  nodes: { startOffsetDays: number | null; dueOffsetDays: number | null }[];
};

/** Smallest start/due offset across a template's nodes (0 if none carry a date). */
function earliestOffset(nodes: { startOffsetDays: number | null; dueOffsetDays: number | null }[]): number {
  let min = Infinity;
  for (const n of nodes) {
    if (n.startOffsetDays != null) min = Math.min(min, n.startOffsetDays);
    if (n.dueOffsetDays != null) min = Math.min(min, n.dueOffsetDays);
  }
  return Number.isFinite(min) ? min : 0;
}

const scheduleSelect = {
  id: true,
  createdById: true,
  recurrenceType: true,
  intervalCount: true,
  intervalUnit: true,
  weekdays: true,
  anchorDate: true,
  endType: true,
  endDate: true,
  maxOccurrences: true,
  labelPrefix: true,
  // Offsets drive the occurrence's earliest date (the lead-window reference).
  nodes: { select: { startOffsetDays: true, dueOffsetDays: true } },
} as const;

function toConfig(t: TemplateForSchedule): RecurrenceConfig {
  return {
    recurrenceType: t.recurrenceType,
    intervalCount: t.intervalCount,
    intervalUnit: t.intervalUnit,
    weekdays: t.weekdays,
    anchorDate: t.anchorDate,
    endType: t.endType,
    endDate: t.endDate,
    maxOccurrences: t.maxOccurrences,
  };
}

type RecurrenceRowLike = {
  recurrenceType: RecurrenceConfig['recurrenceType'];
  intervalCount: number;
  intervalUnit: NonNullable<RecurrenceConfig['intervalUnit']>;
  weekdays: number[];
  anchorDate: Date;
  endType: RecurrenceConfig['endType'];
  endDate: Date | null;
  maxOccurrences: number | null;
};

function rowToConfig(r: RecurrenceRowLike): RecurrenceConfig {
  return {
    recurrenceType: r.recurrenceType,
    intervalCount: r.intervalCount,
    intervalUnit: r.intervalUnit,
    weekdays: r.weekdays,
    anchorDate: r.anchorDate,
    endType: r.endType,
    endDate: r.endDate,
    maxOccurrences: r.maxOccurrences,
  };
}

/** When an occurrence with this anchor becomes eligible to materialize. */
function eligibleAt(anchor: Date, offsetDays: number, leadDays: number): number {
  return addDays(anchor, offsetDays).getTime() - leadDays * DAY_MS;
}

/**
 * Materialize one scheduled occurrence. The TemplateOccurrence unique index on
 * (templateId, seq) IS the claim: a concurrent tick that races us hits P2002 and
 * we skip, so an occurrence is never double-generated. Returns 1 if generated.
 */
async function fireOccurrence(t: TemplateForSchedule, seq: number, anchor: Date): Promise<number> {
  const assigneeByNodeId = await carryForwardAssignees(t.id);
  const label = t.labelPrefix ? `${t.labelPrefix}-${seq}` : null;
  try {
    await generateOccurrence({
      templateId: t.id,
      seq,
      origin: 'scheduled',
      instanceLabel: label,
      anchorStart: anchor,
      assigneeByNodeId,
      // No acting user for an automatic fire: attribute to the template author.
      creatorId: t.createdById,
      actorId: t.createdById,
    });
    return 1;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return 0; // already claimed by a concurrent tick
    }
    throw err;
  }
}

async function firedSeqSet(templateId: number): Promise<Set<number>> {
  const rows = await prisma.templateOccurrence.findMany({
    where: { templateId, seq: { not: null } },
    select: { seq: true },
  });
  return new Set(rows.map((r) => r.seq as number));
}

/**
 * The anchor of the next RelativeToCompletion occurrence for a template, or null
 * when the series is not currently waiting on a clock (no series start, or the
 * prior root is not Completed so the trigger is a status change, not a time).
 */
async function relativeNextAnchor(
  t: TemplateForSchedule,
  cfg: RecurrenceConfig,
  now: Date,
): Promise<{ seq: number; anchor: Date } | null> {
  const latest = await prisma.templateOccurrence.findFirst({
    where: { templateId: t.id, seq: { not: null } },
    orderBy: { seq: 'desc' },
    include: { rootTask: { select: { status: true, statusChangedAt: true } } },
  });

  if (!latest) {
    // First occurrence: anchored at the series start.
    if (!cfg.anchorDate) return null;
    return seqAllowed(cfg, 1, cfg.anchorDate) ? { seq: 1, anchor: cfg.anchorDate } : null;
  }
  // Subsequent occurrence: only once the prior root is Completed.
  if (
    !latest.rootTask ||
    latest.rootTask.status !== 'Completed' ||
    !cfg.intervalUnit ||
    !cfg.intervalCount
  ) {
    return null;
  }
  const completedAt = latest.rootTask.statusChangedAt ?? now;
  const nextSeq = (latest.seq as number) + 1;
  const nextAnchor = addInterval(completedAt, cfg.intervalUnit, cfg.intervalCount);
  return seqAllowed(cfg, nextSeq, nextAnchor) ? { seq: nextSeq, anchor: nextAnchor } : null;
}

/** Materialize any due occurrences for one template; returns how many fired.
 * `leadDays` is the single global materialization lead time (AppSetting). */
async function materializeDueForTemplate(
  t: TemplateForSchedule,
  now: Date,
  leadDays: number,
): Promise<number> {
  const cfg = toConfig(t);
  let count = 0;

  if (cfg.recurrenceType === 'Fixed') {
    const fired = await firedSeqSet(t.id);
    const offset = earliestOffset(t.nodes);
    for (const seq of dueFixedSeqs(cfg, fired, now, leadDays, offset)) {
      count += await fireOccurrence(t, seq, fixedAnchorForSeq(cfg, seq));
    }
    return count;
  }

  if (cfg.recurrenceType === 'RelativeToCompletion') {
    // Only one occurrence is ever "pending" at a time: the next is scheduled
    // strictly AFTER the prior instance's root task is Completed.
    const next = await relativeNextAnchor(t, cfg, now);
    if (!next) return 0;
    if (isWithinLeadTime(next.anchor, leadDays, now)) {
      count += await fireOccurrence(t, next.seq, next.anchor);
    }
    return count;
  }

  return 0;
}

// --- Overdue measurement (S4b, layers 2 and 3) -----------------------------

export interface OverdueMeasurement {
  /** How many items are eligible to have run but have not. */
  count: number;
  /** The worst lateness across those items, in ms (0 when count is 0). */
  maxLateMs: number;
}

/**
 * Everything that SHOULD have been materialized or reviewed by `now` and has
 * not been, with how late it is.
 *
 * This is the anti-silent-failure primitive. Run BEFORE a pass it measures how
 * late we woke; run AFTER a pass it must be zero BY CONSTRUCTION, because it
 * evaluates exactly the same predicates the pass just acted on. A non-zero
 * reading afterwards means the pass is broken, whatever the cause - including the
 * per-item `catch` blocks that would otherwise swallow failures into
 * console.error, unread, forever.
 *
 * Reminder email dispatch is deliberately NOT counted: whether a reminder should
 * be emailed depends on per-user notification preferences, so there is no clean
 * invariant; and the dispatch path stamps `emailSentAt` before sending, so it
 * cannot get stuck.
 */
export async function measureOverdue(now: Date, leadDays: number): Promise<OverdueMeasurement> {
  const late: number[] = [];
  const t = now.getTime();

  // Templates.
  const templates = await prisma.taskTemplate.findMany({
    where: { isActive: true, recurrenceType: { in: ['Fixed', 'RelativeToCompletion'] } },
    select: scheduleSelect,
  });
  for (const tpl of templates) {
    const cfg = toConfig(tpl);
    if (cfg.recurrenceType === 'Fixed') {
      const fired = await firedSeqSet(tpl.id);
      const offset = earliestOffset(tpl.nodes);
      for (const seq of dueFixedSeqs(cfg, fired, now, leadDays, offset)) {
        late.push(t - eligibleAt(fixedAnchorForSeq(cfg, seq), offset, leadDays));
      }
    } else {
      const next = await relativeNextAnchor(tpl, cfg, now);
      if (next && isWithinLeadTime(next.anchor, leadDays, now)) {
        late.push(t - eligibleAt(next.anchor, 0, leadDays));
      }
    }
  }

  // Task-level recurrence. Mirrors materializeDueForSource's predicates.
  const sources = await prisma.task.findMany({
    where: { recurrence: { isActive: true, recurrenceType: { in: ['Fixed', 'RelativeToCompletion'] } } },
    select: {
      id: true,
      status: true,
      statusChangedAt: true,
      recurrence: true,
      recurrenceOccurrences: { select: { recurrenceSeq: true } },
    },
  });
  for (const s of sources) {
    if (!s.recurrence) continue;
    const cfg = rowToConfig(s.recurrence);
    if (cfg.recurrenceType === 'Fixed') {
      const fired = new Set<number>([1, ...s.recurrenceOccurrences.map((o) => o.recurrenceSeq ?? 0)]);
      for (const seq of dueFixedSeqs(cfg, fired, now, leadDays)) {
        late.push(t - eligibleAt(fixedAnchorForSeq(cfg, seq), 0, leadDays));
      }
    } else {
      const latestOcc = await prisma.task.findFirst({
        where: { recurrenceSourceId: s.id },
        orderBy: { recurrenceSeq: 'desc' },
        select: { recurrenceSeq: true, status: true, statusChangedAt: true },
      });
      const latest = latestOcc ?? {
        recurrenceSeq: 1,
        status: s.status,
        statusChangedAt: s.statusChangedAt,
      };
      if (latest.status !== 'Completed' || !cfg.intervalUnit || !cfg.intervalCount) continue;
      const nextSeq = (latest.recurrenceSeq ?? 1) + 1;
      const nextAnchor = addInterval(latest.statusChangedAt ?? now, cfg.intervalUnit, cfg.intervalCount);
      if (seqAllowed(cfg, nextSeq, nextAnchor) && isWithinLeadTime(nextAnchor, leadDays, now)) {
        late.push(t - eligibleAt(nextAnchor, 0, leadDays));
      }
    }
  }

  // Goals past their deadline that are still Approved.
  const goals = await prisma.goal.findMany({
    where: { status: 'Approved', deadline: { lte: now } },
    select: { deadline: true },
  });
  for (const g of goals) late.push(t - g.deadline.getTime());

  return { count: late.length, maxLateMs: late.length ? Math.max(...late) : 0 };
}

// --- Next-wake derivation (S4, the fine clock) -----------------------------

/**
 * The earliest moment a reminder email becomes due, or null if none pending.
 *
 * Computed in JS rather than SQL on purpose. A reminder's due time is DERIVED
 * (`startAt - leadMinutes`; there is no stored column), and comparing a derived
 * `timestamp` against a bound parameter inside SQL is timezone-fragile: the
 * column is naive `timestamp` while the parameter binds as `timestamptz`, so
 * Postgres reconciles them through the session timezone and silently shifts the
 * comparison by the UTC offset. The candidate set here is small by construction -
 * only reminders that have not been emailed yet.
 *
 * Snoozing is not considered: `emailSentAt` is stamped on first dispatch, so a
 * reminder that can still be emailed has never been snoozed past a send.
 */
async function nextReminderDueAt(): Promise<Date | null> {
  const rows = await prisma.reminder.findMany({
    where: { canceledAt: null, emailSentAt: null, task: { startAt: { not: null } } },
    select: { leadMinutes: true, task: { select: { startAt: true } } },
  });
  let min: number | null = null;
  for (const r of rows) {
    if (!r.task.startAt) continue;
    const due = r.task.startAt.getTime() - r.leadMinutes * 60_000;
    if (min === null || due < min) min = due;
  }
  return min === null ? null : new Date(min);
}

/**
 * When the scheduler should next wake, derived FROM SCRATCH against the database.
 * Clamped to [MIN_SLEEP, MAX_SLEEP] from `now`.
 *
 * Only moments strictly in the future are candidates: anything already due is
 * handled by the pass that calls this, and would otherwise pin the timer to its
 * floor forever.
 */
export async function computeNextWakeAt(now: Date): Promise<Date> {
  const t = now.getTime();
  const candidates: number[] = [];
  const consider = (ms: number | null | undefined): void => {
    if (ms != null && ms > t) candidates.push(ms);
  };

  const leadDays = await getMaterializeLeadDays();

  // Reminder emails.
  const reminder = await nextReminderDueAt();
  consider(reminder?.getTime());

  // Goal review: the next Approved goal to pass its deadline.
  const goal = await prisma.goal.findFirst({
    where: { status: 'Approved', deadline: { gt: now } },
    orderBy: { deadline: 'asc' },
    select: { deadline: true },
  });
  consider(goal?.deadline.getTime());

  // Templates.
  const templates = await prisma.taskTemplate.findMany({
    where: { isActive: true, recurrenceType: { in: ['Fixed', 'RelativeToCompletion'] } },
    select: scheduleSelect,
  });
  for (const tpl of templates) {
    const cfg = toConfig(tpl);
    if (cfg.recurrenceType === 'Fixed') {
      const fired = await firedSeqSet(tpl.id);
      const offset = earliestOffset(tpl.nodes);
      for (const { anchor } of upcomingFixedSeqs(cfg, fired)) {
        const at = eligibleAt(anchor, offset, leadDays);
        if (at > t) {
          consider(at);
          break; // ascending, so the first future one is this template's soonest
        }
      }
    } else {
      // RelativeToCompletion only has a clock once the prior root is Completed;
      // otherwise its trigger is a status change and the ceiling covers it.
      const next = await relativeNextAnchor(tpl, cfg, now);
      if (next) consider(eligibleAt(next.anchor, 0, leadDays));
    }
  }

  // Task-level recurrence (Fixed only; relative series wake on completion).
  const sources = await prisma.task.findMany({
    where: { recurrence: { isActive: true, recurrenceType: 'Fixed' } },
    select: { id: true, recurrence: true, recurrenceOccurrences: { select: { recurrenceSeq: true } } },
  });
  for (const s of sources) {
    if (!s.recurrence) continue;
    const cfg = rowToConfig(s.recurrence);
    const fired = new Set<number>([1, ...s.recurrenceOccurrences.map((o) => o.recurrenceSeq ?? 0)]);
    for (const { anchor } of upcomingFixedSeqs(cfg, fired)) {
      const at = eligibleAt(anchor, 0, leadDays);
      if (at > t) {
        consider(at);
        break;
      }
    }
  }

  const soonest = candidates.length ? Math.min(...candidates) : t + SCHEDULER_MAX_SLEEP_MS;
  const clamped = Math.min(Math.max(soonest, t + SCHEDULER_MIN_SLEEP_MS), t + SCHEDULER_MAX_SLEEP_MS);
  return new Date(clamped);
}

// --- The pass --------------------------------------------------------------

/**
 * One scheduler pass: materialize all due occurrences across active recurring
 * templates and tasks, run the goal review, dispatch due reminder emails, then
 * verify the overdue invariant and refresh the in-memory heartbeat + next wake.
 * Exposed so tests can drive it deterministically with an explicit `now`.
 * Returns the number materialized.
 */
export async function runScheduler(now: Date): Promise<number> {
  // Single global materialization lead time, read once per pass.
  const leadDays = await getMaterializeLeadDays();

  // Layer 2: how late did we wake? Measured BEFORE any work, so it reflects the
  // gap between when items became eligible and when we actually got here.
  let before: OverdueMeasurement = { count: 0, maxLateMs: 0 };
  try {
    before = await measureOverdue(now, leadDays);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('scheduler: pre-pass overdue measurement failed', err);
  }

  const templates = await prisma.taskTemplate.findMany({
    where: { isActive: true, recurrenceType: { in: ['Fixed', 'RelativeToCompletion'] } },
    select: scheduleSelect,
  });

  let materialized = 0;
  for (const t of templates) {
    try {
      materialized += await materializeDueForTemplate(t, now, leadDays);
    } catch (err) {
      // Never let one bad template stall the whole pass. The overdue invariant
      // below is what stops this from failing silently forever.
      // eslint-disable-next-line no-console
      console.error(`scheduler: template ${t.id} failed`, err);
    }
  }

  // Task-level recurrence (a regular task set to recur) is materialized in the
  // same pass.
  try {
    materialized += await materializeDueTaskRecurrences(now, leadDays);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('scheduler: task-recurrence pass failed', err);
  }

  // SMART Goals (Phase 12): move Approved goals past their deadline to UnderReview.
  try {
    await runGoalReviewPass(now);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('scheduler: goal-review pass failed', err);
  }

  // Reminder emails (Phase 14 / S4a). Dispatch is server-side for ALL users; it
  // used to run only in the request path scoped to the polling actor, so a user
  // who had closed the app never received one.
  try {
    await dispatchDueReminderEmails(now);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('scheduler: reminder dispatch failed', err);
  }

  // Layers 2 + 3: the invariant must hold after a successful pass; and if we
  // arrived very late, say so even when the pass then succeeded.
  try {
    const after = await measureOverdue(now, leadDays);
    if (after.count > 0) {
      await alertHealth(now, 'HL Central scheduler did not complete its work', [
        `${after.count} item(s) are eligible to run but did not; worst case ${fmtDuration(after.maxLateMs)} overdue.`,
        '',
        'A pass has just finished, so this should be zero. Something in the pass is',
        'failing and being swallowed - check the API logs for "scheduler:" errors.',
      ]);
    } else if (before.maxLateMs > SCHEDULER_LATE_THRESHOLD_MS) {
      await alertHealth(now, 'HL Central scheduler ran late', [
        `Work was ${fmtDuration(before.maxLateMs)} overdue when this pass started.`,
        '',
        'The work has now been done, but the scheduler woke later than it should',
        'have. If this repeats, the next-wake computation is likely wrong.',
      ]);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('scheduler: post-pass overdue measurement failed', err);
  }

  lastTickAt = now;
  try {
    nextWakeAt = await computeNextWakeAt(now);
  } catch (err) {
    // A bad fine clock must degrade to coarse polling, never to silence.
    // eslint-disable-next-line no-console
    console.error('scheduler: next-wake computation failed', err);
    nextWakeAt = new Date(now.getTime() + SCHEDULER_MAX_SLEEP_MS);
  }
  return materialized;
}

// --- Health ----------------------------------------------------------------

function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} minute(s)`;
  return `${Math.round((mins / 60) * 10) / 10} hour(s)`;
}

/**
 * Whether the background timer has stopped doing its job.
 *
 * Under next-wake scheduling a long quiet gap is NORMAL - the scheduler may
 * legitimately sleep for hours - so staleness is measured against the wake the
 * scheduler itself scheduled, not against a fixed interval:
 *  - never ticked   => not down (a fresh boot has not had its first pass yet)
 *  - no armed timer => down (the timer died)
 *  - overslept its own nextWakeAt by more than the grace => down
 *
 * Reads only module state, so it costs nothing on the polling path.
 */
export function isSchedulerDown(now: Date): boolean {
  if (!lastTickAt) return false;
  if (!timerArmed) return true;
  if (!nextWakeAt) return false;
  return now.getTime() > nextWakeAt.getTime() + SCHEDULER_OVERDUE_GRACE_MS;
}

/**
 * Watchdog, run on the notifications heartbeat: if the timer has stopped, email
 * all active admins. The alert slot is claimed in the DATABASE (with a cooldown)
 * because that claim is authoritative - it is what makes concurrent heartbeats,
 * and heartbeats after a restart, send exactly one alert per outage window.
 * Never throws: a health check must not break the heartbeat response.
 */
export async function checkSchedulerHealth(now: Date): Promise<void> {
  try {
    // Fast path: healthy, and ZERO database calls. This runs on every poll from
    // every client, so it must stay free.
    if (!isSchedulerDown(now)) return;

    // Ensure the singleton claim row exists (nothing writes it on the happy path
    // any more), then claim the alert slot conditionally.
    await prisma.schedulerState.upsert({
      where: { id: SCHEDULER_STATE_ID },
      create: { id: SCHEDULER_STATE_ID },
      update: {},
    });
    const cooldownStart = new Date(now.getTime() - SCHEDULER_ALERT_COOLDOWN_MS);
    const claimed = await prisma.schedulerState.updateMany({
      where: {
        id: SCHEDULER_STATE_ID,
        OR: [{ lastAlertAt: null }, { lastAlertAt: { lt: cooldownStart } }],
      },
      data: { lastAlertAt: now },
    });
    if (claimed.count !== 1) return; // another heartbeat already alerted

    await alertAdminsSchedulerDown(lastTickAt, now);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('scheduler health check failed', err);
  }
}

/** Send an admin alert about scheduler health, rate-limited in memory. */
async function alertHealth(now: Date, subject: string, lines: string[]): Promise<void> {
  if (lastHealthAlertAt && now.getTime() - lastHealthAlertAt.getTime() < SCHEDULER_ALERT_COOLDOWN_MS) {
    return;
  }
  lastHealthAlertAt = now;
  await alertAdmins(subject, lines);
}

async function alertAdmins(subject: string, lines: string[]): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { role: 'Admin', isActive: true },
    select: { email: true },
  });
  for (const a of admins) {
    try {
      await mailer.send({
        to: a.email,
        subject,
        text: [...lines, '', `Check the API service (${env.frontendUrl.replace(/\/$/, '')}).`].join('\n'),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('failed to email admin about scheduler health', a.email, err);
    }
  }
}

async function alertAdminsSchedulerDown(last: Date | null, now: Date): Promise<void> {
  const since = last
    ? `Last run: ${last.toISOString()} (~${fmtDuration(now.getTime() - last.getTime())} ago).`
    : 'The scheduler has not completed a pass since this process started.';
  await alertAdmins('HL Central recurrence scheduler is not running', [
    'The background scheduler that generates recurring tasks has stopped ticking.',
    since,
    '',
    'Recurring occurrences will not be materialized until it is restored.',
  ]);
}

// --- Timer lifecycle (server.ts only; never started under tests) -----------

let handle: ReturnType<typeof setTimeout> | null = null;

function arm(delayMs: number): void {
  handle = setTimeout(() => void tick(), delayMs);
  handle.unref?.();
  timerArmed = true;
}

async function tick(): Promise<void> {
  timerArmed = false;
  try {
    await runScheduler(new Date());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('scheduler tick failed', err);
  }
  // Re-arm even if the pass threw, so one bad pass cannot stop the scheduler.
  const t = Date.now();
  const target = nextWakeAt ? nextWakeAt.getTime() : t + SCHEDULER_MAX_SLEEP_MS;
  arm(Math.min(Math.max(target - t, SCHEDULER_MIN_SLEEP_MS), SCHEDULER_MAX_SLEEP_MS));
}

export function startScheduler(): void {
  if (handle) return;
  // Run once at boot so the heartbeat and next wake are fresh immediately, and so
  // module state is rebuilt from the database after every restart.
  void tick();
}

export function stopScheduler(): void {
  if (handle) {
    clearTimeout(handle);
    handle = null;
  }
  timerArmed = false;
}
