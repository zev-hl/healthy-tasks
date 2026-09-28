import { useEffect, useState } from 'react';
import type { ExclusivesStatusDto } from '@healthy-tasks/shared';
import { api } from '../api/client';

// Fetched once and shared across pages/tabs for the session, so navigating
// between the Exclusives screens never re-hits the API (the server also caches).
let cached: ExclusivesStatusDto | null = null;
let inflight: Promise<ExclusivesStatusDto> | null = null;

export function useExclusivesStatus(): { status: ExclusivesStatusDto | null; loading: boolean } {
  const [status, setStatus] = useState<ExclusivesStatusDto | null>(cached);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    if (cached) return;
    let alive = true;
    inflight ??= api.getExclusivesStatus();
    inflight
      .then((s) => {
        cached = s;
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
