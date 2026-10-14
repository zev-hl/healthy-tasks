import type { Job } from 'bullmq';
import type { Mailer } from '../utils/mailer.js';
import { emailFromJob, type EmailJobData } from './email-job.js';
import type { FailedEmailRecorder } from './failed-email.recorder.js';

type EmailJob = Pick<Job<EmailJobData>, 'data' | 'opts' | 'attemptsMade'>;

/**
 * What the email worker does with each job: send it. A send that throws fails
 * this try, and BullMQ tries again on the job's retry policy (email-job.ts).
 *
 * Failures are written to the FailedEmail table as they happen:
 *  - sent on the first try: nothing is written, so a healthy day never touches
 *    the database;
 *  - failed with tries left: a `retrying` row with when the next try is due;
 *  - failed with none left (including a retry pressed on the dashboard): `failed`;
 *  - sent after failing: the row is deleted.
 *
 * Kept apart from Redis and the database, so it can be tested with fake jobs.
 */
export function createEmailProcessor(
  mailer: Mailer,
  recorder: FailedEmailRecorder,
  now: () => number = Date.now,
) {
  return async (job: EmailJob): Promise<void> => {
    // `attemptsMade` counts the tries already finished, and is what BullMQ
    // itself compares with `attempts` to decide on another try.
    const tryNumber = job.attemptsMade + 1;
    try {
      await mailer.send(emailFromJob(job.data));
    } catch (err) {
      const willRetry = tryNumber < (job.opts.attempts ?? 1);
      await recorder.recordFailure({
        data: job.data,
        attempts: tryNumber,
        error: err,
        nextRetryAt: willRetry ? new Date(now() + retryDelayMs(job)) : null,
      });
      throw err;
    }
    // Only an earlier failed try can have left a row.
    if (tryNumber > 1) await recorder.clearFailure(job.data.emailId);
  };
}

/**
 * The wait before the next try. The retry policy travels with each job (set
 * when it was queued), so it is read from the job, not this process's settings.
 */
export function retryDelayMs(job: Pick<Job, 'opts'>): number {
  const backoff = job.opts.backoff;
  return (typeof backoff === 'number' ? backoff : backoff?.delay) ?? 0;
}

/**
 * "try 3 of 11" — for log lines. `tryNumber` counts the try that just ran.
 * Past the last automatic try it can only be a retry pressed on the dashboard.
 */
export function describeTry(tryNumber: number, job: Pick<Job, 'opts'>): string {
  const tries = job.opts.attempts ?? 1;
  return tryNumber > tries ? `try ${tryNumber}, retried by hand` : `try ${tryNumber} of ${tries}`;
}
