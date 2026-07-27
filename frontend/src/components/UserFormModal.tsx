import { useEffect, useState, type FormEvent } from 'react';
import type { CreateUserRequest, Role, UserDto } from '@healthy-tasks/shared';
import { ROLES } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

/** Modal to create a new user. Supervisor list is fetched pre-filtered to
 *  active Managers and Admins (enforced again server-side). */
export function UserFormModal({ onClose, onCreated }: Props) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('Member');
  const [title, setTitle] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [supervisors, setSupervisors] = useState<UserDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .listSupervisors()
      .then(setSupervisors)
      .catch(() => setSupervisors([]));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const body: CreateUserRequest = {
      email,
      role,
      title: title || null,
      jobDescription: jobDescription || null,
      supervisorId: supervisorId || null,
    };
    try {
      await api.createUser(body);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create user');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Add user</h3>
        {error && <div className="alert error">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="new-email">Email (login id)</label>
            <input
              id="new-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="new-role">Role</label>
            <select id="new-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="new-title">Title</label>
            <input id="new-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="new-supervisor">Supervisor</label>
            <select
              id="new-supervisor"
              value={supervisorId}
              onChange={(e) => setSupervisorId(e.target.value)}
            >
              <option value="">— None —</option>
              {supervisors.map((s) => (
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
            <label htmlFor="new-job">Job description</label>
            <textarea
              id="new-job"
              rows={3}
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
            />
          </div>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
