/* eslint-disable no-console */
import { Queue, Worker } from 'bullmq';
import { emailConfig } from '../config/email-config.js';
import { businessTimeZone } from '../config/business-time-zone.js';
import { mailer } from '../utils/mailer.js';
import { prisma } from '../db/prisma.js';
import { createRedis, quietErrorLog } from './redis.js';
import { EMAIL_QUEUE, type EmailJobData } from './email-job.js';
import { createEmailProcessor, describeTry, retryDelayMs } from './email.processor.js';
import { createFailedEmailRecorder } from './failed-email.recorder.js';
import {
  MAINTENANCE_QUEUE,
  createMaintenanceProcessor,
  scheduleMaintenance,
} from './maintenance.js';

/** How many emails are sent at once. */
export const EMAIL_CONCURRENCY = 5;

export interface EmailWorkerHandle {
  /**
   * Stop taking jobs, let the sends already under way finish, then close the
   * worker's Redis connection. The mailer and Prisma belong to the process and
   * are closed by it afterwards.
   */
  close(): Promise<void>;
}

/**
 * Start the email worker in this process: it takes emails off the queue and
 * sends them, recording failures in FailedEmail, and runs the weekly cleanup of
 * failed emails on the maintenance queue.
 *
 * It runs inside the API by default (EMAIL_WORKER_IN_API, started from
 * server.ts), or as a process of its own (src/worker.ts). Either way it reads
 * only the email settings, the business time zone and the database.
 */
export function startEmailWorker(): EmailWorkerHandle {
  const connection = createRedis('worker');
  const worker = new Worker<EmailJobData>(
    EMAIL_QUEUE,
    createEmailProcessor(mailer, createFailedEmailRecorder(prisma)),
    { connection, concurrency: EMAIL_CONCURRENCY },
  );

  // The weekly cleanup (maintenance.ts): one job at a time is plenty.
  const maintenanceQueue = new Queue(MAINTENANCE_QUEUE, { connection });
  const maintenance = new Worker(MAINTENANCE_QUEUE, createMaintenanceProcessor(prisma), {
    connection,
    concurrency: 1,
  });

  console.log(
    `   ${EMAIL_CONCURRENCY} at a time; a failed send is retried every ` +
      `${emailConfig.retryDelayMs / 1000}s, up to ${emailConfig.maxRetries} times`,
  );
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

  return {
    async close() {
      // Waits for the sends already under way; takes no new jobs meanwhile.
      await Promise.all([worker.close(), maintenance.close()]);
      await maintenanceQueue.close();
      await connection.quit().catch(() => connection.disconnect());
    },
  };
}
