/* eslint-disable no-console */
import { prisma } from '../src/db/prisma.js';
import {
  makeDailyAlertTasks,
  makeImmediateAlertTasks,
} from '../src/services/exclusives/alert-tasks.service.js';

// HLAI-112: make the alert tasks that are due now, by hand — Immediate (and any
// retries), then Daily for every 8:30 AM window that has ended. The same work a
// check and the 8:30 AM scheduler pass do; for where those are off (staging, or
// locally with the sweep off). Safe to run any time: an alert never makes two
// tasks.
async function main() {
  console.log(`[alert-tasks] ▶ Run by hand at ${new Date().toISOString()}`);
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
  .finally(() => prisma.$disconnect());
