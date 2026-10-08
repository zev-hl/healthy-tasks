import type { ListingSnapshot, Prisma } from '@prisma/client';
import type { ExclusivesAlertMode, ExclusivesAlertType } from '@healthy-tasks/shared';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { detectAlerts } from './alert-detection.js';
import { describeAlerts, type MessageContext } from './alert-message.js';
import { gateAlerts, type AlertSettingsMap } from './alert-gating.js';
import type { SnapshotView } from './snapshot-diff.js';
import {
  draftView,
  sameStoredState,
  savedView,
  snapshotFields,
  type SnapshotEntry,
} from './snapshot.repository.js';

type WatchedListing = Prisma.ListingGetPayload<{
  include: { group: { include: { settings: true } } };
}>;

function toSettingsMap(settings: { alertType: string; mode: string }[]): AlertSettingsMap {
  const map: AlertSettingsMap = {};
  for (const s of settings) map[s.alertType as ExclusivesAlertType] = s.mode as ExclusivesAlertMode;
  return map;
}

// The AlertLog rows for one listing's change, keeping only the types its group
// watches. Denormalized so they stay readable after a listing/group is deleted.
function alertRows(
  listing: WatchedListing,
  previous: SnapshotView,
  current: SnapshotView,
  merchantToken: string,
  ctx: MessageContext,
): Prisma.AlertLogCreateManyInput[] {
  const gated = gateAlerts(
    detectAlerts(previous, current, merchantToken),
    toSettingsMap(listing.group.settings),
  );
  return describeAlerts(gated, previous, current, ctx).map((a) => ({
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
  }));
}

export interface DetectionReport {
  /** Listings with fresh data that still exist. */
  listings: number;
  /** Compared with their saved snapshot. */
  compared: number;
  /** Seen for the first time: saved as the baseline, nothing to compare yet. */
  baselines: number;
  alertsWritten: number;
  /** Listings recorded this run — one snapshot each, now current. */
  snapshotsSaved: number;
  /** Of those, saved rows rewritten because the data changed. */
  snapshotsChanged: number;
  /** Of those, saved rows whose data matched — only their last-checked time moved. */
  snapshotsUnchanged: number;
  /** Listings whose comparison threw: logged, and their saved snapshot kept. */
  failed: number;
}

/**
 * For each listing with fresh data: compare it with the listing's saved
 * snapshot, log the changes its group watches (the AlertLog is the history),
 * then save the fresh data over that snapshot — one row per listing, updated
 * in place. A listing seen for the first time just gets its baseline saved.
 *
 * Only a snapshot whose data changed is rewritten; the (usually many) others
 * just get their last-checked time moved forward, all in one statement — the
 * clock and the health check rely on that time.
 *
 * Alerts and snapshot updates commit in ONE transaction, so a change is never
 * logged without the snapshot moving on (it would be logged again next time)
 * nor saved without being logged (it would be lost).
 *
 * Pass only listings with complete fresh data (`IngestionReport.entries`). A
 * listing that wasn't checked this sweep keeps its saved snapshot, so the next
 * good sweep compares against its last good data. Re-running with the same data
 * logs nothing: the saved snapshot already matches it.
 */
export async function runDetection(
  entries: SnapshotEntry[],
  onLog: (m: string) => void = () => {},
): Promise<DetectionReport> {
  const merchantToken = env.amazon.merchantToken ?? '';
  const ctx = { storeName: env.amazon.storeName };
  const ids = entries.map((e) => e.listingId);

  const listings =
    ids.length === 0
      ? []
      : await prisma.listing.findMany({
          where: { id: { in: ids } },
          include: { group: { include: { settings: true } } },
        });
  const listingById = new Map(listings.map((l) => [l.id, l]));
  const capturedAt = new Date();
  const started = Date.now();

  const report = await prisma.$transaction(
    async (tx) => {
      // Newest first: the first row per listing is its saved snapshot. Any
      // others predate one-row-per-listing and are removed below.
      const rows = await tx.listingSnapshot.findMany({
        where: { listingId: { in: ids } },
        orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
      });
      const saved = new Map<number, ListingSnapshot>();
      const leftoverIds: number[] = [];
      for (const row of rows) {
        if (saved.has(row.listingId)) leftoverIds.push(row.id);
        else saved.set(row.listingId, row);
      }

      const alerts: Prisma.AlertLogCreateManyInput[] = [];
      const unchangedIds: number[] = [];
      let compared = 0;
      let baselines = 0;
      let failed = 0;
      let snapshotsChanged = 0;

      for (const { listingId, draft } of entries) {
        const listing = listingById.get(listingId);
        if (!listing) continue; // deleted since the sweep started
        const previous = saved.get(listingId);

        if (!previous) {
          baselines += 1;
          await tx.listingSnapshot.create({
            data: { ...snapshotFields(draft), listingId, capturedAt },
          });
          continue;
        }

        const before = savedView(previous);
        const after = draftView(draft);
        try {
          alerts.push(...alertRows(listing, before, after, merchantToken, ctx));
          compared += 1;
        } catch (err) {
          // Keep the saved snapshot so the change is compared again next time.
          failed += 1;
          onLog(`detection failed for listing ${listingId}: ${(err as Error).message}`);
          continue;
        }

        if (sameStoredState(before, after)) {
          unchangedIds.push(previous.id);
        } else {
          snapshotsChanged += 1;
          await tx.listingSnapshot.update({
            where: { id: previous.id },
            data: { ...snapshotFields(draft), capturedAt },
          });
        }
      }

      // Everything that didn't change: just the last-checked time, in one go.
      if (unchangedIds.length > 0) {
        await tx.listingSnapshot.updateMany({
          where: { id: { in: unchangedIds } },
          data: { capturedAt },
        });
      }
      if (leftoverIds.length > 0) {
        await tx.listingSnapshot.deleteMany({ where: { id: { in: leftoverIds } } });
      }
      const alertsWritten =
        alerts.length === 0 ? 0 : (await tx.alertLog.createMany({ data: alerts })).count;

      return {
        listings: listings.length,
        compared,
        baselines,
        alertsWritten,
        snapshotsSaved: baselines + snapshotsChanged + unchangedIds.length,
        snapshotsChanged,
        snapshotsUnchanged: unchangedIds.length,
        failed,
      };
    },
    { maxWait: 10_000, timeout: 120_000 },
  );

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  onLog(
    `[exclusives] detection — compared ${report.compared}, wrote ${report.alertsWritten} alert(s); ` +
      `snapshots: ${report.snapshotsChanged} rewritten, ${report.snapshotsUnchanged} unchanged` +
      (report.baselines ? `, ${report.baselines} new baseline(s)` : '') +
      (report.failed ? `, ${report.failed} failed` : '') +
      ` (saved in ${seconds}s)`,
  );
  return report;
}
