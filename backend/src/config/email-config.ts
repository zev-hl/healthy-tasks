import dotenv from 'dotenv';

// Email settings, kept apart from env.ts so the email worker (a separate
// process) can load them without the API's own settings: env.ts throws the
// moment it is imported if JWT_SECRET and friends are missing, and the worker
// has no use for them. env.ts re-exports this as `env.email`.
dotenv.config();

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

/** A whole number within [min, max]; a typo fails loudly at boot. */
function wholeNumber(name: string, fallback: number, min: number, max: number): number {
  const value = Number(optional(name, String(fallback)));
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  }
  return value;
}

export type EmailDelivery = 'direct' | 'queue';

function delivery(): EmailDelivery {
  const value = optional('EMAIL_DELIVERY', 'direct');
  if (value !== 'direct' && value !== 'queue') {
    throw new Error('EMAIL_DELIVERY must be "direct" or "queue"');
  }
  if (value === 'queue' && !process.env.REDIS_URL) {
    throw new Error('EMAIL_DELIVERY is "queue" but REDIS_URL is not set');
  }
  return value;
}

/** EMAIL_WORKER_IN_API: "true" (also when unset) or "false"; a typo fails at boot. */
export function parseWorkerInApi(value: string | undefined): boolean {
  if (!value) return true;
  if (value !== 'true' && value !== 'false') {
    throw new Error('EMAIL_WORKER_IN_API must be "true" or "false"');
  }
  return value === 'true';
}

export const emailConfig = {
  provider: optional('EMAIL_PROVIDER', 'console'),
  from: optional('EMAIL_FROM', 'HL Central <no-reply@healthy-tasks.local>'),
  smtpHost: process.env.SMTP_HOST,
  smtpPort: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,

  // How an email leaves the app. `direct`: the process that asked sends it,
  // as before — also the mode for tests, which have no Redis, and the switch
  // back if the queue misbehaves. `queue`: it is handed to the email worker
  // through Redis, which retries failures.
  delivery: delivery(),
  // Who sends the queued emails. `true`: the API runs the email worker inside
  // itself, so no other service is needed. `false`: a separate email worker
  // process does (src/worker.ts), and the API only adds them to the queue.
  // Ignored with `direct` delivery.
  workerInApi: parseWorkerInApi(process.env.EMAIL_WORKER_IN_API),
  // Where the queue lives. Required for `queue`; unset means nothing ever
  // opens a Redis connection.
  redisUrl: process.env.REDIS_URL || undefined,
  // Retry policy for queued emails: a failed send is tried again after this
  // delay, up to maxRetries times after the first try.
  retryDelayMs: wholeNumber('EMAIL_RETRY_DELAY_SECONDS', 120, 1, 3600) * 1000,
  maxRetries: wholeNumber('EMAIL_MAX_RETRIES', 10, 0, 100),
} as const;
