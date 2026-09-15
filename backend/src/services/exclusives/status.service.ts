import type { ExclusivesStatusDto } from '@healthy-tasks/shared';
import { getMarketplaceParticipations } from './sp-api/sellers.js';
import { MONITORED_COUNTRY_CODES } from './sp-api/marketplaces.js';
import { SpApiAuthError, SpApiError, SpApiWriteBlockedError } from './sp-api/errors.js';

// Cache the health result so page loads never trigger an Amazon call. Chunk 6's
// scheduler sweep will become the primary signal; until then we probe on demand
// at most once per TTL.
const TTL_MS = 5 * 60 * 1000;

let cache: { value: ExclusivesStatusDto; at: number } | null = null;

export async function getExclusivesStatus(force = false): Promise<ExclusivesStatusDto> {
  const now = Date.now();
  if (!force && cache && now - cache.at < TTL_MS) return cache.value;
  const value = await computeStatus();
  cache = { value, at: now };
  return value;
}

async function computeStatus(): Promise<ExclusivesStatusDto> {
  const checkedAt = new Date().toISOString();
  try {
    const participations = await getMarketplaceParticipations();
    const active = new Set(
      participations
        .filter((p) => p.participation?.isParticipating)
        .map((p) => p.marketplace?.countryCode)
        .filter((v): v is string => Boolean(v)),
    );
    // We only monitor US and Canada — ignore any other authorized marketplaces.
    const marketplaces = MONITORED_COUNTRY_CODES.filter((code) => active.has(code));
    const missing = MONITORED_COUNTRY_CODES.filter((code) => !active.has(code));
    return {
      connected: true,
      checkedAt,
      detail: missing.length
        ? `Connected · ${marketplaces.join(', ') || 'none'} (not authorized: ${missing.join(', ')})`
        : `Connected · ${marketplaces.join(', ')}`,
      marketplaces,
    };
  } catch (err) {
    return { connected: false, checkedAt, detail: describeError(err), marketplaces: [] };
  }
}

function describeError(err: unknown): string {
  if (err instanceof SpApiAuthError) return 'Credentials missing or invalid.';
  if (err instanceof SpApiWriteBlockedError) return err.message;
  if (err instanceof SpApiError) {
    if (err.status === 401 || err.status === 403) return `Authorization rejected (${err.status}).`;
    return `SP-API error (${err.status}).`;
  }
  return (err as Error).message;
}
