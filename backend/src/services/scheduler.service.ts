import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { mailer } from '../utils/mailer.js';
import { env } from '../config/env.js';
import {
  addInterval,
  dueFixedSeqs,
  fixedAnchorForSeq,
  isWithinLeadTime,
  seqAllowed,
  type RecurrenceConfig,
} from './recurrence.js';
import { carryForwardAssignees, generateOccurrence } from './template-instantiation.service.js';
import { materializeDueTaskRecurrences } from './task-recurrence.service.js';
import { runGoalReviewPass } from './goal.service.js';

/**
 * Recurrence scheduler (Phase 11). A real background timer (started from
 * server.ts, NOT from createApp so tests stay deterministic and drive
 * `runScheduler` directly) materializes scheduled occurrences within their lead
 * window. Each tick stamps `SchedulerState.lastTickAt`; the notifications
 * heartbeat separately calls `checkSchedulerHealth`, which alerts admins if that
 * timestamp goes stale — i.e. if the timer has died.
 */

export const SCHEDULER_INTERVAL_MS = 60_000; // 1 minute
// How long without a tick before the timer is presumed down.
export const SCHEDULER_STALE_MS = 5 * SCHEDULER_INTERVAL_MS; // 5 minutes
// Minimum gap between admin down-alerts, so a prolonged outage doesn't spam.
export const SCHEDULER_ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

const SCHEDULER_STATE_ID = 1;

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
  leadTimeDays: number;
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
  leadTimeDays: true,
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
    leadTimeDays: t.leadTimeDays,
  };
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

/** Materialize any due occurrences for one template; returns how many fired. */
async function materializeDueForTemplate(t: TemplateForSchedule, now: Date): Promise<number> {
  const cfg = toConfig(t);
  let count = 0;

  if (cfg.recurrenceType === 'Fixed') {
    const fired = await firedSeqSet(t.id);
    const offset = earliestOffset(t.nodes);
    for (const seq of dueFixedSeqs(cfg, fired, now, offset)) {
      count += await fireOccurrence(t, seq, fixedAnchorForSeq(cfg, seq));
    }
    return count;
  }

  if (cfg.recurrenceType === 'RelativeToCompletion') {
    // Only one occurrence is ever "pending" at a time: the next is scheduled
    // strictly AFTER the prior instance's root task is Completed.
    const latest = await prisma.templateOccurrence.findFirst({
      where: { templateId: t.id, seq: { not: null } },
      orderBy: { seq: 'desc' },
      include: { rootTask: { select: { status: true, statusChangedAt: true } } },
    });

    if (!latest) {
      // First occurrence: anchored at the series start.
      if (!cfg.anchorDate) return 0;
      if (seqAllowed(cfg, 1, cfg.anchorDate) && isWithinLeadTime(cfg.anchorDate, cfg.leadTimeDays, now)) {
        count += await fireOccurrence(t, 1, cfg.anchorDate);
      }
      return count;
    }

    // Subsequent occurrence: only once the prior root is Completed.
    if (!latest.rootTask || latest.rootTask.status !== 'Completed' || !cfg.intervalUnit || !cfg.intervalCount) {
      return count;
    }
    const completedAt = latest.rootTask.statusChangedAt ?? now;
    const nextSeq = (latest.seq as number) + 1;
    const nextAnchor = addInterval(completedAt, cfg.intervalUnit, cfg.intervalCount);
    if (seqAllowed(cfg, nextSeq, nextAnchor) && isWithinLeadTime(nextAnchor, cfg.leadTimeDays, now)) {
      count += await fireOccurrence(t, nextSeq, nextAnchor);
    }
    return count;
  }

  return 0;
}

/**
 * One scheduler pass: materialize all due occurrences across active recurring
 * templates, then stamp the health heartbeat. Exposed so tests can drive it
 * deterministically with an explicit `now`. Returns the number materialized.
 */
