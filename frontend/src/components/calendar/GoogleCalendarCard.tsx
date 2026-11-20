import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { GoogleCalendarStatusDto } from '@healthy-tasks/shared';
import { api, ApiError } from '../../api/client';
import { askConfirm } from '../ui/confirm';

const RESULT_TEXT: Record<string, { text: string; ok: boolean }> = {
  connected: { text: 'Connected. Your Google events now show on the Calendar.', ok: true },
  declined: {
    text: 'Not connected: Google wasn’t allowed to share your calendar. Try again and tick the calendar box.',
    ok: false,
  },
  expired: { text: 'That took too long. Press Connect again.', ok: false },
  failed: { text: 'Google didn’t connect. Try again in a moment.', ok: false },
};

/**
 * Connect your own Google Calendar (Nov 2026 plan, H6): its events show on
 * HL Central's Calendar, read-only. Only you see them; nothing is written to
 * Google. Off until the server is set up for it.
 */
export function GoogleCalendarCard() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<GoogleCalendarStatusDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result] = useState(() => params.get('google'));

  useEffect(() => {
    if (result) {
      const next = new URLSearchParams(params);
      next.delete('google');
      setParams(next, { replace: true });
    }
    api
      .getGoogleCalendar()
      .then(setStatus)
      .catch(() => setStatus(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.connectGoogleCalendar();
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start connecting.');
      setBusy(false);
    }
  }
  async function disconnect() {
    const ok = await askConfirm({
      title: 'Disconnect Google Calendar?',
      message:
        'Your Google events stop showing in HL Central. Nothing is changed in Google. You can connect it again at any time.',
      confirmLabel: 'Disconnect',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.disconnectGoogleCalendar();
      setStatus((s) => (s ? { ...s, connected: false, email: null, problem: null } : s));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  }

  const note = result ? RESULT_TEXT[result] : null;
  return (
    <div className="card" id="google-calendar">
      <div className="profile-card-head">
        <h3>Google Calendar</h3>
      </div>
      <p className="profile-card-sub">
        Show your own Google events on the Calendar, read-only. Only you see them; HL Central never
        changes your Google Calendar.
      </p>
      {note && (
        <p className={note.ok ? 'hb-ok-note' : 'hb-quicktask-error'} role="status">
          {note.text}
        </p>
      )}
      {error && (
        <p className="hb-quicktask-error" role="alert">
          {error}
        </p>
      )}
      {!status ? (
        <p className="hb-small">Loading…</p>
      ) : !status.available ? (
        <p className="hb-small">Not set up on this server yet. An Admin can switch it on.</p>
      ) : status.connected ? (
        <>
          <p>
            Connected{status.email ? ` as ${status.email}` : ''}.
            {status.problem && <span className="hb-quicktask-error"> {status.problem}</span>}
          </p>
          <div className="btn-row">
            {status.problem && (
              <button
                type="button"
                className="btn-sm"
                disabled={busy}
                onClick={() => void connect()}
              >
                Connect again
              </button>
            )}
            <button
              type="button"
              className="btn-sm btn-secondary"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="btn-sm" disabled={busy} onClick={() => void connect()}>
          {busy ? 'Opening Google…' : 'Connect Google Calendar'}
        </button>
      )}
    </div>
  );
}
