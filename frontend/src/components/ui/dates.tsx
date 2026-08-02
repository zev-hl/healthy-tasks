/**
 * Relative-first date display (redesign). `DueDate` shows a two-line
 * treatment — a human primary line ("Overdue 17d", "Today, 2:00 PM",
 * "Thursday") over the absolute value in mono — and tones the primary red when
 * overdue / amber when due today. `AgoDate` is the single-line past form
 * ("22m ago") for created/activity timestamps. Both keep the exact time on hover.
 */
import type { TaskStatus } from '@healthy-tasks/shared';
import { absoluteShort, formatAgo, formatDue } from '../../lib/datetime';

export function DueDate({
  iso,
  long = false,
  inline = false,
  status,
  completedAt,
  isDue = false,
}: {
  iso: string | null | undefined;
  /** Expand "17d" → "17 days" (detail view). */
  long?: boolean;
  /** Single-line: just the relative primary, no mono secondary. */
  inline?: boolean;
  /** Task status, so a Completed/Canceled task isn't shown as "Overdue". */
  status?: TaskStatus;
  /** Status-Change Timestamp (completion time) — drives the "Late" label. */
  completedAt?: string | null;
  /** True when this is the Due date (a late completion then reads "Late"). */
  isDue?: boolean;
}) {
  const p = formatDue(iso, { long, status, completedAt, isDue });
  if (!p) return <span className="muted">—</span>;
  if (inline) {
    return (
      <span className={`due-primary tone-${p.tone}`} title={p.secondary}>
        {p.primary}
      </span>
    );
  }
  return (
    <span className="datestack">
      <span className={`due-primary tone-${p.tone}`}>{p.primary}</span>
      <span className="due-secondary mono">{p.secondary}</span>
    </span>
  );
}

export function AgoDate({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className="muted">—</span>;
  return (
    <time className="ago mono" dateTime={iso} title={absoluteShort(iso)}>
      {formatAgo(iso)}
    </time>
  );
}
