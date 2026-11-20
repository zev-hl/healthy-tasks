/**
 * Ask a yes/no question in the app's own dialog, from anywhere — a click
 * handler, an effect, a plain function — and get the answer as a promise:
 *
 *   if (!(await askConfirm({ title: 'Delete this draft?', message: '…' }))) return;
 *
 * This replaces the browser's `window.confirm` box, which looks like the
 * browser rather than the app and blocks the page. The dialog is drawn in its
 * own small React root on `document.body`, so no provider has to be mounted
 * for it to work (screens, side panels and tests alike). Questions asked while
 * one is open wait their turn. Focus goes back where it was once answered.
 */
import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfirmDialog } from './ConfirmDialog';
import type { ModalTone } from '../exclusives/ModalShell';

export interface ConfirmOptions {
  title: string;
  /** What happens, and for a destructive one what is lost. */
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` (the default) for deleting or discarding; `accent` otherwise. */
  tone?: ModalTone;
}

interface Pending extends ConfirmOptions {
  id: number;
  /** Everyone who asked this same question while it was open. */
  resolves: ((ok: boolean) => void)[];
  returnFocus: HTMLElement | null;
}

let queue: Pending[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
let hostEl: HTMLDivElement | null = null;

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function ConfirmHost() {
  const current = useSyncExternalStore(subscribe, () => queue[0] ?? null);
  if (!current) return null;
  const answer = (ok: boolean) => {
    queue = queue.slice(1);
    emit();
    const back = current.returnFocus;
    if (back?.isConnected) back.focus({ preventScroll: true });
    for (const r of current.resolves) r(ok);
  };
  return (
    <ConfirmDialog
      key={current.id}
      title={current.title}
      message={current.message}
      confirmLabel={current.confirmLabel ?? 'OK'}
      cancelLabel={current.cancelLabel}
      tone={current.tone}
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
    />
  );
}

function ensureHost() {
  if (hostEl) {
    // Something cleared the page's body (a test, say): put the host back.
    if (!hostEl.isConnected) document.body.appendChild(hostEl);
    return;
  }
  const el = document.createElement('div');
  hostEl = el;
  el.className = 'hb-confirm-host';
  document.body.appendChild(el);
  const root = createRoot(el);
  root.render(<ConfirmHost />);
}

export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  ensureHost();
  return new Promise<boolean>((resolve) => {
    // The same question asked again while it is open (a second Esc or click on
    // what opened it) gets the same answer rather than a second dialog.
    const same = queue.find((q) => q.title === options.title && q.message === options.message);
    if (same) {
      same.resolves.push(resolve);
      return;
    }
    const active = document.activeElement;
    queue = [
      ...queue,
      {
        ...options,
        id: nextId++,
        resolves: [resolve],
        returnFocus: active instanceof HTMLElement ? active : null,
      },
    ];
    emit();
  });
}
