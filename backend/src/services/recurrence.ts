import {
  GHOST_HORIZON_OCCURRENCES,
  type RecurrenceEndType,
  type RecurrenceType,
  type RecurrenceUnit,
} from '@healthy-tasks/shared';

/**
 * Pure recurrence date math (Phase 11). No Prisma, no I/O — just the calendar
 * arithmetic behind Fixed schedules, occurrence limits, ghost previews, and the
 * lead-time auto-materialization window. The scheduler and template services
 * compose these; keeping them pure makes the tricky "every 3 weeks × 3" and
 * month-clamping cases directly unit-testable.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecurrenceConfig {
  recurrenceType: RecurrenceType;
  intervalCount: number | null;
  intervalUnit: RecurrenceUnit | null;
  /** Weekly-only "repeat on" weekdays (0=Sun … 6=Sat); empty ⇒ the anchor's day. */
  weekdays: number[];
  anchorDate: Date | null;
  endType: RecurrenceEndType;
  endDate: Date | null;
  maxOccurrences: number | null;
  leadTimeDays: number;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Add whole months, preserving the day-of-month but clamping to month length
 * (e.g. Jan 31 + 1 month → Feb 28/29). Computed in UTC so it is timezone-stable. */
export function addMonths(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const d = new Date(date.getTime());
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const daysInTarget = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, daysInTarget));
  return d;
}

