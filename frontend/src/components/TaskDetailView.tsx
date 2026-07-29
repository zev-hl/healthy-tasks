import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  TASK_NAME_MIN_LENGTH,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type ActiveUserDto,
  type DependencyType,
  type TaskDetailDto,
  type TaskPriority,
  type TaskRef,
  type TaskStatus,
  type UpdateTaskRequest,
  type UserDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { RichText } from './RichText';
import { RichTextEditor } from './RichTextEditor';
import { AttachmentSection } from './AttachmentSection';
import { Comments } from './Comments';
import { TaskRefLink } from './TaskRefLink';
import { TaskPickerModal } from './TaskPickerModal';
import { TaskHistory } from './TaskHistory';
import { TaskReminders } from './TaskReminders';
import { UserChip, UnassignedAvatar, userLabel } from './ui/Avatar';
import { StatusPill, PriorityRamp } from './ui/indicators';
import { DueDate, AgoDate } from './ui/dates';
import { isoToParts, partsToIso, defaultTime, DEFAULT_START_HOUR, DEFAULT_DUE_HOUR } from '../lib/datetime';
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning';

type PickerKind = 'parent' | DependencyType;

const PICKER_TITLES: Record<PickerKind, string> = {
  parent: 'Set parent task',
  blocks: 'Add a task this one blocks',
  blockedBy: 'Add a task this one is blocked by',
};

type Tab = 'work' | 'comments' | 'history';

interface Props {
  initialTask: TaskDetailDto;
  currentUser: UserDto;
}

