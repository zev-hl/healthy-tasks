import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  NOTIFICATION_LISTS,
  NOTIFICATION_LIST_LABELS,
  type NotificationPreferencesDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Avatar, userLabel } from '../components/ui/Avatar';

export function ProfilePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState<NotificationPreferencesDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getNotificationPreferences()
      .then(setPrefs)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load preferences'));
  }, []);

  const update = async (key: keyof NotificationPreferencesDto, value: boolean) => {
    const patch = { [key]: value } as Partial<NotificationPreferencesDto>;
    setPrefs((p) => (p ? { ...p, ...patch } : p)); // optimistic
    try {
      setPrefs(await api.updateNotificationPreferences(patch));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save preferences');
      // Re-sync with the server on failure.
      void api.getNotificationPreferences().then(setPrefs).catch(() => {});
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
      <h1>Profile</h1>

      <div className="card">
        <div className="profile-id">
          {user && <Avatar user={user} px={52} decorative />}
          <div className="profile-id-info">
            <div className="profile-id-name">{user ? userLabel(user) : ''}</div>
            <div className="profile-id-meta">
              <span>{user?.email}</span>
              {user?.role ? <span className={`badge role-${user.role}`}>{user.role}</span> : null}
            </div>
          </div>
          <div className="spacer" />
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

      <div className="card">
        <div className="profile-card-head">
          <h3>Notification preferences</h3>
        </div>
        <p className="profile-card-sub">
          Choose which updates you receive in the app, and which also email you at {user?.email}.
        </p>
        {error && <div className="alert error">{error}</div>}

        <div className="prefs-list">
          <div className="prefs-head">
            <span>Notification</span>
            <span>In app</span>
            <span>Email</span>
          </div>
          {NOTIFICATION_LISTS.map((list) => {
            const inAppKey = `${list}InApp` as keyof NotificationPreferencesDto;
            const emailKey = `${list}Email` as keyof NotificationPreferencesDto;
            const inApp = prefs[inAppKey];
            const email = prefs[emailKey];
            const label = NOTIFICATION_LIST_LABELS[list];
            return (
              <div key={list} className="prefs-row">
                <span className="prefs-row-label">{label}</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={inApp}
                    aria-label={`Receive ${label} notifications in the app`}
                    onChange={(e) => void update(inAppKey, e.target.checked)}
                  />
                  <span className="switch-track" aria-hidden="true" />
                </label>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={email}
                    disabled={!inApp}
                    aria-label={`Also email me ${label} notifications`}
                    onChange={(e) => void update(emailKey, e.target.checked)}
                  />
                  <span className="switch-track" aria-hidden="true" />
                </label>
              </div>
            );
          })}
        </div>

        <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 0, marginTop: '1rem' }}>
          Turning off “In app” stops new notifications of that type (existing ones remain). In
          development, emails are printed to the server console.
        </p>
      </div>
    </div>
  );
}
