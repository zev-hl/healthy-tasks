import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Avatar, userLabel } from '../components/ui/Avatar';
import { PageHeader } from '../components/harbor/PageHeader';
import { NotificationSettings } from '../components/NotificationSettings';
import { GoogleCalendarCard } from '../components/calendar/GoogleCalendarCard';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

const DEVICE_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Every IANA zone the browser knows, labelled with its current UTC offset. */
function timeZoneOptions(): { id: string; label: string }[] {
  const now = new Date();
  return Intl.supportedValuesOf('timeZone').map((id) => {
    const offset =
      new Intl.DateTimeFormat('en-US', { timeZone: id, timeZoneName: 'shortOffset' })
        .formatToParts(now)
        .find((p) => p.type === 'timeZoneName')?.value ?? '';
    return { id, label: `${id.replace(/_/g, ' ')} (${offset})` };
  });
}

export function ProfilePage() {
  const { user, logout, updateMe } = useAuth();
  const navigate = useNavigate();
  const [supervisorName, setSupervisorName] = useState<string | null>(null);
  const [tzSaving, setTzSaving] = useState(false);
  const [tzError, setTzError] = useState<string | null>(null);
  const tzOptions = useMemo(timeZoneOptions, []);
  const [confirmEverywhere, setConfirmEverywhere] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const saveTimeZone = async (timeZone: string | null) => {
    setTzSaving(true);
    try {
      await updateMe({ timeZone });
      setTzError(null);
    } catch (err) {
      setTzError(err instanceof ApiError ? err.message : 'Failed to save time zone');
    } finally {
      setTzSaving(false);
    }
  };

  // Resolve the supervisor's display name (existing endpoint, no new data).
  useEffect(() => {
    if (!user?.supervisorId) return;
    void api
      .listActiveUsers()
      .then((users) => {
        const sup = users.find((u) => u.id === user.supervisorId);
        if (sup) setSupervisorName(userLabel(sup));
      })
      .catch(() => {});
  }, [user?.supervisorId]);

  return (
    <>
      <PageHeader title="Your profile" subtitle={user?.email} search={false} newTask={false} />
      <div className="profile-page hb-legacy-body">
        <div className="profile-grid">
          {/* Identity */}
          <div className="card">
            <div className="profile-id">
              {user && <Avatar user={user} px={56} decorative />}
              <span className="profile-id-name">{user ? userLabel(user) : ''}</span>
              {user?.role && <span className={`badge role-${user.role}`}>{user.role}</span>}
            </div>

            <div className="profile-divider" />

            <div className="profile-details">
              <div className="profile-detail">
                <span className="profile-detail-label">Email</span>
                <span className="profile-detail-value mono">{user?.email}</span>
              </div>
              <div className="profile-detail">
                <span className="profile-detail-label">Title</span>
                <span className="profile-detail-value">
                  {user?.title ? user.title : <span className="muted">—</span>}
                </span>
              </div>
              <div className="profile-detail">
                <span className="profile-detail-label">Supervisor</span>
                <span className="profile-detail-value">
                  {supervisorName ?? <span className="muted">—</span>}
                </span>
              </div>
              <div className="profile-detail">
                <label className="profile-detail-label" htmlFor="profile-tz">
                  Time zone
                </label>
                <select
                  id="profile-tz"
                  className="profile-tz-select"
                  value={user?.timeZone ?? ''}
                  disabled={tzSaving}
                  onChange={(e) => void saveTimeZone(e.target.value || null)}
                >
                  <option value="">Not set (company time)</option>
                  {/* Keep a saved zone selectable even if this browser doesn't list it. */}
                  {user?.timeZone && !tzOptions.some((o) => o.id === user.timeZone) && (
                    <option value={user.timeZone}>{user.timeZone}</option>
                  )}
                  {tzOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {!user?.timeZone && DEVICE_TIME_ZONE && (
                  <button
                    type="button"
                    className="link-button profile-tz-use"
                    disabled={tzSaving}
                    onClick={() => void saveTimeZone(DEVICE_TIME_ZONE)}
                  >
                    Use this device’s zone ({DEVICE_TIME_ZONE.replace(/_/g, ' ')})
                  </button>
                )}
                <span className="profile-tz-hint muted">Used for times in emails sent to you.</span>
                {tzError && <div className="alert error">{tzError}</div>}
              </div>
            </div>

            <div className="profile-actions">
              {/* Signing in with Google means there is no password of ours to
                change — the one that matters is held by Google. */}
              {user?.signInMethod === 'password' && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => navigate('/forgot-password')}
                >
                  Change password
                </button>
              )}
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  logout();
                  navigate('/login');
                }}
              >
                Log out
              </button>
              <button
                type="button"
                className="secondary"
                title="Ends every sign-in of yours, on every computer and phone, this one too"
                onClick={() => setConfirmEverywhere(true)}
              >
                Sign out everywhere
              </button>
            </div>
            {confirmEverywhere && (
              <ConfirmDialog
                title="Sign out everywhere?"
                message="Every sign-in of yours ends now, on every computer and phone, this one too. Devices kept signed in will have to sign in again."
                confirmLabel="Sign out everywhere"
                tone="warn"
                busy={signingOut}
                onCancel={() => setConfirmEverywhere(false)}
                onConfirm={() => {
                  setSigningOut(true);
                  void api
                    .signOutEverywhere()
                    .catch(() => undefined)
                    .then(() => {
                      logout();
                      navigate('/login');
                    });
                }}
              />
            )}
          </div>

          {/* The right-hand column: preferences, then the queue link under them. */}
          <div className="profile-col">
            {/* Notification preferences */}
            <div className="card">
              <div className="profile-card-head">
                <h3>Notifications</h3>
              </div>
              <p className="profile-card-sub">Choose what reaches you, and where.</p>
              <NotificationSettings email={user?.email} />
            </div>
            <GoogleCalendarCard />
          </div>
        </div>
      </div>
    </>
  );
}
