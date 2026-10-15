/**
 * Boot-time readiness reporting (Phase 14).
 *
 * The architecture audit flagged that production dependencies fail SILENTLY: with
 * `EMAIL_PROVIDER=console` the app looks healthy while every email it "sends" goes
 * to a log nobody reads, and with `STORAGE_DRIVER=memory` attachments vanish on
 * restart. Neither surfaces anywhere.
 *
 * That matters more than it used to, because Phase 14's whole premise is that a
 * broken scheduler now tells you - it emails admins when work is overdue or ran
 * late. Without a real mail provider those alerts are exactly as silent as the
 * `console.error` calls they replaced. This is what makes that visible.
 *
 * Deliberately a WARNING, not a refusal to boot: a running app with stubbed email
 * is the current intended state of this deployment, and hard-failing would take
 * production down to tell it something it already knows.
 *
 * Pure and dependency-free so it can be tested without touching `env`, which is a
 * const snapshot read at import time.
 */

export interface ReadinessInput {
  isProduction: boolean;
  emailProvider: string;
  smtpHost?: string | undefined;
  emailDelivery: string;
  storageDriver: string;
  schedulerEnabled: boolean;
  googleClientId: string;
}

/**
 * Gaps between how this process is configured and what a production deployment
 * needs. Empty in a fully-wired production, and always empty outside production.
 */
export function productionReadinessGaps(cfg: ReadinessInput): string[] {
  if (!cfg.isProduction) return [];
  const gaps: string[] = [];

  if (cfg.emailProvider !== 'smtp') {
    gaps.push(
      'EMAIL_PROVIDER is "console": NO email is delivered. Password resets, ' +
        'reminders and scheduler health alerts are written to this log only.',
    );
  } else if (!cfg.smtpHost) {
    gaps.push('EMAIL_PROVIDER is "smtp" but SMTP_HOST is unset: sending will fail.');
  }

  if (cfg.emailDelivery !== 'queue') {
    gaps.push(
      'EMAIL_DELIVERY is "direct": emails are sent from this process and a failed one ' +
        'is not retried. Set it to "queue" once the email worker is running.',
    );
  }

  if (!cfg.googleClientId) {
    gaps.push(
      'GOOGLE_CLIENT_ID is unset: "Sign in with Google" will refuse every attempt. ' +
        'Email and password sign-in is unaffected.',
    );
  }

  if (cfg.storageDriver === 'memory') {
    gaps.push('STORAGE_DRIVER is "memory": attachments are lost when this process restarts.');
  }

  if (!cfg.schedulerEnabled) {
    gaps.push(
      'SCHEDULER_ENABLED is false: recurring occurrences will not materialize and ' +
        'reminder emails will not be dispatched.',
    );
  }

  return gaps;
}

/** Whether this API process runs the email worker itself (EMAIL_WORKER_IN_API). */
export function runsEmailWorker(emailDelivery: string, workerInApi: boolean): boolean {
  return emailDelivery === 'queue' && workerInApi;
}

/** One line naming who sends this API's emails, logged on every boot. */
export function deliverySummary(emailDelivery: string, workerInApi: boolean): string {
  if (emailDelivery !== 'queue') return 'email delivery: direct';
  return workerInApi
    ? 'email delivery: queued, sent by the email worker inside this API'
    : 'email delivery: queued for the separate email worker';
}

/** Where the API serves the queue dashboard: the same path as the local one. */
export const QUEUE_DASHBOARD_PATH = '/bullmq';

/** Shortest password the API's queue dashboard accepts; it is open to the internet. */
export const QUEUE_DASHBOARD_MIN_PASSWORD = 16;

export type QueueDashboardMode =
  | { on: true; summary: string; misconfigured: false; user: string; password: string }
  | {
      on: false;
      /** One line for the boot log. */
      summary: string;
      /** Settings were given but cannot be used: logged as a warning. */
      misconfigured: boolean;
    };

/**
 * Whether this API serves the queue dashboard (QUEUE_DASHBOARD_USER and
 * QUEUE_DASHBOARD_PASSWORD). It needs the queue, both settings and a password
 * long enough that guessing it over the internet is hopeless; anything less
 * leaves it off rather than open.
 */
export function queueDashboardMode(cfg: {
  emailDelivery: string;
  user?: string | undefined;
  password?: string | undefined;
}): QueueDashboardMode {
  const off = (reason?: string): QueueDashboardMode => ({
    on: false,
    summary: reason ? `queue dashboard: off - ${reason}` : 'queue dashboard: off',
    misconfigured: Boolean(reason),
  });
  if (!cfg.user && !cfg.password) return off();
  if (!cfg.user || !cfg.password) {
    return off('set both QUEUE_DASHBOARD_USER and QUEUE_DASHBOARD_PASSWORD');
  }
  if (cfg.emailDelivery !== 'queue') return off('EMAIL_DELIVERY is not "queue"');
  if (cfg.password.length < QUEUE_DASHBOARD_MIN_PASSWORD) {
    return off(
      `QUEUE_DASHBOARD_PASSWORD is shorter than ${QUEUE_DASHBOARD_MIN_PASSWORD} characters`,
    );
  }
  return {
    on: true,
    summary: `queue dashboard: on at ${QUEUE_DASHBOARD_PATH} (password protected)`,
    misconfigured: false,
    user: cfg.user,
    password: cfg.password,
  };
}

/** One line naming the mail path actually in use, logged on every boot. */
export function mailerSummary(emailProvider: string, smtpHost?: string | undefined): string {
  return emailProvider === 'smtp'
    ? `email: SMTP via ${smtpHost ?? '(SMTP_HOST unset!)'}`
    : 'email: console only - nothing is actually delivered';
}
