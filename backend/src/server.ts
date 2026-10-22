import { createApp, type AppOptions } from './app.js';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import {
  exclusivesSweepMode,
  startScheduler,
  stopScheduler,
} from './services/scheduler.service.js';
import { describeDailyWindow } from './services/exclusives/daily-window.js';
import {
  deliverySummary,
  mailerSummary,
  productionReadinessGaps,
  QUEUE_DASHBOARD_PATH,
  queueDashboardMode,
  runsEmailWorker,
} from './config/startup-checks.js';
import { createQueueBoard, type QueueBoard } from './queue/dashboard-board.js';
import { closeEmailQueue, getEmailQueue } from './queue/email-queue.js';
import { startEmailWorker, type EmailWorkerHandle } from './queue/email-worker.js';
import { mailer } from './utils/mailer.js';

/** Longest a shutdown may take before the process is stopped regardless. */
const SHUTDOWN_LIMIT_MS = 25_000;

// The queue dashboard behind a password, e.g. on staging; off unless
// QUEUE_DASHBOARD_USER and QUEUE_DASHBOARD_PASSWORD allow it.
const dashboardMode = queueDashboardMode({
  emailDelivery: env.email.delivery,
  user: env.email.dashboardUser,
  password: env.email.dashboardPassword,
});
let queueBoard: QueueBoard | undefined;
const appOptions: AppOptions = {};
if (dashboardMode.on) {
  queueBoard = createQueueBoard(QUEUE_DASHBOARD_PATH);
  appOptions.queueDashboard = {
    path: QUEUE_DASHBOARD_PATH,
    router: queueBoard.router,
    user: dashboardMode.user,
    password: dashboardMode.password,
  };
}

const app = createApp(appOptions);
let emailWorker: EmailWorkerHandle | undefined;

const server = app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`🚀 HL Central API listening on http://localhost:${env.port} (${env.nodeEnv})`);
  // Always say which mail path is live, so the day EMAIL_PROVIDER flips to smtp
  // there is a boot line confirming it took.
  // eslint-disable-next-line no-console
  console.log(`   ${mailerSummary(env.email.provider, env.email.smtpHost)}`);
  // eslint-disable-next-line no-console
  console.log(`   ${deliverySummary(env.email.delivery, env.email.workerInApi)}`);
  if (dashboardMode.misconfigured) {
    // eslint-disable-next-line no-console
    console.warn(`⚠️  ${dashboardMode.summary}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`   ${dashboardMode.summary}`);
  }
  // Connect to the queue now, so the first email of the day finds the
  // connection ready instead of falling back to a direct send.
  if (env.email.delivery === 'queue') getEmailQueue();
  // By default this API also sends what it queues (queue/email-worker.ts), so
  // no separate worker service is needed. Never under tests, which import
  // createApp and send directly.
  if (runsEmailWorker(env.email.delivery, env.email.workerInApi)) {
    emailWorker = startEmailWorker();
  }

  // Production dependencies otherwise fail silently; Phase 14's health alerting
  // is worthless if the mailer it uses is a no-op, so say so out loud.
  const gaps = productionReadinessGaps({
    isProduction: env.isProduction,
    emailProvider: env.email.provider,
    smtpHost: env.email.smtpHost,
    emailDelivery: env.email.delivery,
    storageDriver: env.storage.driver,
    schedulerEnabled: env.schedulerEnabled,
    googleClientId: env.google.clientId,
  });
  for (const gap of gaps) {
    // eslint-disable-next-line no-console
    console.warn(`⚠️  NOT PRODUCTION READY: ${gap}`);
  }
  // Start the recurrence scheduler only in the running server (never under
  // tests, which import createApp and drive runScheduler directly). Its heartbeat
  // is watched by the notifications endpoint, which alerts admins if it stops.
  if (env.schedulerEnabled) {
    startScheduler();
    // eslint-disable-next-line no-console
    console.log(`   Exclusives sweep: ${exclusivesSweepMode().summary}`);
    // HLAI-112: the time EXCLUSIVES_DAILY_TASKS_AT set, so a change on Render
    // shows in the boot log.
    // eslint-disable-next-line no-console
    console.log(`   Daily alert tasks: ${describeDailyWindow()}`);
  } else {
    // eslint-disable-next-line no-console
    console.log('⏸  Recurrence scheduler disabled (SCHEDULER_ENABLED=false)');
    // eslint-disable-next-line no-console
    console.log('   Exclusives sweep: off (SCHEDULER_ENABLED=false)');
  }
});

let stopping = false;

// Graceful shutdown: the email worker finishes the sends under way, then Prisma,
// the queue, the queue dashboard and the mail server connection are released.
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  // eslint-disable-next-line no-console
  console.log(`\n${signal} received, shutting down...`);
  setTimeout(() => {
    // eslint-disable-next-line no-console
    console.error('shutdown took too long; stopping now');
    process.exit(1);
  }, SHUTDOWN_LIMIT_MS).unref();
  stopScheduler();
  // Started at once, so no new email is picked up while requests drain.
  const workerStopped = emailWorker?.close();
  server.close(() => {
    void Promise.allSettled([workerStopped])
      .then(() =>
        Promise.allSettled([
          prisma.$disconnect(),
          closeEmailQueue(),
          queueBoard?.close(),
          mailer.close?.(),
        ]),
      )
      .finally(() => process.exit(0));
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
