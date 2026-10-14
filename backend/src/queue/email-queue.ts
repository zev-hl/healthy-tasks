import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { emailConfig } from '../config/email-config.js';
import { mailer, type Email } from '../utils/mailer.js';
import { createRedis } from './redis.js';
import {
  EMAIL_QUEUE,
  emailJobData,
  emailJobOptions,
  type EmailJobData,
  type EmailKind,
} from './email-job.js';

let redis: Redis | undefined;
let queue: Queue<EmailJobData> | undefined;

/**
 * The email queue, created on first use. Nothing connects to Redis until
 * something asks for it, so `direct` mode and the tests never touch Redis.
 */
export function getEmailQueue(): Queue<EmailJobData> {
  if (!queue) {
    redis = createRedis('producer');
    queue = new Queue<EmailJobData>(EMAIL_QUEUE, {
      connection: redis,
      defaultJobOptions: emailJobOptions(),
    });
  }
  return queue;
}

/** Close the queue and its connection (server shutdown, scripts). */
export async function closeEmailQueue(): Promise<void> {
  const [q, r] = [queue, redis];
  queue = undefined;
  redis = undefined;
  // A queue that never reached Redis is not closed, only disconnected: BullMQ
  // would report its unfinished connection attempt after removing its own
  // listeners, and an unheard error ends the process (seen shutting down
  // during a Redis outage).
  if (r?.status === 'ready') await q?.close();
  // A connection handed to BullMQ is not closed by it.
  r?.disconnect();
}

/**
 * Send an email the way EMAIL_DELIVERY says.
 *
 *  - `direct`: the mailer sends it now, from this process — today's behaviour.
 *    The send starts before this function first awaits anything, so the
 *    console mailer's outbox is filled by the time it returns a promise; the
 *    tests rely on that.
 *  - `queue`: it is added to the email queue and the worker sends it, retrying
 *    failures. If Redis can't take it, it is sent directly instead and a warning
 *    logged: an email that skips the queue still beats one that is lost.
 */
export async function queueEmail(
  email: Email,
  options: { kind: EmailKind; emailId?: string },
): Promise<void> {
  if (emailConfig.delivery === 'direct') return mailer.send(email);

  const data = emailJobData(email, options.kind, options.emailId);
  const q = getEmailQueue();
  // The producer connection refuses commands while it is down rather than
  // holding them; checking first also avoids queueing behind a reconnect.
  if (redis?.status !== 'ready') {
    warnFallback(data, `Redis connection is ${redis?.status ?? 'missing'}`);
    return mailer.send(email);
  }
  try {
    await q.add(data.kind, data, { jobId: data.emailId });
  } catch (err) {
    warnFallback(data, (err as Error).message);
    return mailer.send(email);
  }
}

function warnFallback(data: EmailJobData, reason: string): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[queue] Email not queued (${data.kind} to ${data.to}), sending directly: ${reason}`,
  );
}
