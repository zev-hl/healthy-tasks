import type { ExclusivesMarketplace } from '@healthy-tasks/shared';
import { searchListingsItems } from './sp-api/listings.js';
import { batch, type Pacer } from './sp-api/pacer.js';
import { sharedPacers } from './sp-api/shared-pacer.js';

// Amazon accepts at most 20 identifiers per listings search and returns at most
// 20 items per page. One ASIN can carry several SKUs on the same account, so a
// full batch of 20 ASINs can produce more than 20 items — Amazon then returns
// the first page plus a nextToken. Reading only the first page silently drops
// the remainder, which is how 11 listings went unmonitored after the first
// seeding run. Every caller must page until the token is gone.
export const LISTINGS_BATCH_SIZE = 20;

// An ASIN can resolve to more than one SKU: the seller's real one plus leftovers
// from a fulfilment transfer ("FBA1963N2SPT.missing1") or a test listing
// ("B005XLF6KK-TEST"). Those extras are usually dead offers with no price and no
// Buy Box, so monitoring one means watching nothing. Rank them last and keep
// Amazon's own order among equals, so the choice stays deterministic.
function skuRank(sku: string): number {
  if (/\.missing/i.test(sku)) return 2;
  if (/(^|[-_])test(\d*)($|[-_])/i.test(sku)) return 1;
  return 0;
}

export function pickSku(skus: string[]): string {
  const [first, ...rest] = skus;
  if (first === undefined) throw new Error('pickSku needs at least one SKU.');

  let best = first;
  let bestRank = skuRank(first);
  for (const sku of rest) {
    const rank = skuRank(sku);
    if (rank < bestRank) {
      best = sku;
      bestRank = rank;
    }
  }
  return best;
}

export interface DiscoveryResult {
  /** asin -> the SKU we will monitor. */
  skuByAsin: Map<string, string>;
  /** asin -> the title Amazon shows for it, when it gave one. */
  titleByAsin: Map<string, string | null>;
  /** asin -> every SKU Amazon returned, in its order. */
  allSkusByAsin: Map<string, string[]>;
  /** ASINs Amazon could not answer for. Only filled when `tolerateFailures`. */
  failed: string[];
  pages: number;
}

export interface DiscoverOptions {
  onLog?: (msg: string) => void;
  /**
   * Record a failed batch's ASINs in `failed` instead of throwing. The lookup
   * endpoint needs this: one bad batch must not fail a 300-ASIN import.
   */
  tolerateFailures?: boolean;
  /** Rate limiter; defaults to the process-wide listings pacer. */
  pacer?: Pacer;
}

/**
 * Which of these ASINs does the seller account actually list in this
 * marketplace, under which SKU, and with what title? Paced inside the listings
 * rate limit and paged to exhaustion.
 */
export async function discoverListings(
  asins: string[],
  marketplace: ExclusivesMarketplace,
  opts: DiscoverOptions = {},
): Promise<DiscoveryResult> {
  const onLog = opts.onLog ?? (() => {});
  const pacer = opts.pacer ?? sharedPacers().listings;
  const allSkusByAsin = new Map<string, string[]>();
  const titleByAsin = new Map<string, string | null>();
  const failed: string[] = [];
  let pages = 0;

  for (const group of batch(asins, LISTINGS_BATCH_SIZE)) {
    let pageToken: string | undefined;
    try {
      do {
        await pacer.acquire();
        const res = await searchListingsItems({
          marketplace,
          identifiers: group,
          identifiersType: 'ASIN',
          includedData: ['summaries'],
          pageSize: LISTINGS_BATCH_SIZE,
          pageToken,
        });
        pacer.observeLimit(res.rateLimit);
        pages += 1;

        for (const item of res.items) {
          const summary = item.summaries?.[0];
          const asin = summary?.asin;
          if (!asin) continue;
          const skus = allSkusByAsin.get(asin) ?? [];
          if (!skus.includes(item.sku)) skus.push(item.sku);
          allSkusByAsin.set(asin, skus);
          if (!titleByAsin.has(asin)) titleByAsin.set(asin, summary?.itemName ?? null);
        }

        pageToken = res.nextToken;
        if (pageToken) onLog(`  ${marketplace}: extra page for a batch of ${group.length} ASIN(s)`);
      } while (pageToken);
    } catch (err) {
      if (!opts.tolerateFailures) throw err;
      failed.push(...group);
      onLog(
        `  ${marketplace}: batch of ${group.length} ASIN(s) failed — ${(err as Error).message}`,
      );
    }
  }

  const skuByAsin = new Map([...allSkusByAsin].map(([asin, skus]) => [asin, pickSku(skus)]));
  return { skuByAsin, titleByAsin, allSkusByAsin, failed, pages };
}
