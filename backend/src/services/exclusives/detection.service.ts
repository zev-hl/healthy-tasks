import type { ListingSnapshot } from '@prisma/client';
import type { ExclusivesAlertMode, ExclusivesAlertType } from '@healthy-tasks/shared';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { detectAlerts } from './alert-detection.js';
import { describeAlerts } from './alert-message.js';
import { gateAlerts, type AlertSettingsMap } from './alert-gating.js';
import type { SnapshotView } from './snapshot-diff.js';

function toView(s: ListingSnapshot): SnapshotView {
  return {
    title: s.title,
    mainImageUrl: s.mainImageUrl,
    category: s.category,
    brand: s.brand,
    bulletPoints: Array.isArray(s.bulletPoints) ? (s.bulletPoints as string[]) : [],
    description: s.description,
    dimensions: s.dimensions,
    listedPrice: s.listedPrice == null ? null : s.listedPrice.toNumber(),
    currency: s.currency,
    buyboxWinnerSellerId: s.buyboxWinnerSellerId,
    buyboxPrice: s.buyboxPrice == null ? null : s.buyboxPrice.toNumber(),
    offerCount: s.offerCount,
    isSuppressed: s.isSuppressed,
    suppressionReason: s.suppressionReason,
  };
}

function toSettingsMap(settings: { alertType: string; mode: string }[]): AlertSettingsMap {
  const map: AlertSettingsMap = {};
  for (const s of settings) map[s.alertType as ExclusivesAlertType] = s.mode as ExclusivesAlertMode;
  return map;
}

export interface DetectionReport {
  listings: number;
  compared: number;
  alertsWritten: number;
}

// Compare each listing's newest two snapshots and write AlertLog rows for the
// changes its group is subscribed to. Idempotent in the scheduler flow: every
// cycle writes a fresh snapshot first, so re-running finds no new diff. One bad
// listing never stops the pass. Runs once per ingestion cycle (Chunk 6).
export async function runDetection(onLog: (m: string) => void = () => {}): Promise<DetectionReport> {
  const merchantToken = env.amazon.merchantToken ?? '';
  const ctx = { storeName: env.amazon.storeName };

  const listings = await prisma.listing.findMany({
    include: { group: { include: { settings: true } } },
  });

  let compared = 0;
  let alertsWritten = 0;

  for (const listing of listings) {
    try {
      const snaps = await prisma.listingSnapshot.findMany({
        where: { listingId: listing.id },
        orderBy: { capturedAt: 'desc' },
        take: 2,
      });
      if (snaps.length < 2) continue;

      const current = toView(snaps[0]!);
      const previous = toView(snaps[1]!);
      compared += 1;

      const gated = gateAlerts(
        detectAlerts(previous, current, merchantToken),
        toSettingsMap(listing.group.settings),
      );
      if (gated.length === 0) continue;

      const described = describeAlerts(gated, previous, current, ctx);
      const { count } = await prisma.alertLog.createMany({
        data: described.map((a) => ({
          groupId: listing.groupId,
          listingId: listing.id,
          alertType: a.alertType,
          category: a.category,
          previousValue: a.previousValue,
          newValue: a.newValue,
          message: a.message,
          asin: listing.asin,
          marketplace: listing.marketplace,
          title: current.title ?? listing.asin,
          groupName: listing.group.name,
        })),
      });
      alertsWritten += count;
    } catch (err) {
      onLog(`detection failed for listing ${listing.id}: ${(err as Error).message}`);
    }
  }

  onLog(`[exclusives] detection — compared ${compared}, wrote ${alertsWritten} alert(s)`);
  return { listings: listings.length, compared, alertsWritten };
}
