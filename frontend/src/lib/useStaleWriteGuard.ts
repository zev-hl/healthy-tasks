import { useCallback, useState } from 'react';
import { ApiError } from '../api/client';

/** True for the backend's optimistic-concurrency 409 (record changed under us),
 * as opposed to the domain state-conflict 409s that share the status code. */
export function isStaleWriteError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 409 &&
    typeof err.details === 'object' &&
    err.details !== null &&
    (err.details as { code?: string }).code === 'STALE_WRITE'
  );
}

type ConflictState = 'none' | 'shown' | 'reviewing';

/**
 * Guards a detail screen's save/actions with optimistic concurrency. Wrap a save
 * in `guard(...)`: on a stale-write 409 it enters the conflict state (banner +
 * the caller swaps its Save button for Refresh) instead of throwing.
 *  - `bannerShown` → render the ConflictBanner.
 *  - `conflict`    → show a Refresh button in place of Save.
 *  - `review()`    → hide the banner but keep the stale edits (no save).
 *  - `reset()`     → clear the conflict (call after a successful Refresh).
 */
export function useStaleWriteGuard() {
  const [state, setState] = useState<ConflictState>('none');

  const guard = useCallback(async (run: () => Promise<void>): Promise<boolean> => {
    try {
      await run();
      setState('none');
      return true;
    } catch (err) {
      if (isStaleWriteError(err)) {
        setState('shown');
        return false;
      }
      throw err; // non-conflict errors fall through to the caller's own handling
    }
  }, []);

  return {
    conflict: state !== 'none',
    bannerShown: state === 'shown',
    guard,
    review: useCallback(() => setState('reviewing'), []),
    reset: useCallback(() => setState('none'), []),
  };
}
