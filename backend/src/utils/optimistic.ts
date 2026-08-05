import { HttpError } from './http-error.js';

/** Marker (in the 409 body's `details.code`) that tells the client this was an
 * optimistic-concurrency stale-write conflict — distinct from the domain state
 * conflicts that also use 409 (e.g. "Only a draft goal can be edited"). */
export const STALE_WRITE_CODE = 'STALE_WRITE';

/**
 * Optimistic concurrency check. Rejects a write when the record was modified
 * since the client loaded it. `expectedUpdatedAt` is the ISO `updatedAt` the
 * client last saw; when absent the check is skipped (opt-in / back-compatible).
 */
export function assertNotStale(
  current: { updatedAt: Date },
  expectedUpdatedAt: string | null | undefined,
): void {
  if (!expectedUpdatedAt) return;
  if (current.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) {
    throw new HttpError(409, 'This record was updated while you were viewing it.', {
      code: STALE_WRITE_CODE,
    });
  }
}
