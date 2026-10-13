/* eslint-disable no-console */
import express from 'express';
import { Queue } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { createRedis, quietErrorLog } from './queue/redis.js';
import { EMAIL_QUEUE } from './queue/email-job.js';
import { MAINTENANCE_QUEUE } from './queue/maintenance.js';

// The queue dashboard (Bull Board): a page showing what is waiting, being sent,
// sent and failed, with the option to retry a failed email by hand. The
// maintenance queue shows the weekly cleanup: its next run and past results.
//
// For local development only, as a container of its own at
// http://localhost:3005/bullmq. It has no login, so it is never deployed: the
// compose file publishes it to this computer alone.

const PORT = Number(process.env.QUEUE_DASHBOARD_PORT ?? 3005);
const BASE_PATH = '/bullmq';

const connection = createRedis('dashboard');
const queues = [EMAIL_QUEUE, MAINTENANCE_QUEUE].map((name) => new Queue(name, { connection }));
// Each queue would otherwise print a full stack per reconnect while Redis is down.
const logError = quietErrorLog('[dashboard] ');
for (const queue of queues) queue.on('error', logError);

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath(BASE_PATH);
createBullBoard({
  queues: queues.map((queue) => new BullMQAdapter(queue)),
  serverAdapter,
  options: { uiConfig: { boardTitle: 'HL Central queues' } },
});

const app = express();
app.use(BASE_PATH, serverAdapter.getRouter());
app.get('/', (_req, res) => res.redirect(BASE_PATH));

const server = app.listen(PORT, () => {
  console.log(`📊 Queue dashboard on http://localhost:${PORT}${BASE_PATH}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await Promise.allSettled(queues.map((queue) => queue.close()));
  await connection.quit().catch(() => connection.disconnect());
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
