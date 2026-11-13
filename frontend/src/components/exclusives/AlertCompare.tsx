import { useEffect, useMemo, useState } from 'react';
import {
  EXCLUSIVES_ALERT_TYPE_LABELS,
  diffWords,
  plainText,
  type DiffPart,
  type ExclusivesAlertRowDto,
  type ExclusivesAlertType,
} from '@healthy-tasks/shared';
import { absoluteShort } from '../../lib/datetime';
import { ModalShell } from './ModalShell';

/**
 * Text-change alerts (title, description, bullet points): a "Compare" link
 * under the alert's message opens the text before and now side by side, the
 * changed words marked in both. The message shows only where the text first
 * changed; this shows all of it.
 */

/** The alert types whose before and now are texts worth comparing. */
const COMPARABLE = new Set<ExclusivesAlertType>([
  'TitleChanged',
  'DescriptionChanged',
  'BulletPointsChanged',
]);

export function canCompare(
  row: Pick<ExclusivesAlertRowDto, 'alertType' | 'previousValue' | 'newValue'>,
) {
  return COMPARABLE.has(row.alertType) && (!!row.previousValue || !!row.newValue);
}

function Side({
  label,
  parts,
  kind,
}: {
  label: string;
  parts: DiffPart[];
  kind: 'before' | 'now';
}) {
  return (
    <section className="exc-compare-side" aria-label={label}>
      <h3 className="exc-compare-h">{label}</h3>
      <div className="exc-compare-text">
        {parts.length === 0 ? (
          <span className="muted">(none)</span>
        ) : (
          parts.map((p, i) =>
            p.changed ? (
              <mark key={i} className={`exc-diff ${kind}`}>
                {p.text}
              </mark>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )
        )}
      </div>
    </section>
  );
}

export function AlertCompareModal({
  row,
  onClose,
}: {
  row: ExclusivesAlertRowDto;
  onClose: () => void;
}) {
  const parts = useMemo(
    () => diffWords(plainText(row.previousValue), plainText(row.newValue)),
    [row.previousValue, row.newValue],
  );

  // Escape closes this, and only this: in a group's alerts panel the panel
  // would otherwise close too. Read-only, so clicking away closes it as well.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <ModalShell
      title={`${EXCLUSIVES_ALERT_TYPE_LABELS[row.alertType]}: before and now`}
      tone="neutral"
      width="min(1000px, 96vw)"
      onBackdropClick={onClose}
      hint="Changed words are marked on both sides."
      actions={
        <button type="button" className="btn-sm" onClick={onClose}>
          Close
        </button>
      }
    >
      <p className="exc-compare-about">
        <span className="mono">{row.asin}</span> · {row.title}
        <span className="muted"> · {absoluteShort(row.createdAt)}</span>
      </p>
      <div className="exc-compare">
        <Side label="Before" parts={parts.before} kind="before" />
        <Side label="Now" parts={parts.after} kind="now" />
      </div>
    </ModalShell>
  );
}

/** The "Compare" link for an alert row, and its pop-up. Nothing for other alerts. */
export function AlertCompareLink({ row }: { row: ExclusivesAlertRowDto }) {
  const [open, setOpen] = useState(false);
  if (!canCompare(row)) return null;
  return (
    <>
      <button
        type="button"
        className="link-button exc-compare-link"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        Compare before and now
      </button>
      {open && <AlertCompareModal row={row} onClose={() => setOpen(false)} />}
    </>
  );
}
