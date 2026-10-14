/* eslint-disable no-console */
import { emailConfig } from './config/email-config.js';
import { mailer } from './utils/mailer.js';
import { prisma } from './db/prisma.js';
import { startEmailWorker } from './queue/email-worker.js';

// The email worker as a process of its own, for when the API does not send its
// queued emails itself (EMAIL_WORKER_IN_API=false): a Render background worker,
// or `npm run worker:dev` locally. What it does is in queue/email-worker.ts,
// which the API runs inside itself by default.
//
// It reads only the email settings, the business time zone and the database
// address (for failed emails), so it needs neither the API's secrets nor a web
// port.

/** Longest a shutdown may take before the process is stopped regardless. */
const SHUTDOWN_LIMIT_MS = 25_000;

const via =
  emailConfig.provider === 'smtp'
    ? `SMTP via ${emailConfig.smtpHost ?? '(SMTP_HOST unset!)'}`
    : 'console only - nothing is actually delivered';
console.log(`📮 Email worker started — ${via}`);
const emailWorker = startEmailWorker();
if (!process.env.DATABASE_URL) {
  console.warn('   DATABASE_URL is not set: failed emails will not be recorded in the database');
}

let stopping = false;

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal} received, finishing the emails in progress...`);
  setTimeout(() => {
    console.error('[email-worker] shutdown took too long; stopping now');
    process.exit(1);
  }, SHUTDOWN_LIMIT_MS).unref();

  await emailWorker.close();
  await mailer.close?.();
  await prisma.$disconnect();
  console.log('[email-worker] stopped cleanly');
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
