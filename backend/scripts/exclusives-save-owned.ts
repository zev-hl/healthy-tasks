/* eslint-disable no-console */
import { prisma } from '../src/db/prisma.js';
import { searchListingsItems } from '../src/services/exclusives/sp-api/listings.js';
import { sweepListings } from '../src/services/exclusives/sweep.service.js';
import { persistSnapshots } from '../src/services/exclusives/snapshot.repository.js';

const OWNED_SIGNALS = ['bullet_point', 'product_description'];

async function findOwned(): Promise<{ sku: string; asin: string } | null> {
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await searchListingsItems({
      marketplace: 'USA',
      pageSize: 20,
      pageToken,
      includedData: ['summaries', 'attributes'],
    });
    for (const item of res.items) {
      const keys = Object.keys(item.attributes ?? {});
      const asin = item.summaries?.[0]?.asin;
      if (asin && OWNED_SIGNALS.some((k) => keys.includes(k))) return { sku: item.sku, asin };
    }
    pageToken = res.nextToken;
    if (!pageToken) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

async function main() {
  // 1. Remove the previous test data (cascades to its listings + snapshots).
  const old = await prisma.alertGroup.findUnique({ where: { name: 'Ingestion Test' } });
  if (old) {
    await prisma.alertGroup.delete({ where: { id: old.id } });
    console.log('Deleted previous "Ingestion Test" group (and its listings/snapshots).\n');
  }

  const user = await prisma.user.findFirst();
  if (!user) {
    console.log('No user in DB — run db:seed first.');
    return;
  }

  const owned = await findOwned();
  if (!owned) {
    console.log('No Versure-owned listing found in the scanned pages.');
    return;
  }
  console.log(`Owned listing: SKU ${owned.sku} / ASIN ${owned.asin}\n`);

  const group = await prisma.alertGroup.create({
    data: { name: 'Ingestion Test', groupType: 'GROUP', createdById: user.id },
  });
  const listing = await prisma.listing.create({
    data: { groupId: group.id, marketplace: 'USA', asin: owned.asin, sku: owned.sku, createdById: user.id },
  });

  const { snapshots } = await sweepListings([{ sku: owned.sku, marketplace: 'USA' }]);
  await persistSnapshots(snapshots.map((draft) => ({ listingId: listing.id, draft })));

  const s = await prisma.listingSnapshot.findFirst({
    where: { listingId: listing.id },
    orderBy: { capturedAt: 'desc' },
  });
  const bullets = Array.isArray(s?.bulletPoints) ? (s?.bulletPoints as string[]) : [];
  console.log(`Saved snapshot #${s?.id} for listing #${listing.id}:\n`);
  console.log(`Title:   ${s?.title}`);
  console.log(`Brand:   ${s?.brand}`);
  console.log(`Price:   ${s?.listedPrice?.toString()} ${s?.currency ?? ''}`);
  console.log(`Buy Box: ${s?.buyboxPrice?.toString() ?? '(none — not actively offered)'}`);
  console.log(`\nBullet points (${bullets.length}):`);
  bullets.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));
  console.log(`\nDescription:\n  ${s?.description ?? '(none)'}`);

  await prisma.$disconnect();
}

void main();
