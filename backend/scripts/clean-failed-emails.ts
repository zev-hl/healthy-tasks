/* eslint-disable no-console */
import { Queue } from 'bullmq';
import { createRedis } from '../src/queue/redis.js';
import {
  CLEAN_FAILED_EMAILS,
  MAINTENANCE_QUEUE,
  cleanupJobOptions,
} from '../src/queue/maintenance.js';

// Run the weekly cleanup of failed emails now: deletes the FailedEmail rows
// whose status is `failed`. It is added as a one-off job, so the email worker
// runs it and the result shows on the queue dashboard, and the weekly schedule
// is left exactly as it was.
//
//   docker compose exec backend npm run queue:clean-failed-emails
async function main() {
  const connection = createRedis('producer');
  const queue = new Queue(MAINTENANCE_QUEUE, { connection });
  try {
    await queue.waitUntilReady();
    const job = await queue.add(
      CLEAN_FAILED_EMAILS,
      {},
      { ...cleanupJobOptions, jobId: `${CLEAN_FAILED_EMAILS}-by-hand-${Date.now()}` },
    );
    console.log(`Queued the failed-email cleanup as job ${job.id}.`);
    console.log(
      'The email worker runs it now; its log and the dashboard show how many it deleted.',
    );
  } finally {
    await queue.close();
    connection.disconnect();
  }
}

main().catch((err) => {
  console.error('Could not start the cleanup:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
