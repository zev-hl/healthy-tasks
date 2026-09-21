/* eslint-disable no-console */
import { Prisma } from '@prisma/client';
import { EXCLUSIVES_ALERT_TYPES } from '@healthy-tasks/shared';
import { prisma } from '../src/db/prisma.js';
import { env } from '../src/config/env.js';
import { runDetection } from '../src/services/exclusives/detection.service.js';
import type { ListingSnapshotDraft } from '../src/services/exclusives/snapshot.mapper.js';

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log('No user in DB.');
    return;
  }
  const us = env.amazon.merchantToken ?? 'A1UWLDVGZSXGKG';

  const old = await prisma.alertGroup.findUnique({ where: { name: 'Detect Test' } });
  if (old) await prisma.alertGroup.delete({ where: { id: old.id } });

  const group = await prisma.alertGroup.create({
    data: { name: 'Detect Test', groupType: 'GROUP', createdById: user.id },
  });
  // All alert types ON for this group.
  await prisma.alertSetting.createMany({
    data: EXCLUSIVES_ALERT_TYPES.map((t) => ({ groupId: group.id, alertType: t, mode: 'immediate' })),
  });
  const listing = await prisma.listing.create({
    data: { groupId: group.id, marketplace: 'USA', asin: 'B000TEST01', sku: 'TEST-1', createdById: user.id },
  });

  const bullets = (b: string[]) => b as unknown as Prisma.InputJsonValue;

  // The saved snapshot (last known state) — we hold the Buy Box at $34.99, 3 offers.
  await prisma.listingSnapshot.create({
    data: {
      listingId: listing.id,
      title: 'Widget',
      category: 'Vitamins',
      brand: 'Acme',
      bulletPoints: bullets(['one', 'two', 'three']),
      listedPrice: 34.99,
      currency: 'USD',
      buyboxWinnerSellerId: us,
      buyboxPrice: 34.99,
      offerCount: 3,
      isSuppressed: false,
    },
  });
  // Fresh data as a sweep would bring it — price drop, Buy Box lost to a
  // competitor, +3 offers, title edited, bullet 2 rewritten.
  const fresh: ListingSnapshotDraft = {
    sku: 'TEST-1',
    marketplace: 'USA',
    asin: 'B000TEST01',
    title: 'Widget XL',
    category: 'Vitamins',
    brand: 'Acme',
    bulletPoints: ['one', 'TWO', 'three'],
    listedPrice: 31.49,
    currency: 'USD',
    buyboxWinnerSellerId: 'A9COMPETITOR0',
    buyboxPrice: 31.49,
    offerCount: 6,
    isSuppressed: false,
  };
  const entries = [{ listingId: listing.id, draft: fresh }];

  const report = await runDetection(entries, (m) => console.log(m));

  const logs = await prisma.alertLog.findMany({
    where: { listingId: listing.id },
    orderBy: { alertType: 'asc' },
  });
  console.log('\nAlerts written:');
  for (const l of logs) console.log(`  [${l.alertType}] ${l.message}  (cat=${l.category ?? '-'})`);
  console.log(`\nreport: ${JSON.stringify(report)}`);

  // Re-run with the same data: the saved snapshot already matches, so nothing is added.
  const rerun = await runDetection(entries);
  console.log(`re-run: ${JSON.stringify(rerun)} (expect alertsWritten 0)`);
  const rows = await prisma.listingSnapshot.count({ where: { listingId: listing.id } });
  console.log(`snapshot rows for this listing: ${rows} (expect 1 — updated in place)`);

  // Cleanup. AlertLog survives group deletion by design (SetNull), so remove
  // this test's rows explicitly or they'd linger as orphans.
  await prisma.alertLog.deleteMany({ where: { listingId: listing.id } });
  await prisma.alertGroup.delete({ where: { id: group.id } });
  await prisma.$disconnect();
}

void main();
