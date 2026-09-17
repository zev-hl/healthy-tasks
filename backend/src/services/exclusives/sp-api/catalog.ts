import type { ExclusivesMarketplace } from '@healthy-tasks/shared';
import { spApiRequest } from './client.js';
import { AMAZON_MARKETPLACE_ID } from './marketplaces.js';

export interface CatalogSummary {
  itemName?: string;
  brand?: string;
  manufacturer?: string;
  browseClassification?: { displayName?: string; classificationId?: string };
}

export interface CatalogImageSet {
  images?: Array<{ variant?: string; link?: string; height?: number; width?: number }>;
}

export interface CatalogItem {
  asin?: string;
  summaries?: CatalogSummary[];
  attributes?: Record<string, Array<Record<string, unknown>>>;
  images?: CatalogImageSet[];
}

const CONTENT_DATA = ['summaries', 'attributes', 'images'];

// Amazon's displayed catalog content for an ASIN (read-only GET). Works by ASIN
// regardless of who owns the listing — used to fill brand/bullets/description/
// dimensions for resold listings where searchListingsItems returns none.
export async function getCatalogItem(
  asin: string,
  marketplace: ExclusivesMarketplace,
  includedData: string[] = CONTENT_DATA,
): Promise<CatalogItem> {
  const res = await spApiRequest<CatalogItem>({
    method: 'GET',
    path: `/catalog/2022-04-01/items/${encodeURIComponent(asin)}`,
    query: {
      marketplaceIds: AMAZON_MARKETPLACE_ID[marketplace],
      includedData: includedData.join(','),
    },
  });
  return res.data;
}

export interface CatalogSearchResult {
  items: CatalogItem[];
  rateLimit: number | null;
}

// Batch content lookup (up to 20 ASINs per call) for the conditional supplement.
export async function searchCatalogItems(
  asins: string[],
  marketplace: ExclusivesMarketplace,
): Promise<CatalogSearchResult> {
  const res = await spApiRequest<{ items?: CatalogItem[] }>({
    method: 'GET',
    path: '/catalog/2022-04-01/items',
    query: {
      identifiers: asins.join(','),
      identifiersType: 'ASIN',
      marketplaceIds: AMAZON_MARKETPLACE_ID[marketplace],
      includedData: CONTENT_DATA.join(','),
      pageSize: 20,
    },
  });
  return { items: res.data.items ?? [], rateLimit: res.rateLimit };
}
