import type { Job } from 'bullmq';
import type { Mailer } from '../utils/mailer.js';
import { emailFromJob, type EmailJobData } from './email-job.js';

/**
 * What the email worker does with each job: send it. A send that throws fails
 * this try, and BullMQ tries again on the job's retry policy (email-job.ts).
 *
 * Kept apart from Redis and the database, so it can be tested with fake jobs.
 */
export function createEmailProcessor(mailer: Mailer) {
  return async (job: Pick<Job<EmailJobData>, 'data'>): Promise<void> => {
    await mailer.send(emailFromJob(job.data));
  };
}

/**
 * "try 3 of 11" — for log lines. `tryNumber` counts the try that just ran.
 * Past the last automatic try it can only be a retry pressed on the dashboard.
 */
export function describeTry(tryNumber: number, job: Pick<Job, 'opts'>): string {
  const tries = job.opts.attempts ?? 1;
  return tryNumber > tries ? `try ${tryNumber}, retried by hand` : `try ${tryNumber} of ${tries}`;
}
