/* eslint-disable no-console */
import { closeEmailQueue, getEmailQueue } from '../src/queue/email-queue.js';
import { emailJobData } from '../src/queue/email-job.js';

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

  const sentAt = new Date().toISOString();
  const data = emailJobData(
    {
      to,
      subject: 'HL Central test email (queue)',
      text: [
        'This is a test email from the HL Central email queue.',
        '',
        `Queued at ${sentAt}. If you are reading it, the queue and the email worker are working.`,
      ].join('\n'),
    },
    'test',
  );
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
