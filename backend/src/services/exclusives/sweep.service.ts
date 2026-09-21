import type { ExclusivesMarketplace } from '@healthy-tasks/shared';
import { searchListingsItems } from './sp-api/listings.js';
import { getListingOffersBatch, isTransientOfferResult, resolveBuyBox } from './sp-api/pricing.js';
import { searchCatalogItems, type CatalogItem } from './sp-api/catalog.js';
import { mapCatalogContent, mapListingSnapshot, type ListingSnapshotDraft } from './snapshot.mapper.js';
import { Pacer, batch, SP_API_RATES } from './sp-api/pacer.js';

export interface MonitoredListing {
  sku: string;
  marketplace: ExclusivesMarketplace;
}

export interface CallCounts {
  listings: number;
  pricing: number;
  catalog: number;
}

/** Why a monitored listing got no snapshot this sweep. */
export type SkipReason =
  | 'batch-failed' // the listings or pricing call for its batch failed
  | 'not-returned' // Amazon returned no listing for this SKU (delisted?)
  | 'pricing-unavailable' // its own pricing answer was throttled, a 5xx, or missing
  | 'catalog-unavailable' // it needed the catalog fill and could not get one
  | 'sweep-aborted'; // never reached: the sweep stopped early

export interface SkippedListing {
  sku: string;
  marketplace: ExclusivesMarketplace;
  reason: SkipReason;
}

export interface SweepResult {
  snapshots: ListingSnapshotDraft[];
  skipped: SkippedListing[];
  calls: CallCounts;
  callsByMarketplace: Record<string, CallCounts>;
  /** Stopped early after too many failed batches in a row. */
  aborted: boolean;
}

// After this many failures in a row an endpoint is presumably down (a dead one
// can cost ~2 min per call in timeouts and backoff). Listings/pricing failing
// stops the whole sweep; the catalog failing only stops catalog fills, so
// losing that one API never halts price and Buy Box monitoring. Either way the
// next sweep is the retry.
export const MAX_CONSECUTIVE_FAILURES = 3;

const LISTINGS_INCLUDED = ['summaries', 'attributes', 'issues', 'offers'];

// A listing whose own attributes carry no brand content — resold/thin — and so
// needs the catalog supplement.
const needsCatalog = (d: ListingSnapshotDraft): boolean =>
  Boolean(d.asin) && d.bulletPoints.length === 0 && !d.description;

function groupByMarketplace(listings: MonitoredListing[]): Map<ExclusivesMarketplace, string[]> {
  const map = new Map<ExclusivesMarketplace, string[]>();
  for (const l of listings) {
    const skus = map.get(l.marketplace) ?? [];
    skus.push(l.sku);
    map.set(l.marketplace, skus);
  }
  return map;
}

function fillFromCatalog(drafts: ListingSnapshotDraft[], items: CatalogItem[]): void {
  const byAsin = new Map(items.filter((i) => i.asin).map((i) => [i.asin, i]));
  for (const d of drafts) {
    const item = byAsin.get(d.asin);
    if (!item) continue;
    const content = mapCatalogContent(item);
    if (!d.brand) d.brand = content.brand;
    if (d.bulletPoints.length === 0 && content.bulletPoints) d.bulletPoints = content.bulletPoints;
    if (!d.description) d.description = content.description;
    if (!d.dimensions) d.dimensions = content.dimensions;
    if (!d.mainImageUrl) d.mainImageUrl = content.mainImageUrl;
  }
}

interface BatchContext {
  pacers: { listings: Pacer; pricing: Pacer; catalog: Pacer };
  countCall: (api: keyof CallCounts) => void;
  onLog: (msg: string) => void;
  /** False once the catalog has failed too often this sweep. */
  useCatalog: boolean;
}

interface BatchResult {
  snapshots: ListingSnapshotDraft[];
  skipped: SkippedListing[];
  /** 'unused': no listing needed a fill, or fills are switched off. */
  catalog: 'ok' | 'failed' | 'unused';
}

