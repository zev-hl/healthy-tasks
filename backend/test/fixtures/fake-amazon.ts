import type { ListingItem } from '../../src/services/exclusives/sp-api/listings.js';
import type { ListingOffersPayload } from '../../src/services/exclusives/sp-api/pricing.js';
import type { CatalogItem } from '../../src/services/exclusives/sp-api/catalog.js';
import { __setHttpHooks } from '../../src/services/exclusives/sp-api/http.js';
import { offersWeHold } from './exclusives.js';

// A stand-in for Amazon behind the SP-API transport's test seam: the LWA token
// endpoint, the three read calls a sweep makes, and the status probe. Nothing
// leaves the process.
// Restore the real network afterwards with __resetHttpHooks().

export interface PricingAnswer {
  statusCode: number;
  payload?: ListingOffersPayload;
}

/** What the fake Amazon knows. Read on every request, so tests may change it
 * between sweeps. Anything not listed is "not found". */
export interface FakeAmazonWorld {
  items: ListingItem[];
  pricing?: Record<string, PricingAnswer>; // default: 200 with a Buy Box we hold
  catalog?: CatalogItem[];
  failListings?: (marketplaceId: string) => boolean;
  failCatalog?: boolean;
  /** Return the pricing answers in reverse order (Amazon doesn't promise order). */
  reversePricing?: boolean;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const rejected = () => json(400, { errors: [{ code: 'InvalidInput', message: 'Bad request' }] });

/** Route all SP-API traffic to `world`. Returns the paths requested, in order. */
export function fakeAmazon(world: FakeAmazonWorld): { requests: string[] } {
  const requests: string[] = [];
  __setHttpHooks({
    sleep: async () => {},
    fetch: async (url, init) => {
      const u = new URL(String(url));
      if (u.host === 'api.amazon.com') return json(200, { access_token: 't', expires_in: 3600 });
      requests.push(u.pathname);

      if (u.pathname.startsWith('/listings/')) {
        if (world.failListings?.(u.searchParams.get('marketplaceIds') ?? '')) return rejected();
        const ids = new Set(u.searchParams.get('identifiers')!.split(','));
        const byAsin = u.searchParams.get('identifiersType') === 'ASIN';
        const matched = world.items.filter((i) =>
          byAsin ? ids.has(i.summaries?.[0]?.asin ?? '') : ids.has(i.sku),
        );
        // Like the real API: a page holds at most pageSize items and hands back
        // a token when more remain. The fake's token is simply the next offset.
        const pageSize = Number(u.searchParams.get('pageSize') ?? 10);
        const offset = Number(u.searchParams.get('pageToken') ?? 0);
        const page = matched.slice(offset, offset + pageSize);
        const nextOffset = offset + page.length;
        return json(200, {
          numberOfResults: matched.length,
          items: page,
          ...(nextOffset < matched.length ? { pagination: { nextToken: String(nextOffset) } } : {}),
        });
      }
      if (u.pathname === '/batches/products/pricing/v0/listingOffers') {
        const body = JSON.parse(String(init.body)) as {
          requests: { uri: string; MarketplaceId: string }[];
        };
        const responses = body.requests.map(({ uri, MarketplaceId }) => {
          const sku = decodeURIComponent(uri.split('/')[5]!);
          const answer = world.pricing?.[sku] ?? {
            statusCode: 200,
            payload: offersWeHold,
          };
          return {
            status: { statusCode: answer.statusCode },
            body: { payload: answer.payload },
            // Like the real API: every answer echoes what was asked, SKU included.
            request: { MarketplaceId, ItemCondition: 'New', SellerSKU: sku },
          };
        });
        if (world.reversePricing) responses.reverse();
        return json(200, { responses });
      }
      if (u.pathname === '/sellers/v1/marketplaceParticipations') {
        const participating = (countryCode: string) => ({
          marketplace: { countryCode },
          participation: { isParticipating: true },
        });
        return json(200, {
          payload: [participating('US'), participating('CA')],
        });
      }
      if (u.pathname === '/catalog/2022-04-01/items') {
        if (world.failCatalog) return rejected();
        const asins = new Set(u.searchParams.get('identifiers')!.split(','));
        return json(200, {
          items: (world.catalog ?? []).filter((i) => asins.has(i.asin!)),
        });
      }
      throw new Error(`unexpected request ${u.pathname}`);
    },
  });
  return { requests };
}

/** A BUYABLE listing with its own bullets (never needs the catalog), optionally priced. */
export const plainListing = (sku: string, price?: number): ListingItem => ({
  sku,
  summaries: [{ asin: `B0${sku}`, itemName: `Item ${sku}`, status: ['BUYABLE'] }],
  attributes: { bullet_point: [{ value: 'A bullet.' }] },
  offers: price == null ? [] : [{ price: { amount: price, currencyCode: 'USD' } }],
});

/** A resold listing: no brand content of its own, so it needs a catalog fill. */
export const resoldListing = (sku: string): ListingItem => ({
  sku,
  summaries: [{ asin: `B0${sku}`, itemName: `Item ${sku}`, status: ['BUYABLE'] }],
  attributes: {},
});
