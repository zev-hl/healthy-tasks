/* eslint-disable no-console */
import { readFileSync } from 'node:fs';
import { EXCLUSIVES_ALERT_TYPES } from '@healthy-tasks/shared';
import { prisma } from '../src/db/prisma.js';
import { discoverListings } from '../src/services/exclusives/listing-discovery.js';
import { runIngestion } from '../src/services/exclusives/ingestion.service.js';
import { runDetection } from '../src/services/exclusives/detection.service.js';

const GROUP_NAME = 'Versure Exclusives';

// Keep only well-formed ASINs (10 letters/digits), so a spreadsheet export's
// header row ("ASIN") or stray text is never sent to Amazon as an identifier.
const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

function loadAsins(): string[] {
  const raw = readFileSync('scripts/data/asins.txt', 'utf8');
  const lines = raw.split('\n').map((s) => s.trim().toUpperCase());
  return [...new Set(lines.filter((s) => ASIN_PATTERN.test(s)))];
}

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log('No user in DB — run db:seed first.');
    return;
  }

  const asins = loadAsins();
  console.log(`Loaded ${asins.length} ASINs.\n`);

  // Full rebuild: drop the group (cascading its listings, snapshots and
  // settings) and clear the alert log, so nothing survives from the previous,
  // incomplete seeding run.
  const existing = await prisma.alertGroup.findUnique({
    where: { name: GROUP_NAME },
  });
  if (existing) {
    const before = await prisma.listing.count({
      where: { groupId: existing.id },
    });
    await prisma.alertGroup.delete({ where: { id: existing.id } });
    console.log(`Wiped the previous group: ${before} listing(s) and their snapshots.`);
  }
  const alerts = await prisma.alertLog.deleteMany({});
  console.log(`Wiped ${alerts.count} alert log row(s).\n`);

  const group = await prisma.alertGroup.create({
    data: { name: GROUP_NAME, groupType: 'GROUP', createdById: user.id },
  });

  // Every alert type starts off, and someone switches on the ones they want.
  // The rows are still written so all twelve are visible and toggleable rather
  // than implied by their absence (a missing row also counts as off — see
  // alert-gating.ts). Until one is switched on, sweeps keep the snapshots
  // current and write no alerts.
  await prisma.alertSetting.createMany({
    data: EXCLUSIVES_ALERT_TYPES.map((alertType) => ({
      groupId: group.id,
      alertType,
      mode: 'off',
    })),
  });
  console.log(`Created ${EXCLUSIVES_ALERT_TYPES.length} alert types, all off by default.
`);

  console.log('Discovering US listings…');
  const us = await discoverListings(asins, 'USA', { onLog: (m) => console.log(m) });
  console.log(`  ${us.skuByAsin.size} ASINs listed in US (${us.pages} page(s) fetched)`);
  console.log('Discovering CA listings…');
  const ca = await discoverListings(asins, 'Canada', { onLog: (m) => console.log(m) });
  console.log(`  ${ca.skuByAsin.size} ASINs listed in CA (${ca.pages} page(s) fetched)\n`);

  const rows = [
    ...[...us.skuByAsin].map(([asin, sku]) => ({
      marketplace: 'USA',
      asin,
      sku,
    })),
    ...[...ca.skuByAsin].map(([asin, sku]) => ({
      marketplace: 'Canada',
      asin,
      sku,
    })),
  ].map((r) => ({ ...r, groupId: group.id, createdById: user.id }));

  await prisma.listing.createMany({ data: rows, skipDuplicates: true });
  const listingCount = await prisma.listing.count({
    where: { groupId: group.id },
  });

  // Where Amazon returned several SKUs for one ASIN, say which one we kept.
  for (const [marketplace, found] of [
    ['US', us],
    ['CA', ca],
  ] as const) {
    const multi = [...found.allSkusByAsin].filter(([, skus]) => skus.length > 1);
    if (!multi.length) continue;
    console.log(`${marketplace}: ${multi.length} ASIN(s) have more than one SKU — monitoring:`);
    for (const [asin, skus] of multi) {
      console.log(
        `  ${asin}: ${found.skuByAsin.get(asin)}   (also: ${skus.filter((s) => s !== found.skuByAsin.get(asin)).join(', ')})`,
      );
    }
    console.log('');
  }

  const missing = asins.filter((a) => !us.skuByAsin.has(a) && !ca.skuByAsin.has(a));
  console.log(`Seeded ${listingCount} listings (US + CA).`);
  console.log(
    `ASINs with no listing under this seller account in either marketplace: ${missing.length}`,
  );
  if (missing.length) console.log(`  ${missing.join(', ')}`);

  console.log('\nRunning ingestion (rate-paced)…');
  const startedAt = Date.now();
  const report = await runIngestion((m) => console.log(`  ${m}`));
  // New listings have no saved snapshot yet, so this saves one baseline each.
  const saved = await runDetection(report.entries, (m) => console.log(`  ${m}`));
  const elapsed = Math.round((Date.now() - startedAt) / 1000);

  const snapCount = await prisma.listingSnapshot.count({
    where: { listing: { groupId: group.id } },
  });
  console.log('\n=== Report ===');
  console.log(`ASINs provided:      ${asins.length}`);
  console.log(`Listed in US / CA:   ${us.skuByAsin.size} / ${ca.skuByAsin.size}`);
  console.log(`Listings monitored:  ${report.listingCount}`);
  console.log(`Snapshots saved:     ${saved.snapshotsSaved} (in DB: ${snapCount})`);
  console.log(
    `API calls:           listings=${report.calls.listings}, pricing=${report.calls.pricing}, catalog=${report.calls.catalog}`,
  );
  console.log(`Elapsed:             ${elapsed}s`);

  await prisma.$disconnect();
}

void main();
