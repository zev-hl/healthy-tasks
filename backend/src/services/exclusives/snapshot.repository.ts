import { Prisma, type ListingSnapshot } from '@prisma/client';
import type { ListingSnapshotDraft } from './snapshot.mapper.js';
import type { SnapshotView } from './snapshot-diff.js';

// Each listing has exactly ONE snapshot row: its latest known state. Every sweep
// compares fresh data with that row, logs what changed (the AlertLog is the
// history), then overwrites the row. The one-row rule lives in code
// (detection.service.ts), not in a DB constraint.

export interface SnapshotEntry {
  listingId: number;
  draft: ListingSnapshotDraft;
}

// Money exactly as the Decimal(10,2) columns store it (half-up to the cent), so
// fresh data compares equal to an unchanged saved row.
function cents(amount: number | null | undefined): number | null {
  return amount == null ? null : new Prisma.Decimal(amount).toDecimalPlaces(2).toNumber();
}

/** The stored columns for fresh data (everything but the listing and the time). */
export function snapshotFields(draft: ListingSnapshotDraft) {
  return {
    title: draft.title ?? null,
    mainImageUrl: draft.mainImageUrl ?? null,
    category: draft.category ?? null,
    brand: draft.brand ?? null,
    bulletPoints: draft.bulletPoints as Prisma.InputJsonValue,
    description: draft.description ?? null,
    dimensions: draft.dimensions ?? null,
    listedPrice: cents(draft.listedPrice),
    currency: draft.currency ?? null,
    buyboxWinnerSellerId: draft.buyboxWinnerSellerId ?? null,
    buyboxPrice: cents(draft.buyboxPrice),
    offerCount: draft.offerCount ?? null,
    isSuppressed: draft.isSuppressed,
    suppressionReason: draft.suppressionReason ?? null,
  };
}

/** A saved snapshot as comparable values. */
export function savedView(s: ListingSnapshot): SnapshotView {
  return {
    title: s.title,
    mainImageUrl: s.mainImageUrl,
    category: s.category,
    brand: s.brand,
    bulletPoints: Array.isArray(s.bulletPoints) ? (s.bulletPoints as string[]) : [],
    description: s.description,
    dimensions: s.dimensions,
    listedPrice: s.listedPrice == null ? null : s.listedPrice.toNumber(),
    currency: s.currency,
    buyboxWinnerSellerId: s.buyboxWinnerSellerId,
    buyboxPrice: s.buyboxPrice == null ? null : s.buyboxPrice.toNumber(),
    offerCount: s.offerCount,
    isSuppressed: s.isSuppressed,
    suppressionReason: s.suppressionReason,
  };
}

/** Fresh data as comparable values — in stored form, like `savedView`. */
export function draftView(draft: ListingSnapshotDraft): SnapshotView {
  const f = snapshotFields(draft);
  return { ...f, bulletPoints: draft.bulletPoints };
}

/**
 * Whether saving `fresh` would store exactly what `saved` already holds — every
 * stored column, including ones no alert watches (currency, suppression
 * reason). Both must be in stored form (`savedView` / `draftView`).
 */
export function sameStoredState(saved: SnapshotView, fresh: SnapshotView): boolean {
  return (Object.keys(saved) as Array<keyof SnapshotView>).every((key) =>
    key === 'bulletPoints'
      ? saved.bulletPoints.length === fresh.bulletPoints.length &&
        saved.bulletPoints.every((bullet, i) => bullet === fresh.bulletPoints[i])
      : saved[key] === fresh[key],
  );
}
