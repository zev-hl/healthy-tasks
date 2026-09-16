/* eslint-disable no-console */
import { prisma } from '../src/db/prisma.js';
import { searchListingsItems } from '../src/services/exclusives/sp-api/listings.js';
import { sweepListings } from '../src/services/exclusives/sweep.service.js';
import { persistSnapshots } from '../src/services/exclusives/snapshot.repository.js';

async function findBuyable(): Promise<{ sku: string; asin: string } | null> {
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await searchListingsItems({ marketplace: 'USA', pageSize: 20, pageToken, includedData: ['summaries'] });
    for (const item of res.items) {
      const s = item.summaries?.[0];
      if (s?.asin && (s.status ?? []).includes('BUYABLE')) return { sku: item.sku, asin: s.asin };
    }
    pageToken = res.nextToken;
    if (!pageToken) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log('No user in DB — run db:seed first.');
    return;
  }

  const found = await findBuyable();
  if (!found) {
    console.log('No BUYABLE listing found to test with.');
    return;
  }
  console.log(`Using SKU ${found.sku} / ASIN ${found.asin}\n`);

  const group = await prisma.alertGroup.upsert({
    where: { name: 'Ingestion Test' },
    update: {},
    create: { name: 'Ingestion Test', groupType: 'GROUP', createdById: user.id },
  });
  const listing = await prisma.listing.upsert({
    where: { marketplace_asin: { marketplace: 'USA', asin: found.asin } },
    update: { sku: found.sku },
    create: { groupId: group.id, marketplace: 'USA', asin: found.asin, sku: found.sku, createdById: user.id },
  });

  const { snapshots } = await sweepListings([{ sku: found.sku, marketplace: 'USA' }]);
  const count = await persistSnapshots(snapshots.map((draft) => ({ listingId: listing.id, draft })));
  console.log(`Persisted ${count} snapshot row(s) for listing #${listing.id}\n`);

  const latest = await prisma.listingSnapshot.findFirst({
    where: { listingId: listing.id },
    orderBy: { capturedAt: 'desc' },
  });
  console.log('Latest snapshot row from DB:');
  console.log({
    id: latest?.id,
    title: latest?.title?.slice(0, 60),
    brand: latest?.brand,
    listedPrice: latest?.listedPrice?.toString(),
    currency: latest?.currency,
    buyboxPrice: latest?.buyboxPrice?.toString(),
    buyboxWinnerSellerId: latest?.buyboxWinnerSellerId,
    offerCount: latest?.offerCount,
    isSuppressed: latest?.isSuppressed,
    bulletPoints: Array.isArray(latest?.bulletPoints) ? (latest?.bulletPoints as unknown[]).length + ' bullets' : latest?.bulletPoints,
    capturedAt: latest?.capturedAt,
  });

  await prisma.$disconnect();
}

void main();
