import type { ExclusivesMarketplace } from '@healthy-tasks/shared';
import { searchListingsItems } from './sp-api/listings.js';
import { getListingOffersBatch, resolveBuyBox } from './sp-api/pricing.js';
import { searchCatalogItems } from './sp-api/catalog.js';
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

export interface SweepResult {
  snapshots: ListingSnapshotDraft[];
  calls: CallCounts;
  callsByMarketplace: Record<string, CallCounts>;
}

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

// Fetch listing + pricing data for every monitored SKU, paced so we never
// exceed the SP-API limit, and merge into one snapshot draft per listing. For
// resold listings that come back without brand content, a batched Catalog call
// fills brand/bullets/description/dimensions/image. Read-only; nothing persisted.
export async function sweepListings(
  listings: MonitoredListing[],
  onLog: (msg: string) => void = () => {},
): Promise<SweepResult> {
  const listingsPacer = new Pacer(SP_API_RATES.listings);
  const pricingPacer = new Pacer(SP_API_RATES.pricing);
  const catalogPacer = new Pacer(SP_API_RATES.catalog);

  const snapshots: ListingSnapshotDraft[] = [];
  const calls: CallCounts = { listings: 0, pricing: 0, catalog: 0 };
  const callsByMarketplace: Record<string, CallCounts> = {};

  for (const [marketplace, skus] of groupByMarketplace(listings)) {
    const mkt = (callsByMarketplace[marketplace] ??= { listings: 0, pricing: 0, catalog: 0 });

    for (const group of batch(skus, 20)) {
      await listingsPacer.acquire();
      const listingRes = await searchListingsItems({
        marketplace,
        identifiers: group,
        includedData: LISTINGS_INCLUDED,
        pageSize: 20,
      });
      listingsPacer.observeLimit(listingRes.rateLimit);
      calls.listings += 1;
      mkt.listings += 1;

      await pricingPacer.acquire();
      const pricingRes = await getListingOffersBatch(group, marketplace);
      pricingPacer.observeLimit(pricingRes.rateLimit);
      calls.pricing += 1;
      mkt.pricing += 1;

      const listingBySku = new Map(listingRes.items.map((i) => [i.sku, i]));
      const offersBySku = new Map(pricingRes.results.map((r) => [r.sku, r]));

      const batchDrafts: ListingSnapshotDraft[] = [];
      for (const sku of group) {
        const item = listingBySku.get(sku);
        if (!item) {
          onLog(`no listing data for ${marketplace}/${sku}`);
          continue;
        }
        const draft = mapListingSnapshot(item, marketplace);
        const bb = resolveBuyBox(offersBySku.get(sku)?.payload);
        draft.buyboxWinnerSellerId = bb.winnerSellerId;
        draft.buyboxPrice = bb.price;
        draft.offerCount = bb.offerCount;
        batchDrafts.push(draft);
      }

      // Conditional supplement: only for content-missing (resold) drafts.
      const gaps = batchDrafts.filter(needsCatalog);
      if (gaps.length > 0) {
        await catalogPacer.acquire();
        const catalog = await searchCatalogItems(
          gaps.map((d) => d.asin as string),
          marketplace,
        );
        catalogPacer.observeLimit(catalog.rateLimit);
        calls.catalog += 1;
        mkt.catalog += 1;

        const byAsin = new Map(catalog.items.filter((i) => i.asin).map((i) => [i.asin, i]));
        for (const d of gaps) {
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

      snapshots.push(...batchDrafts);
    }
  }

  return { snapshots, calls, callsByMarketplace };
}
