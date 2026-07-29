/**
 * Status & priority indicators — Phase 9.
 *
 * Color is applied sparingly, as a small dot, so the neutral UI stays calm and
 * the cue draws the eye. The colors live in JS (not CSS attribute selectors) so
 * they can't silently break if an enum label changes.
 */
import {
  TASK_STATUS_LABELS,
  type TaskPriority,
  type TaskStatus,
} from '@healthy-tasks/shared';

const STATUS_COLORS: Record<TaskStatus, string> = {
  Open: 'var(--status-open)',
  InProgress: 'var(--status-progress)',
  OnHold: 'var(--status-hold)',
  Review: 'var(--status-review)',
  Completed: 'var(--status-done)',
  Canceled: 'var(--status-cancelled)',
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  Urgent: 'var(--prio-urgent)',
  High: 'var(--prio-high)',
  Medium: 'var(--prio-medium)',
  Low: 'var(--prio-low)',
};

export const statusColor = (status: TaskStatus): string =>
  STATUS_COLORS[status] ?? 'var(--status-open)';
export const priorityColor = (priority: TaskPriority): string =>
  PRIORITY_COLORS[priority] ?? 'var(--prio-medium)';

export function StatusDot({
  status,
  justCompleted = false,
}: {
  status: TaskStatus;
  /** Briefly pop the dot when the task has just transitioned to Completed. */
  justCompleted?: boolean;
}) {
  return (
    <span className="status-dot">
      <span
        className={`dot${justCompleted ? ' dot-pop' : ''}`}
        style={{ background: STATUS_COLORS[status] ?? 'var(--status-open)' }}
      />
      {TASK_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function PriorityDot({ priority }: { priority: TaskPriority }) {
  return (
    <span className="prio-dot">
      <span
        className="dot"
        style={{ background: PRIORITY_COLORS[priority] ?? 'var(--prio-medium)' }}
      />
      {priority}
    </span>
  );
}
