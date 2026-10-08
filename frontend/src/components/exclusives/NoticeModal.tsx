/**
 * A centred message that stays until it is acknowledged (HLAI-71 Chunk 8c).
 *
 * Used where something the person tried did not happen — an ASIN that is not on
 * the seller account, a malformed code, Amazon not answering, a duplicate. A
 * corner toast can be missed or can fade while they are still reading; this
 * cannot. One button, because there is nothing to decide.
 *
 * Wears the shared modal scheme (see ModalShell), so every box in the feature
 * reads the same way.
 */
import { useEffect, useRef } from 'react';
import { ModalShell, type ModalTone } from './ModalShell';

export function NoticeModal({
  title = 'Just so you know',
  message,
  onClose,
  autoCloseMs,
  tone = 'warn',
}: {
  title?: string;
  message: string;
  onClose: () => void;
  /** Close by itself after this long, with no button. For confirmations. */
  autoCloseMs?: number;
  tone?: ModalTone;
}) {
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoCloseMs === undefined) return;
    const t = setTimeout(onClose, autoCloseMs);
    return () => clearTimeout(t);
  }, [autoCloseMs, onClose]);

  useEffect(() => {
    if (autoCloseMs !== undefined) return;
    okRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'Enter') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, autoCloseMs]);

  return (
    // No backdrop click handler: it must be acknowledged.
    <ModalShell
      title={title}
      tone={tone}
      role="alertdialog"
      actions={
        autoCloseMs === undefined ? (
          <button type="button" ref={okRef} onClick={onClose}>
            OK
          </button>
        ) : undefined
      }
    >
      <p className="exc-confirm-sub">{message}</p>
    </ModalShell>
  );
}
