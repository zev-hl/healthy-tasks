import type { Prisma } from '@prisma/client';
import type { EmailJobData } from './email-job.js';

/** The FailedEmail table, as far as the recorder uses it. */
export interface FailedEmailTable {
  upsert(args: {
    where: { emailId: string };
    create: Prisma.FailedEmailCreateInput;
    update: Prisma.FailedEmailUpdateInput;
  }): PromiseLike<unknown>;
  deleteMany(args: { where: { emailId: string } }): PromiseLike<unknown>;
}

/** One failed try of an email, as the worker saw it. */
export interface FailedTry {
  data: EmailJobData;
  /** Tries made so far, this one included. */
  attempts: number;
  error: unknown;
  /** When the queue tries again; null when it will not (no tries left). */
  nextRetryAt: Date | null;
}

/**
 * Keeps the FailedEmail table in step with the queue: a row while an email is
 * failing, `failed` once it has no tries left, gone once a try succeeds.
 *
 * Neither method ever throws. Whether an email is retried is the queue's
 * business; a database hiccup here must not change it, so it is logged and
 * the send carries on as if the row had been written.
 */
export interface FailedEmailRecorder {
  recordFailure(failure: FailedTry): Promise<void>;
  clearFailure(emailId: string): Promise<void>;
}

/** Longest error message kept; SMTP replies can run long. */
const MAX_ERROR_LENGTH = 500;

export function createFailedEmailRecorder(
  db: { failedEmail: FailedEmailTable },
  now: () => Date = () => new Date(),
): FailedEmailRecorder {
  return {
    async recordFailure({ data, attempts, error, nextRetryAt }) {
      const failedForGood = nextRetryAt === null;
      const state = {
        status: failedForGood ? 'failed' : 'retrying',
        attempts,
        lastError: shortError(error),
        nextRetryAt,
        failedAt: failedForGood ? now() : null,
      };
      try {
        await db.failedEmail.upsert({
          where: { emailId: data.emailId },
          create: {
            emailId: data.emailId,
            kind: data.kind,
            recipient: data.to,
            subject: data.subject,
            payload: storedPayload(data),
            ...state,
          },
          update: state,
        });
      } catch (err) {
        logDbError(`record the failed ${data.kind} email to ${data.to}`, err);
      }
    },

    async clearFailure(emailId) {
      try {
        await db.failedEmail.deleteMany({ where: { emailId } });
      } catch (err) {
        logDbError(`clear the failed email ${emailId}`, err);
      }
    },
  };
}

// Password links carry a token that signs the holder in. The database copy
// is for reading what went wrong, not for resending, so it never holds one.
const TOKEN_IN_LINK = /([?&]token=)[^\s&#"'<>]+/gi;

export function redactTokens(text: string): string {
  return text.replace(TOKEN_IN_LINK, '$1[redacted]');
}

/** The email as stored in `payload`: its content, sign-in tokens removed. */
function storedPayload(data: EmailJobData): Prisma.InputJsonObject {
  return {
    to: data.to,
    subject: data.subject,
    text: redactTokens(data.text),
    ...(data.html ? { html: redactTokens(data.html) } : {}),
  };
}

function shortError(error: unknown): string {
  const message = redactTokens(error instanceof Error ? error.message : String(error));
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…` : message;
}

function logDbError(what: string, err: unknown): void {
  // eslint-disable-next-line no-console
  console.error(
    `[email-worker] could not ${what} in the database: ${(err as Error)?.message ?? err}`,
  );
}