// One batch of up to 20 SKUs. Throws if the listings or pricing call fails (the
// whole batch is then skipped); a catalog failure only skips the listings that
// needed a fill.
async function sweepBatch(
  skus: string[],
  marketplace: ExclusivesMarketplace,
  ctx: BatchContext,
): Promise<BatchResult> {
  const { pacers, countCall } = ctx;

  countCall('listings');
  const listingRes = await searchListingsItems({
    marketplace,
    identifiers: skus,
    includedData: LISTINGS_INCLUDED,
    pageSize: 20,
    pace: () => pacers.listings.acquire(),
  });
  pacers.listings.observeLimit(listingRes.rateLimit);

  countCall('pricing');
  const pricingRes = await getListingOffersBatch(skus, marketplace, () => pacers.pricing.acquire());
  pacers.pricing.observeLimit(pricingRes.rateLimit);
  for (const warning of pricingRes.warnings) ctx.onLog(`[exclusives] ${marketplace}: ${warning}`);

  const listingBySku = new Map(listingRes.items.map((i) => [i.sku, i]));
  const offersBySku = new Map(pricingRes.results.map((r) => [r.sku, r]));

  let snapshots: ListingSnapshotDraft[] = [];
  const skipped: SkippedListing[] = [];
  const skip = (sku: string, reason: SkipReason) => skipped.push({ sku, marketplace, reason });

  for (const sku of skus) {
    const item = listingBySku.get(sku);
    if (!item) {
      skip(sku, 'not-returned');
      continue;
    }
    const offers = offersBySku.get(sku);
    // Storing an untrustworthy answer as "no Buy Box" would fire a false Buy
    // Box Won on the next good cycle — skip the listing instead.
    if (isTransientOfferResult(offers)) {
      skip(sku, 'pricing-unavailable');
      continue;
    }
    const draft = mapListingSnapshot(item, marketplace);
    const bb = resolveBuyBox(offers?.payload);
    draft.buyboxWinnerSellerId = bb.winnerSellerId;
    draft.buyboxPrice = bb.price;
    draft.offerCount = bb.offerCount;
    snapshots.push(draft);
  }

  // Conditional supplement: only for content-missing (resold) drafts. Stored
  // without the fill, these would read as brand content removed — and restored
  // next cycle: two false alerts each. So no fill means no snapshot.
  const gaps = snapshots.filter(needsCatalog);
  if (gaps.length === 0) return { snapshots, skipped, catalog: 'unused' };

  let catalog: BatchResult['catalog'] = 'unused';
  if (ctx.useCatalog) {
    try {
      countCall('catalog');
      const res = await searchCatalogItems(
        gaps.map((d) => d.asin as string),
        marketplace,
        () => pacers.catalog.acquire(),
      );
      pacers.catalog.observeLimit(res.rateLimit);
      fillFromCatalog(gaps, res.items);
      return { snapshots, skipped, catalog: 'ok' };
    } catch (err) {
      ctx.onLog(`[exclusives] catalog fill failed (${marketplace}): ${(err as Error).message}`);
      catalog = 'failed';
    }
  }

  const gapSet = new Set(gaps);
  snapshots = snapshots.filter((d) => !gapSet.has(d));
  for (const d of gaps) skip(d.sku, 'catalog-unavailable');
  return { snapshots, skipped, catalog };
}

// Fetch listing + pricing data for every monitored SKU, paced so we never
// exceed the SP-API limit (retries included), and merge into one snapshot draft
// per listing. For resold listings that come back without brand content, a
// batched Catalog call fills brand/bullets/description/dimensions/image.
// Only COMPLETE drafts are returned: a listing whose data could not all be
// fetched this cycle is reported in `skipped` and gets no snapshot, so the
// next good snapshot compares against the last good one (no false alerts).
// Never throws for an SP-API failure. Read-only; nothing persisted.
// `rates` exists for tests; production always uses Amazon's documented rates.
export async function sweepListings(
  listings: MonitoredListing[],
  onLog: (msg: string) => void = () => {},
  rates: Record<keyof CallCounts, number> = SP_API_RATES,
): Promise<SweepResult> {
  const pacers = {
    listings: new Pacer(rates.listings),
    pricing: new Pacer(rates.pricing),
    catalog: new Pacer(rates.catalog),
  };

  const snapshots: ListingSnapshotDraft[] = [];
  const skipped: SkippedListing[] = [];
  const calls: CallCounts = { listings: 0, pricing: 0, catalog: 0 };
  const callsByMarketplace: Record<string, CallCounts> = {};
  let batchFailures = 0;
  let catalogFailures = 0;
  let aborted = false;

  for (const [marketplace, skus] of groupByMarketplace(listings)) {
    const mkt = (callsByMarketplace[marketplace] ??= { listings: 0, pricing: 0, catalog: 0 });
    const countCall = (api: keyof CallCounts) => {
      calls[api] += 1;
      mkt[api] += 1;
    };
    const skipAll = (group: string[], reason: SkipReason) =>
      skipped.push(...group.map((sku) => ({ sku, marketplace, reason })));

    for (const group of batch(skus, 20)) {
      if (aborted) {
        skipAll(group, 'sweep-aborted');
        continue;
      }

      try {
        const useCatalog = catalogFailures < MAX_CONSECUTIVE_FAILURES;
        const ctx = { pacers, countCall, onLog, useCatalog };
        const result = await sweepBatch(group, marketplace, ctx);
        snapshots.push(...result.snapshots);
        skipped.push(...result.skipped);
        batchFailures = 0;

        if (result.catalog === 'ok') catalogFailures = 0;
        if (result.catalog === 'failed' && ++catalogFailures === MAX_CONSECUTIVE_FAILURES) {
          onLog(
            `[exclusives] catalog failed ${catalogFailures} times in a row — no more catalog ` +
              'fills this sweep (listings that need one are skipped)',
          );
        }
      } catch (err) {
        const msg = (err as Error).message;
        onLog(`[exclusives] batch failed (${marketplace}, ${group.length} SKUs): ${msg}`);
        skipAll(group, 'batch-failed');
        if (++batchFailures >= MAX_CONSECUTIVE_FAILURES) {
          aborted = true;
          onLog(`[exclusives] ${batchFailures} batches failed in a row — stopping this sweep`);
        }
      }
    }
  }

  return { snapshots, skipped, calls, callsByMarketplace, aborted };
}
