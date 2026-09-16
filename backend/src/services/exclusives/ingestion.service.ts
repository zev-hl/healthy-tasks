import type { ExclusivesMarketplace } from '@healthy-tasks/shared';
import { prisma } from '../../db/prisma.js';
import { sweepListings, type MonitoredListing } from './sweep.service.js';
import { persistSnapshots, type SnapshotEntry } from './snapshot.repository.js';
import type { CallCounts } from './sweep.service.js';

export interface IngestionReport {
  listingCount: number;
  snapshotsWritten: number;
  calls: CallCounts;
  callsByMarketplace: Record<string, CallCounts>;
  startedAt: string;
  finishedAt: string;
}

const key = (marketplace: string, sku: string) => `${marketplace}::${sku}`;

// One full sweep-and-store pass over every monitored Listing. Read-only against
// Amazon; paced by the sweep so we stay under the rate limit. Idempotent — safe
// to run again (it simply captures a fresh snapshot per listing). This is what
// the scheduler (Chunk 6) will call.
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

  let snapshotsWritten = 0;
  let calls: CallCounts = { listings: 0, pricing: 0 };
  let callsByMarketplace: Record<string, CallCounts> = {};

  if (monitored.length > 0) {
    const sweep = await sweepListings(monitored, onLog);
    calls = sweep.calls;
    callsByMarketplace = sweep.callsByMarketplace;

    const entries: SnapshotEntry[] = [];
    for (const draft of sweep.snapshots) {
      const listingId = idByKey.get(key(draft.marketplace, draft.sku));
      if (listingId) entries.push({ listingId, draft });
    }
    snapshotsWritten = await persistSnapshots(entries);
  }

  const finishedAt = new Date().toISOString();
  onLog(
    `[exclusives] ingestion done — ${snapshotsWritten} snapshot(s); ` +
      `calls listings=${calls.listings} pricing=${calls.pricing}`,
  );

  return {
    listingCount: listings.length,
    snapshotsWritten,
    calls,
    callsByMarketplace,
    startedAt,
    finishedAt,
  };
}
