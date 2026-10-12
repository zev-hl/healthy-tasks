import { dutyLabel, type DutyRef } from '@healthy-tasks/shared';

/**
 * A duty, always shown as "Department › Duty" with the department's swatch.
 * Archived duties stay readable (history and reports keep them) but say so.
 */
export function DutyTag({
  duty,
  compact = false,
}: {
  duty: DutyRef | null | undefined;
  compact?: boolean;
}) {
  if (!duty) return <span className="muted">—</span>;
  return (
    <span className={`duty-tag${compact ? ' compact' : ''}`} title={dutyLabel(duty)}>
      <span className="duty-sw" style={{ background: duty.color }} aria-hidden="true" />
      <span className="duty-dept">{duty.departmentName} ›</span> {duty.name}
      {duty.archived && <span className="muted"> (archived)</span>}
    </span>
  );
}

/** The ⚠ flag: the person doing the task doesn't hold its duty. */
export function MismatchFlag({ who }: { who?: string | null }) {
  const text = who ? `${who} doesn’t hold this duty` : 'The assignee doesn’t hold this duty';
  return (
    <span className="duty-flag" title={text} role="img" aria-label={text}>
      !
    </span>
  );
}

/** A department color swatch. */
export function Swatch({ color, size = 9 }: { color: string; size?: number }) {
  return (
    <span
      className="duty-sw"
      style={{ background: color, width: size, height: size }}
      aria-hidden="true"
    />
  );
}
