import { useEffect, useState } from 'react';
import type { ConnectMembersSyncDto, ConnectSignInStatusDto } from '@healthy-tasks/shared';
import { api, ApiError } from '../../api/client';

/**
 * Settings, Admins (Nov 2026 plan, Stage 5): whether HL Central signs people in
 * to Connect and keeps its member list in step, and "Send everyone to Connect"
 * for the first time or to catch up after Connect was unreachable.
 */
export function ConnectSignInCard() {
  const [status, setStatus] = useState<ConnectSignInStatusDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConnectMembersSyncDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.connectSignInStatus().then(setStatus, () => setStatus(null));
  }, []);

  async function sync() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.syncConnectMembers());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach Connect.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card settings-card">
      <h2 className="settings-card-title">Connect sign-in</h2>
      {!status ? (
        <p className="muted settings-help">Loading…</p>
      ) : !status.signIn ? (
        <p className="muted settings-help">
          Not set up. Once our Connect is running, set CONNECT_AUTH_URL, CONNECT_SIGNING_KEY and
          CONNECT_ORG_ID on HL Central’s server, and Connect’s central sign-in settings, as in
          docs/connect-changes.md §7. People then sign in to Connect with their HL Central sign-in.
        </p>
      ) : (
        <>
          <p className="muted settings-help">
            People sign in to Connect with HL Central. Connect is given{' '}
            <code>{status.authUrl}</code> as its sign-in service.
          </p>
          {status.members ? (
            <>
              <p className="muted settings-help">
                Connect’s members follow HL Central: adding someone here, changing their name,
                address or role, or deactivating them changes them in Connect too.
              </p>
              {error && <div className="alert error">{error}</div>}
              {result && (
                <div className={`alert ${result.failed.length ? 'error' : 'info'}`}>
                  Sent {result.sent} {result.sent === 1 ? 'person' : 'people'} to Connect.
                  {result.failed.length > 0 && (
                    <>
                      {' '}
                      Not sent: {result.failed.map((f) => `${f.email} (${f.error})`).join('; ')}.
                    </>
                  )}
                </div>
              )}
              <div className="btn-row">
                <button
                  type="button"
                  className="btn-sm"
                  onClick={() => void sync()}
                  disabled={busy}
                >
                  {busy ? 'Sending…' : 'Send everyone to Connect'}
                </button>
              </div>
            </>
          ) : (
            <p className="muted settings-help">
              Connect’s members aren’t kept in step yet: set CONNECT_PROVISION_SECRET (the same
              value on both).
            </p>
          )}
        </>
      )}
    </section>
  );
}
