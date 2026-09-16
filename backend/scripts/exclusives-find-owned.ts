/* eslint-disable no-console */
import { searchListingsItems } from '../src/services/exclusives/sp-api/listings.js';
import { mapListingSnapshot } from '../src/services/exclusives/snapshot.mapper.js';

// A brand-owned listing carries the seller's own content contribution; a pure
// reseller listing only has offer/fulfillment attributes.
const OWNED_SIGNALS = ['bullet_point', 'product_description'];
const MAX_PAGES = 15;

async function main() {
  console.log('Scanning Versure US listings for brand-owned ones (read-only)…\n');
  const owned: import('../src/services/exclusives/sp-api/listings.js').ListingItem[] = [];
  let scanned = 0;
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES && owned.length < 3; page++) {
    const res = await searchListingsItems({
      marketplace: 'USA',
      pageSize: 20,
      pageToken,
      includedData: ['summaries', 'attributes', 'issues', 'offers'],
    });
    for (const item of res.items) {
      scanned++;
      const keys = Object.keys(item.attributes ?? {});
      if (OWNED_SIGNALS.some((k) => keys.includes(k))) owned.push(item);
    }
    pageToken = res.nextToken;
    if (!pageToken) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`Scanned ${scanned} listings; ${owned.length} look brand-owned.\n`);

  const item = owned[0];
  if (!item) {
    console.log('No brand-owned listing found in the scanned pages.');
    console.log('→ This account may be mostly reseller listings; owned content would need the Catalog Items API.');
    return;
  }

  const snap = mapListingSnapshot(item, 'USA');
  console.log('First brand-owned listing, mapped:');
  console.log(`  SKU:          ${snap.sku}`);
  console.log(`  ASIN:         ${snap.asin ?? '(none)'}`);
  console.log(`  Title:        ${snap.title ?? '(none)'}`);
  console.log(`  Brand:        ${snap.brand ?? '(none)'}`);
  console.log(`  Category:     ${snap.category ?? '(none)'}`);
  console.log(`  Main image:   ${snap.mainImageUrl ?? '(none)'}`);
  console.log(`  Price:        ${snap.listedPrice ?? '(none)'} ${snap.currency ?? ''}`);
  console.log(`  Dimensions:   ${snap.dimensions ?? '(none)'}`);
  console.log(`  Bullets (${snap.bulletPoints.length}): ${snap.bulletPoints.slice(0, 3).join(' | ') || '(none)'}`);
  console.log(`  Description:  ${(snap.description ?? '(none)').slice(0, 160)}`);
  console.log(`  Suppressed:   ${snap.isSuppressed}${snap.suppressionReason ? ` (${snap.suppressionReason})` : ''}`);
  console.log(`\n  Attribute keys (${Object.keys(item.attributes ?? {}).length}): ${Object.keys(item.attributes ?? {}).join(', ')}`);
}

void main();
