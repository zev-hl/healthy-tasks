import { useEffect, useState, type FormEvent } from 'react';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_STATUS,
  type TaskDto,
  type TaskPriority,
  type TaskStatus,
  type TaskUserRef,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';

export interface TaskFormPayload {
  name: string;
  description: string | null;
  assigneeId: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  tags: string[];
  startAt: string | null;
  dueAt: string | null;
}

interface Props {
  initial?: TaskDto | null;
  submitLabel: string;
  onSubmit: (payload: TaskFormPayload) => Promise<void>;
}

const DEFAULT_START_HOUR = 7; // 7:00 AM
const DEFAULT_DUE_HOUR = 19; // 7:00 PM

const pad = (n: number) => String(n).padStart(2, '0');
const defaultTime = (hour: number) => `${pad(hour)}:00`;

/** Split an ISO timestamp into local date ("YYYY-MM-DD") and time ("HH:mm") parts. */
function isoToParts(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/**
 * Combine local date + time fields into an absolute UTC ISO string. Returns null
 * if no date is set. A missing time falls back to the field's default hour. The
 * conversion happens in the browser so "local" is the user's actual timezone.
 */
function partsToIso(date: string, time: string, defaultHour: number): string | null {
  if (date === '') return null;
  const t = time === '' ? defaultTime(defaultHour) : time;
  const d = new Date(`${date}T${t}`); // no offset → parsed as local time
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Shared editable form for all task fields. Deliberately plain — this is Phase 2
 * scaffolding, not the polished UI.
 */
export function TaskForm({ initial, submitLabel, onSubmit }: Props) {
  const initialStart = isoToParts(initial?.startAt);
  const initialDue = isoToParts(initial?.dueAt);

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [assigneeId, setAssigneeId] = useState(initial?.assigneeId ?? '');
  const [priority, setPriority] = useState<TaskPriority>(
    initial?.priority ?? DEFAULT_TASK_PRIORITY,
  );
  const [status, setStatus] = useState<TaskStatus>(initial?.status ?? DEFAULT_TASK_STATUS);
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');

  const [startDate, setStartDate] = useState(initialStart.date);
  const [startTime, setStartTime] = useState(initialStart.time);
  const [dueDate, setDueDate] = useState(initialDue.date);
  const [dueTime, setDueTime] = useState(initialDue.time);

  const [users, setUsers] = useState<TaskUserRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .listActiveUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  function addTag() {
    const t = tagDraft.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagDraft('');
  }

  function removeTag(t: string) {
    setTags(tags.filter((x) => x !== t));
  }

  // When a date is set and its time is still empty, fill the time with the
  // default (7 AM start / 7 PM due). Clearing the date clears the time too.
  function handleStartDate(value: string) {
    setStartDate(value);
    if (value === '') setStartTime('');
    else if (startTime === '') setStartTime(defaultTime(DEFAULT_START_HOUR));
  }
  function handleDueDate(value: string) {
    setDueDate(value);
    if (value === '') setDueTime('');
    else if (dueTime === '') setDueTime(defaultTime(DEFAULT_DUE_HOUR));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const startAt = partsToIso(startDate, startTime, DEFAULT_START_HOUR);
    const dueAt = partsToIso(dueDate, dueTime, DEFAULT_DUE_HOUR);

    // If both are supplied, Start must be before Due.
    if (startAt && dueAt && new Date(startAt) >= new Date(dueAt)) {
      setError('Start must be earlier than Due');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name,
        description: description.trim() === '' ? null : description,
        assigneeId: assigneeId === '' ? null : assigneeId,
        priority,
        status,
        tags,
        startAt,
        dueAt,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save task');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="alert error">{error}</div>}

      <div className="field">
        <label htmlFor="task-name">Name *</label>
        <input
          id="task-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          minLength={2}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="task-desc">Description</label>
        <textarea
          id="task-desc"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="task-assignee">Assignee</label>
        <select
          id="task-assignee"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
        >
          <option value="">— Unassigned —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.email}
              {u.title ? ` (${u.title})` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="task-priority">Priority</label>
        <select
          id="task-priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
        >
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="task-status">Status</label>
        <select
          id="task-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as TaskStatus)}
        >
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Tags</label>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          {tags.length === 0 && <span className="muted">No tags</span>}
          {tags.map((t) => (
            <span key={t} className="badge role-Member">
              {t}{' '}
              <button
                type="button"
                onClick={() => removeTag(t)}
                aria-label={`Remove tag ${t}`}
                style={{ background: 'transparent', color: 'inherit', padding: 0, marginLeft: 4 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="Add a tag and press Enter"
          />
          <button type="button" className="secondary" onClick={addTag}>
            Add
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="task-start-date">Start</label>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <input
            id="task-start-date"
            type="date"
            value={startDate}
            onChange={(e) => handleStartDate(e.target.value)}
            aria-label="Start date"
          />
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            aria-label="Start time"
            disabled={startDate === ''}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="task-due-date">Due</label>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <input
            id="task-due-date"
            type="date"
            value={dueDate}
            onChange={(e) => handleDueDate(e.target.value)}
            aria-label="Due date"
          />
          <input
            type="time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
            aria-label="Due time"
            disabled={dueDate === ''}
          />
        </div>
      </div>

      <button type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
