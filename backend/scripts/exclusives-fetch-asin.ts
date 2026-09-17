/* eslint-disable no-console */
import type { ExclusivesMarketplace } from '@healthy-tasks/shared';
import { searchListingsItems } from '../src/services/exclusives/sp-api/listings.js';
import { getListingOffersBatch, resolveBuyBox } from '../src/services/exclusives/sp-api/pricing.js';
import { mapListingSnapshot } from '../src/services/exclusives/snapshot.mapper.js';

async function fetchOne(asin: string, marketplace: ExclusivesMarketplace) {
  console.log(`\n=== ${marketplace} ===`);
  const res = await searchListingsItems({
    marketplace,
    identifiers: [asin],
    identifiersType: 'ASIN',
    includedData: ['summaries', 'attributes', 'issues', 'offers'],
  });
  const item = res.items[0];
  if (!item) {
    console.log('No listing for this ASIN (Versure is not listed here).');
    return;
  }

  const snap = mapListingSnapshot(item, marketplace);
  const { results } = await getListingOffersBatch([item.sku], marketplace);
  const bb = resolveBuyBox(results[0]?.payload);

  console.log(`SKU:          ${snap.sku}`);
  console.log(`ASIN:         ${snap.asin}`);
  console.log(`Title:        ${snap.title ?? '(none)'}`);
  console.log(`Brand:        ${snap.brand ?? '(none)'}`);
  console.log(`Category:     ${snap.category ?? '(none)'}`);
  console.log(`Main image:   ${snap.mainImageUrl ?? '(none)'}`);
  console.log(`Listed price: ${snap.listedPrice ?? '(none)'} ${snap.currency ?? ''}`);
  console.log(`Dimensions:   ${snap.dimensions ?? '(none)'}`);
  console.log(`Bullets (${snap.bulletPoints.length}):`);
  snap.bulletPoints.forEach((b, i) => console.log(`   ${i + 1}. ${b}`));
  console.log(`Description:   ${(snap.description ?? '(none)').slice(0, 200)}`);
  console.log(`Suppressed:   ${snap.isSuppressed}${snap.suppressionReason ? ` (${snap.suppressionReason})` : ''}`);
  console.log(`Buy Box:      ${bb.price ?? '(none)'} — winner ${bb.winnerSellerId ?? '(suppressed/none)'}`);
  console.log(`Offer count:  ${bb.offerCount ?? '(n/a)'}`);
  console.log(`Attribute keys (${Object.keys(item.attributes ?? {}).length}): ${Object.keys(item.attributes ?? {}).join(', ')}`);
}

async function main() {
  const asin = process.argv[2] ?? 'B000TMU63K';
  console.log(`Fetching ASIN ${asin} (read-only)…`);
  await fetchOne(asin, 'USA');
  await fetchOne(asin, 'Canada');
}

void main();
