import { useEffect, useMemo, useState } from 'react';
import {
  EXCLUSIVES_ALERT_TYPE_LABELS,
  alertComparison,
  type AlertComparison,
  type CompareBox,
  type ExclusivesAlertRowDto,
} from '@healthy-tasks/shared';
import { absoluteShort } from '../../lib/datetime';
import { ModalShell } from './ModalShell';

/**
 * An alert's before and now, in two boxes: a "Compare" link under the alert's
 * message opens them. The same boxes as the assignment email
 * (`alertComparison`): removed words struck through in red, new ones on green,
 * a value that is gone as "Removed", the main image as pictures. A description
 * shows whole here (the message and the email show only where it first changed).
 */

type CompareRow = Pick<
  ExclusivesAlertRowDto,
  'alertType' | 'previousValue' | 'newValue' | 'message'
>;

const comparisonOf = (row: CompareRow): AlertComparison | null => alertComparison(row);

/** Whether the alert has a before and now worth showing (not Buy Box or suppressed). */
export function canCompare(row: CompareRow) {
  return comparisonOf(row) !== null;
}

function Box({ box }: { box: CompareBox }) {
  return (
    <section className="exc-compare-side" aria-label={box.label}>
      <h3 className="exc-compare-h">{box.label}</h3>
      <div className="exc-compare-text">
        {box.image && (
          <a href={box.image} target="_blank" rel="noreferrer noopener">
            <img className="exc-compare-img" src={box.image} alt={`${box.label} image`} />
          </a>
        )}
        <div className={box.image ? 'exc-compare-url' : undefined}>
          {box.parts.length === 0 ? (
            <span className="muted">(none)</span>
          ) : (
            box.parts.map((p, i) =>
              p.removed ? (
                <strong key={i} className="exc-removed">
                  {p.text}
                </strong>
              ) : p.changed ? (
                <mark key={i} className={`exc-diff ${box.tone}`}>
                  {p.text}
                </mark>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )
          )}
        </div>
        {box.note && <div className="exc-compare-note">{box.note}</div>}
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
  const { alertType, previousValue, newValue, message } = row;
  const comparison = useMemo(
    () => comparisonOf({ alertType, previousValue, newValue, message }),
    [alertType, previousValue, newValue, message],
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

  if (!comparison) return null;
  return (
    <ModalShell
      title={`${EXCLUSIVES_ALERT_TYPE_LABELS[row.alertType]}${
        comparison.beforeAndNow ? ': before and now' : ''
      }`}
      tone="neutral"
      width="min(1000px, 96vw)"
      onBackdropClick={onClose}
      hint={
        comparison.beforeAndNow
          ? 'Removed words are struck through in red; new words are in green.'
          : undefined
      }
      actions={
        <button type="button" className="btn-sm" onClick={onClose}>
          Close
        </button>
      }
    >
      {/* The same order as the email: product, ASIN, when, what changed, the boxes. */}
      <div className="exc-compare-about">
        <div className="exc-compare-product">{row.title}</div>
        <div>
          ASIN <span className="mono">{row.asin}</span> · {row.marketplace}
        </div>
        <div className="muted">Alerted {absoluteShort(row.createdAt)}</div>
        <div className="exc-compare-heading">{comparison.heading}</div>
      </div>
      <div className="exc-compare">
        <Box box={comparison.boxes[0]} />
        <Box box={comparison.boxes[1]} />
      </div>
      {comparison.footer && <p className="exc-compare-footer">{comparison.footer}</p>}
    </ModalShell>
  );
}

/** The "Compare" link for an alert row, and its pop-up. Nothing for alerts with nothing to compare. */
export function AlertCompareLink({ row }: { row: ExclusivesAlertRowDto }) {
  const [open, setOpen] = useState(false);
  const comparison = comparisonOf(row);
  if (!comparison) return null;
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
        {comparison.beforeAndNow ? 'Compare before and now' : 'Compare prices'}
      </button>
      {open && <AlertCompareModal row={row} onClose={() => setOpen(false)} />}
    </>
  );
}
