/* eslint-disable no-console */
import { searchListingsItems } from '../src/services/exclusives/sp-api/listings.js';
import { sweepListings, type MonitoredListing } from '../src/services/exclusives/sweep.service.js';

async function findBuyableSkus(target: number): Promise<string[]> {
  const skus: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 25 && skus.length < target; page++) {
    const res = await searchListingsItems({
      marketplace: 'USA',
      pageSize: 20,
      pageToken,
      includedData: ['summaries'],
    });
    for (const item of res.items) {
      if ((item.summaries?.[0]?.status ?? []).includes('BUYABLE')) skus.push(item.sku);
      if (skus.length >= target) break;
    }
    pageToken = res.nextToken;
    if (!pageToken) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return skus;
}

async function main() {
  console.log('Collecting a few BUYABLE US SKUs to sweep…');
  const skus = await findBuyableSkus(4);
  if (skus.length === 0) {
    console.log('No BUYABLE SKUs found.');
    return;
  }
  console.log(`Sweeping: ${skus.join(', ')}\n`);

  const listings: MonitoredListing[] = skus.map((sku) => ({ sku, marketplace: 'USA' }));
  const startedAt = Date.now();
  const result = await sweepListings(listings, (m) => console.log(`  · ${m}`));
  const elapsed = Date.now() - startedAt;

  for (const s of result.snapshots) {
    console.log(`SKU ${s.sku} / ASIN ${s.asin ?? '?'}`);
    console.log(`  Title:    ${(s.title ?? '(none)').slice(0, 70)}`);
    console.log(`  Price:    ${s.listedPrice ?? '(none)'} ${s.currency ?? ''}`);
    console.log(`  Buy Box:  ${s.buyboxPrice ?? '(none)'} — winner ${s.buyboxWinnerSellerId ?? '(suppressed)'}`);
    console.log(`  Offers:   ${s.offerCount ?? '(n/a)'}   Suppressed: ${s.isSuppressed}`);
    console.log('');
  }

  console.log(`Calls: listings=${result.calls.listings}, pricing=${result.calls.pricing}`);
  console.log(`By marketplace: ${JSON.stringify(result.callsByMarketplace)}`);
  console.log(`Snapshots: ${result.snapshots.length}   Elapsed: ${elapsed} ms`);
}

void main();
