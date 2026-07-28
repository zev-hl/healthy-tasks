import { useEffect, useState } from 'react';
import {
  NOTIFICATION_LISTS,
  NOTIFICATION_LIST_LABELS,
  type NotificationPreferencesDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Avatar, userLabel } from '../components/ui/Avatar';

export function ProfilePage() {
  const { user } = useAuth();
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
      <div className="container">
        {error ? <div className="alert error">{error}</div> : 'Loading…'}
      </div>
    );
  }

  return (
    <div className="container">
      <h2>Profile</h2>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
          {user && <Avatar user={user} size="lg" decorative />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 650, fontSize: '1.05rem' }}>
              {user ? userLabel(user) : ''}
            </div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {user?.email}
              {user?.role ? (
                <span className={`badge role-${user.role}`} style={{ marginLeft: '0.5rem' }}>
                  {user.role}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Notification preferences</h3>
        {error && <div className="alert error">{error}</div>}
        <table className="prefs-table">
          <thead>
            <tr>
              <th>List</th>
              <th>Receive</th>
              <th>Also email me</th>
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_LISTS.map((list) => {
              const inAppKey = `${list}InApp` as keyof NotificationPreferencesDto;
              const emailKey = `${list}Email` as keyof NotificationPreferencesDto;
              const inApp = prefs[inAppKey];
              const email = prefs[emailKey];
              return (
                <tr key={list}>
                  <td>{NOTIFICATION_LIST_LABELS[list]}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={inApp}
                      aria-label={`Receive ${NOTIFICATION_LIST_LABELS[list]} notifications`}
                      onChange={(e) => void update(inAppKey, e.target.checked)}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={email}
                      disabled={!inApp}
                      aria-label={`Also email ${NOTIFICATION_LIST_LABELS[list]} notifications`}
                      onChange={(e) => void update(emailKey, e.target.checked)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          Turning off “Receive” stops new notifications of that type (existing ones remain). “Also
          email me” additionally sends each notification to {user?.email}. In development, emails are
          printed to the server console.
        </p>
      </div>
    </div>
  );
}
