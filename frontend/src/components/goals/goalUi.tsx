import type { GoalMetricType, GoalStatus } from '@healthy-tasks/shared';
import { GOAL_STATUS_LABELS, goalValueLabel } from '@healthy-tasks/shared';

/** Soft-fill / deep-text colour pair per lifecycle status (Phase 9 tokens). */
const STATUS_STYLE: Record<GoalStatus, { bg: string; fg: string }> = {
  Draft: { bg: 'var(--canvas-deep)', fg: 'var(--muted)' },
  PendingApproval: { bg: 'var(--warn-soft)', fg: 'var(--warn-deep)' },
  Approved: { bg: 'var(--accent-soft)', fg: 'var(--accent-deep)' },
  UnderReview: { bg: 'var(--review-soft)', fg: 'var(--review-deep)' },
  Resolved: { bg: 'var(--ok-soft)', fg: 'var(--ok-deep)' },
};

export function GoalStatusPill({ status }: { status: GoalStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="goal-status-pill" style={{ background: s.bg, color: s.fg }}>
      {GOAL_STATUS_LABELS[status]}
    </span>
  );
}

/** Format a target/result value with its metric unit (delegates to shared). */
export function formatGoalValue(
  value: number | null | undefined,
  metricType: GoalMetricType,
  unitLabel: string | null,
): string {
  return goalValueLabel(value, metricType, unitLabel);
}

/**
 * A deadline (date only) rendered in the user's locale; '—' when absent.
 * Formatted in UTC because the deadline is a date-only value stored at UTC
 * midnight — rendering in local time would shift it a day for users behind UTC.
 */
export function formatDeadline(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** ISO instant → the value a <input type="date"> expects (YYYY-MM-DD, UTC day). */
export function isoToDateInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

/** A date-input value (YYYY-MM-DD) → an ISO instant at UTC midnight. */
export function dateInputToIso(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}
