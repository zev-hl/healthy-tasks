import { useState, type FormEvent } from 'react';
import type { Role, UpdateUserRequest, UserDto } from '@healthy-tasks/shared';
import { ROLES } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';

interface Props {
  user: UserDto;
  /** Eligible supervisors (active Managers/Admins) for the dropdown. */
  supervisors: UserDto[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

/**
 * Edit an existing user in a dialog (mirrors the Add-user form). "Save changes"
 * is disabled until a field differs, sends only the changed fields, and closes
 * on success; on error it stays open and shows the message.
 */
export function UserEditModal({ user, supervisors, onClose, onSaved }: Props) {
  const [email, setEmail] = useState(user.email);
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [role, setRole] = useState<Role>(user.role);
  const [title, setTitle] = useState(user.title ?? '');
  const [jobDescription, setJobDescription] = useState(user.jobDescription ?? '');
  const [supervisorId, setSupervisorId] = useState(user.supervisorId ?? '');
  const [isActive, setIsActive] = useState(user.isActive);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function buildPatch(): UpdateUserRequest {
    const patch: UpdateUserRequest = {};
    if (email.trim() !== user.email) patch.email = email.trim();
    if (firstName.trim() !== user.firstName) patch.firstName = firstName.trim();
    if (lastName.trim() !== user.lastName) patch.lastName = lastName.trim();
    if (role !== user.role) patch.role = role;
    if ((title.trim() || null) !== (user.title ?? null)) patch.title = title.trim() || null;
    if ((jobDescription.trim() || null) !== (user.jobDescription ?? null))
      patch.jobDescription = jobDescription.trim() || null;
    if ((supervisorId || null) !== (user.supervisorId ?? null))
      patch.supervisorId = supervisorId || null;
    if (isActive !== user.isActive) patch.isActive = isActive;
    return patch;
  }

  const patch = buildPatch();
  const dirty = Object.keys(patch).length > 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last name are required.');
      return;
    }
    setSaving(true);
    try {
      await api.updateUser(user.id, patch);
      onSaved(`Saved changes to ${email.trim()}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes');
    } finally {
      setSaving(false);
    }
  }

  const supervisorOptions = supervisors.filter((s) => s.id !== user.id);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Edit user</h3>
        {error && <div className="alert error">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="edit-email">Email (login id)</label>
            <input
              id="edit-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="edit-first">First name</label>
            <input id="edit-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="edit-last">Last name</label>
            <input id="edit-last" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="edit-role">Role</label>
            <select id="edit-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="edit-title">Title</label>
            <input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="edit-supervisor">Supervisor</label>
            <select
              id="edit-supervisor"
              value={supervisorId}
              onChange={(e) => setSupervisorId(e.target.value)}
            >
              <option value="">— None —</option>
              {supervisorOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.email} ({s.role})
                </option>
              ))}
            </select>
            <p className="muted" style={{ fontSize: '0.75rem', margin: '0.35rem 0 0' }}>
              Only Managers and Admins can be supervisors.
            </p>
          </div>
          <div className="field">
            <label htmlFor="edit-job">Job description</label>
            <textarea
              id="edit-job"
              rows={3}
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-status">Status</label>
            <select
              id="edit-status"
              value={isActive ? 'active' : 'inactive'}
              onChange={(e) => setIsActive(e.target.value === 'active')}
            >
              <option value="active">Active</option>
              <option value="inactive">Deactivated</option>
            </select>
          </div>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
