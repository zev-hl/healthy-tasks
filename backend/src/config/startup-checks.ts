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
  storageDriver: string;
  schedulerEnabled: boolean;
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

/** One line naming the mail path actually in use, logged on every boot. */
export function mailerSummary(emailProvider: string, smtpHost?: string | undefined): string {
  return emailProvider === 'smtp'
    ? `email: SMTP via ${smtpHost ?? '(SMTP_HOST unset!)'}`
    : 'email: console only - nothing is actually delivered';
}
