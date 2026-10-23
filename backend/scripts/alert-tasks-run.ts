/* eslint-disable no-console */
import { env } from '../src/config/env.js';
import { prisma } from '../src/db/prisma.js';
import { closeEmailQueue, getEmailQueue } from '../src/queue/email-queue.js';
import {
  makeDailyAlertTasks,
  makeImmediateAlertTasks,
} from '../src/services/exclusives/alert-tasks.service.js';
import { backgroundEmailsSent } from '../src/utils/mailer.js';

// How long to wait for Redis before making the tasks anyway: their emails are
// then sent directly, as the app does whenever Redis can't take one.
const QUEUE_CONNECT_MS = 10_000;

// HLAI-112: make the alert tasks that are due now, by hand — Immediate (and any
// retries), then Daily for every day that has ended (at 8:30 AM by default;
// EXCLUSIVES_DAILY_TASKS_AT). The same work a check and the scheduler's Daily
// pass do; for where those are off (staging, or
// locally with the sweep off). Safe to run any time: an alert never makes two
// tasks.
async function main() {
  console.log(`[alert-tasks] ▶ Run by hand at ${new Date().toISOString()}`);
  // Connect to the email queue first, as the API does at start-up: an email
  // asked for before the connection is ready skips the queue (and its retries).
  if (env.email.delivery === 'queue') {
    const ready = getEmailQueue()
      .waitUntilReady()
      .then(() => true)
      .catch(() => false);
    const timeout = new Promise<false>((resolve) =>
      setTimeout(() => resolve(false), QUEUE_CONNECT_MS).unref(),
    );
    if (!(await Promise.race([ready, timeout]))) {
      console.warn('[alert-tasks] Email queue not reachable: emails will be sent directly');
    }
  }
  const immediate = await makeImmediateAlertTasks((m) => console.log(m));
  const daily = await makeDailyAlertTasks((m) => console.log(m));
  for (const [name, r] of [
    ['Immediate', immediate],
    ['Daily', daily],
  ] as const) {
    console.log(
      `${name}: ${r.made} task(s) made, ${r.noTask} alert(s) with no task due, ${r.failed} not made`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  // Hand over the tasks' emails, then close what keeps the process alive: the
  // email queue's connection, and the database.
  .finally(async () => {
    await backgroundEmailsSent();
    await closeEmailQueue();
    await prisma.$disconnect();
  });