export async function runScheduler(now: Date): Promise<number> {
  const templates = await prisma.taskTemplate.findMany({
    where: { isActive: true, recurrenceType: { in: ['Fixed', 'RelativeToCompletion'] } },
    select: scheduleSelect,
  });

  let materialized = 0;
  for (const t of templates) {
    try {
      materialized += await materializeDueForTemplate(t, now);
    } catch (err) {
      // Never let one bad template stall the whole pass.
      // eslint-disable-next-line no-console
      console.error(`scheduler: template ${t.id} failed`, err);
    }
  }

  // Task-level recurrence (a regular task set to recur) is materialized in the
  // same pass.
  try {
    materialized += await materializeDueTaskRecurrences(now);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('scheduler: task-recurrence pass failed', err);
  }

  // SMART Goals (Phase 12): move Active goals past their deadline to UnderReview.
  try {
    await runGoalReviewPass(now);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('scheduler: goal-review pass failed', err);
  }

  await prisma.schedulerState.upsert({
    where: { id: SCHEDULER_STATE_ID },
    create: { id: SCHEDULER_STATE_ID, lastTickAt: now },
    update: { lastTickAt: now },
  });
  return materialized;
}

/**
 * Watchdog, run on the notifications heartbeat: if the background timer's last
 * tick has gone stale, email all active admins that the scheduler is down. The
 * alert slot is claimed with a conditional update (+ cooldown) so concurrent
 * heartbeats send exactly one alert per outage window. Never throws — a health
 * check must not break the heartbeat response.
 */
export async function checkSchedulerHealth(now: Date): Promise<void> {
  try {
    const state = await prisma.schedulerState.findUnique({ where: { id: SCHEDULER_STATE_ID } });
    // Never ticked ⇒ can't tell "just booted" from "down"; wait for a first tick.
    if (!state?.lastTickAt) return;
    if (now.getTime() - state.lastTickAt.getTime() <= SCHEDULER_STALE_MS) return;

    const cooldownStart = new Date(now.getTime() - SCHEDULER_ALERT_COOLDOWN_MS);
    const claimed = await prisma.schedulerState.updateMany({
      where: {
        id: SCHEDULER_STATE_ID,
        OR: [{ lastAlertAt: null }, { lastAlertAt: { lt: cooldownStart } }],
      },
      data: { lastAlertAt: now },
    });
    if (claimed.count !== 1) return; // another heartbeat already alerted

    await alertAdminsSchedulerDown(state.lastTickAt, now);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('scheduler health check failed', err);
  }
}

/**
 * Read-only staleness check for the global "contact an admin" banner. Returns
 * true once a tick has happened and then gone stale; false when the timer has
 * never ticked (fresh boot) so a just-started app doesn't flash the banner.
 */
export async function isSchedulerDown(now: Date): Promise<boolean> {
  try {
    const state = await prisma.schedulerState.findUnique({ where: { id: SCHEDULER_STATE_ID } });
    if (!state?.lastTickAt) return false;
    return now.getTime() - state.lastTickAt.getTime() > SCHEDULER_STALE_MS;
  } catch {
    return false; // a health-read failure must never break the heartbeat
  }
}

async function alertAdminsSchedulerDown(lastTickAt: Date, now: Date): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { role: 'Admin', isActive: true },
    select: { email: true },
  });
  const minutes = Math.round((now.getTime() - lastTickAt.getTime()) / 60_000);
  for (const a of admins) {
    try {
      await mailer.send({
        to: a.email,
        subject: '⚠️ HL Central recurrence scheduler is not running',
        text: [
          'The background scheduler that generates recurring tasks has stopped ticking.',
          `Last run: ${lastTickAt.toISOString()} (~${minutes} minutes ago).`,
          '',
          'Recurring occurrences will not be materialized until it is restored.',
          `Check the API service (${env.frontendUrl.replace(/\/$/, '')}).`,
        ].join('\n'),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('failed to email admin about scheduler outage', a.email, err);
    }
  }
}

// --- Timer lifecycle (server.ts only; never started under tests) -----------

let handle: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (handle) return;
  const tick = (): void => {
    void runScheduler(new Date()).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('scheduler tick failed', err);
    });
  };
  tick(); // run once at boot so lastTickAt is fresh immediately
  handle = setInterval(tick, SCHEDULER_INTERVAL_MS);
  // Don't keep the event loop alive on shutdown.
  handle.unref?.();
}

export function stopScheduler(): void {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
}
