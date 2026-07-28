import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Role, UpdateUserRequest, UserDto } from '@healthy-tasks/shared';
import { ROLES } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { UserFormModal } from '../components/UserFormModal';
import { MergeUsersModal } from '../components/MergeUsersModal';
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning';

/** The editable projection of a user row (strings for form inputs). */
interface Draft {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  title: string;
  supervisorId: string;
  isActive: boolean;
}

function toDraft(u: UserDto): Draft {
  return {
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    title: u.title ?? '',
    supervisorId: u.supervisorId ?? '',
    isActive: u.isActive,
  };
}

function rowDirty(u: UserDto, d: Draft): boolean {
  return (
    d.email !== u.email ||
    d.firstName !== u.firstName ||
    d.lastName !== u.lastName ||
    d.role !== u.role ||
    d.title !== (u.title ?? '') ||
    d.supervisorId !== (u.supervisorId ?? '') ||
    d.isActive !== u.isActive
  );
}

/** Build a PATCH body containing only the fields that changed for this row. */
function buildPatch(u: UserDto, d: Draft): UpdateUserRequest {
  const patch: UpdateUserRequest = {};
  if (d.email !== u.email) patch.email = d.email.trim();
  if (d.firstName !== u.firstName) patch.firstName = d.firstName.trim();
  if (d.lastName !== u.lastName) patch.lastName = d.lastName.trim();
  if (d.role !== u.role) patch.role = d.role;
  if (d.title !== (u.title ?? '')) patch.title = d.title.trim() || null;
  if (d.supervisorId !== (u.supervisorId ?? '')) patch.supervisorId = d.supervisorId || null;
  if (d.isActive !== u.isActive) patch.isActive = d.isActive;
  return patch;
}

export function UsersPage() {
  const [users, setUsers] = useState<UserDto[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [supervisors, setSupervisors] = useState<UserDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showMerge, setShowMerge] = useState(false);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sup] = await Promise.all([api.listUsers(), api.listSupervisors()]);
      setUsers(list);
      setSupervisors(sup);
      setDrafts(Object.fromEntries(list.map((u) => [u.id, toDraft(u)])));
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

  const dirty = useMemo(
    () =>
      users.some((u) => {
        const d = drafts[u.id];
        return d ? rowDirty(u, d) : false;
      }),
    [users, drafts],
  );

  // Warn before leaving with unsaved edits (staged but not yet saved).
  useUnsavedChangesWarning(dirty);

  function edit(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      return { ...prev, [id]: { ...cur, ...patch } };
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setNotice(null);
    setResetLink(null);
    const changed = users.filter((u) => {
      const d = drafts[u.id];
      return d ? rowDirty(u, d) : false;
    });
    try {
      for (const u of changed) {
        const d = drafts[u.id];
        if (d) await api.updateUser(u.id, buildPatch(u, d));
      }
      setNotice(`Saved changes to ${changed.length} user${changed.length === 1 ? '' : 's'}.`);
      await load();
    } catch (err) {
      // Reload so the table reflects whatever did persist before the failure.
      setError(err instanceof ApiError ? err.message : 'Failed to save changes');
      await load();
    } finally {
      setSaving(false);
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

  // Eligible supervisors for a given row: active Managers/Admins, never self.
  const supervisorOptions = (rowId: string) => supervisors.filter((s) => s.id !== rowId);

  return (
    <div className="container container-wide">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Users</h2>
        <div className="spacer" />
        <button onClick={handleSave} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button className="secondary" onClick={() => setShowMerge(true)}>
          Merge accounts
        </button>
        <button className="secondary" onClick={() => setShowCreate(true)}>
          Add user
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}
      {resetLink && (
        <div className="alert info">
          <strong>Reset link:</strong> {resetLink}
        </div>
      )}
      {dirty && (
        <div className="alert info">
          You have unsaved changes. Click <strong>Save changes</strong> to apply them.
        </div>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <div className="table-scroll">
        <table className="users-table">
          <thead>
            <tr>
              <th>Email (login id)</th>
              <th>First name</th>
              <th>Last name</th>
              <th>Role</th>
              <th>Title</th>
              <th>Supervisor</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const d = drafts[u.id];
              if (!d) return null;
              const merged = u.mergedIntoId !== null;
              const isDirty = rowDirty(u, d);
              return (
                <tr key={u.id} className={`${u.isActive ? '' : 'row-inactive'} ${isDirty ? 'row-dirty' : ''}`}>
                  <td>
                    <input
                      type="email"
                      value={d.email}
                      disabled={merged}
                      onChange={(e) => edit(u.id, { email: e.target.value })}
                      aria-label={`Email for ${u.email}`}
                    />
                  </td>
                  <td>
                    <input
                      value={d.firstName}
                      disabled={merged}
                      onChange={(e) => edit(u.id, { firstName: e.target.value })}
                      aria-label={`First name for ${u.email}`}
                    />
                  </td>
                  <td>
                    <input
                      value={d.lastName}
                      disabled={merged}
                      onChange={(e) => edit(u.id, { lastName: e.target.value })}
                      aria-label={`Last name for ${u.email}`}
                    />
                  </td>
                  <td>
                    <select
                      value={d.role}
                      disabled={merged}
                      onChange={(e) => edit(u.id, { role: e.target.value as Role })}
                      aria-label={`Role for ${u.email}`}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={d.title}
                      disabled={merged}
                      onChange={(e) => edit(u.id, { title: e.target.value })}
                      aria-label={`Title for ${u.email}`}
                    />
                  </td>
                  <td>
                    <select
                      value={d.supervisorId}
                      disabled={merged}
                      onChange={(e) => edit(u.id, { supervisorId: e.target.value })}
                      aria-label={`Supervisor for ${u.email}`}
                    >
                      <option value="">— None —</option>
                      {supervisorOptions(u.id).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.email}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {merged ? (
                      <span className="badge inactive" title={`Merged into ${usersById.get(u.mergedIntoId!)?.email ?? 'another account'}`}>
                        Merged
                      </span>
                    ) : (
                      <select
                        value={d.isActive ? 'active' : 'inactive'}
                        onChange={(e) => edit(u.id, { isActive: e.target.value === 'active' })}
                        aria-label={`Status for ${u.email}`}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Deactivated</option>
                      </select>
                    )}
                  </td>
                  <td>
                    <div className="btn-row">
                      {merged ? (
                        <span className="muted" style={{ fontSize: '0.8rem' }}>
                          → {usersById.get(u.mergedIntoId!)?.email ?? 'merged'}
                        </span>
                      ) : (
                        <button className="secondary" onClick={() => handleReset(u)}>
                          Reset password
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
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

      {showMerge && (
        <MergeUsersModal
          users={users}
          onClose={() => setShowMerge(false)}
          onMerged={(message) => {
            setShowMerge(false);
            setNotice(message);
            void load();
          }}
        />
      )}
    </div>
  );
}
