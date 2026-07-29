/**
 * TimeStamp — compact, year-aware timestamp with the full date/time on hover.
 * Current-year dates render without the year; other years keep it, so a date
 * this year is never mistaken for one in another year. The exact time is always
 * available in the tooltip (and as a machine-readable `dateTime`).
 */
import { formatTimestamp, fullTimestamp } from '../../lib/datetime';

export function TimeStamp({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className="muted">—</span>;
  return (
    <time dateTime={iso} title={fullTimestamp(iso)}>
      {formatTimestamp(iso)}
    </time>
  );
}