export function TaskDetailView({ initialTask, currentUser }: Props) {
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskDetailDto>(initialTask);

  const [historyVersion, setHistoryVersion] = useState(0);
  const applyTask = useCallback((t: TaskDetailDto) => {
    setTask(t);
    setHistoryVersion((v) => v + 1);
  }, []);

  const [tab, setTab] = useState<Tab>('work');
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [commentsDirty, setCommentsDirty] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const [copied, setCopied] = useState(false);

  // Inline name edit.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(initialTask.name);
  const [savingName, setSavingName] = useState(false);

  // Inline description edit.
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(initialTask.description ?? '');
  const [savingDesc, setSavingDesc] = useState(false);

  // Tags + sub-task quick-add.
  const [tagDraft, setTagDraft] = useState('');
  const [tagBusy, setTagBusy] = useState(false);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const [addingSub, setAddingSub] = useState(false);

  const [users, setUsers] = useState<ActiveUserDto[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  useEffect(() => {
    api.listActiveUsers().then(setUsers).catch(() => setUsers([]));
    api.listTaskTags().then(setAllTags).catch(() => setAllTags([]));
  }, []);

  // --- Immediate-save property edits ---------------------------------------
  async function saveField(patch: Partial<UpdateTaskRequest>, completed = false) {
    setError(null);
    try {
      applyTask(await api.updateTask(task.id, patch));
      if (completed) {
        setJustCompleted(true);
        window.setTimeout(() => setJustCompleted(false), 1300);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the change');
    }
  }

  const onStatus = (s: TaskStatus) => saveField({ status: s }, s === 'Completed' && task.status !== 'Completed');

  // Dates are derived straight from the task, so the inputs stay in sync.
  const startParts = isoToParts(task.startAt);
  const dueParts = isoToParts(task.dueAt);
  const onStartDate = (v: string) => {
    const time = v === '' ? '' : startParts.time || defaultTime(DEFAULT_START_HOUR);
    void saveField({ startAt: partsToIso(v, time, DEFAULT_START_HOUR) });
  };
  const onStartTime = (v: string) => {
    if (startParts.date) void saveField({ startAt: partsToIso(startParts.date, v, DEFAULT_START_HOUR) });
  };
  const onDueDate = (v: string) => {
    const time = v === '' ? '' : dueParts.time || defaultTime(DEFAULT_DUE_HOUR);
    void saveField({ dueAt: partsToIso(v, time, DEFAULT_DUE_HOUR) });
  };
  const onDueTime = (v: string) => {
    if (dueParts.date) void saveField({ dueAt: partsToIso(dueParts.date, v, DEFAULT_DUE_HOUR) });
  };

  // --- Relationships / picker ----------------------------------------------
  async function runRel(action: () => Promise<TaskDetailDto>) {
    setError(null);
    try {
      applyTask(await action());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }
  async function handlePick(picked: TaskRef) {
    const kind = picker;
    setPicker(null);
    if (kind === 'parent') await runRel(() => api.setParent(task.id, picked.id));
    else if (kind) await runRel(() => api.addDependency(task.id, kind, picked.id));
  }

  // --- Name / description ---------------------------------------------------
  async function saveName() {
    const name = nameDraft.trim();
    if (name.length < TASK_NAME_MIN_LENGTH) return;
    setSavingName(true);
    try {
      applyTask(await api.updateTask(task.id, { name }));
      setEditingName(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the name');
    } finally {
      setSavingName(false);
    }
  }
  async function saveDesc() {
    setSavingDesc(true);
    try {
      applyTask(await api.updateTask(task.id, { description: descDraft === '' ? null : descDraft }));
      setEditingDesc(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the description');
    } finally {
      setSavingDesc(false);
    }
  }

  // --- Tags -----------------------------------------------------------------
  async function refreshTags() {
    try {
      setAllTags(await api.listTaskTags());
    } catch {
      /* keep current list */
    }
  }
  async function addTagValue(tag: string) {
    const t = tag.trim();
    if (!t || task.tags.includes(t)) return;
    setTagBusy(true);
    try {
      applyTask(await api.updateTask(task.id, { tags: [...task.tags, t] }));
      await refreshTags();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the tag');
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
      applyTask(await api.updateTask(task.id, { tags: task.tags.filter((x) => x !== tag) }));
      await refreshTags();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the tag');
    } finally {
      setTagBusy(false);
    }
  }

  // --- Sub-tasks ------------------------------------------------------------
  async function completeChild(childId: number) {
    setError(null);
    try {
      await api.updateTask(childId, { status: 'Completed' });
      applyTask(await api.getTask(task.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not complete the sub-task');
    }
  }
  async function addSubtask() {
    const name = subtaskDraft.trim();
    if (name.length < TASK_NAME_MIN_LENGTH) return;
    setAddingSub(true);
    try {
      const created = await api.createTask({ name });
      await api.setParent(created.id, task.id);
      applyTask(await api.getTask(task.id));
      setSubtaskDraft('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the sub-task');
    } finally {
      setAddingSub(false);
    }
  }

  async function handleDeleteTask() {
    setDeleting(true);
    try {
      await api.deleteTask(task.id);
      navigate('/tasks');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete task');
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  function copyLink() {
    void navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  const nameUnsaved = editingName && nameDraft.trim() !== task.name;
  const descUnsaved = editingDesc && descDraft !== (task.description ?? '');
  useUnsavedChangesWarning(nameUnsaved || descUnsaved || commentsDirty);

  const availableTags = allTags.filter((t) => !task.tags.includes(t));
  const doneChildren = task.children.filter((c) => c.status === 'Completed').length;
  const isCompleted = task.status === 'Completed';

  return (
    <div className="detail-page">
      {/* Top bar */}
      <div className="detail-topbar">
        <nav className="detail-breadcrumb">
          <Link to="/tasks">All tasks</Link>
          <span className="crumb-sep">/</span>
          <span className="mono">#{task.id}</span>
        </nav>
        <div className="spacer" />
        <button type="button" className="secondary btn-sm" onClick={copyLink}>
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
        {currentUser.role === 'Admin' && (
          <button type="button" className="secondary btn-sm" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
        {isCompleted ? (
          <button type="button" className="secondary btn-sm" onClick={() => onStatus('Open')}>
            Reopen
          </button>
        ) : (
          <button type="button" onClick={() => onStatus('Completed')}>
            Mark complete
          </button>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}

      {/* Header */}
      <div className={`detail-headerblock${justCompleted ? ' just-completed' : ''}`}>
        {editingName ? (
          <div className="field" style={{ margin: 0, maxWidth: 640 }}>
            <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} aria-label="Task name" autoFocus />
            <div className="btn-row">
              <button type="button" disabled={savingName || nameDraft.trim().length < TASK_NAME_MIN_LENGTH} onClick={saveName}>
                {savingName ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="secondary" onClick={() => { setEditingName(false); setNameDraft(task.name); }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="detail-title-row">
            <h1 className="detail-title">{task.name}</h1>
            <button type="button" className="edit-chip" onClick={() => { setNameDraft(task.name); setEditingName(true); }}>
              Edit
            </button>
          </div>
        )}

        {/* Property chip row — each saves immediately */}
        <div className="detail-props">
          <span className="prop-chip is-status">
            <StatusPill status={task.status} caret />
            <select className="prop-overlay-select" value={task.status} aria-label="Status" onChange={(e) => onStatus(e.target.value as TaskStatus)}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </span>

          <span className="prop-chip">
            <PriorityRamp priority={task.priority} label />
            <span className="prop-caret" aria-hidden="true">▾</span>
            <select className="prop-overlay-select" value={task.priority} aria-label="Priority" onChange={(e) => saveField({ priority: e.target.value as TaskPriority })}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </span>

          <span className="prop-chip">
            {task.assignee ? (
              <UserChip user={task.assignee} />
            ) : (
              <span className="user-chip muted">
                <UnassignedAvatar px={20} />
                <span className="user-name">Unassigned</span>
              </span>
            )}
            <span className="prop-caret" aria-hidden="true">▾</span>
            <select className="prop-overlay-select" value={task.assigneeId ?? ''} aria-label="Assignee" onChange={(e) => saveField({ assigneeId: e.target.value || null })}>
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {userLabel(u)}
                </option>
              ))}
            </select>
          </span>

          <span className={`prop-chip due-chip${task.dueAt ? '' : ' is-empty'}`}>
            {task.dueAt ? <DueDate iso={task.dueAt} inline /> : <span className="muted">No due date</span>}
          </span>

          {task.tags.map((t) => (
            <span key={t} className="badge tag">
              {t}
              <button type="button" className="tag-x" onClick={() => removeTag(t)} disabled={tagBusy} aria-label={`Remove tag ${t}`}>
                ×
              </button>
            </span>
          ))}
          <span className="prop-chip add-tag-chip">
            + Tag
            <input
              className="tag-inline-input"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addTagFromDraft();
                }
              }}
              placeholder="tag…"
              aria-label="Add a tag"
              list="detail-tag-list"
            />
            <datalist id="detail-tag-list">
              {availableTags.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </span>
        </div>
      </div>

      {/* Two-pane body */}
      <div className="detail-cols">
        <div className="detail-content">
          {/* Tabs */}
          <div className="detail-tabs" role="tablist">
            <button type="button" className={`detail-tab${tab === 'work' ? ' active' : ''}`} onClick={() => setTab('work')}>
              Work
            </button>
            <button type="button" className={`detail-tab${tab === 'comments' ? ' active' : ''}`} onClick={() => setTab('comments')}>
              Comments {task.comments.length > 0 ? `(${task.comments.length})` : ''}
            </button>
            <button type="button" className={`detail-tab${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>
              History
            </button>
          </div>

          {tab === 'work' && (
            <div className="detail-work">
              {/* Description */}
              <section className="card">
                <div className="section-head">
                  <h3>Description</h3>
                  {!editingDesc && (
                    <button type="button" className="edit-chip" onClick={() => { setDescDraft(task.description ?? ''); setEditingDesc(true); }}>
                      Edit
                    </button>
                  )}
                </div>
                {editingDesc ? (
                  <div>
                    <RichTextEditor value={descDraft} onChange={setDescDraft} ariaLabel="Task description" autoFocus />
                    <div className="btn-row">
                      <button type="button" disabled={savingDesc} onClick={saveDesc}>
                        {savingDesc ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" className="secondary" onClick={() => { setEditingDesc(false); setDescDraft(task.description ?? ''); }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : task.description ? (
                  <RichText html={task.description} />
                ) : (
                  <p className="muted" style={{ margin: 0 }}>
                    No description yet.
                  </p>
                )}
              </section>

              {/* Sub-tasks */}
              <section className="card">
                <div className="section-head">
                  <h3>Sub-tasks</h3>
                  {task.children.length > 0 && (
                    <span className="mono subtask-count">
                      {doneChildren} of {task.children.length} done
                    </span>
                  )}
                </div>
                {task.children.length > 0 && (
                  <div className="subtask-progress" aria-hidden="true">
                    <span style={{ width: `${(doneChildren / task.children.length) * 100}%` }} />
                  </div>
                )}
                <ul className="subtask-list">
                  {task.children.map((c) => {
                    const done = c.status === 'Completed';
                    return (
                      <li key={c.id} className={`subtask-row${done ? ' is-done' : ''}`}>
                        <button
                          type="button"
                          className="mday-check"
                          aria-label={done ? 'Completed' : 'Mark sub-task complete'}
                          disabled={done}
                          onClick={() => completeChild(c.id)}
                        >
                          {done && (
                            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                              <path d="M2 6.5 L5 9 L10 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                        <Link to={`/tasks/${c.id}`} className="subtask-name">
                          {c.name}
                        </Link>
                        <StatusPill status={c.status} />
                      </li>
                    );
                  })}
                </ul>
                <div className="subtask-add">
                  <input
                    value={subtaskDraft}
                    onChange={(e) => setSubtaskDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void addSubtask();
                      }
                    }}
                    placeholder="Add a sub-task…"
                    aria-label="Add a sub-task"
                  />
                  <button type="button" className="secondary btn-sm" disabled={addingSub || subtaskDraft.trim().length < TASK_NAME_MIN_LENGTH} onClick={addSubtask}>
                    {addingSub ? 'Adding…' : '+ Add'}
                  </button>
                </div>
              </section>

              {/* Attachments */}
              <section className="card">
                <h3 style={{ marginTop: 0 }}>Attachments</h3>
                <AttachmentSection attachments={task.attachments} target={{ kind: 'task', taskId: task.id }} canUpload currentUser={currentUser} onChanged={applyTask} />
              </section>
            </div>
          )}

          {tab === 'comments' && (
            <section className="card">
              <Comments task={task} currentUser={currentUser} onChanged={applyTask} onDirtyChange={setCommentsDirty} />
            </section>
          )}

          {tab === 'history' && (
            <section className="card">
              <TaskHistory taskId={task.id} version={historyVersion} />
            </section>
          )}
        </div>

        {/* Right rail */}
        <aside className="detail-rail">
          <div className="rail-section">
            <div className="rail-section-title">Details</div>
            <div className="rail-row">
              <span className="rail-label">Start</span>
              <span className="rail-dates">
                <input type="date" value={startParts.date} onChange={(e) => onStartDate(e.target.value)} aria-label="Start date" />
                <input type="time" value={startParts.time} onChange={(e) => onStartTime(e.target.value)} aria-label="Start time" disabled={!startParts.date} />
              </span>
            </div>
            <div className="rail-row">
              <span className="rail-label">Due</span>
              <span className="rail-dates">
                <input type="date" value={dueParts.date} onChange={(e) => onDueDate(e.target.value)} aria-label="Due date" />
                <input type="time" value={dueParts.time} onChange={(e) => onDueTime(e.target.value)} aria-label="Due time" disabled={!dueParts.date} />
              </span>
            </div>
            <div className="rail-row">
              <span className="rail-label">Creator</span>
              <UserChip user={task.creator} />
            </div>
            <div className="rail-row">
              <span className="rail-label">Created</span>
              <AgoDate iso={task.createdAt} />
            </div>
            <div className="rail-row">
              <span className="rail-label">Status set</span>
              <AgoDate iso={task.statusChangedAt} />
            </div>
          </div>

          <div className="rail-section">
            <div className="rail-section-title">Relationships</div>
            <div className="rel-section">
              <div className="rel-heading">
                <span>Parent</span>
                {!task.parent && (
                  <button type="button" className="tertiary btn-sm rel-add" onClick={() => setPicker('parent')}>
                    + Link
                  </button>
                )}
              </div>
              {task.parent ? (
                <div className="rel-row">
                  <TaskRefLink task={task.parent} />
                  <button type="button" className="rel-x" aria-label="Remove parent" onClick={() => runRel(() => api.clearParent(task.id))}>
                    ×
                  </button>
                </div>
              ) : (
                <p className="muted rel-empty">None</p>
              )}
            </div>

            <div className="rel-section">
              <div className="rel-heading">
                <span>Blocked by</span>
                <button type="button" className="tertiary btn-sm rel-add" onClick={() => setPicker('blockedBy')}>
                  + Link
                </button>
              </div>
              {task.isBlockedBy.length === 0 ? (
                <p className="muted rel-empty">Nothing</p>
              ) : (
                task.isBlockedBy.map((t) => (
                  <div key={t.id} className="rel-row rel-blocked">
                    <TaskRefLink task={t} />
                    <button type="button" className="rel-x" aria-label={`Remove is-blocked-by #${t.id}`} onClick={() => runRel(() => api.removeDependency(task.id, 'blockedBy', t.id))}>
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="rel-section">
              <div className="rel-heading">
                <span>Blocks</span>
                <button type="button" className="tertiary btn-sm rel-add" onClick={() => setPicker('blocks')}>
                  + Link
                </button>
              </div>
              {task.blocks.length === 0 ? (
                <p className="muted rel-empty">Nothing</p>
              ) : (
                task.blocks.map((t) => (
                  <div key={t.id} className="rel-row">
                    <TaskRefLink task={t} />
                    <button type="button" className="rel-x" aria-label={`Remove blocks #${t.id}`} onClick={() => runRel(() => api.removeDependency(task.id, 'blocks', t.id))}>
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rail-section">
            <div className="rail-section-title">Reminders</div>
            <TaskReminders taskId={task.id} />
          </div>
        </aside>
      </div>

      {picker && (
        <TaskPickerModal title={PICKER_TITLES[picker]} excludeId={task.id} onPick={handlePick} onClose={() => setPicker(null)} />
      )}

      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Delete task?</h3>
            <p>
              This permanently deletes task #{task.id} “{task.name}”, along with its comments and attachments. This cannot be undone.
            </p>
            <div className="btn-row">
              <button type="button" className="danger" disabled={deleting} onClick={handleDeleteTask}>
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
