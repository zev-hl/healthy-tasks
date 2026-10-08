import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { missingSpApiConfig } from './sp-api/config.js';
import { runIngestion, type IngestionReport } from './ingestion.service.js';
import { runDetection, type DetectionReport } from './detection.service.js';

// Database-wide lock so two sweeps never run at once — e.g. the timer and a
// manual `exclusives-run-pass.ts`, or two backend processes — which would double
// the call rate against the seller's shared SP-API quota. Transaction-scoped
// like the task-relationship lock, so Postgres releases it however the pass
// ends. The key is the ASCII bytes of "HLEX" (HL central EXclusives).
export const PASS_LOCK_KEY = 0x484c4558; // 1212957016

// How long the lock may be held. A normal pass takes ~1 min; even one that stops
// early on a dead endpoint stays well under this.
const PASS_LOCK_TIMEOUT_MS = 20 * 60_000;

export interface ExclusivesPassReport {
  status: 'completed' | 'skipped' | 'failed';
  /** Why the pass was skipped or failed. */
  reason?: string;
  startedAt: string;
  finishedAt: string;
  ingestion?: IngestionReport;
  detection?: DetectionReport;
}

type ReportBody = Omit<ExclusivesPassReport, 'startedAt' | 'finishedAt'>;

let running = false;

// "USA: listings 17, pricing 17, catalog 16; Canada: …"
function describeCalls(report: IngestionReport): string {
  const parts = Object.entries(report.callsByMarketplace).map(
    ([marketplace, c]) =>
      `${marketplace}: listings ${c.listings}, pricing ${c.pricing}, catalog ${c.catalog}`,
  );
  return parts.join('; ') || 'no calls';
}

/**
 * One Exclusives pass: fetch fresh data for every monitored listing
 * (ingestion), then compare it with each listing's saved snapshot, log alerts
 * for what changed and save the fresh data in place (detection). This is what
 * the scheduler runs on its cadence; it can also be run by hand
 * (scripts/exclusives-run-pass.ts). Read-only against Amazon.
 *
 * Never throws. Returns `skipped` without calling Amazon when SP-API is not
 * configured (silently — expected wherever Exclusives isn't wired up), when a
 * pass is already running in this process, or when another instance holds the
 * lock.
 */
export async function runExclusivesPass(
  onLog: (msg: string) => void = () => {},
): Promise<ExclusivesPassReport> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const finish = (body: ReportBody): ExclusivesPassReport => ({
    ...body,
    startedAt,
    finishedAt: new Date().toISOString(),
  });

  const missing = missingSpApiConfig(env.amazon);
  if (missing.length > 0) {
    const reason = `SP-API not configured (missing ${missing.join(', ')})`;
    return finish({ status: 'skipped', reason });
  }
  if (running) {
    onLog('[exclusives] pass skipped — one is already running in this process');
    return finish({ status: 'skipped', reason: 'a pass is already running in this process' });
  }

  running = true;
  let ingestion: IngestionReport | undefined;
  try {
    // `tx` only holds the lock; the work itself runs on other pooled connections.
    return await prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${PASS_LOCK_KEY}::bigint) AS locked`;
        if (!lock?.locked) {
          onLog('[exclusives] pass skipped — another instance is running one');
          return finish({ status: 'skipped', reason: 'another instance is running a pass' });
        }

        ingestion = await runIngestion(onLog);
        const detection = await runDetection(ingestion.entries, onLog);
        onLog(
          `[exclusives] pass done in ${Math.round((Date.now() - started) / 1000)}s — ` +
            `${describeCalls(ingestion)}; ${detection.snapshotsSaved} listing(s) checked ` +
            `(${detection.snapshotsChanged} changed), ${ingestion.skipped.length} skipped, ` +
            `${detection.alertsWritten} alert(s)`,
        );
        return finish({ status: 'completed', ingestion, detection });
      },
      { maxWait: 10_000, timeout: PASS_LOCK_TIMEOUT_MS },
    );
  } catch (err) {
    const reason = (err as Error).message;
    onLog(`[exclusives] pass failed: ${reason}`);
    return finish({ status: 'failed', reason, ingestion });
  } finally {
    running = false;
  }
}
