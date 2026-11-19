import { useEffect, useState } from 'react';
import type { ConnectStatusDto } from '@healthy-tasks/shared';
import { api } from '../api/client';

/**
 * Whether HL Central is linked to our Connect (Stage 4), asked once per page
 * load and shared. Connect's buttons show only once it is.
 */
let cached: Promise<ConnectStatusDto> | null = null;
const OFF: ConnectStatusDto = { available: false, url: null };

export function loadConnect(): Promise<ConnectStatusDto> {
  return (cached ??= Promise.resolve()
    .then(() => api.getConnect())
    .then((s) => (s && typeof s === 'object' && 'available' in s ? s : OFF))
    .catch(() => OFF));
}

/** Tests start from scratch. */
export function resetConnectCache(): void {
  cached = null;
}

export function useConnect(): ConnectStatusDto {
  const [status, setStatus] = useState<ConnectStatusDto>(OFF);
  useEffect(() => {
    let alive = true;
    void loadConnect().then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, []);
  return status;
}
