import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import { startScheduler, stopScheduler } from './services/scheduler.service.js';
import { mailerSummary, productionReadinessGaps } from './config/startup-checks.js';

const app = createApp();

const server = app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`🚀 HL Central API listening on http://localhost:${env.port} (${env.nodeEnv})`);
  // Always say which mail path is live, so the day EMAIL_PROVIDER flips to smtp
  // there is a boot line confirming it took.
  // eslint-disable-next-line no-console
  console.log(`   ${mailerSummary(env.email.provider, env.email.smtpHost)}`);

  // Production dependencies otherwise fail silently; Phase 14's health alerting
  // is worthless if the mailer it uses is a no-op, so say so out loud.
  const gaps = productionReadinessGaps({
    isProduction: env.isProduction,
    emailProvider: env.email.provider,
    smtpHost: env.email.smtpHost,
    storageDriver: env.storage.driver,
    schedulerEnabled: env.schedulerEnabled,
  });
  for (const gap of gaps) {
    // eslint-disable-next-line no-console
    console.warn(`⚠️  NOT PRODUCTION READY: ${gap}`);
  }
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
