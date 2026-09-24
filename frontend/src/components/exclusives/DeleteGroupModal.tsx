/**
 * Delete-group confirmation dialog (HLAI-71). Wears the shared modal scheme
 * (see ModalShell): a dot before the title and the consequence spelled out once
 * — what stops and what survives — with nothing repeated in the footer.
 */
import { useEffect } from 'react';
import type { ExclusivesGroupRowDto } from '@healthy-tasks/shared';
import { ModalShell } from './ModalShell';

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
    <ModalShell
      title={`Delete the group “${group.name}”?`}
      tone="danger"
      role="alertdialog"
      onBackdropClick={onCancel}
      actions={
        <>
          <button type="button" className="secondary" onClick={onCancel}>
            Keep it
          </button>
          <button type="button" className="danger" onClick={onConfirm}>
            Delete
          </button>
        </>
      }
    >
      <p className="exc-confirm-sub">
        {n} ASIN{n === 1 ? '' : 's'} stop{n === 1 ? 's' : ''} being monitored. Past alerts stay in
        the alert log.
      </p>
    </ModalShell>
  );
}
