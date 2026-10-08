import type { ExclusivesMarketplace } from '@healthy-tasks/shared';
import { env } from '../../../config/env.js';
import { spApiRequest } from './client.js';
import { AMAZON_MARKETPLACE_ID } from './marketplaces.js';
import { SpApiAuthError } from './errors.js';

export interface ListingSummary {
  marketplaceId?: string;
  asin?: string;
  productType?: string;
  itemName?: string;
  brand?: string;
  mainImage?: { link?: string };
  status?: string[];
}

export interface ListingIssue {
  code?: string;
  message?: string;
  severity?: string;
  enforcements?: { actions?: { action?: string }[] };
}

export interface ListingOffer {
  offerType?: string;
  price?: { amount?: string | number; currencyCode?: string };
}

export type ListingAttributes = Record<string, Array<Record<string, unknown>>>;

export interface ListingItem {
  sku: string;
  summaries?: ListingSummary[];
  attributes?: ListingAttributes;
  issues?: ListingIssue[];
  offers?: ListingOffer[];
}

export interface SearchListingsResult {
  numberOfResults?: number;
  nextToken?: string;
  items: ListingItem[];
  rateLimit: number | null;
}

function sellerId(): string {
  const id = env.amazon.merchantToken;
  if (!id) throw new SpApiAuthError('SP_API_MERCHANT_TOKEN is not set.');
  return id;
}

export async function searchListingsItems(opts: {
  marketplace: ExclusivesMarketplace;
  identifiers?: string[];
  identifiersType?: 'SKU' | 'ASIN';
  includedData?: string[];
  pageSize?: number;
  pageToken?: string;
  pace?: () => Promise<void>;
}): Promise<SearchListingsResult> {
  const query: Record<string, string | number | undefined> = {
    marketplaceIds: AMAZON_MARKETPLACE_ID[opts.marketplace],
    includedData: (opts.includedData ?? ['summaries']).join(','),
    pageSize: opts.pageSize ?? 10,
    pageToken: opts.pageToken,
  };
  if (opts.identifiers?.length) {
    query.identifiers = opts.identifiers.join(',');
    query.identifiersType = opts.identifiersType ?? 'SKU';
  }

  const res = await spApiRequest<{
    numberOfResults?: number;
    pagination?: { nextToken?: string };
    items?: ListingItem[];
  }>({
    method: 'GET',
    path: `/listings/2021-08-01/items/${sellerId()}`,
    query,
    pace: opts.pace,
  });

  return {
    numberOfResults: res.data.numberOfResults,
    nextToken: res.data.pagination?.nextToken,
    items: res.data.items ?? [],
    rateLimit: res.rateLimit,
  };
}
