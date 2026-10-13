import { Redis } from 'ioredis';
import { emailConfig } from '../config/email-config.js';

/**
 * Who the connection is for, which decides how it behaves while Redis is down:
 *
 *  - `worker`: BullMQ's blocking reads require `maxRetriesPerRequest: null`, and
 *    the worker should simply wait and reconnect through a Redis restart.
 *  - `dashboard` (the local queue dashboard): the same patience — it is only
 *    read by a person, who can wait for Redis to come back.
 *  - `producer` (the API adding emails): fails at once instead of queueing
 *    commands in memory, so adding an email never holds up a request. The
 *    caller then sends the email directly.
 */
export type RedisRole = 'producer' | 'worker' | 'dashboard';

/** How often a lost connection is reported; ioredis retries far more often. */
const ERROR_LOG_INTERVAL_MS = 60_000;

export function createRedis(role: RedisRole): Redis {
  const url = emailConfig.redisUrl;
  if (!url) throw new Error('REDIS_URL is not set');

  const redis = new Redis(
    url,
    role === 'producer'
      ? { maxRetriesPerRequest: 1, enableOfflineQueue: false }
      : { maxRetriesPerRequest: null },
  );

  // Without a listener ioredis reports every failed reconnect as an unhandled
  // 'error' event. One line a minute is enough to show Redis is unreachable.
  let lastLoggedAt = 0;
  redis.on('error', (err: Error) => {
    const now = Date.now();
    if (now - lastLoggedAt < ERROR_LOG_INTERVAL_MS) return;
    lastLoggedAt = now;
    // eslint-disable-next-line no-console
    console.error(`[queue] Redis unreachable (${role}): ${err.message}`);
  });
  return redis;
}
