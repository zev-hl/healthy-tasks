import type { ExclusivesMarketplace } from '@healthy-tasks/shared';
import { spApiRequest } from './client.js';
import { AMAZON_MARKETPLACE_ID } from './marketplaces.js';

interface Money {
  Amount?: number;
  CurrencyCode?: string;
}

export interface Offer {
  SellerId?: string;
  ListingPrice?: Money;
  Shipping?: Money;
  IsBuyBoxWinner?: boolean;
}

export interface OffersSummary {
  TotalOfferCount?: number;
  BuyBoxPrices?: Array<{ condition?: string; LandedPrice?: Money }>;
}

export interface ListingOffersPayload {
  ASIN?: string;
  SKU?: string;
  status?: string;
  Summary?: OffersSummary;
  Offers?: Offer[];
}

export interface OffersResult {
  sku: string;
  statusCode?: number;
  payload?: ListingOffersPayload;
  errors?: unknown;
}

export interface OffersBatchResult {
  results: OffersResult[];
  rateLimit: number | null;
}

// Read-only despite being POST-shaped (whitelisted). Up to 20 SKUs per call.
export async function getListingOffersBatch(
  skus: string[],
  marketplace: ExclusivesMarketplace,
): Promise<OffersBatchResult> {
  const marketplaceId = AMAZON_MARKETPLACE_ID[marketplace];
  const requests = skus.map((sku) => ({
    uri: `/products/pricing/v0/listings/${encodeURIComponent(sku)}/offers`,
    method: 'GET',
    MarketplaceId: marketplaceId,
    ItemCondition: 'New',
  }));

  const res = await spApiRequest<{
    responses?: Array<{
      status?: { statusCode?: number };
      body?: { payload?: ListingOffersPayload; errors?: unknown };
    }>;
  }>({
    method: 'POST',
    path: '/batches/products/pricing/v0/listingOffers',
    body: { requests },
  });

  const responses = res.data.responses ?? [];
  const results = skus.map((sku, i) => ({
    sku,
    statusCode: responses[i]?.status?.statusCode,
    payload: responses[i]?.body?.payload,
    errors: responses[i]?.body?.errors,
  }));
  return { results, rateLimit: res.rateLimit };
}

export interface BuyBox {
  winnerSellerId: string | null;
  price: number | null;
  offerCount: number | null;
}

// Do NOT trust IsBuyBoxWinner (brief §6.4). Take the Buy Box landed price from
// the summary; a missing price means the Buy Box is suppressed. Otherwise match
// the offer whose listing + shipping equals that landed price.
export function resolveBuyBox(payload: ListingOffersPayload | undefined): BuyBox {
  const summary = payload?.Summary;
  const offerCount = summary?.TotalOfferCount ?? null;
  const price = summary?.BuyBoxPrices?.[0]?.LandedPrice?.Amount ?? null;
  if (price == null) {
    return { winnerSellerId: null, price: null, offerCount };
  }
  const winner = (payload?.Offers ?? []).find((o) => {
    const landed = (o.ListingPrice?.Amount ?? 0) + (o.Shipping?.Amount ?? 0);
    return Math.abs(landed - price) < 0.01;
  });
  return { winnerSellerId: winner?.SellerId ?? null, price, offerCount };
}
