import type { Job, JobSchedulerTemplateOptions, Queue, RepeatOptions } from 'bullmq';

// Housekeeping jobs, run by the email worker on a queue of their own so they
// show on the queue dashboard apart from the emails. Today there is one: the
// weekly cleanup of failed emails.

export const MAINTENANCE_QUEUE = 'maintenance';

/** The weekly cleanup: its scheduler id and its jobs' name. */
export const CLEAN_FAILED_EMAILS = 'clean-failed-emails';

/** Every Sunday at 04:00, in the business time zone. */
export const CLEAN_FAILED_EMAILS_CRON = '0 4 * * 0';

/** The FailedEmail table, as far as the cleanup uses it. */
export interface FailedEmailCleanupTable {
  deleteMany(args: { where: { status: 'failed' } }): PromiseLike<{ count: number }>;
}

/**
 * Deletes the emails that ran out of tries, and only those: a `retrying` row
 * belongs to an email the queue is still working on.
 */
export async function deleteFailedEmails(db: {
  failedEmail: FailedEmailCleanupTable;
}): Promise<number> {
  const { count } = await db.failedEmail.deleteMany({ where: { status: 'failed' } });
  return count;
}

/**
 * Runs a maintenance job. What it returns is shown as the job's result on the
 * dashboard. A failure is retried (see `scheduleMaintenance`) and then left on
 * the dashboard; next week's run starts afresh either way.
 */
export function createMaintenanceProcessor(db: { failedEmail: FailedEmailCleanupTable }) {
  return async (job: Pick<Job, 'name'>): Promise<{ deleted: number }> => {
    if (job.name === CLEAN_FAILED_EMAILS) return { deleted: await deleteFailedEmails(db) };
    throw new Error(`Unknown maintenance job: ${job.name}`);
  };
}

/** For every cleanup run, scheduled or started by hand. */
export const cleanupJobOptions: JobSchedulerTemplateOptions = {
  // A database that is briefly unreachable gets two more chances.
  attempts: 3,
  backoff: { type: 'fixed', delay: 10 * 60_000 },
  // Enough past runs to see recent history on the dashboard.
  removeOnComplete: { count: 20 },
  removeOnFail: { count: 20 },
};

/**
 * Registers the weekly cleanup and returns when it next runs. Safe to call on
 * every worker start: the scheduler is stored in Redis under a fixed id, so
 * this updates it rather than adding a second one.
 *
 * To clean up now, use `npm run queue:clean-failed-emails`, not Promote on the
 * dashboard: promoting runs that week's scheduled slot early, so the schedule
 * skips a week (or brings the slot back on the next worker start).
 */
export async function scheduleMaintenance(
  queue: Pick<Queue, 'upsertJobScheduler' | 'getJobScheduler'>,
  timeZone: string,
): Promise<Date | undefined> {
  const repeat: Omit<RepeatOptions, 'key'> = { pattern: CLEAN_FAILED_EMAILS_CRON, tz: timeZone };
  await queue.upsertJobScheduler(CLEAN_FAILED_EMAILS, repeat, {
    name: CLEAN_FAILED_EMAILS,
    opts: cleanupJobOptions,
  });
  const next = (await queue.getJobScheduler(CLEAN_FAILED_EMAILS))?.next;
  return next ? new Date(next) : undefined;
}
