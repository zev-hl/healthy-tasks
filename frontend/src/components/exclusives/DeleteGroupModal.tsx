/**
 * Delete-group confirmation dialog (HLAI-71). Reuses the app's modal chrome
 * (.modal-backdrop / .modal, .secondary / .danger buttons) with the design's
 * white body + grey footer split.
 */
import { useEffect } from 'react';
import type { ExclusivesGroupRowDto } from '@healthy-tasks/shared';

export function DeleteGroupModal({
  group,
  onCancel,
  onConfirm,
}: {
  group: ExclusivesGroupRowDto;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const n = group.listingCount;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal exc-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exc-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="exc-confirm-body">
          <h2 className="exc-confirm-title" id="exc-confirm-title">
            Delete “{group.name}”?
          </h2>
          <p className="exc-confirm-sub">
            {n} ASIN{n === 1 ? '' : 's'} stop{n === 1 ? 's' : ''} being monitored. Past alerts stay
            in the log.
          </p>
        </div>
        <div className="exc-confirm-foot">
          <button type="button" className="secondary" onClick={onCancel}>
            Keep it
          </button>
          <button type="button" className="danger" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
