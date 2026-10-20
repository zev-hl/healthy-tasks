import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_STATUS,
  type ActiveUserDto,
  type TaskDto,
  type TaskPriority,
  type TaskStatus,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { assigneeOptionGroups, dutyOptionGroups, isMismatch, useDutyCatalog } from '../lib/duties';
import { userLabel } from './ui/Avatar';
import { DutyCrossCheck } from './duties/DutyCrossCheck';
import { GroupedOptions } from './duties/GroupedOptions';
import { RichTextEditor } from './RichTextEditor';
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning';

/** Visible text of rich-text HTML, for "did anything change" checks only. */
function richTextAsText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}
import {
  isoToParts,
  partsToIso,
  defaultTime,
  DEFAULT_START_HOUR,
  DEFAULT_DUE_HOUR,
} from '../lib/datetime';

export interface TaskFormPayload {
  name: string;
  description: string | null;
  assigneeId: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  tags: string[];
  startAt: string | null;
  dueAt: string | null;
  dutyId: string | null;
}

interface Props {
  initial?: TaskDto | null;
  submitLabel: string;
  onSubmit: (payload: TaskFormPayload) => Promise<void>;
}

/**
 * Editable form used to CREATE a task (all fields at once). The task detail
 * page edits fields individually (see TaskDetailView) and does not use this.
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

  const [users, setUsers] = useState<ActiveUserDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dutyId, setDutyId] = useState(initial?.dutyId ?? '');

  // Unsaved-work guard: anything typed or picked asks before the page is left.
  // The description is compared as text, since the rich-text editor may turn
  // an empty value into empty markup on its own. Off while submitting, so the
  // redirect to the new task isn't blocked.
  const snapshot = (s: {
    name: string;
    description: string;
    assigneeId: string;
    priority: string;
    status: string;
    tags: string[];
    tagDraft: string;
    start: string;
    due: string;
    dutyId: string;
  }) => JSON.stringify({ ...s, description: richTextAsText(s.description) });
  const [original] = useState(() =>
    snapshot({
      name,
      description,
      assigneeId,
      priority,
      status,
      tags,
      tagDraft: '',
      start: initialStart.date + initialStart.time,
      due: initialDue.date + initialDue.time,
      dutyId,
    }),
  );
  const dirty =
    snapshot({
      name,
      description,
      assigneeId,
      priority,
      status,
      tags,
      tagDraft: tagDraft.trim(),
      start: startDate + startTime,
      due: dueDate + dueTime,
      dutyId,
    }) !== original;
  useUnsavedChangesWarning(dirty && !submitting);

  useEffect(() => {
    api
      .listActiveUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  // --- Department Duties: optional duty + the live assignee ⇄ duty check -----
  // An unassigned new task goes to its creator, so the check runs against them.
  const { user: me } = useAuth();
  const catalog = useDutyCatalog();
  const [granting, setGranting] = useState(false);
  const assigneeRef = useRef<HTMLSelectElement>(null);
  const doerId = assigneeId || me?.id || null;
  const doer = users.find((u) => u.id === doerId) ?? null;
  const duty = dutyId ? (catalog.duties.get(dutyId) ?? null) : null;
  const mismatch = !catalog.loading && isMismatch(catalog.holdings, doerId, dutyId || null);
  const byId = new Map(users.map((u) => [u.id, u]));
  const supervisorOf = (id: string | null) => (id ? byId.get(byId.get(id)?.supervisorId ?? '') : undefined);
  const isAbove = (actorId: string, subId: string | null) => {
    const seen = new Set<string>();
    let cur = subId;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const sup = byId.get(cur)?.supervisorId ?? null;
      if (sup === actorId) return true;
      cur = sup;
    }
    return false;
  };
  const canGrant = !!me && !!doerId && (me.role === 'Admin' || isAbove(me.id, doerId));

  async function grant() {
    if (!doerId || !dutyId) return;
    setGranting(true);
    try {
      await api.grantDuty(doerId, dutyId);
      catalog.grantLocally(doerId, dutyId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not give the duty');
    } finally {
      setGranting(false);
    }
  }

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
    if (!dirty) return; // nothing entered yet
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
        dutyId: dutyId === '' ? null : dutyId,
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
        <label>Description</label>
        <RichTextEditor
          value={description}
          onChange={setDescription}
          ariaLabel="Task description"
        />
      </div>

      <div className="field">
        <label htmlFor="task-assignee">Assignee</label>
        <select
          id="task-assignee"
          ref={assigneeRef}
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
        >
          <option value="">— Unassigned (me) —</option>
          {/* With a duty chosen, people split into holders and ⚠ non-holders. */}
          <GroupedOptions groups={assigneeOptionGroups(users, { holdings: catalog.holdings, duty })} />
        </select>
      </div>

      <div className="field">
        <label htmlFor="task-duty">Department › Duty</label>
        <select id="task-duty" value={dutyId} onChange={(e) => setDutyId(e.target.value)}>
          <option value="">— No duty —</option>
          <GroupedOptions
            groups={dutyOptionGroups(catalog.departments, {
              holdings: catalog.holdings,
              assignee: doer ? { id: doer.id, firstName: doer.firstName } : null,
              selectedId: dutyId || null,
            })}
          />
        </select>
      </div>

      {mismatch && duty && doer && (
        <DutyCrossCheck
          personName={userLabel(doer)}
          personFirstName={doer.firstName || userLabel(doer)}
          duty={duty}
          blocking
          canGrant={canGrant}
          supervisorName={(() => {
            const s = supervisorOf(doer.id);
            return s ? userLabel(s) : null;
          })()}
          granting={granting}
          onGrant={() => void grant()}
          onPickAssignee={() => assigneeRef.current?.focus()}
          onClearDuty={() => setDutyId('')}
        />
      )}

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
            <span key={t} className="badge tag">
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

      <button
        type="submit"
        disabled={submitting || mismatch || !dirty}
        title={dirty ? undefined : 'Nothing has changed yet'}
      >
        {submitting ? 'Saving…' : submitLabel}
      </button>
      {mismatch && (
        <span className="muted" style={{ marginLeft: 10, fontSize: 12.5 }}>
          Fix the duty mismatch to save.
        </span>
      )}
    </form>
  );
}
