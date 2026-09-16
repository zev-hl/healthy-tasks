/* eslint-disable no-console */
import { searchListingsItems } from '../src/services/exclusives/sp-api/listings.js';
import { mapListingSnapshot } from '../src/services/exclusives/snapshot.mapper.js';

async function main() {
  console.log('Fetching one Versure US listing with full detail (read-only)…\n');
  try {
    const res = await searchListingsItems({
      marketplace: 'USA',
      pageSize: 1,
      includedData: ['summaries', 'attributes', 'issues', 'offers'],
    });

    const item = res.items[0];
    if (!item) {
      console.log('No item returned.');
      return;
    }

    const snap = mapListingSnapshot(item, 'USA');
    console.log('Mapped snapshot fields:');
    console.log(`  SKU:          ${snap.sku}`);
    console.log(`  ASIN:         ${snap.asin ?? '(none)'}`);
    console.log(`  Title:        ${snap.title ?? '(none)'}`);
    console.log(`  Brand:        ${snap.brand ?? '(none)'}`);
    console.log(`  Category:     ${snap.category ?? '(none)'}`);
    console.log(`  Main image:   ${snap.mainImageUrl ?? '(none)'}`);
    console.log(`  Price:        ${snap.listedPrice ?? '(none)'} ${snap.currency ?? ''}`);
    console.log(`  Dimensions:   ${snap.dimensions ?? '(none)'}`);
    console.log(`  Bullets:      ${snap.bulletPoints.length} → ${snap.bulletPoints.slice(0, 2).join(' | ') || '(none)'}`);
    console.log(`  Description:  ${(snap.description ?? '(none)').slice(0, 120)}`);
    console.log(`  Suppressed:   ${snap.isSuppressed}${snap.suppressionReason ? ` (${snap.suppressionReason})` : ''}`);

    console.log(`\nAttribute keys present (${Object.keys(item.attributes ?? {}).length}):`);
    console.log('  ' + Object.keys(item.attributes ?? {}).join(', '));
  } catch (err) {
    console.error('FAILED:', (err as Error).message);
    process.exitCode = 1;
  }
}

void main();
