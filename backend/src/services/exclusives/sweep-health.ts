// Is the Amazon sweep keeping listings current? Judged per listing, so a
// partial outage shows up too — e.g. losing the Catalog API skips every
// resold listing while owned ones still refresh.

/** A listing is stale once it has missed this many sweeps in a row. */
export const STALE_AFTER_SWEEPS = 3;

/** More than this share of stale listings is a problem. Below it are the
 * few listings Amazon has stopped returning (delisted), which aren't worth
 * an alarm every hour. */
export const MAX_STALE_SHARE = 0.1;

export interface SweepHealth {
  listings: number;
  /** Listings with no fresh snapshot within the stale window. */
  stale: number;
  /** The newest snapshot of any listing: the last successful Amazon check. */
  lastSuccessAt: Date | null;
  unhealthy: boolean;
}

/**
 * `lastSeen` has one entry per monitored listing: its newest snapshot's time,
 * or when it was added if it has none yet (a new listing gets the same grace
 * window). Pure — no I/O.
 */
export function assessSweepHealth(
  lastSeen: Date[],
  lastSuccessAt: Date | null,
  now: Date,
  staleAfterMs: number,
): SweepHealth {
  const cutoff = now.getTime() - staleAfterMs;
  const stale = lastSeen.filter((d) => d.getTime() < cutoff).length;
  const unhealthy = stale > 0 && stale > lastSeen.length * MAX_STALE_SHARE;
  return { listings: lastSeen.length, stale, lastSuccessAt, unhealthy };
}
