import type { Router } from 'express';
import { Queue } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { createRedis, quietErrorLog } from './redis.js';
import { EMAIL_QUEUE } from './email-job.js';
import { MAINTENANCE_QUEUE } from './maintenance.js';
import { redactTokens } from './failed-email.recorder.js';

// The queue dashboard (Bull Board): a page showing what is waiting, being sent,
// sent and failed, with the option to retry a failed email by hand. The
// maintenance queue shows the weekly cleanup: its next run and past results.
//
// One setup for both places it is served: the local dashboard container
// (queue-dashboard.ts) and the API itself behind a password (server.ts), so
// the two always look the same.

export interface QueueBoard {
  /** The dashboard's pages and its own API, to mount at `basePath`. */
  router: Router;
  /** Releases its queues and Redis connection. */
  close(): Promise<void>;
}

/**
 * An email as the dashboard shows it: the sign-in tokens in password links
 * hidden, as in the FailedEmail table. Display only — the job keeps the real
 * link, so a Retry still sends a working email.
 */
export function emailForDisplay(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const shown: Record<string, unknown> = { ...data };
  for (const field of ['text', 'html']) {
    const value = shown[field];
    if (typeof value === 'string') shown[field] = redactTokens(value);
  }
  return shown;
}

export function createQueueBoard(basePath: string): QueueBoard {
  const connection = createRedis('dashboard');
  const emailQueue = new Queue(EMAIL_QUEUE, { connection });
  const maintenanceQueue = new Queue(MAINTENANCE_QUEUE, { connection });
  const queues = [emailQueue, maintenanceQueue];
  // Each queue would otherwise print a full stack per reconnect while Redis is down.
  const logError = quietErrorLog('[dashboard] ');
  for (const queue of queues) queue.on('error', logError);

  const emailAdapter = new BullMQAdapter(emailQueue);
  emailAdapter.setFormatter('data', emailForDisplay);

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(basePath);
  createBullBoard({
    queues: [emailAdapter, new BullMQAdapter(maintenanceQueue)],
    serverAdapter,
    options: { uiConfig: { boardTitle: 'HL Central queues' } },
  });

  return {
    router: serverAdapter.getRouter() as Router,
    async close() {
      await Promise.allSettled(queues.map((queue) => queue.close()));
      await connection.quit().catch(() => connection.disconnect());
    },
  };
}
