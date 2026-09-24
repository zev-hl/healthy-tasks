/**
 * Exclusives alert-type & group-type badges (HLAI-71).
 *
 * Deliberately mirrors `ui/indicators.tsx` StatusPill: a soft-fill / deep-text /
 * dot pill whose colours live in JS (not CSS attribute selectors) so a label
 * change can't silently break styling. Each alert tone maps onto the app's
 * existing pill palette tokens (--danger/--warn/--ok/--review), so Exclusives
 * reads as one design system with the rest of the app.
 */
import {
  EXCLUSIVES_ALERT_TYPE_LABELS,
  EXCLUSIVES_ALERT_TYPE_TONE,
  EXCLUSIVES_GROUP_TYPE_LABELS,
  type ExclusivesAlertTone,
  type ExclusivesAlertType,
  type ExclusivesGroupType,
} from '@healthy-tasks/shared';

const TONE: Record<ExclusivesAlertTone, { bg: string; fg: string; dot: string }> = {
  danger: { bg: 'var(--danger-soft)', fg: 'var(--danger-deep)', dot: 'var(--danger)' },
  warn: { bg: 'var(--warn-soft)', fg: 'var(--warn-deep)', dot: 'var(--warn)' },
  ok: { bg: 'var(--ok-soft)', fg: 'var(--ok-deep)', dot: 'var(--ok)' },
  review: { bg: 'var(--review-soft)', fg: 'var(--review-deep)', dot: 'var(--review)' },
  neutral: { bg: 'var(--canvas-deep)', fg: 'var(--muted-2)', dot: 'var(--faint-2)' },
};

/** The `{bg,fg,dot}` triple for an alert type — reused by legend chips, filters. */
export const alertTone = (type: ExclusivesAlertType) => TONE[EXCLUSIVES_ALERT_TYPE_TONE[type]];

/** Colour-coded pill for one alert type, e.g. "● Buy Box Lost" or with a count. */
export function AlertTypeBadge({
  type,
  count,
  showDot = true,
}: {
  type: ExclusivesAlertType;
  /** Appended as "· 4" — used by the group panel's summary chips. */
  count?: number;
  /** Off for the panel's summary chips, where the pill's own colour says enough. */
  showDot?: boolean;
}) {
  const c = TONE[EXCLUSIVES_ALERT_TYPE_TONE[type]];
  return (
    <span className="status-pill" style={{ background: c.bg, color: c.fg }}>
      {showDot && <span className="status-pill-dot" style={{ background: c.dot }} />}
      {EXCLUSIVES_ALERT_TYPE_LABELS[type]}
      {count !== undefined && <span className="exc-chip-count"> · {count}</span>}
    </span>
  );
}

/** GROUP / INDIVIDUAL kind badge (no dot), reusing the pill chrome. */
export function GroupTypeBadge({ type }: { type: ExclusivesGroupType }) {
  const accent = type === 'GROUP';
  return (
    <span
      className="status-pill exc-kind"
      style={{
        background: accent ? 'var(--accent-soft)' : 'var(--canvas-deep)',
        color: accent ? 'var(--accent-deep)' : 'var(--ink-3)',
      }}
    >
      {EXCLUSIVES_GROUP_TYPE_LABELS[type]}
    </span>
  );
}