export function addInterval(date: Date, unit: RecurrenceUnit, count: number): Date {
  switch (unit) {
    case 'Day':
      return addDays(date, count);
    case 'Week':
      return addDays(date, count * 7);
    case 'Month':
      return addMonths(date, count);
    case 'Year':
      return addMonths(date, count * 12);
  }
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * The `seq`-th (1-based) date of a weekly "repeat on" schedule. Occurrence #1 is
 * always the anchor itself (the series start / source task, whatever weekday it
 * falls on, matching Google's "keep the original date" behavior); occurrences
 * 2, 3, … are the selected weekdays (0=Sun … 6=Sat) enumerated strictly after
 * the anchor, every `intervalWeeks` weeks. The anchor's time-of-day is preserved.
 * Empty weekdays falls back to the plain weekly step.
 */
function weeklyByweekdayDate(anchor: Date, intervalWeeks: number, weekdays: number[], seq: number): Date {
  if (seq === 1) return anchor;
  const days = [...new Set(weekdays)].filter((w) => w >= 0 && w <= 6).sort((a, b) => a - b);
  if (days.length === 0) return addDays(anchor, intervalWeeks * 7 * (seq - 1));
  const anchorDay = startOfUtcDay(anchor);
  const timeOfDay = anchor.getTime() - anchorDay.getTime();
  const weekStart0 = addDays(anchorDay, -anchorDay.getUTCDay()); // Sunday of the anchor's week
  let count = 0;
  const HARD_CAP = 200000;
  for (let c = 0; c < HARD_CAP; c++) {
    const base = addDays(weekStart0, c * intervalWeeks * 7);
    for (const wd of days) {
      const d = addDays(base, wd);
      if (d.getTime() > anchorDay.getTime()) {
        // seq 2 → the 1st byweekday date after the anchor, etc.
        count += 1;
        if (count === seq - 1) return new Date(d.getTime() + timeOfDay);
      }
    }
  }
  throw new Error('weeklyByweekdayDate: seq out of range');
}

/** Whether a template has a live (auto-generating) recurrence. */
export function isRecurring(cfg: Pick<RecurrenceConfig, 'recurrenceType'>): boolean {
  return cfg.recurrenceType !== 'None';
}

/**
 * The anchor (instantiation date) for the `seq`-th occurrence (1-based) of a
 * Fixed schedule: anchorDate + interval × (seq − 1). Throws if the config is not
 * a fully-specified Fixed schedule (caller guards with isRecurring/type checks).
 */
export function fixedAnchorForSeq(cfg: RecurrenceConfig, seq: number): Date {
  if (cfg.recurrenceType !== 'Fixed') throw new Error('fixedAnchorForSeq: not a Fixed schedule');
  if (!cfg.anchorDate || !cfg.intervalUnit || !cfg.intervalCount) {
    throw new Error('fixedAnchorForSeq: incomplete recurrence config');
  }
  // Weekly with selected weekdays enumerates by-weekday; every other unit steps
  // the anchor by whole intervals.
  if (cfg.intervalUnit === 'Week' && cfg.weekdays.length > 0) {
    return weeklyByweekdayDate(cfg.anchorDate, cfg.intervalCount, cfg.weekdays, seq);
  }
  return addInterval(cfg.anchorDate, cfg.intervalUnit, cfg.intervalCount * (seq - 1));
}

/**
 * Whether occurrence `seq` (with computed `anchor`) is permitted by the end
 * condition. AfterOccurrences caps the count; OnDate caps the anchor date
 * (inclusive); Never is unbounded.
 */
export function seqAllowed(cfg: RecurrenceConfig, seq: number, anchor: Date): boolean {
  if (seq < 1) return false;
  if (cfg.endType === 'AfterOccurrences') {
    return cfg.maxOccurrences != null && seq <= cfg.maxOccurrences;
  }
  if (cfg.endType === 'OnDate') {
    return cfg.endDate != null && anchor.getTime() <= cfg.endDate.getTime();
  }
  return true; // Never
}

/**
 * Whether `now` has reached the lead window: (occurrence earliest date −
 * leadTimeDays). The occurrence's earliest date is `anchor + referenceOffsetDays`
 * — for a recurring task the anchor already IS the earliest date (offset 0); for
 * a template it is the anchor plus the tree's smallest start/due offset. This
 * matches the product definition of a ghost: earliest date more than the lead
 * time out ⇒ still a ghost; within it ⇒ auto-materialize.
 */
export function isWithinLeadTime(
  anchor: Date,
  leadTimeDays: number,
  now: Date,
  referenceOffsetDays = 0,
): boolean {
  const earliest = addDays(anchor, referenceOffsetDays).getTime();
  return now.getTime() >= earliest - leadTimeDays * DAY_MS;
}

/**
 * The scheduled seqs of a Fixed schedule that are DUE to materialize as of `now`
 * (within the lead window and allowed by the limit), excluding any already-fired
 * seqs. Returns them in ascending order so the scheduler catches up in sequence.
 */
export function dueFixedSeqs(
  cfg: RecurrenceConfig,
  firedSeqs: Set<number>,
  now: Date,
  referenceOffsetDays = 0,
): number[] {
  if (cfg.recurrenceType !== 'Fixed') return [];
  const out: number[] = [];
  // Walk forward from seq 1; stop at the first seq beyond the limit or beyond the
  // lead window (later seqs are only further in the future). A hard cap guards a
  // misconfigured Never schedule from looping unboundedly.
  const HARD_CAP = 100000;
  for (let seq = 1; seq <= HARD_CAP; seq++) {
    const anchor = fixedAnchorForSeq(cfg, seq);
    if (!seqAllowed(cfg, seq, anchor)) break;
    if (!isWithinLeadTime(anchor, cfg.leadTimeDays, now, referenceOffsetDays)) break;
    if (!firedSeqs.has(seq)) out.push(seq);
  }
  return out;
}

/**
 * Upcoming (not-yet-fired) Fixed occurrences to preview as ghosts, ascending.
 * Bounded series (OnDate / AfterOccurrences) yield all remaining; an indefinite
 * Never series is capped at GHOST_HORIZON_OCCURRENCES future entries so the
 * preview list stays finite.
 */
export function upcomingFixedSeqs(
  cfg: RecurrenceConfig,
  firedSeqs: Set<number>,
): { seq: number; anchor: Date }[] {
  if (cfg.recurrenceType !== 'Fixed') return [];
  const out: { seq: number; anchor: Date }[] = [];
  const HARD_CAP = 100000;
  for (let seq = 1; seq <= HARD_CAP; seq++) {
    const anchor = fixedAnchorForSeq(cfg, seq);
    if (!seqAllowed(cfg, seq, anchor)) break;
    if (firedSeqs.has(seq)) continue;
    out.push({ seq, anchor });
    if (cfg.endType === 'Never' && out.length >= GHOST_HORIZON_OCCURRENCES) break;
  }
  return out;
}
