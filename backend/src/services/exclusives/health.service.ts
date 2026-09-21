import { prisma } from '../../db/prisma.js';

/** When the newest listing snapshot was captured — the last successful Amazon check. */
export async function lastSuccessfulSweepAt(): Promise<Date | null> {
  const newest = await prisma.listingSnapshot.aggregate({ _max: { capturedAt: true } });
  return newest._max.capturedAt;
}
