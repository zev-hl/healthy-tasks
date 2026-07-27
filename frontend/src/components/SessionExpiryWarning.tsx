import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

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
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Session expiring</h3>
        <p>Session will expire due to inactivity. Continue the session?</p>
        <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={continueSession} disabled={busy}>
            {busy ? 'Continuing…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
