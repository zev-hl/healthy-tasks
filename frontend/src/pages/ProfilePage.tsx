import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  NOTIFICATION_LISTS,
  type NotificationList,
  type NotificationPreferencesDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Avatar, userLabel } from '../components/ui/Avatar';
import { QueueDashboardCard } from '../components/QueueDashboardCard';

// Per-list label + one-line description shown on each preference row (frame 1g).
const PREF_META: Record<NotificationList, { label: string; desc: string }> = {
  mentioned: { label: 'Mentioned in a comment', desc: 'Someone types @your name on a task.' },
  assigned: { label: 'Assigned to you', desc: 'A task is assigned to or taken from you.' },
  reminders: { label: 'Task reminders', desc: 'Your own reminders, ahead of a start time.' },
};
// Order shown in the mock (mentioned, assigned, reminders).
const PREF_ORDER: NotificationList[] = ['mentioned', 'assigned', 'reminders'];

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
  const [prefs, setPrefs] = useState<NotificationPreferencesDto | null>(null);
  const [supervisorName, setSupervisorName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tzSaving, setTzSaving] = useState(false);
  const [tzError, setTzError] = useState<string | null>(null);
  const tzOptions = useMemo(timeZoneOptions, []);

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

  useEffect(() => {
    void api
      .getNotificationPreferences()
      .then(setPrefs)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load preferences'),
      );
  }, []);

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

  const update = async (key: keyof NotificationPreferencesDto, value: boolean) => {
    const patch = { [key]: value } as Partial<NotificationPreferencesDto>;
    setPrefs((p) => (p ? { ...p, ...patch } : p)); // optimistic
    try {
      setPrefs(await api.updateNotificationPreferences(patch));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save preferences');
      void api
        .getNotificationPreferences()
        .then(setPrefs)
        .catch(() => {});
    }
  };

  if (!prefs) {
    return (
      <div className="profile-page">
        {error ? <div className="alert error">{error}</div> : <div className="muted">Loading…</div>}
      </div>
    );
  }

  return (
    <div className="profile-page">
      <h1>Your profile</h1>

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
          </div>
        </div>

        {/* The right-hand column: preferences, then the queue link under them. */}
        <div className="profile-col">
          {/* Notification preferences */}
          <div className="card">
            <div className="profile-card-head">
              <h3>Notifications</h3>
            </div>
            <p className="profile-card-sub">Choose what reaches you, and where.</p>
            {error && <div className="alert error">{error}</div>}

            <div className="prefs-list">
              <div className="prefs-head">
                <span />
                <span>In app</span>
                <span>Email</span>
              </div>
              {PREF_ORDER.filter((l) => NOTIFICATION_LISTS.includes(l)).map((list) => {
                const inAppKey = `${list}InApp` as keyof NotificationPreferencesDto;
                const emailKey = `${list}Email` as keyof NotificationPreferencesDto;
                const inApp = prefs[inAppKey];
                const email = prefs[emailKey];
                const meta = PREF_META[list];
                return (
                  <div key={list} className="prefs-row">
                    <div className="prefs-row-main">
                      <div className="prefs-row-label">{meta.label}</div>
                      <div className="prefs-row-desc">{meta.desc}</div>
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={inApp}
                        aria-label={`Receive ${meta.label} notifications in the app`}
                        onChange={(e) => void update(inAppKey, e.target.checked)}
                      />
                      <span className="switch-track" aria-hidden="true" />
                    </label>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={email}
                        disabled={!inApp}
                        aria-label={`Also email me ${meta.label} notifications`}
                        onChange={(e) => void update(emailKey, e.target.checked)}
                      />
                      <span className="switch-track" aria-hidden="true" />
                    </label>
                  </div>
                );
              })}
            </div>

            <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 0, marginTop: '1rem' }}>
              Changes save as you make them. Email goes to {user?.email}.
            </p>
          </div>

          {/* Admins only: the email queue dashboard. */}
          <QueueDashboardCard />
        </div>
      </div>
    </div>
  );
}
