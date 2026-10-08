import type { ExclusivesMarketplace } from '@healthy-tasks/shared';
import { prisma } from '../../db/prisma.js';
import {
  sweepListings,
  type CallCounts,
  type MonitoredListing,
  type SkippedListing,
} from './sweep.service.js';
import type { SnapshotEntry } from './snapshot.repository.js';

export interface IngestionReport {
  listingCount: number;
  /** Complete fresh data per listing — what detection compares and saves. */
  entries: SnapshotEntry[];
  /** Monitored listings with no fresh data this run, and why. */
  skipped: SkippedListing[];
  /** The sweep stopped early after repeated batch failures. */
  aborted: boolean;
  calls: CallCounts;
  callsByMarketplace: Record<string, CallCounts>;
  startedAt: string;
  finishedAt: string;
}

const key = (marketplace: string, sku: string) => `${marketplace}::${sku}`;

// "pricing-unavailable=3, not-returned=2"
export function summarizeSkips(skipped: SkippedListing[]): string {
  const counts = new Map<string, number>();
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  return [...counts].map(([reason, n]) => `${reason}=${n}`).join(', ');
}

// Fetch fresh data for every monitored Listing. Read-only against Amazon and
// against the DB snapshots — saving is detection's job, after it compares
// (detection.service.ts). Paced by the sweep so we stay under the rate limit.
// An SP-API failure never throws out of here: affected listings are skipped for
// this run and reported.
export async function runIngestion(
  onLog: (msg: string) => void = () => {},
): Promise<IngestionReport> {
  const startedAt = new Date().toISOString();

  const listings = await prisma.listing.findMany({
    select: { id: true, sku: true, marketplace: true },
  });
  onLog(`[exclusives] ingestion start — ${listings.length} monitored listing(s)`);

  const idByKey = new Map<string, number>();
  const monitored: MonitoredListing[] = listings.map((l) => {
    idByKey.set(key(l.marketplace, l.sku), l.id);
    return { sku: l.sku, marketplace: l.marketplace as ExclusivesMarketplace };
  });

  const entries: SnapshotEntry[] = [];
  let skipped: SkippedListing[] = [];
  let aborted = false;
  let calls: CallCounts = { listings: 0, pricing: 0, catalog: 0 };
  let callsByMarketplace: Record<string, CallCounts> = {};

  if (monitored.length > 0) {
    const sweep = await sweepListings(monitored, onLog);
    ({ skipped, aborted, calls, callsByMarketplace } = sweep);

    for (const draft of sweep.snapshots) {
      const listingId = idByKey.get(key(draft.marketplace, draft.sku));
      if (listingId) entries.push({ listingId, draft });
    }
  }

  const finishedAt = new Date().toISOString();
  onLog(
    `[exclusives] ingestion done — ${entries.length} fetched, ${skipped.length} skipped` +
      `${aborted ? ' (sweep stopped early)' : ''}; ` +
      `calls listings=${calls.listings} pricing=${calls.pricing} catalog=${calls.catalog}`,
  );
  if (skipped.length > 0) onLog(`[exclusives] skipped: ${summarizeSkips(skipped)}`);

  return {
    listingCount: listings.length,
    entries,
    skipped,
    aborted,
    calls,
    callsByMarketplace,
    startedAt,
    finishedAt,
  };
}
