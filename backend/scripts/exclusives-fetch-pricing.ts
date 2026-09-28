/* eslint-disable no-console */
import { env } from '../src/config/env.js';
import { searchListingsItems } from '../src/services/exclusives/sp-api/listings.js';
import { getListingOffersBatch, resolveBuyBox } from '../src/services/exclusives/sp-api/pricing.js';

// Pricing-by-SKU only works for SKUs with a live offer (BUYABLE).
async function findBuyableSku(): Promise<string | undefined> {
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await searchListingsItems({
      marketplace: 'USA',
      pageSize: 20,
      pageToken,
      includedData: ['summaries'],
    });
    const hit = res.items.find((i) => (i.summaries?.[0]?.status ?? []).includes('BUYABLE'));
    if (hit) return hit.sku;
    pageToken = res.nextToken;
    if (!pageToken) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return undefined;
}

async function main() {
  let skus = process.argv.slice(2);
  if (skus.length === 0) {
    console.log('No SKU given — searching for a BUYABLE US SKU…');
    const sku = await findBuyableSku();
    if (!sku) {
      console.log('No BUYABLE SKU found in the scanned pages.');
      return;
    }
    console.log(`Using ${sku}\n`);
    skus = [sku];
  }
  const me = env.amazon.merchantToken;
  console.log(`Fetching Buy Box / offers for US SKUs: ${skus.join(', ')} (read-only)…\n`);

  try {
    const { results } = await getListingOffersBatch(skus, 'USA');
    for (const r of results) {
      if (!r.payload) {
        console.log(`SKU ${r.sku}: no data (status ${r.statusCode ?? 'n/a'})`);
        if (r.errors) console.log(`  errors: ${JSON.stringify(r.errors)}`);
        continue;
      }
      const bb = resolveBuyBox(r.payload);
      const holder =
        bb.winnerSellerId == null
          ? 'suppressed (no Buy Box)'
          : bb.winnerSellerId === me
            ? `US (${bb.winnerSellerId})`
            : `competitor (${bb.winnerSellerId})`;
      console.log(`SKU ${r.sku} / ASIN ${r.payload.ASIN ?? '?'}`);
      console.log(`  Offer count:   ${bb.offerCount ?? '(n/a)'}`);
      console.log(`  Buy Box price: ${bb.price ?? '(none)'}`);
      console.log(`  Buy Box held:  ${holder}`);
      console.log(`  We hold it:    ${bb.winnerSellerId != null && bb.winnerSellerId === me}`);
      console.log('');
    }
  } catch (err) {
    console.error('FAILED:', (err as Error).message);
    process.exitCode = 1;
  }
}

void main();
