/* eslint-disable no-console */
import { prisma } from '../src/db/prisma.js';
import { runExclusivesPass } from '../src/services/exclusives/pass.service.js';

// Run one Exclusives pass by hand — the same pass the scheduler runs: fetch
// every monitored listing, compare with its saved snapshot, log alerts for what
// changed and save the fresh data. Read-only against Amazon. Exit code 1 if the
// pass failed.
async function main() {
  console.log(`[exclusives] ▶ Manual sweep started at ${new Date().toISOString()}`);
  const report = await runExclusivesPass((m) => console.log(m));

  console.log(`\nstatus: ${report.status}${report.reason ? ` — ${report.reason}` : ''}`);
  if (report.ingestion) {
    const { listingCount, entries, skipped, aborted } = report.ingestion;
    console.log(
      `ingestion: ${entries.length}/${listingCount} fetched, ${skipped.length} skipped` +
        (aborted ? ' (stopped early)' : ''),
    );
  }
  if (report.detection) {
    const { compared, baselines, alertsWritten, snapshotsChanged, snapshotsUnchanged, failed } =
      report.detection;
    console.log(
      `detection: ${compared} compared, ${baselines} new baseline(s), ` +
        `${alertsWritten} alert(s) written, ${snapshotsChanged} snapshot(s) rewritten, ` +
        `${snapshotsUnchanged} unchanged, ${failed} failed`,
    );
  }

  process.exitCode = report.status === 'failed' ? 1 : 0;
  await prisma.$disconnect();
}

void main();
