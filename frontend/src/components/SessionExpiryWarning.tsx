import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ModalShell } from './exclusives/ModalShell';
import { Btn } from './harbor/ui';

/**
 * Shown in the final minute before an idle session expires. "Continue" renews
 * the session; ignoring it lets the session lapse and bounce to login.
 */
export function SessionExpiryWarning() {
  const { user, expiryWarning, extendSession } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!user || !expiryWarning) return null;

  async function continueSession() {
    setBusy(true);
    try {
      await extendSession();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title="Still there?"
      tone="warn"
      role="alertdialog"
      width="min(420px, calc(100vw - 32px))"
      actions={
        <Btn kind="primary" onClick={() => void continueSession()} disabled={busy} autoFocus>
          {busy ? 'Continuing…' : 'Stay signed in'}
        </Btn>
      }
    >
      <p className="exc-confirm-sub">
        You’ll be signed out in under a minute because nothing has happened for a while.
      </p>
    </ModalShell>
  );
}
