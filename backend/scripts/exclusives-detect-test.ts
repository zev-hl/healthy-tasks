/* eslint-disable no-console */
import { Prisma } from '@prisma/client';
import { EXCLUSIVES_ALERT_TYPES } from '@healthy-tasks/shared';
import { prisma } from '../src/db/prisma.js';
import { env } from '../src/config/env.js';
import { runDetection } from '../src/services/exclusives/detection.service.js';

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

  // Previous snapshot — we hold the Buy Box at $34.99, 3 offers.
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
      capturedAt: new Date(Date.now() - 60_000),
    },
  });
  // Current snapshot — price drop, Buy Box lost to a competitor, +3 offers,
  // title edited, bullet 2 rewritten.
  await prisma.listingSnapshot.create({
    data: {
      listingId: listing.id,
      title: 'Widget XL',
      category: 'Vitamins',
      brand: 'Acme',
      bulletPoints: bullets(['one', 'TWO', 'three']),
      listedPrice: 31.49,
      currency: 'USD',
      buyboxWinnerSellerId: 'A9COMPETITOR0',
      buyboxPrice: 31.49,
      offerCount: 6,
      isSuppressed: false,
      capturedAt: new Date(),
    },
  });

  const report = await runDetection((m) => console.log(m));

  const logs = await prisma.alertLog.findMany({
    where: { listingId: listing.id },
    orderBy: { alertType: 'asc' },
  });
  console.log('\nAlerts written:');
  for (const l of logs) console.log(`  [${l.alertType}] ${l.message}  (cat=${l.category ?? '-'})`);
  console.log(`\nreport: ${JSON.stringify(report)}`);

  // Re-run to prove idempotency (no new snapshot → same newest pair → but this
  // would re-detect; in the real flow a fresh snapshot is written each cycle).
  await prisma.alertGroup.delete({ where: { id: group.id } }); // cleanup (cascade)
  await prisma.$disconnect();
}

void main();
