import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { ListingSnapshotDraft } from './snapshot.mapper.js';

export interface SnapshotEntry {
  listingId: number;
  draft: ListingSnapshotDraft;
}

export function snapshotCreateData(
  listingId: number,
  draft: ListingSnapshotDraft,
): Prisma.ListingSnapshotCreateManyInput {
  return {
    listingId,
    title: draft.title ?? null,
    mainImageUrl: draft.mainImageUrl ?? null,
    category: draft.category ?? null,
    brand: draft.brand ?? null,
    bulletPoints: draft.bulletPoints as Prisma.InputJsonValue,
    description: draft.description ?? null,
    dimensions: draft.dimensions ?? null,
    listedPrice: draft.listedPrice ?? null,
    currency: draft.currency ?? null,
    buyboxWinnerSellerId: draft.buyboxWinnerSellerId ?? null,
    buyboxPrice: draft.buyboxPrice ?? null,
    offerCount: draft.offerCount ?? null,
    isSuppressed: draft.isSuppressed,
    suppressionReason: draft.suppressionReason ?? null,
  };
}

export async function persistSnapshots(entries: SnapshotEntry[]): Promise<number> {
  if (entries.length === 0) return 0;
  const { count } = await prisma.listingSnapshot.createMany({
    data: entries.map((e) => snapshotCreateData(e.listingId, e.draft)),
  });
  return count;
}
