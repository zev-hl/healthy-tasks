/* eslint-disable no-console */
import { Queue, Worker } from 'bullmq';
import { emailConfig } from './config/email-config.js';
import { businessTimeZone } from './config/business-time-zone.js';
import { mailer } from './utils/mailer.js';
import { prisma } from './db/prisma.js';
import { createRedis, quietErrorLog } from './queue/redis.js';
import { EMAIL_QUEUE, type EmailJobData } from './queue/email-job.js';
import { createEmailProcessor, describeTry, retryDelayMs } from './queue/email.processor.js';
import { createFailedEmailRecorder } from './queue/failed-email.recorder.js';
import {
  MAINTENANCE_QUEUE,
  createMaintenanceProcessor,
  scheduleMaintenance,
} from './queue/maintenance.js';

// The email worker: a process of its own (a separate container locally, a
// Render background worker in the cloud) that takes emails off the queue and
// sends them. The API only puts them on the queue. It also runs the weekly
// cleanup of failed emails, on the maintenance queue.
//
// It reads only the email settings, the business time zone and the database
// address (for failed emails), so it needs neither the API's secrets nor a web
// port.

/** How many emails are sent at once. */
const CONCURRENCY = 5;
/** Longest a shutdown may take before the process is stopped regardless. */
const SHUTDOWN_LIMIT_MS = 25_000;

const connection = createRedis('worker');
const worker = new Worker<EmailJobData>(
  EMAIL_QUEUE,
  createEmailProcessor(mailer, createFailedEmailRecorder(prisma)),
  { connection, concurrency: CONCURRENCY },
);

// The weekly cleanup (maintenance.ts): one job at a time is plenty.
const maintenanceQueue = new Queue(MAINTENANCE_QUEUE, { connection });
const maintenance = new Worker(MAINTENANCE_QUEUE, createMaintenanceProcessor(prisma), {
  connection,
  concurrency: 1,
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
if (!process.env.DATABASE_URL) {
  console.warn('   DATABASE_URL is not set: failed emails will not be recorded in the database');
}
scheduleMaintenance(maintenanceQueue, businessTimeZone)
  .then((next) => {
    const when = next
      ? next.toLocaleString('en-US', {
          timeZone: businessTimeZone,
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : 'not scheduled';
    console.log(
      `   failed emails are cleaned up every Sunday at 04:00 ${businessTimeZone}; next: ${when}`,
    );
  })
  .catch((err: Error) => {
    console.error(`[maintenance] could not schedule the weekly cleanup: ${err.message}`);
  });

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
  const next =
    job.attemptsMade < (job.opts.attempts ?? 1)
      ? `retrying in ${retryDelayMs(job) / 1000}s`
      : 'no tries left — not retried again';
  console.error(
    `[email-worker] ${job.name} to ${job.data.to} failed ` +
      `(${describeTry(job.attemptsMade, job)}, job ${job.id}): ${err.message} — ${next}`,
  );
});

// Without listeners, an error inside a worker or queue (e.g. Redis dropping)
// would be an unhandled 'error' event or a full stack per reconnect attempt.
// One shared quiet log prints each message once a minute for all of them.
const logError = quietErrorLog('[email-worker] ');
worker.on('error', logError);
maintenance.on('error', logError);
maintenanceQueue.on('error', logError);

maintenance.on('completed', (job, result: { deleted: number }) => {
  console.log(`[maintenance] ${job.name}: deleted ${result.deleted} failed email(s)`);
});
maintenance.on('failed', (job, err) => {
  console.error(`[maintenance] ${job?.name ?? 'a job'} failed: ${err.message}`);
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
  await Promise.all([worker.close(), maintenance.close()]);
  await maintenanceQueue.close();
  await mailer.close?.();
  await prisma.$disconnect();
  await connection.quit().catch(() => connection.disconnect());
  console.log('[email-worker] stopped cleanly');
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
