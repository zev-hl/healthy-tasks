/**
 * A brief message that fades by itself (HLAI-71 Chunk 8c).
 *
 * The app has no toast system; success and failure are normally a persistent
 * `alert` banner. The group editor needs something lighter: adding an ASIN can
 * fail in three different, undramatic ways, and a banner for each would be
 * heavy-handed. This follows the local `flashSaved` timer pattern in
 * TaskDetailView, made reusable.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastTone = 'error' | 'info' | 'success';

export interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
}

const VISIBLE_MS = 4_000;

export function useToast(): {
  toast: ToastMessage | null;
  showToast: (text: string, tone?: ToastTone) => void;
  clearToast: () => void;
} {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);

  const clearToast = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  const showToast = useCallback((text: string, tone: ToastTone = 'info') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: ++nextId.current, text, tone });
    timer.current = setTimeout(() => setToast(null), VISIBLE_MS);
  }, []);

  // Never leave a timer running after the screen is gone.
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return { toast, showToast, clearToast };
}

export function Toast({ toast, onClose }: { toast: ToastMessage | null; onClose: () => void }) {
  if (!toast) return null;
  return (
    <div className={`exc-toast ${toast.tone}`} role="status" aria-live="polite">
      <span>{toast.text}</span>
      <button type="button" className="exc-toast-x" onClick={onClose} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
