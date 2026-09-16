/* eslint-disable no-console */
import { prisma } from '../src/db/prisma.js';
import { searchListingsItems } from '../src/services/exclusives/sp-api/listings.js';
import { Pacer, SP_API_RATES } from '../src/services/exclusives/sp-api/pacer.js';
import { runIngestion } from '../src/services/exclusives/ingestion.service.js';

const SEED_LIMIT = 50;
const MAX_PAGES = 150;
// A listing is Versure-owned when it carries the seller's own brand content;
// resold/other-brand listings only have offer/fulfillment attributes.
const OWNED_SIGNALS = ['bullet_point', 'product_description'];

// Paced page-through of US listings, collecting up to `limit` distinct
// Versure-OWNED ASINs (skipping resold ones).
async function gatherOwnedUsListings(limit: number): Promise<Array<{ sku: string; asin: string }>> {
  const pacer = new Pacer(SP_API_RATES.listings);
  const seen = new Set<string>();
  const out: Array<{ sku: string; asin: string }> = [];
  let pageToken: string | undefined;
  let pages = 0;

  while (out.length < limit && pages < MAX_PAGES) {
    await pacer.acquire();
    const res = await searchListingsItems({
      marketplace: 'USA',
      pageSize: 20,
      pageToken,
      includedData: ['summaries', 'attributes'],
    });
    pacer.observeLimit(res.rateLimit);
    pages += 1;

    for (const item of res.items) {
      const asin = item.summaries?.[0]?.asin;
      const owned = OWNED_SIGNALS.some((k) => k in (item.attributes ?? {}));
      if (asin && owned && !seen.has(asin)) {
        seen.add(asin);
        out.push({ sku: item.sku, asin });
        if (out.length >= limit) break;
      }
    }
    pageToken = res.nextToken;
    if (!pageToken) break;
  }
  console.log(`Scanned ${pages} page(s) (~${pages * 20} listings); found ${out.length} owned.`);
  return out;
}

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log('No user in DB — run db:seed first.');
    return;
  }

  // Reset any prior test data (cascades to listings + snapshots).
  const old = await prisma.alertGroup.findUnique({ where: { name: 'Ingestion Test' } });
  if (old) {
    await prisma.alertGroup.delete({ where: { id: old.id } });
    console.log('Reset previous "Ingestion Test" group.');
  }

  console.log(`Gathering up to ${SEED_LIMIT} Versure-OWNED US ASINs (rate-paced)…`);
  const listings = await gatherOwnedUsListings(SEED_LIMIT);
  console.log(`Collected ${listings.length} distinct owned ASINs.\n`);

  const group = await prisma.alertGroup.create({
    data: { name: 'Ingestion Test', groupType: 'GROUP', createdById: user.id },
  });
  await prisma.listing.createMany({
    data: listings.map((l) => ({
      groupId: group.id,
      marketplace: 'USA',
      asin: l.asin,
      sku: l.sku,
      createdById: user.id,
    })),
    skipDuplicates: true,
  });
  const seeded = await prisma.listing.count({ where: { groupId: group.id } });
  console.log(`Seeded ${seeded} listings into group #${group.id}.\n`);

  const startedAt = Date.now();
  const report = await runIngestion((m) => console.log(m));
  const elapsed = Date.now() - startedAt;

  const total = await prisma.listingSnapshot.count({
    where: { listing: { groupId: group.id } },
  });
  console.log('\n=== Ingestion report ===');
  console.log(`Monitored listings: ${report.listingCount}`);
  console.log(`Snapshots written:  ${report.snapshotsWritten} (total in DB for group: ${total})`);
  console.log(`API calls:          listings=${report.calls.listings}, pricing=${report.calls.pricing}`);
  console.log(`By marketplace:     ${JSON.stringify(report.callsByMarketplace)}`);
  console.log(`Elapsed:            ${elapsed} ms`);

  await prisma.$disconnect();
}

void main();
