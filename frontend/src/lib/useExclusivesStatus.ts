import { useEffect, useState } from 'react';
import type { ExclusivesStatusDto } from '@healthy-tasks/shared';
import { api } from '../api/client';

// Shared across pages so navigating between the Exclusives screens does not
// re-hit the API on every mount — but only briefly. This used to cache for the
// whole session, which froze the status dot's "Last Amazon check" at whatever
// it read when the tab was opened, while the page heading beside it moved on
// with each sweep. A short window keeps the two telling the same story; the
// request is cheap, and the server still caches the Amazon probe for minutes.
const TTL_MS = 30 * 1000;

let cached: { value: ExclusivesStatusDto; at: number } | null = null;
let inflight: Promise<ExclusivesStatusDto> | null = null;

const freshEnough = (): ExclusivesStatusDto | null =>
  cached && Date.now() - cached.at < TTL_MS ? cached.value : null;

/** Test seam: forget what was fetched, so each case starts from nothing. */
export function __resetExclusivesStatusCache(): void {
  cached = null;
  inflight = null;
}

export function useExclusivesStatus(): { status: ExclusivesStatusDto | null; loading: boolean } {
  const [status, setStatus] = useState<ExclusivesStatusDto | null>(freshEnough);
  const [loading, setLoading] = useState(!freshEnough());

  useEffect(() => {
    if (freshEnough()) return;
    let alive = true;
    inflight ??= api.getExclusivesStatus();
    inflight
      .then((s) => {
        cached = { value: s, at: Date.now() };
        if (alive) setStatus(s);
      })
      .catch(() => {})
      .finally(() => {
        inflight = null;
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { status, loading };
}
