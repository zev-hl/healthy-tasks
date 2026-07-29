/**
 * Relative-first date display (redesign). `DueDate` shows a two-line
 * treatment — a human primary line ("Overdue 17d", "Today, 2:00 PM",
 * "Thursday") over the absolute value in mono — and tones the primary red when
 * overdue / amber when due today. `AgoDate` is the single-line past form
 * ("22m ago") for created/activity timestamps. Both keep the exact time on hover.
 */
import { absoluteShort, formatAgo, formatDue } from '../../lib/datetime';

export function DueDate({
  iso,
  long = false,
  done = false,
  inline = false,
}: {
  iso: string | null | undefined;
  /** Expand "17d" → "17 days" (detail view). */
  long?: boolean;
  /** Render "done Mon" for completed tasks. */
  done?: boolean;
  /** Single-line: just the relative primary, no mono secondary. */
  inline?: boolean;
}) {
  const p = formatDue(iso, { long, done });
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
