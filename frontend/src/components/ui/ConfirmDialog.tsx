/**
 * A yes/no confirmation in the app's own modal style, replacing the browser's
 * `window.confirm` box.
 *
 * `window.confirm` looks like the browser rather than the app, can't be styled,
 * and blocks the page while it is open. This wears the same scheme as every
 * other modal in the app — a coloured dot before the title, the consequence
 * spelled out beneath, buttons in a footer band.
 *
 * (ModalShell currently lives under `components/exclusives/` because that is
 * where the scheme was first built. It is purely presentational and belongs in
 * `components/ui/` eventually; moving it would touch every Exclusives modal, so
 * it is left where it is for now.)
 */
import { useEffect, useRef } from 'react';
import { ModalShell, type ModalTone } from '../exclusives/ModalShell';

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ModalTone;
  /** Keeps both buttons out of action while the request is in flight. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Focus lands on Cancel, not Confirm: a stray Enter should not delete.
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <ModalShell
      title={title}
      tone={tone}
      role="alertdialog"
      onBackdropClick={busy ? undefined : onCancel}
      actions={
        <>
          <button
            type="button"
            className="secondary"
            ref={cancelRef}
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'danger' : undefined}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="exc-confirm-sub">{message}</p>
    </ModalShell>
  );
}
