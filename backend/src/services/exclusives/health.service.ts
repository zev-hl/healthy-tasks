import { prisma } from '../../db/prisma.js';
import { assessSweepHealth, type SweepHealth } from './sweep-health.js';

/** When the newest listing snapshot was captured — the last successful Amazon check. */
export async function lastSuccessfulSweepAt(): Promise<Date | null> {
  const newest = await prisma.listingSnapshot.aggregate({ _max: { capturedAt: true } });
  return newest._max.capturedAt;
}

/** Load each listing's last-seen time and judge the sweep's health (see sweep-health.ts). */
export async function loadSweepHealth(now: Date, staleAfterMs: number): Promise<SweepHealth> {
  const [listings, newest] = await Promise.all([
    prisma.listing.findMany({ select: { id: true, createdAt: true } }),
    prisma.listingSnapshot.groupBy({ by: ['listingId'], _max: { capturedAt: true } }),
  ]);
  const newestById = new Map(newest.map((r) => [r.listingId, r._max.capturedAt]));

  const lastSeen: Date[] = [];
  let lastSuccessAt: Date | null = null;
  for (const listing of listings) {
    const seen = newestById.get(listing.id);
    if (seen && (!lastSuccessAt || seen > lastSuccessAt)) lastSuccessAt = seen;
    lastSeen.push(seen ?? listing.createdAt);
  }
  return assessSweepHealth(lastSeen, lastSuccessAt, now, staleAfterMs);
}
