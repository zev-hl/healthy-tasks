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
  /** Anything odd about how answers lined up with SKUs (for the sweep log). */
  warnings: string[];
}

/** One answer in Amazon's batch reply. */
export interface BatchAnswer {
  status?: { statusCode?: number };
  body?: { payload?: ListingOffersPayload; errors?: unknown };
  /** Amazon's copy of what we asked — present on every answer, errors included. */
  request?: { SellerSKU?: string; MarketplaceId?: string };
}

// The SKU an answer is for: from Amazon's copy of our request, else from the
// price data itself (only successful answers carry that).
const answerSku = (answer: BatchAnswer): string | undefined =>
  answer.request?.SellerSKU ?? answer.body?.payload?.SKU;

/**
 * Give each SKU we asked about the answer that is FOR that SKU — matched by the
 * SKU the answer names, never by its place in the list, because Amazon doesn't
 * promise to keep the order. Only an answer that names no SKU at all falls back
 * to its position (and says so). An answer naming a SKU we didn't ask about is
 * ignored; a SKU left without an answer gets none, and the sweep then skips it
 * this round (no false alerts). Pure — no I/O.
 */
export function matchAnswersToSkus(
  skus: string[],
  answers: BatchAnswer[],
): { results: OffersResult[]; warnings: string[] } {
  const asked = new Set(skus);
  const bySku = new Map<string, BatchAnswer>();
  const unnamed: number[] = [];
  const warnings: string[] = [];
  let outOfOrder = false;

  answers.forEach((answer, i) => {
    const sku = answerSku(answer);
    if (sku === undefined) {
      unnamed.push(i);
    } else if (!asked.has(sku)) {
      warnings.push(`pricing answer for ${sku}, which was not asked about — ignored`);
    } else if (!bySku.has(sku)) {
      if (sku !== skus[i]) outOfOrder = true;
      bySku.set(sku, answer);
    }
  });
  // Last resort, after every named answer is placed so a guess never displaces one.
  for (const i of unnamed) {
    const sku = skus[i];
    if (sku !== undefined && !bySku.has(sku)) {
      bySku.set(sku, answers[i]!);
      warnings.push(`pricing answer #${i + 1} names no SKU — matched to ${sku} by position`);
    }
  }
  if (outOfOrder) {
    warnings.push('pricing answers came back in a different order than asked — matched by SKU');
  }

  const results = skus.map((sku) => {
    const answer = bySku.get(sku);
    return {
      sku,
      statusCode: answer?.status?.statusCode,
      payload: answer?.body?.payload,
      errors: answer?.body?.errors,
    };
  });
  return { results, warnings };
}

// Read-only despite being POST-shaped (whitelisted). Up to 20 SKUs per call.
export async function getListingOffersBatch(
  skus: string[],
  marketplace: ExclusivesMarketplace,
  pace?: () => Promise<void>,
): Promise<OffersBatchResult> {
  const marketplaceId = AMAZON_MARKETPLACE_ID[marketplace];
  const requests = skus.map((sku) => ({
    uri: `/products/pricing/v0/listings/${encodeURIComponent(sku)}/offers`,
    method: 'GET',
    MarketplaceId: marketplaceId,
    ItemCondition: 'New',
  }));

  const res = await spApiRequest<{ responses?: BatchAnswer[] }>({
    method: 'POST',
    path: '/batches/products/pricing/v0/listingOffers',
    body: { requests },
    pace,
  });

  const { results, warnings } = matchAnswersToSkus(skus, res.data.responses ?? []);
  return { results, rateLimit: res.rateLimit, warnings };
}

// The batch call succeeded but this SKU's own answer can't be trusted this
// cycle: none came back, or it was throttled / a server error. A 4xx (e.g. the
// "invalid SKU" a not-buyable listing gets) is a real answer — no Buy Box.
export function isTransientOfferResult(result: OffersResult | undefined): boolean {
  const status = result?.statusCode;
  return status == null || status === 429 || status >= 500;
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
