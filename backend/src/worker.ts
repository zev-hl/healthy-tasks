/* eslint-disable no-console */
import { Worker } from 'bullmq';
import { emailConfig } from './config/email-config.js';
import { mailer } from './utils/mailer.js';
import { createRedis } from './queue/redis.js';
import { EMAIL_QUEUE, type EmailJobData } from './queue/email-job.js';
import { createEmailProcessor, describeTry } from './queue/email.processor.js';

// The email worker: a process of its own (a separate container locally, a
// Render background worker in the cloud) that takes emails off the queue and
// sends them. The API only puts them on the queue.
//
// It reads only the email settings, so it needs neither the API's secrets nor
// a web port.

/** How many emails are sent at once. */
const CONCURRENCY = 5;
/** Longest a shutdown may take before the process is stopped regardless. */
const SHUTDOWN_LIMIT_MS = 25_000;

const connection = createRedis('worker');
const worker = new Worker<EmailJobData>(EMAIL_QUEUE, createEmailProcessor(mailer), {
  connection,
  concurrency: CONCURRENCY,
});

const via =
  emailConfig.provider === 'smtp'
    ? `SMTP via ${emailConfig.smtpHost ?? '(SMTP_HOST unset!)'}`
    : 'console only - nothing is actually delivered';
console.log(`📮 Email worker started — ${via}`);
console.log(
  `   ${CONCURRENCY} at a time; a failed send is retried every ` +
    `${emailConfig.retryDelayMs / 1000}s, up to ${emailConfig.maxRetries} times`,
);

worker.on('completed', (job) => {
  console.log(
    `[email-worker] sent ${job.name} to ${job.data.to} ` +
      `(${describeTry(job.attemptsStarted, job)}, job ${job.id})`,
  );
});

worker.on('failed', (job, err) => {
  if (!job) {
    console.error(`[email-worker] a job failed: ${err.message}`);
    return;
  }
  // The retry policy travels with each job (set when it was queued), so read
  // the delay from the job rather than from this process's settings.
  const tries = job.opts.attempts ?? 1;
  const backoff = job.opts.backoff;
  const delayMs = typeof backoff === 'number' ? backoff : backoff?.delay;
  const next =
    job.attemptsMade < tries
      ? `retrying in ${(delayMs ?? 0) / 1000}s`
      : 'no tries left — not retried again';
  console.error(
    `[email-worker] ${job.name} to ${job.data.to} failed ` +
      `(${describeTry(job.attemptsMade, job)}, job ${job.id}): ${err.message} — ${next}`,
  );
});

// Without a listener, an error inside the worker (e.g. Redis dropping) would be
// an unhandled 'error' event. The Redis connection logs its own outages.
worker.on('error', (err) => {
  console.error(`[email-worker] ${err.message}`);
});

let stopping = false;

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal} received, finishing the emails in progress...`);
  setTimeout(() => {
    console.error('[email-worker] shutdown took too long; stopping now');
    process.exit(1);
  }, SHUTDOWN_LIMIT_MS).unref();

  // Waits for the sends already under way; takes no new jobs meanwhile.
  await worker.close();
  await mailer.close?.();
  await connection.quit().catch(() => connection.disconnect());
  console.log('[email-worker] stopped cleanly');
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
