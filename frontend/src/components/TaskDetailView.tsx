import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type DependencyType,
  type TaskDetailDto,
  type TaskPriority,
  type TaskRef,
  type TaskStatus,
  type TaskUserRef,
  type UserDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { RichText } from './RichText';
import { RichTextEditor } from './RichTextEditor';
import { AttachmentSection } from './AttachmentSection';
import { Comments } from './Comments';
import { TaskRefLink } from './TaskRefLink';
import { TaskPickerModal } from './TaskPickerModal';
import {
  isoToParts,
  partsToIso,
  defaultTime,
  DEFAULT_START_HOUR,
  DEFAULT_DUE_HOUR,
} from '../lib/datetime';
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning';

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

type PickerKind = 'parent' | DependencyType;

const PICKER_TITLES: Record<PickerKind, string> = {
  parent: 'Set parent task',
  blocks: 'Add a task this one blocks',
  blockedBy: 'Add a task this one is blocked by',
};

interface Props {
  initialTask: TaskDetailDto;
  currentUser: UserDto;
}

/**
 * The task detail page's editing surface. Different fields save differently:
 *  - Name & Description: click to edit in place, each with its own Save/Cancel.
 *  - Assignee / Priority / Status / Start / Due: staged, saved together by the
 *    "Save changes" button (offered at the top and bottom — both equivalent).
 *  - Tags, Relationships, Attachments: saved immediately, no explicit save.
 */
