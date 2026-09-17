/* eslint-disable no-console */
import { readFileSync } from 'node:fs';
import type { ExclusivesMarketplace } from '@healthy-tasks/shared';
import { prisma } from '../src/db/prisma.js';
import { searchListingsItems } from '../src/services/exclusives/sp-api/listings.js';
import { Pacer, batch, SP_API_RATES } from '../src/services/exclusives/sp-api/pacer.js';
import { runIngestion } from '../src/services/exclusives/ingestion.service.js';

const GROUP_NAME = 'Versure Exclusives';

function loadAsins(): string[] {
  const raw = readFileSync('scripts/data/asins.txt', 'utf8');
  return [...new Set(raw.split('\n').map((s) => s.trim()).filter(Boolean))];
}

// For a marketplace, look up which of these ASINs Versure actually lists, and
// capture the SKU Amazon returns for each. Paced within the listings rate.
async function discover(
  asins: string[],
  marketplace: ExclusivesMarketplace,
): Promise<Map<string, string>> {
  const pacer = new Pacer(SP_API_RATES.listings);
  const found = new Map<string, string>(); // asin -> sku
  for (const group of batch(asins, 20)) {
    await pacer.acquire();
    const res = await searchListingsItems({
      marketplace,
      identifiers: group,
      identifiersType: 'ASIN',
      includedData: ['summaries'],
      pageSize: 20,
    });
    pacer.observeLimit(res.rateLimit);
    for (const item of res.items) {
      const asin = item.summaries?.[0]?.asin;
      if (asin && !found.has(asin)) found.set(asin, item.sku);
    }
  }
  return found;
}

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log('No user in DB — run db:seed first.');
    return;
  }

  const asins = loadAsins();
  console.log(`Loaded ${asins.length} ASINs.\n`);

  const existing = await prisma.alertGroup.findUnique({ where: { name: GROUP_NAME } });
  if (existing) await prisma.alertGroup.delete({ where: { id: existing.id } });
  const group = await prisma.alertGroup.create({
    data: { name: GROUP_NAME, groupType: 'GROUP', createdById: user.id },
  });

  console.log('Discovering US listings…');
  const us = await discover(asins, 'USA');
  console.log(`  ${us.size} ASINs listed in US`);
  console.log('Discovering CA listings…');
  const ca = await discover(asins, 'Canada');
  console.log(`  ${ca.size} ASINs listed in CA\n`);

  const rows = [
    ...[...us].map(([asin, sku]) => ({ marketplace: 'USA', asin, sku })),
    ...[...ca].map(([asin, sku]) => ({ marketplace: 'Canada', asin, sku })),
  ].map((r) => ({ ...r, groupId: group.id, createdById: user.id }));

  await prisma.listing.createMany({ data: rows, skipDuplicates: true });
  const listingCount = await prisma.listing.count({ where: { groupId: group.id } });

  const missing = asins.filter((a) => !us.has(a) && !ca.has(a));
  console.log(`Seeded ${listingCount} listings (US + CA).`);
  console.log(`ASINs with no listing in either marketplace: ${missing.length}`);
  if (missing.length) console.log(`  e.g. ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}`);

  console.log('\nRunning ingestion (rate-paced)…');
  const startedAt = Date.now();
  const report = await runIngestion((m) => console.log(`  ${m}`));
  const elapsed = Math.round((Date.now() - startedAt) / 1000);

  const snapCount = await prisma.listingSnapshot.count({ where: { listing: { groupId: group.id } } });
  console.log('\n=== Report ===');
  console.log(`ASINs provided:      ${asins.length}`);
  console.log(`Listed in US / CA:   ${us.size} / ${ca.size}`);
  console.log(`Listings monitored:  ${report.listingCount}`);
  console.log(`Snapshots written:   ${report.snapshotsWritten} (in DB: ${snapCount})`);
  console.log(`API calls:           listings=${report.calls.listings}, pricing=${report.calls.pricing}, catalog=${report.calls.catalog}`);
  console.log(`Elapsed:             ${elapsed}s`);

  await prisma.$disconnect();
}

void main();
