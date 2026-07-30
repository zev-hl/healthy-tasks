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

/* --- Redesign primitives: status pill + priority ramp --------------------- */

const STATUS_PILL: Record<TaskStatus, { bg: string; fg: string; dot: string }> = {
  Open: { bg: '#EEEAE4', fg: 'var(--ink-3)', dot: 'var(--faint)' },
  InProgress: { bg: 'var(--accent-soft)', fg: 'var(--accent-deep)', dot: 'var(--accent)' },
  OnHold: { bg: 'var(--warn-soft)', fg: 'var(--warn-deep)', dot: 'var(--warn)' },
  Review: { bg: 'var(--review-soft)', fg: 'var(--review-deep)', dot: 'var(--review)' },
  Completed: { bg: 'var(--ok-soft)', fg: 'var(--ok-deep)', dot: 'var(--ok)' },
  Canceled: { bg: 'var(--canvas-deep)', fg: 'var(--muted-2)', dot: 'var(--faint-2)' },
};

/** Soft-fill / deep-text / dot colours for a status — the pill palette, reused
 *  by the Calendar range chips and Gantt bars so all three read as one system. */
export const statusPill = (status: TaskStatus): { bg: string; fg: string; dot: string } =>
  STATUS_PILL[status] ?? STATUS_PILL.Open;

export function StatusPill({
  status,
  size = 'sm',
  caret = false,
}: {
  status: TaskStatus;
  size?: 'sm' | 'lg';
  /** Show a trailing ▾ when the pill is an inline editor trigger. */
  caret?: boolean;
}) {
  const c = STATUS_PILL[status] ?? STATUS_PILL.Open;
  return (
    <span
      className={`status-pill${size === 'lg' ? ' status-pill-lg' : ''}`}
      style={{ background: c.bg, color: c.fg }}
    >
      <span className="status-pill-dot" style={{ background: c.dot }} />
      {TASK_STATUS_LABELS[status] ?? status}
      {caret && <span className="status-pill-caret" aria-hidden="true">▾</span>}
    </span>
  );
}

const PRIO_BARS: Record<TaskPriority, [string, string, string]> = {
  Low: ['var(--faint-2)', 'var(--faint-2)', 'var(--faint-2)'],
  Medium: ['var(--muted)', 'var(--muted)', 'var(--border-soft)'],
  High: ['var(--warn)', 'var(--warn)', 'var(--warn)'],
  Urgent: ['var(--danger)', 'var(--danger)', 'var(--danger)'],
};

export function PriorityRamp({
  priority,
  label = false,
  dimmed = false,
}: {
  priority: TaskPriority;
  label?: boolean;
  /** Completed rows render the ramp at reduced opacity. */
  dimmed?: boolean;
}) {
  const bars = PRIO_BARS[priority] ?? PRIO_BARS.Medium;
  return (
    <span className="prio-ramp-wrap">
      <span
        className="prio-ramp"
        style={dimmed ? { opacity: 0.4 } : undefined}
        role="img"
        aria-label={`${priority} priority`}
        title={`${priority} priority`}
      >
        <i style={{ background: bars[0] }} />
        <i style={{ background: bars[1] }} />
        <i style={{ background: bars[2] }} />
      </span>
      {label && <span className={`prio-label prio-label-${priority}`}>{priority}</span>}
    </span>
  );
}

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
