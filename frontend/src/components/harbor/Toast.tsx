import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';

interface ToastSpec {
  message: string;
  /** Shown as an Undo button; the toast closes when it runs. */
  undo?: () => void | Promise<void>;
  tone?: 'dark' | 'success' | 'error';
  /** A second button, e.g. "Open" the task just made. */
  action?: { label: string; run: () => void };
}

interface Shown extends ToastSpec {
  id: number;
}

const ToastContext = createContext<(t: ToastSpec) => void>(() => {});

/** Show a toast: `toast({ message, undo })`. */
export function useToast() {
  return useContext(ToastContext);
}

/**
 * Bottom-centre toasts (§5): say exactly what happened, offer Undo whenever it
 * can be undone, and hide on their own after about 6 seconds.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Shown | null>(null);
  const timer = useRef<number>();
  const seq = useRef(0);

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback((t: ToastSpec) => {
    window.clearTimeout(timer.current);
    seq.current += 1;
    setToast({ ...t, id: seq.current });
    timer.current = window.setTimeout(() => setToast(null), t.undo || t.action ? 7000 : 4500);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="hb-toast-zone" aria-live="polite" role="status">
        {toast && (
          <div key={toast.id} className={`hb-toast tone-${toast.tone ?? 'dark'}`}>
            <span className="hb-toast-msg">{toast.message}</span>
            {toast.undo && (
              <button
                type="button"
                className="hb-toast-undo"
                onClick={async () => {
                  const undo = toast.undo!;
                  dismiss();
                  await undo();
                }}
              >
                Undo
              </button>
            )}
            {toast.action && (
              <button
                type="button"
                className="hb-toast-undo"
                onClick={() => {
                  const action = toast.action!;
                  dismiss();
                  action.run();
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button type="button" className="hb-toast-x" onClick={dismiss} aria-label="Dismiss">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