export function TaskDetailView({ initialTask, currentUser }: Props) {
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskDetailDto>(initialTask);

  const [notice, setNotice] = useState<string | null>(null);
  const [relError, setRelError] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [commentsDirty, setCommentsDirty] = useState(false);

  // Inline name edit.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(initialTask.name);
  const [savingName, setSavingName] = useState(false);

  // Inline description edit.
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(initialTask.description ?? '');
  const [savingDesc, setSavingDesc] = useState(false);

  // Staged fields (saved together via "Save changes").
  const [assigneeId, setAssigneeId] = useState(initialTask.assigneeId ?? '');
  const [priority, setPriority] = useState<TaskPriority>(initialTask.priority);
  const [status, setStatus] = useState<TaskStatus>(initialTask.status);
  const [startDate, setStartDate] = useState(() => isoToParts(initialTask.startAt).date);
  const [startTime, setStartTime] = useState(() => isoToParts(initialTask.startAt).time);
  const [dueDate, setDueDate] = useState(() => isoToParts(initialTask.dueAt).date);
  const [dueTime, setDueTime] = useState(() => isoToParts(initialTask.dueAt).time);
  const [savingFields, setSavingFields] = useState(false);
  const [fieldsError, setFieldsError] = useState<string | null>(null);

  // Tags (auto-saved).
  const [tagDraft, setTagDraft] = useState('');
  const [tagBusy, setTagBusy] = useState(false);

  const [users, setUsers] = useState<TaskUserRef[]>([]);
  useEffect(() => {
    api
      .listActiveUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  // All tags currently in use across tasks (for the picklist).
  const [allTags, setAllTags] = useState<string[]>([]);
  useEffect(() => {
    api
      .listTaskTags()
      .then(setAllTags)
      .catch(() => setAllTags([]));
  }, []);

  // --- Save handlers -------------------------------------------------------

  async function runRel(action: () => Promise<TaskDetailDto>) {
    setRelError(null);
    try {
      setTask(await action());
    } catch (err) {
      setRelError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function handlePick(picked: TaskRef) {
    const kind = picker;
    setPicker(null);
    if (kind === 'parent') {
      await runRel(() => api.setParent(task.id, picked.id));
    } else if (kind) {
      await runRel(() => api.addDependency(task.id, kind, picked.id));
    }
  }

  async function saveName() {
    const name = nameDraft.trim();
    if (name.length < 2) return;
    setSavingName(true);
    try {
      setTask(await api.updateTask(task.id, { name }));
      setEditingName(false);
      setNotice('Task saved.');
    } catch (err) {
      setRelError(err instanceof ApiError ? err.message : 'Could not save the name');
    } finally {
      setSavingName(false);
    }
  }

  async function saveDesc() {
    setSavingDesc(true);
    try {
      // RichTextEditor emits '' when empty → store null.
      setTask(await api.updateTask(task.id, { description: descDraft === '' ? null : descDraft }));
      setEditingDesc(false);
      setNotice('Task saved.');
    } catch (err) {
      setRelError(err instanceof ApiError ? err.message : 'Could not save the description');
    } finally {
      setSavingDesc(false);
    }
  }

  async function saveFields() {
    setFieldsError(null);
    const startAt = partsToIso(startDate, startTime, DEFAULT_START_HOUR);
    const dueAt = partsToIso(dueDate, dueTime, DEFAULT_DUE_HOUR);
    if (startAt && dueAt && new Date(startAt) >= new Date(dueAt)) {
      setFieldsError('Start must be earlier than Due');
      return;
    }
    setSavingFields(true);
    try {
      setTask(
        await api.updateTask(task.id, {
          assigneeId: assigneeId === '' ? null : assigneeId,
          priority,
          status,
          startAt,
          dueAt,
        }),
      );
      setNotice('Task saved.');
    } catch (err) {
      setFieldsError(err instanceof ApiError ? err.message : 'Could not save changes');
    } finally {
      setSavingFields(false);
    }
  }

  async function refreshTags() {
    try {
      setAllTags(await api.listTaskTags());
    } catch {
      /* keep the current list if the refresh fails */
    }
  }

  async function addTagValue(tag: string) {
    const t = tag.trim();
    if (!t || task.tags.includes(t)) return;
    setTagBusy(true);
    try {
      setTask(await api.updateTask(task.id, { tags: [...task.tags, t] }));
      await refreshTags();
    } catch (err) {
      setRelError(err instanceof ApiError ? err.message : 'Could not add the tag');
    } finally {
      setTagBusy(false);
    }
  }

  async function addTagFromDraft() {
    const t = tagDraft.trim();
    setTagDraft('');
    if (t) await addTagValue(t);
  }

  async function removeTag(tag: string) {
    setTagBusy(true);
    try {
      setTask(await api.updateTask(task.id, { tags: task.tags.filter((x) => x !== tag) }));
      // A tag no longer used on any task drops out of the picklist.
      await refreshTags();
    } catch (err) {
      setRelError(err instanceof ApiError ? err.message : 'Could not remove the tag');
    } finally {
      setTagBusy(false);
    }
  }

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

  async function handleDeleteTask() {
    setDeleting(true);
    try {
      await api.deleteTask(task.id);
      navigate('/tasks');
    } catch (err) {
      setRelError(err instanceof ApiError ? err.message : 'Could not delete task');
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  // The Details "Save changes" button stays disabled until one of its staged
  // fields differs from what's persisted.
  const savedStart = isoToParts(task.startAt);
  const savedDue = isoToParts(task.dueAt);
  const fieldsDirty =
    assigneeId !== (task.assigneeId ?? '') ||
    priority !== task.priority ||
    status !== task.status ||
    startDate !== savedStart.date ||
    startTime !== savedStart.time ||
    dueDate !== savedDue.date ||
    dueTime !== savedDue.time;

  // Unsaved-changes guard: staged Details edits, or an open inline name/
  // description edit with a modified value. (Tags/relationships/attachments
  // save immediately, so they're never "unsaved".)
  const nameUnsaved = editingName && nameDraft.trim() !== task.name;
  const descUnsaved = editingDesc && descDraft !== (task.description ?? '');
  useUnsavedChangesWarning(fieldsDirty || nameUnsaved || descUnsaved || commentsDirty);

  const saveChangesButton = (
    <button type="button" disabled={savingFields || !fieldsDirty} onClick={saveFields}>
      {savingFields ? 'Saving…' : 'Save changes'}
    </button>
  );

  // Existing tags not already on this task, for the picklist (sorted by the API).
  const availableTags = allTags.filter((t) => !task.tags.includes(t));

  return (
    <div className="container">
      <p style={{ marginTop: 0 }}>
        <Link to="/tasks">← Back to tasks</Link>
      </p>

      {notice && <div className="alert success">{notice}</div>}
      {relError && <div className="alert error">{relError}</div>}

      {/* Header: inline-editable name + top Save changes + Delete */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
          }}
        >
          <div style={{ flex: 1 }}>
            {editingName ? (
              <div className="field" style={{ margin: 0 }}>
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  minLength={2}
                  aria-label="Task name"
                  autoFocus
                />
                <div className="btn-row">
                  <button
                    type="button"
                    disabled={savingName || nameDraft.trim().length < 2}
                    onClick={saveName}
                  >
                    {savingName ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setEditingName(false);
                      setNameDraft(task.name);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <h2
                className="editable-heading"
                style={{ margin: 0 }}
                title="Click to edit the name"
                onClick={() => {
                  setNameDraft(task.name);
                  setEditingName(true);
                }}
              >
                Task #{task.id}: {task.name}
              </h2>
            )}
          </div>
          <div className="btn-row" style={{ marginTop: 0, flex: 'none' }}>
            {currentUser.role === 'Admin' && (
              <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>
                Delete task
              </button>
            )}
          </div>
        </div>
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '0.35rem 1rem',
            margin: '0.75rem 0 0',
          }}
        >
          <dt className="muted">Creator</dt>
          <dd style={{ margin: 0 }}>{task.creator.email}</dd>
          <dt className="muted">Created</dt>
          <dd style={{ margin: 0 }}>{formatDateTime(task.createdAt)}</dd>
          <dt className="muted">Status changed</dt>
          <dd style={{ margin: 0 }}>{formatDateTime(task.statusChangedAt)}</dd>
        </dl>
      </div>

      {/* Description: click to edit in place */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Description</h3>
        {editingDesc ? (
          <div>
            <RichTextEditor
              value={descDraft}
              onChange={setDescDraft}
              ariaLabel="Task description"
              autoFocus
            />
            <div className="btn-row">
              <button type="button" disabled={savingDesc} onClick={saveDesc}>
                {savingDesc ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setEditingDesc(false);
                  setDescDraft(task.description ?? '');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            className="editable-block"
            title="Click to edit the description"
            onClick={() => {
              setDescDraft(task.description ?? '');
              setEditingDesc(true);
            }}
          >
            {task.description ? (
              <RichText html={task.description} />
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                No description. Click to add one.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Attachments (saved immediately) */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Attachments</h3>
        <AttachmentSection
          attachments={task.attachments}
          target={{ kind: 'task', taskId: task.id }}
          canUpload
          currentUser={currentUser}
          onChanged={setTask}
        />
      </div>

      {/* Details: staged fields saved by "Save changes" */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Details</h3>
        {fieldsError && <div className="alert error">{fieldsError}</div>}

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

        <div className="btn-row">{saveChangesButton}</div>
      </div>

      {/* Tags (saved immediately) — below the Details section */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Tags</h3>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          {task.tags.length === 0 && <span className="muted">No tags</span>}
          {task.tags.map((t) => (
            <span key={t} className="badge role-Member">
              {t}{' '}
              <button
                type="button"
                onClick={() => removeTag(t)}
                disabled={tagBusy}
                aria-label={`Remove tag ${t}`}
                style={{ background: 'transparent', color: 'inherit', padding: 0, marginLeft: 4 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {availableTags.length > 0 && (
            <select
              value=""
              disabled={tagBusy}
              aria-label="Add an existing tag"
              onChange={(e) => {
                const value = e.target.value;
                if (value) void addTagValue(value);
              }}
            >
              <option value="">Add an existing tag…</option>
              {availableTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addTagFromDraft();
              }
            }}
            placeholder="Add a new tag and press Enter"
          />
          <button type="button" className="secondary" disabled={tagBusy} onClick={addTagFromDraft}>
            Add
          </button>
        </div>
      </div>

      {/* Relationships (saved immediately) */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Relationships</h3>

        <div className="rel-section">
          <div className="rel-heading">
            <span>Parent Task</span>
            {!task.parent && (
              <button
                type="button"
                className="secondary rel-add"
                onClick={() => setPicker('parent')}
              >
                + Add
              </button>
            )}
          </div>
          {task.parent ? (
            <div className="rel-row">
              <TaskRefLink task={task.parent} />
              <button
                type="button"
                className="rel-x"
                aria-label="Remove parent"
                onClick={() => runRel(() => api.clearParent(task.id))}
              >
                ×
              </button>
            </div>
          ) : (
            <p className="muted rel-empty">No parent task.</p>
          )}
        </div>

        <div className="rel-section">
          <div className="rel-heading">
            <span>Child Tasks</span>
          </div>
          {task.children.length === 0 ? (
            <p className="muted rel-empty">No sub-tasks.</p>
          ) : (
            task.children.map((c) => (
              <div key={c.id} className="rel-row">
                <TaskRefLink task={c} />
              </div>
            ))
          )}
        </div>

        <div className="rel-section">
          <div className="rel-heading">
            <span>Blocks</span>
            <button type="button" className="secondary rel-add" onClick={() => setPicker('blocks')}>
              + Add
            </button>
          </div>
          {task.blocks.length === 0 ? (
            <p className="muted rel-empty">Doesn&apos;t block any tasks.</p>
          ) : (
            task.blocks.map((t) => (
              <div key={t.id} className="rel-row">
                <TaskRefLink task={t} />
                <button
                  type="button"
                  className="rel-x"
                  aria-label={`Remove blocks #${t.id}`}
                  onClick={() => runRel(() => api.removeDependency(task.id, 'blocks', t.id))}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        <div className="rel-section">
          <div className="rel-heading">
            <span>Is Blocked By</span>
            <button
              type="button"
              className="secondary rel-add"
              onClick={() => setPicker('blockedBy')}
            >
              + Add
            </button>
          </div>
          {task.isBlockedBy.length === 0 ? (
            <p className="muted rel-empty">Not blocked by any tasks.</p>
          ) : (
            task.isBlockedBy.map((t) => (
              <div key={t.id} className="rel-row">
                <TaskRefLink task={t} />
                <button
                  type="button"
                  className="rel-x"
                  aria-label={`Remove is-blocked-by #${t.id}`}
                  onClick={() => runRel(() => api.removeDependency(task.id, 'blockedBy', t.id))}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Comments */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Comments</h3>
        <Comments
          task={task}
          currentUser={currentUser}
          onChanged={setTask}
          onDirtyChange={setCommentsDirty}
        />
      </div>

      {picker && (
        <TaskPickerModal
          title={PICKER_TITLES[picker]}
          excludeId={task.id}
          onPick={handlePick}
          onClose={() => setPicker(null)}
        />
      )}

      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Delete task?</h3>
            <p>
              This permanently deletes task #{task.id} “{task.name}”, along with its comments and
              attachments. This cannot be undone.
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="danger"
                disabled={deleting}
                onClick={handleDeleteTask}
              >
                {deleting ? 'Deleting…' : 'Delete task'}
              </button>
              <button type="button" className="secondary" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
