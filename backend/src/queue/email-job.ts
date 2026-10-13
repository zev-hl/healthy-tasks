import { randomUUID } from 'node:crypto';
import type { JobsOptions } from 'bullmq';
import { emailConfig } from '../config/email-config.js';
import type { Email } from '../utils/mailer.js';

export const EMAIL_QUEUE = 'email';

/** What an email is for — the job's name in the queue and on the dashboard. */
export type EmailKind =
  | 'new-account'
  | 'google-welcome'
  | 'password-reset'
  | 'mention'
  | 'assignment'
  | 'reminder'
  | 'admin-alert'
  | 'test';

/**
 * What a queued email carries. Jobs can wait in Redis across deploys, so the
 * shape is versioned: a later change must keep reading `v: 1` jobs.
 */
export interface EmailJobData {
  v: 1;
  /** Unique per email; also the job's id, so the same email is never queued twice. */
  emailId: string;
  kind: EmailKind;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export function emailJobData(email: Email, kind: EmailKind): EmailJobData {
  return {
    v: 1,
    emailId: randomUUID(),
    kind,
    to: email.to,
    subject: email.subject,
    text: email.text,
    ...(email.html ? { html: email.html } : {}),
  };
}

/** The email back out of a job, for the mailer. */
export function emailFromJob(data: EmailJobData): Email {
  return {
    to: data.to,
    subject: data.subject,
    text: data.text,
    ...(data.html ? { html: data.html } : {}),
  };
}

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Applied to every email job.
 *
 *  - A failed send is tried again after a fixed delay (2 minutes by default),
 *    `maxRetries` times after the first try — 11 tries in all by default.
 *  - Sent emails are dropped from Redis after a day.
 *  - Failed ones stay two weeks, so they can still be retried by hand.
 */
export function emailJobOptions(
  cfg: Pick<typeof emailConfig, 'maxRetries' | 'retryDelayMs'> = emailConfig,
): JobsOptions {
  return {
    attempts: cfg.maxRetries + 1,
    backoff: { type: 'fixed', delay: cfg.retryDelayMs },
    removeOnComplete: { age: DAY_SECONDS },
    removeOnFail: { age: 14 * DAY_SECONDS },
  };
}
