/**
 * A centred message that stays until it is acknowledged (HLAI-71 Chunk 8d).
 *
 * Used where something the person tried did not happen — an ASIN that is not on
 * the seller account, a malformed code, Amazon not answering, a duplicate. A
 * corner toast can be missed or can fade while they are still reading; this
 * cannot. One button, because there is nothing to decide.
 */
import { useEffect, useRef } from 'react';

export function NoticeModal({
  title = 'Just so you know',
  message,
  onClose,
  autoCloseMs,
}: {
  title?: string;
  message: string;
  onClose: () => void;
  /** Close by itself after this long, with no button. For confirmations. */
  autoCloseMs?: number;
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
    // No click-outside-to-close: it must be acknowledged.
    <div className="modal-backdrop">
      <div
        className="modal exc-confirm exc-notice"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="exc-notice-title"
        aria-describedby="exc-notice-body"
      >
        <div className="exc-confirm-body">
          <h2 className="exc-confirm-title" id="exc-notice-title">
            {title}
          </h2>
          <p className="exc-confirm-sub" id="exc-notice-body">
            {message}
          </p>
        </div>
        {autoCloseMs === undefined && (
          <div className="exc-confirm-foot">
            <button type="button" ref={okRef} onClick={onClose}>
              OK
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
