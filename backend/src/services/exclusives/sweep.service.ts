import type { ExclusivesMarketplace } from '@healthy-tasks/shared';
import { searchListingsItems } from './sp-api/listings.js';
import { getListingOffersBatch, resolveBuyBox } from './sp-api/pricing.js';
import { mapListingSnapshot, type ListingSnapshotDraft } from './snapshot.mapper.js';
import { Pacer, batch, SP_API_RATES } from './sp-api/pacer.js';

export interface MonitoredListing {
  sku: string;
  marketplace: ExclusivesMarketplace;
}

export interface CallCounts {
  listings: number;
  pricing: number;
}

export interface SweepResult {
  snapshots: ListingSnapshotDraft[];
  calls: CallCounts;
  callsByMarketplace: Record<string, CallCounts>;
}

const LISTINGS_INCLUDED = ['summaries', 'attributes', 'issues', 'offers'];

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
// exceed the SP-API limit, and merge into one snapshot draft per listing.
// Read-only; nothing is persisted here (that is 4c).
export async function sweepListings(
  listings: MonitoredListing[],
  onLog: (msg: string) => void = () => {},
): Promise<SweepResult> {
  const listingsPacer = new Pacer(SP_API_RATES.listings);
  const pricingPacer = new Pacer(SP_API_RATES.pricing);

  const snapshots: ListingSnapshotDraft[] = [];
  const calls: CallCounts = { listings: 0, pricing: 0 };
  const callsByMarketplace: Record<string, CallCounts> = {};

  for (const [marketplace, skus] of groupByMarketplace(listings)) {
    const mkt = (callsByMarketplace[marketplace] ??= { listings: 0, pricing: 0 });

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
        snapshots.push(draft);
      }
    }
  }

  return { snapshots, calls, callsByMarketplace };
}
