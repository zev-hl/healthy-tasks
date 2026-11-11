import type { GoalDto, GoalMetricType, GoalStatus } from '@healthy-tasks/shared';
import { GOAL_STATUS_LABELS, goalValueLabel } from '@healthy-tasks/shared';
import { todayLocalDate } from '../../lib/datetime';
import { Pill, type Tone } from '../harbor/ui';

/** Each lifecycle step's meaning color (Harbor: grey, amber, blue, indigo, green). */
export const GOAL_STATUS_TONE: Record<GoalStatus, Tone> = {
  Draft: 'grey',
  PendingApproval: 'amber',
  Approved: 'blue',
  UnderReview: 'review',
  Resolved: 'green',
};

export function GoalStatusPill({ status }: { status: GoalStatus }) {
  return <Pill tone={GOAL_STATUS_TONE[status]}>{GOAL_STATUS_LABELS[status]}</Pill>;
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

/** Days from the viewer's today to the deadline's date (negative once past). */
export function daysToDeadline(iso: string): number {
  const today = Date.parse(`${todayLocalDate()}T00:00:00.000Z`);
  const due = Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`);
  return Math.round((due - today) / 86_400_000);
}

/** "in 12 days", "today", "3 days late" — late only matters before Resolved. */
export function deadlineHint(goal: GoalDto): { text: string; late: boolean } {
  if (goal.status === 'Resolved') return { text: '', late: false };
  const d = daysToDeadline(goal.deadline);
  if (d === 0) return { text: 'due today', late: false };
  if (d > 0) return { text: `in ${d} ${d === 1 ? 'day' : 'days'}`, late: false };
  return { text: `${-d} ${d === -1 ? 'day' : 'days'} late`, late: true };
}

/** ISO instant → the value a date field holds (YYYY-MM-DD, UTC day). */
export function isoToDateInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

/** A date value (YYYY-MM-DD) → an ISO instant at UTC midnight. */
export function dateInputToIso(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}
