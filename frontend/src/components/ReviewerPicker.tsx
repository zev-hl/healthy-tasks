import { useEffect, useId, useMemo, useState, type KeyboardEvent, type RefObject } from 'react';
import { ArrowRight, Check, Search } from 'lucide-react';
import { type ActiveUserDto } from '@healthy-tasks/shared';
import { api } from '../api/client';
import { Avatar, userLabel } from './ui/Avatar';
import { Popover } from './harbor/Popover';
import { Btn, Pill, cx } from './harbor/ui';

interface Props {
  /** The control it opens under: the task page's Status chip, or the Board card. */
  anchorRef: RefObject<HTMLElement>;
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
 * Reviewer selection (Phase 10, scoped in Phase 13). In the redesign it's a
 * menu under the control that asked for it, not a pop-up window (brief §5:
 * no modals unless something must interrupt). Shown whenever a task's Status
 * is set to Review — from the task page's Status chip or a Board drop into
 * Review. Lists only the eligible
 * reviewer pool for THIS task (Admin + the current assignee's supervisor
 * chain); the chosen reviewer becomes the task's temporary assignee, and the
 * "What happens" box spells out what is restored later. Nothing changes
 * until it's confirmed.
 */
export function ReviewerPicker({
  anchorRef,
  taskId,
  taskRef,
  taskName,
  currentAssignee,
  returnStatus,
  onPick,
  onClose,
}: Props) {
  const listId = useId();
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
        if (cancelled) return;
        setUsers(u);
        // Only one person can review: choose them already.
        if (u.length === 1) setSelected(u[0]!.id);
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

  async function confirm(id = selected) {
    if (!id || submitting) return;
    setSubmitting(true);
    try {
      await onPick(id);
    } finally {
      setSubmitting(false);
    }
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (filtered.length === 0) return;
    const at = filtered.findIndex((u) => u.id === selected);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = at < 0 ? (step > 0 ? 0 : filtered.length - 1) : at + step;
      setSelected(filtered[(next + filtered.length) % filtered.length]!.id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (at >= 0) void confirm();
      else if (filtered.length === 1) setSelected(filtered[0]!.id);
    }
  }

  const reviewer = users.find((u) => u.id === selected);
  const subtitle = [taskRef, taskName].filter(Boolean).join(' ');

  return (
    <Popover
      anchorRef={anchorRef}
      open
      onClose={() => !submitting && onClose()}
      label="Send for review"
      minWidth={420}
      matchWidth={false}
      closeOnTab={false}
      className="hb-rvw"
    >
      <div className="hb-rvw-head">Send for review</div>
      <p className="hb-rvw-sub">
        {subtitle ? <strong>{subtitle}</strong> : null}
        {subtitle ? <br /> : null}
        Choose who reviews it. They hold the task until they’re done.
      </p>

      {users.length > 5 && (
        <label className="hb-menu-search hb-rvw-search">
          <Search size={14} aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Search people"
            aria-label="Search reviewers"
            aria-controls={listId}
          />
        </label>
      )}

      <ul id={listId} className="hb-rvw-list" role="listbox" aria-label="Reviewers">
        {loading && <li className="hb-rvw-msg">Loading…</li>}
        {!loading && users.length === 0 && (
          <li className="hb-rvw-msg">
            Nobody can review this task: it needs an assignee with a supervisor.
          </li>
        )}
        {!loading && users.length > 0 && filtered.length === 0 && (
          <li className="hb-rvw-msg">No one matches “{query.trim()}”.</li>
        )}
        {filtered.map((u) => {
          const on = selected === u.id;
          return (
            <li
              key={u.id}
              role="option"
              aria-selected={on}
              tabIndex={0}
              className={cx('hb-rvw-row', on && 'is-on')}
              onClick={() => setSelected(u.id)}
              onDoubleClick={() => void confirm(u.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (on && e.key === 'Enter') void confirm();
                  else setSelected(u.id);
                }
              }}
            >
              <Avatar user={u} px={32} decorative />
              <span className="hb-rvw-who">
                <span className="hb-rvw-name">{userLabel(u)}</span>
                <span className="hb-rvw-meta">{u.title || u.email}</span>
              </span>
              {u.role === 'Admin' && <Pill tone="grey">Admin</Pill>}
              <span className={cx('hb-rvw-radio', on && 'is-on')} aria-hidden="true">
                {on && <Check size={12} strokeWidth={3} />}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="hb-rvw-what" aria-label="What happens">
        <span className="hb-label">What happens</span>
        <div className="hb-rvw-step">
          <span className="hb-rvw-k">Now</span>
          <span>
            {currentAssignee || 'Unassigned'}
            <ArrowRight size={14} aria-hidden="true" className="hb-rvw-arrow" />
            <strong>{reviewer ? userLabel(reviewer) : 'the reviewer'}</strong>
          </span>
        </div>
        <div className="hb-rvw-step">
          <span className="hb-rvw-k">When reviewed</span>
          <span>
            Back to {currentAssignee || 'Unassigned'}
            {returnStatus ? (
              <>
                , status <strong>{returnStatus}</strong>
              </>
            ) : null}
          </span>
        </div>
      </div>

      <div className="hb-rvw-foot">
        <span className="hb-rvw-hint">Only Admins and the assignee’s supervisors can review.</span>
        <Btn onClick={onClose} disabled={submitting}>
          Cancel
        </Btn>
        <Btn kind="primary" onClick={() => void confirm()} disabled={!selected || submitting}>
          {submitting ? 'Sending…' : 'Send for review'}
        </Btn>
      </div>
    </Popover>
  );
}
