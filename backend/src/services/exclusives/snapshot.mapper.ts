import type { ExclusivesMarketplace } from '@healthy-tasks/shared';
import type { ListingAttributes, ListingIssue, ListingItem } from './sp-api/listings.js';
import type { CatalogItem } from './sp-api/catalog.js';

// The listing half of a snapshot. Buy Box winner/price and offer count come
// from the pricing call (3d) and are merged in later.
export interface ListingSnapshotDraft {
  sku: string;
  marketplace: ExclusivesMarketplace;
  asin?: string;
  title?: string;
  mainImageUrl?: string;
  category?: string;
  brand?: string;
  bulletPoints: string[];
  description?: string;
  dimensions?: string;
  listedPrice?: number;
  currency?: string;
  isSuppressed: boolean;
  suppressionReason?: string;
  // Filled from the pricing read (3d) during the sweep merge.
  buyboxWinnerSellerId?: string | null;
  buyboxPrice?: number | null;
  offerCount?: number | null;
}

function values(attrs: ListingAttributes, key: string): Array<Record<string, unknown>> {
  const v = attrs[key];
  return Array.isArray(v) ? v : [];
}

function first(attrs: ListingAttributes, key: string): string | undefined {
  const raw = values(attrs, key)[0]?.value;
  return typeof raw === 'string' ? raw : raw != null ? String(raw) : undefined;
}

/**
 * Amazon spells units out in full — "centimeters", "inches". Three of those in
 * one line makes a dimension string hard to read, and it ends up quoted inside
 * an alert message, so it is shortened at the point it is built rather than
 * patched up later in the UI.
 *
 * An unrecognised unit is kept as Amazon sent it: better an odd-looking line
 * than a measurement with no unit at all.
 */
const SHORT_UNIT: Record<string, string> = {
  centimeters: 'cm',
  centimeter: 'cm',
  millimeters: 'mm',
  millimeter: 'mm',
  meters: 'm',
  meter: 'm',
  inches: 'in',
  inch: 'in',
  feet: 'ft',
  foot: 'ft',
};

function dimension(dim: Record<string, unknown> | undefined): string | undefined {
  if (!dim) return undefined;
  const part = (k: string) => {
    const d = dim[k] as { value?: unknown; unit?: string } | undefined;
    if (d?.value == null) return null;
    const unit = d.unit ? (SHORT_UNIT[d.unit.toLowerCase()] ?? d.unit) : '';
    return `${d.value}${unit}`;
  };
  const lwh = ['length', 'width', 'height'].map(part).filter(Boolean);
  return lwh.length ? lwh.join(' x ') : undefined;
}

function extractDimensions(attrs: ListingAttributes): string | undefined {
  const box = values(attrs, 'item_package_dimensions')[0] ?? values(attrs, 'item_dimensions')[0];
  return dimension(box);
}

function extractImage(item: ListingItem): string | undefined {
  const fromSummary = item.summaries?.[0]?.mainImage?.link;
  if (fromSummary) return fromSummary;
  const loc = values(item.attributes ?? {}, 'main_product_image_locator')[0];
  const url = loc?.media_location ?? loc?.value;
  return typeof url === 'string' ? url : undefined;
}

function extractPrice(item: ListingItem): { amount?: number; currency?: string } {
  const offer = item.offers?.find((o) => o.price?.amount != null);
  if (offer?.price?.amount != null) {
    return { amount: Number(offer.price.amount), currency: offer.price.currencyCode };
  }
  const attr = values(item.attributes ?? {}, 'purchasable_offer')[0];
  const schedule = (
    attr?.our_price as Array<{ schedule?: Array<{ value_with_tax?: number }> }>
  )?.[0];
  const amount = schedule?.schedule?.[0]?.value_with_tax;
  const currency = typeof attr?.currency === 'string' ? attr.currency : undefined;
  return { amount: amount != null ? Number(amount) : undefined, currency };
}

// A BUYABLE listing is purchasable, so it is never suppressed even if it
// carries ERROR-severity issues. Otherwise: an explicit suppression enforcement
// always counts; an ERROR-severity issue counts only when not BUYABLE. Empty
// issues + no BUYABLE is zero inventory, not suppression (brief §6.5).
function detectSuppression(
  issues: ListingIssue[],
  status: string[],
): { suppressed: boolean; reason?: string } {
  const enforced = issues.find((i) =>
    (i.enforcements?.actions ?? []).some(
      (a) => a.action === 'LISTING_SUPPRESSED' || a.action === 'SEARCH_SUPPRESSED',
    ),
  );
  if (enforced) return { suppressed: true, reason: enforced.message };

  if (!status.includes('BUYABLE')) {
    const err = issues.find((i) => i.severity === 'ERROR');
    if (err) return { suppressed: true, reason: err.message };
  }
  return { suppressed: false };
}

export interface CatalogContent {
  brand?: string;
  bulletPoints?: string[];
  description?: string;
  dimensions?: string;
  mainImageUrl?: string;
}

// Extract the content fields from a Catalog Items response — used to fill gaps
// on resold listings whose own attributes carry no brand content.
export function mapCatalogContent(item: CatalogItem): CatalogContent {
  const attrs = item.attributes ?? {};
  const bullets = values(attrs, 'bullet_point')
    .map((b) => b.value)
    .filter((v): v is string => typeof v === 'string');
  return {
    brand: item.summaries?.[0]?.brand ?? first(attrs, 'brand'),
    bulletPoints: bullets.length ? bullets : undefined,
    description: first(attrs, 'product_description'),
    dimensions: extractDimensions(attrs),
    mainImageUrl: item.images?.[0]?.images?.find((i) => i.variant === 'MAIN')?.link,
  };
}

export function mapListingSnapshot(
  item: ListingItem,
  marketplace: ExclusivesMarketplace,
): ListingSnapshotDraft {
  const summary = item.summaries?.[0];
  const attrs = item.attributes ?? {};
  const price = extractPrice(item);
  const suppression = detectSuppression(item.issues ?? [], summary?.status ?? []);

  return {
    sku: item.sku,
    marketplace,
    asin: summary?.asin,
    title: summary?.itemName ?? first(attrs, 'item_name'),
    mainImageUrl: extractImage(item),
    category: summary?.productType,
    brand: first(attrs, 'brand') ?? summary?.brand,
    bulletPoints: values(attrs, 'bullet_point')
      .map((b) => b.value)
      .filter((v): v is string => typeof v === 'string'),
    description: first(attrs, 'product_description'),
    dimensions: extractDimensions(attrs),
    listedPrice: price.amount,
    currency: price.currency,
    isSuppressed: suppression.suppressed,
    suppressionReason: suppression.reason,
  };
}
