import { useEffect, useMemo, useState } from 'react';
import { type ActiveUserDto } from '@healthy-tasks/shared';
import { api } from '../api/client';
import { Avatar, userLabel } from './ui/Avatar';

interface Props {
  /** Task whose reviewer pool to load (Admin + the assignee's supervisor chain). */
  taskId: number;
  /** Task ref for the subtitle, e.g. "#482". */
  taskRef?: string;
  /** Context for the subtitle, e.g. the task name. */
  taskName?: string;
  /** Current assignee's display name (shown in the consequence preview). */
  currentAssignee?: string | null;
  /** Status the task returns to when the review completes (its current status label). */
  returnStatus?: string | null;
  /** Called with the chosen reviewer's user id once confirmed. */
  onPick: (userId: string) => void | Promise<void>;
  onClose: () => void;
}

/**
 * Reviewer selection popup (Phase 10, scoped in Phase 13). Shown whenever a
 * task's Status is set to Review — from the Task Detail Status field or a Kanban
 * drop into Review. Lists only the eligible reviewer pool for THIS task (Admin +
 * the current assignee's supervisor chain); the chosen reviewer becomes the
 * task's temporary assignee, and a preview spells out what will be restored
 * later. Reused by both entry points.
 */
export function ReviewerPickerModal({
  taskId,
  taskRef,
  taskName,
  currentAssignee,
  returnStatus,
  onPick,
  onClose,
}: Props) {
  const [users, setUsers] = useState<ActiveUserDto[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .getReviewerCandidates(taskId)
      .then((u) => {
        if (!cancelled) setUsers(u);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => userLabel(u).toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [users, query]);

  async function confirm() {
    if (!selected || submitting) return;
    setSubmitting(true);
    try {
      await onPick(selected);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Send for review</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          {taskRef ? `${taskRef} ` : ''}
          {taskName ? `${taskName}. ` : ''}
          Choose who should review this task — they’ll temporarily become the assignee.
        </p>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people…"
          aria-label="Search reviewers"
        />
        <div className="reviewer-list" role="listbox" aria-label="Reviewers">
          {loading && <p className="muted">Loading…</p>}
          {!loading && filtered.length === 0 && <p className="muted">No matching people.</p>}
          {filtered.map((u) => (
            <button
              key={u.id}
              type="button"
              role="option"
              aria-selected={selected === u.id}
              className={`reviewer-option${selected === u.id ? ' selected' : ''}`}
              onClick={() => setSelected(u.id)}
            >
              <Avatar user={u} decorative />
              <span className="reviewer-name">
                {userLabel(u)}
                {u.title ? <span className="muted"> · {u.title}</span> : null}
              </span>
              <span className="mono muted reviewer-email">{u.email}</span>
            </button>
          ))}
        </div>
        {/* Consequence preview: what the confirm will do, in plain language. */}
        <div className="reviewer-preview">
          <div className="reviewer-preview-row">
            <span className="muted">Current assignee</span>
            <span>{currentAssignee || 'Unassigned'}</span>
          </div>
          <div className="reviewer-preview-row">
            <span className="muted">Will become</span>
            <span className="strong-ok">Prior assignee, restored when review completes</span>
          </div>
          {returnStatus ? (
            <div className="reviewer-preview-row">
              <span className="muted">Status returns to</span>
              <span>{returnStatus}, when review completes</span>
            </div>
          ) : null}
        </div>
        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={confirm} disabled={!selected || submitting}>
            {submitting ? 'Sending…' : 'Send for review'}
          </button>
        </div>
      </div>
    </div>
  );
}
