/* eslint-disable no-console */
import type { ExclusivesMarketplace } from '@healthy-tasks/shared';
import { EXCLUSIVES_ALERT_TYPES } from '@healthy-tasks/shared';
import { prisma } from '../src/db/prisma.js';
import { sweepListings } from '../src/services/exclusives/sweep.service.js';
import { persistSnapshots } from '../src/services/exclusives/snapshot.repository.js';
import { runDetection } from '../src/services/exclusives/detection.service.js';

async function main() {
  // 1. Pick a real, priced listing (prefer the Walden Farms Blueberry US one).
  let listing = await prisma.listing.findFirst({ where: { asin: 'B000TMU63K', marketplace: 'USA' } });
  if (!listing) {
    const snap = await prisma.listingSnapshot.findFirst({
      where: { listedPrice: { not: null } },
      orderBy: { capturedAt: 'desc' },
      include: { listing: true },
    });
    listing = snap?.listing ?? null;
  }
  if (!listing) {
    console.log('No priced listing found — seed first (scripts/seed-exclusives.ts).');
    return;
  }

  // 2. Make sure the watching group has this alert type switched on.
  await prisma.alertSetting.createMany({
    data: EXCLUSIVES_ALERT_TYPES.map((t) => ({ groupId: listing!.groupId, alertType: t, mode: 'immediate' })),
    skipDuplicates: true,
  });

  // 3. Edit the stored snapshot's price so it differs from Amazon's real price.
  const stored = await prisma.listingSnapshot.findFirst({
    where: { listingId: listing.id },
    orderBy: { capturedAt: 'desc' },
  });
  if (!stored) {
    console.log('No snapshot to edit — run ingestion first.');
    return;
  }
  const realPrice = stored.listedPrice == null ? 10 : stored.listedPrice.toNumber();
  const fakedPrice = Number((realPrice + 3).toFixed(2));
  await prisma.listingSnapshot.update({ where: { id: stored.id }, data: { listedPrice: fakedPrice } });
  console.log(`Listing ${listing.asin} / ${listing.sku} (${listing.marketplace})`);
  console.log(`Edited stored snapshot price on the DB: real ${realPrice} → set to ${fakedPrice} (DB only; Amazon untouched)\n`);

  // 4. Re-fetch this one listing's REAL data from Amazon (read-only) + store it.
  console.log('Fetching fresh data from Amazon (read-only)…');
  const { snapshots } = await sweepListings([
    { sku: listing.sku, marketplace: listing.marketplace as ExclusivesMarketplace },
  ]);
  await persistSnapshots(snapshots.map((draft) => ({ listingId: listing!.id, draft })));
  const fresh = snapshots[0];
  console.log(`Fresh Amazon price: ${fresh?.listedPrice ?? '(none)'} ${fresh?.currency ?? ''}\n`);

  // 5. Detect changes → write AlertLog.
  await runDetection((m) => console.log(m));

  // 6. Show the alert(s) as they would appear in the Alert Log.
  const logs = await prisma.alertLog.findMany({
    where: { listingId: listing.id },
    orderBy: { createdAt: 'desc' },
  });
  console.log('\n=== Alert Log rows for this listing ===');
  for (const l of logs) {
    console.log(`  ${l.alertType} · ${l.marketplace} · ${l.asin}`);
    console.log(`    ${l.message}`);
    console.log(`    prev=${l.previousValue ?? '-'}  new=${l.newValue ?? '-'}  group="${l.groupName}"  at ${l.createdAt.toISOString()}`);
  }

  await prisma.$disconnect();
}

void main();
