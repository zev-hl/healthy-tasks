import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import { startScheduler, stopScheduler } from './services/scheduler.service.js';

const app = createApp();

const server = app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`🚀 HL Central API listening on http://localhost:${env.port} (${env.nodeEnv})`);
  // Start the recurrence scheduler only in the running server (never under
  // tests, which import createApp and drive runScheduler directly). Its heartbeat
  // is watched by the notifications endpoint, which alerts admins if it stops.
  if (env.schedulerEnabled) {
    startScheduler();
  } else {
    // eslint-disable-next-line no-console
    console.log('⏸  Recurrence scheduler disabled (SCHEDULER_ENABLED=false)');
  }
});

// Graceful shutdown so Prisma releases its connections.
async function shutdown(signal: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`\n${signal} received, shutting down...`);
  stopScheduler();
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
