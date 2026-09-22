import { env } from '../../config/env.js';
import { missingSpApiConfig, type SpApiConfig } from './sp-api/config.js';

// The sweep's timing rules, kept away from scheduler.service.ts so the API can
// answer "when is the next check due?" without importing the scheduler, and so
// the rule itself is testable with no database and no clock of its own.

export type SweepConfig = SpApiConfig & { sweepEnabled: boolean; sweepMinutes: number };
export type SweepMode = { on: boolean; summary: string };

/** Whether this process runs the Exclusives sweep, with a one-line why for the boot log. */
export function exclusivesSweepMode(cfg: SweepConfig = env.amazon): SweepMode {
  if (!cfg.sweepEnabled) {
    return { on: false, summary: 'off (EXCLUSIVES_SWEEP_ENABLED is not "true")' };
  }
  const missing = missingSpApiConfig(cfg);
  if (missing.length > 0) {
    return { on: false, summary: `off (SP-API not configured: missing ${missing.join(', ')})` };
  }
  return { on: true, summary: `on, every ${cfg.sweepMinutes} min` };
}

/**
 * When the next pass is due: one interval after the last successful sweep (by
 * any instance) and one interval after this process's last attempt, whichever
 * is later — and never before `now`. The attempt is what stops a tight loop
 * while Amazon is down: a failing pass saves no snapshot, so the newest
 * snapshot alone would read "due now" forever. Nothing yet: due now.
 */
export function nextSweepDueAt(
  now: Date,
  lastSuccessAt: Date | null,
  lastAttemptAt: Date | null,
  sweepMinutes: number,
): Date {
  const intervalMs = sweepMinutes * 60 * 1000;
  const candidates = [now.getTime()];
  if (lastSuccessAt) candidates.push(lastSuccessAt.getTime() + intervalMs);
  if (lastAttemptAt) candidates.push(lastAttemptAt.getTime() + intervalMs);
  return new Date(Math.max(...candidates));
}
