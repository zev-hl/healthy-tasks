/* eslint-disable no-console */
import { closeEmailQueue, getEmailQueue } from '../src/queue/email-queue.js';
import { emailJobData } from '../src/queue/email-job.js';
import { testEmail } from '../src/utils/notification-emails.js';

// Put one test email on the email queue, whatever EMAIL_DELIVERY says, and show
// the queue's counts. Proves the queue end to end before any real email uses
// it; with no worker running yet the job simply waits.
//
//   docker compose exec backend npm run queue:test-email -- you@example.com
async function main() {
  const to = process.argv[2];
  if (!to || !to.includes('@')) {
    console.error('Usage: npm run queue:test-email -- you@example.com');
    process.exitCode = 1;
    return;
  }

  const queue = getEmailQueue();
  await queue.waitUntilReady();

  const data = emailJobData(testEmail(to, new Date().toISOString()), 'test');
  const job = await queue.add(data.kind, data, { jobId: data.emailId });
  console.log(`Queued test email to ${to} as job ${job.id}.`);
  console.log(
    'Queue counts:',
    await queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
  );
}

main()
  .catch((err) => {
    console.error('Could not queue the test email:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void closeEmailQueue());
