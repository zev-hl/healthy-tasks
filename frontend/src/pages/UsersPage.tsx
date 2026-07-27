import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UserDto } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { UserFormModal } from '../components/UserFormModal';

export function UsersPage() {
  const [users, setUsers] = useState<UserDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await api.listUsers());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDeactivate(user: UserDto) {
    if (!confirm(`Deactivate ${user.email}? They will be unable to sign in.`)) return;
    try {
      await api.deactivateUser(user.id);
      setNotice(`${user.email} was deactivated.`);
      setResetLink(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to deactivate user');
    }
  }

  async function handleReset(user: UserDto) {
    try {
      const res = await api.adminResetPassword(user.id);
      setNotice(`Reset link generated for ${user.email} (also emailed / logged to the console).`);
      setResetLink(res.resetLink);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate reset link');
    }
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Users</h2>
        <div className="spacer" />
        <button onClick={() => setShowCreate(true)}>Add user</button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}
      {resetLink && (
        <div className="alert info">
          <strong>Reset link:</strong> {resetLink}
        </div>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Title</th>
              <th>Supervisor</th>
              <th>Status</th>
              <th style={{ width: 1 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.isActive ? '' : 'row-inactive'}>
                <td>{u.email}</td>
                <td>
                  <span className={`badge role-${u.role}`}>{u.role}</span>
                </td>
                <td>{u.title ?? <span className="muted">—</span>}</td>
                <td>
                  {u.supervisorId ? (
                    (usersById.get(u.supervisorId)?.email ?? <span className="muted">—</span>)
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <span className={`badge ${u.isActive ? 'active' : 'inactive'}`}>
                    {u.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <div className="btn-row">
                    <button className="secondary" onClick={() => handleReset(u)}>
                      Reset password
                    </button>
                    {u.isActive && (
                      <button className="danger" onClick={() => handleDeactivate(u)}>
                        Deactivate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showCreate && (
        <UserFormModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            setNotice('User created. A password-reset link was emailed / logged to the console.');
            void load();
          }}
        />
      )}
    </div>
  );
}
