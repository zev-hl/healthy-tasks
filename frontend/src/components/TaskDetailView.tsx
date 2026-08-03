import { useCallback, useEffect, useRef, useState } from 'react';
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
  type UserDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { RichText } from './RichText';
import { RichTextEditor } from './RichTextEditor';
import { AttachmentSection } from './AttachmentSection';
import { Comments } from './Comments';
import { TaskRefLink } from './TaskRefLink';
import { TaskPickerModal } from './TaskPickerModal';
import { ReviewerPickerModal } from './ReviewerPickerModal';
import { TaskHistory } from './TaskHistory';
import { TaskReminders } from './TaskReminders';
import { TaskRecurrencePanel } from './TaskRecurrencePanel';
import { UserChip, UnassignedAvatar, userLabel } from './ui/Avatar';
import { StatusPill, PriorityRamp } from './ui/indicators';
import { DueDate, AgoDate } from './ui/dates';
import { isoToParts, partsToIso, DEFAULT_START_HOUR, DEFAULT_DUE_HOUR } from '../lib/datetime';
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning';

type PickerKind = 'parent' | 'child' | DependencyType;

const PICKER_TITLES: Record<PickerKind, string> = {
  parent: 'Set parent task',
  child: 'Add an existing task as a sub-task',
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
  const [notice, setNotice] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [commentsDirty, setCommentsDirty] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const [copied, setCopied] = useState(false);
  // Review workflow (Phase 10): reviewer-picker visibility + a busy flag for the
  // Reviewed / Recall actions.
  const [pendingReview, setPendingReview] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  // Savebar "All changes saved" label lifecycle: appears on a save, holds
  // briefly, then fades out and goes blank. 'hidden' is the resting state, so a
  // fresh/untouched task shows no flag.
  const [savedState, setSavedState] = useState<'hidden' | 'shown' | 'fading'>('hidden');
  const savedTimers = useRef<number[]>([]);

  // A "Task saved." confirmation auto-clears so it reads as a transient flash;
  // the savebar's "All changes saved" label follows the same fade-then-blank arc.
  const flashSaved = useCallback(() => {
    setNotice('Task saved.');
    window.setTimeout(() => setNotice(null), 2500);
    savedTimers.current.forEach((t) => window.clearTimeout(t));
    savedTimers.current = [];
    setSavedState('shown');
    savedTimers.current.push(window.setTimeout(() => setSavedState('fading'), 1800));
    savedTimers.current.push(window.setTimeout(() => setSavedState('hidden'), 2100));
  }, []);
  // Cancel pending fade timers on unmount.
  useEffect(() => () => savedTimers.current.forEach((t) => window.clearTimeout(t)), []);

  // Inline name edit.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(initialTask.name);
  const [savingName, setSavingName] = useState(false);

  // Inline description edit.
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(initialTask.description ?? '');
  const [savingDesc, setSavingDesc] = useState(false);

  // Tags quick-add.
  const [tagDraft, setTagDraft] = useState('');
  const [tagBusy, setTagBusy] = useState(false);

  const [users, setUsers] = useState<ActiveUserDto[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  useEffect(() => {
    api.listActiveUsers().then(setUsers).catch(() => setUsers([]));
    api.listTaskTags().then(setAllTags).catch(() => setAllTags([]));
  }, []);

  // --- Staged property edits (Status / Priority / Assignee / Start / Due) ---
  // These are edited locally and committed together via "Save changes", so a
  // change isn't persisted until the user confirms it.
  const [assigneeId, setAssigneeId] = useState(initialTask.assigneeId ?? '');
  const [priority, setPriority] = useState<TaskPriority>(initialTask.priority);
  const [status, setStatus] = useState<TaskStatus>(initialTask.status);
  const [startDate, setStartDate] = useState(() => isoToParts(initialTask.startAt).date);
  const [startTime, setStartTime] = useState(() => isoToParts(initialTask.startAt).time);
  const [dueDate, setDueDate] = useState(() => isoToParts(initialTask.dueAt).date);
  const [dueTime, setDueTime] = useState(() => isoToParts(initialTask.dueAt).time);
  const [savingFields, setSavingFields] = useState(false);
  const [fieldsError, setFieldsError] = useState<string | null>(null);

  // ISO is built only where it's actually needed: the save payload, the Start<Due
  // check, and the Due chip display.
  const stagedStartIso = partsToIso(startDate, startTime, DEFAULT_START_HOUR);
  const stagedDueIso = partsToIso(dueDate, dueTime, DEFAULT_DUE_HOUR);

  // Dirtiness is compared in the EDITOR's own representation (date + HH:mm parts),
  // never by round-tripping through ISO. The persisted value is projected into
  // the same parts via isoToParts, so it's precision-safe by construction: a
  // stored timestamp carrying seconds/ms matches cleanly until the user actually
  // edits a field. (A reusable form-dirty hook would generalize this — see the
  // Phase 11 note.)
  const persistedStart = isoToParts(task.startAt);
  const persistedDue = isoToParts(task.dueAt);
  const fieldsDirty =
    assigneeId !== (task.assigneeId ?? '') ||
    priority !== task.priority ||
    status !== task.status ||
    startDate !== persistedStart.date ||
    startTime !== persistedStart.time ||
    dueDate !== persistedDue.date ||
    dueTime !== persistedDue.time;

  // Commit all staged fields at once (status, priority, assignee, and dates),
  // always via the explicit "Save changes" button.
  async function saveFields() {
    setFieldsError(null);
    // A time with no date is ambiguous — reject it. (A date with no time is fine:
    // partsToIso fills in the default hour, i.e. auto-defaults on save.)
    if (startTime && !startDate) {
      setFieldsError('Start time needs a start date (or clear the time).');
      return;
    }
    if (dueTime && !dueDate) {
      setFieldsError('Due time needs a due date (or clear the time).');
      return;
    }
    const nextStatus = status;
    if (stagedStartIso && stagedDueIso && new Date(stagedStartIso) >= new Date(stagedDueIso)) {
      setFieldsError('Start must be earlier than Due');
      return;
    }
    // Transitioning INTO Review requires choosing a reviewer first — the actual
    // save happens in saveReview() once the reviewer-picker is confirmed.
    if (nextStatus === 'Review' && task.status !== 'Review') {
      setPendingReview(true);
      return;
    }
    const becameCompleted = nextStatus === 'Completed' && task.status !== 'Completed';
    setSavingFields(true);
    try {
      const updated = await api.updateTask(task.id, {
        assigneeId: assigneeId === '' ? null : assigneeId,
        priority,
        status: nextStatus,
        startAt: stagedStartIso,
        dueAt: stagedDueIso,
      });
      applyTask(updated);
      syncStaged(updated);
      flashSaved();
      if (becameCompleted) {
        setJustCompleted(true);
        window.setTimeout(() => setJustCompleted(false), 1300);
      }
    } catch (err) {
      setFieldsError(err instanceof ApiError ? err.message : 'Could not save changes');
    } finally {
      setSavingFields(false);
    }
  }

  // Sync the staged property fields to a task (the persisted truth). Used after
  // every commit and by Discard, so the chips + savebar never show a phantom
  // "unsaved" once the server has the change (e.g. the reviewer becoming assignee).
  function syncStaged(t: TaskDetailDto) {
    setAssigneeId(t.assigneeId ?? '');
    setPriority(t.priority);
    setStatus(t.status);
    const s = isoToParts(t.startAt);
    const d = isoToParts(t.dueAt);
    setStartDate(s.date);
    setStartTime(s.time);
    setDueDate(d.date);
    setDueTime(d.time);
  }

  // Revert staged fields to the persisted task.
  function discardFields() {
    setFieldsError(null);
    syncStaged(task);
  }

  // Clearing a date clears its time too, so a time is never left orphaned.
  function handleStartDate(value: string) {
    setStartDate(value);
    if (value === '') setStartTime('');
  }
  function handleDueDate(value: string) {
    setDueDate(value);
    if (value === '') setDueTime('');
  }

  // --- Review workflow (Phase 10) ------------------------------------------
  // Commit the staged fields with the chosen reviewer; the server makes the
  // reviewer the temporary assignee and records the prior assignee/status.
  async function saveReview(reviewerId: string) {
    setPendingReview(false);
    setFieldsError(null);
    setSavingFields(true);
    try {
      const updated = await api.updateTask(task.id, {
        priority,
        status: 'Review',
        reviewerId,
        startAt: stagedStartIso,
        dueAt: stagedDueIso,
      });
      applyTask(updated);
      syncStaged(updated);
      flashSaved();
    } catch (err) {
      setFieldsError(err instanceof ApiError ? err.message : 'Could not send to Review');
    } finally {
      setSavingFields(false);
    }
  }

  async function exitReview(kind: 'reviewed' | 'recall') {
    setError(null);
    setReviewBusy(true);
    try {
      const updated =
        kind === 'reviewed' ? await api.reviewed(task.id) : await api.recallReview(task.id);
      applyTask(updated);
      syncStaged(updated);
      flashSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update review');
    } finally {
      setReviewBusy(false);
    }
  }

  /** Is `actorId` a supervisor of `subId` at any level up the chain? (uses the users list) */
  function isSupervisorAbove(actorId: string, subId: string | null): boolean {
    const byId = new Map(users.map((u) => [u.id, u]));
    const seen = new Set<string>();
    let cur = subId;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const sup = byId.get(cur)?.supervisorId ?? null;
      if (!sup) break;
      if (sup === actorId) return true;
      cur = sup;
    }
    return false;
  }

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
    if (kind === 'parent') {
      await runRel(() => api.setParent(task.id, picked.id));
    } else if (kind === 'child') {
      // Re-parent the chosen existing task under this one, then refresh to show it.
      setError(null);
      try {
        await api.setParent(picked.id, task.id);
        applyTask(await api.getTask(task.id));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not add the sub-task');
      }
    } else if (kind) {
      await runRel(() => api.addDependency(task.id, kind, picked.id));
    }
  }

  // --- Name / description ---------------------------------------------------
  async function saveName() {
    const name = nameDraft.trim();
    if (name.length < TASK_NAME_MIN_LENGTH) return;
    setSavingName(true);
    try {
      applyTask(await api.updateTask(task.id, { name }));
      setEditingName(false);
      flashSaved();
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
      flashSaved();
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

  async function doDuplicate(includeDescendants: boolean) {
    setDupOpen(false);
    setDuplicating(true);
    setError(null);
    try {
      const dup = await api.duplicateTask(task.id, includeDescendants);
      navigate(`/tasks/${dup.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not duplicate the task');
      setDuplicating(false);
    }
  }
  function onDuplicateClick() {
    // With sub-tasks, ask whether to clone the whole tree; otherwise duplicate directly.
    if (task.children.length > 0) setDupOpen(true);
    else void doDuplicate(false);
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

  // Phase 13: toggle the task's Private flag (Admin / supervisor-chain only).
  const [privacyBusy, setPrivacyBusy] = useState(false);
  async function togglePrivate() {
    if (privacyBusy) return;
    setPrivacyBusy(true);
    setError(null);
    try {
      applyTask(await api.setTaskPrivate(task.id, !task.isPrivate));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change privacy');
    } finally {
      setPrivacyBusy(false);
    }
  }

  const nameUnsaved = editingName && nameDraft.trim() !== task.name;
  const descUnsaved = editingDesc && descDraft !== (task.description ?? '');
  useUnsavedChangesWarning(fieldsDirty || nameUnsaved || descUnsaved || commentsDirty);

  const availableTags = allTags.filter((t) => !task.tags.includes(t));
  const doneChildren = task.children.filter((c) => c.status === 'Completed').length;
  // Review workflow: while in Review, Status + Assignee are locked; the two exits
  // (Reviewed / Recall) carry their own permissions.
  const isInReview = task.status === 'Review';
  const canReview =
    currentUser.role === 'Admin' ||
    currentUser.id === task.assigneeId ||
    isSupervisorAbove(currentUser.id, task.assigneeId);
  const canRecall =
    currentUser.id === task.reviewInitiatorId || currentUser.id === task.priorAssigneeId;

  // Phase 13 access control: full access means editable; comment-only (mention)
  // access is read-only for every task field — commenting still works.
  const canEdit = task.access === 'full';

  // Staged assignee resolved to a user object for the chip display.
  const assigneeUser =
    assigneeId === ''
      ? null
      : assigneeId === (task.assigneeId ?? '')
        ? task.assignee
        : users.find((u) => u.id === assigneeId) ?? null;

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
        <button type="button" className="secondary btn-sm" disabled={duplicating} onClick={onDuplicateClick}>
          {duplicating ? 'Duplicating…' : 'Duplicate'}
        </button>
        {task.canTogglePrivate && (
          <button
            type="button"
            className={`secondary btn-sm${task.isPrivate ? ' is-private-on' : ''}`}
            disabled={privacyBusy}
            title={
              task.isPrivate
                ? 'Private — visible only to the assignee and their supervisor chain. Click to make it visible again.'
                : 'Make this task private (suspends mention-only access)'
            }
            onClick={() => void togglePrivate()}
          >
            {task.isPrivate ? '🔒 Private' : 'Make private'}
          </button>
        )}
        {currentUser.role === 'Admin' && (
          <button type="button" className="secondary btn-sm" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
        {!canEdit ? null : isInReview ? (
          <>
            {canRecall && (
              <button type="button" className="secondary btn-sm" disabled={reviewBusy} onClick={() => void exitReview('recall')}>
                Recall from Review
              </button>
            )}
            <button
              type="button"
              className="btn-sm"
              disabled={reviewBusy || !canReview}
              title={canReview ? undefined : 'Only an admin, the assignee, or a supervisor above them can finish this review'}
              onClick={() => void exitReview('reviewed')}
            >
              {reviewBusy ? 'Saving…' : 'Reviewed'}
            </button>
          </>
        ) : null}
      </div>

      {notice && <div className="alert success">{notice}</div>}
      {error && <div className="alert error">{error}</div>}
      {!canEdit && (
        <div className="alert info read-only-banner" role="status">
          {task.access === 'tree' ? (
            <>🌳 You can see this task because it sits in the parent/child tree of a task you have access to. It’s read-only — you can view it, but not change its fields.</>
          ) : (
            <>👁 You can see this task because you’re mentioned in it. It’s read-only — you can add comments, but not change its fields.</>
          )}
        </div>
      )}

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
            {task.isPrivate && (
              <span className="badge private-badge" title="Private task">
                🔒 Private
              </span>
            )}
            {canEdit && (
              <button type="button" className="edit-chip" onClick={() => { setNameDraft(task.name); setEditingName(true); }}>
                Edit
              </button>
            )}
          </div>
        )}

        {/* Property chip row — staged; committed together via "Save changes" */}
        <div className="detail-props">
          <span className={`prop-chip is-status${status !== task.status ? ' is-dirty' : ''}${isInReview ? ' is-locked' : ''}`}>
            <StatusPill status={status} caret={!isInReview && canEdit} />
            {!isInReview && canEdit && (
              <select className="prop-overlay-select" value={status} aria-label="Status" onChange={(e) => setStatus(e.target.value as TaskStatus)}>
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TASK_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            )}
          </span>

          <span className={`prop-chip${priority !== task.priority ? ' is-dirty' : ''}`}>
            <PriorityRamp priority={priority} label />
            {canEdit && (
              <>
                <span className="prop-caret" aria-hidden="true">▾</span>
                <select className="prop-overlay-select" value={priority} aria-label="Priority" onChange={(e) => setPriority(e.target.value as TaskPriority)}>
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </>
            )}
          </span>

          <span className={`prop-chip${assigneeId !== (task.assigneeId ?? '') ? ' is-dirty' : ''}${isInReview ? ' is-locked' : ''}`}>
            {assigneeUser ? (
              <UserChip
                user={assigneeUser}
                label={isInReview ? `${userLabel(assigneeUser)} · reviewing` : undefined}
              />
            ) : (
              <span className="user-chip muted">
                <UnassignedAvatar px={20} />
                <span className="user-name">Unassigned</span>
              </span>
            )}
            {!isInReview && canEdit && (
              <>
                <span className="prop-caret" aria-hidden="true">▾</span>
                <select className="prop-overlay-select" value={assigneeId} aria-label="Assignee" onChange={(e) => setAssigneeId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {userLabel(u)}
                    </option>
                  ))}
                </select>
              </>
            )}
          </span>

          <span className={`prop-chip due-chip${stagedDueIso ? '' : ' is-empty'}${stagedDueIso !== (task.dueAt ?? null) ? ' is-dirty' : ''}`}>
            <span className="due-chip-label">Due</span>
            {stagedDueIso ? <DueDate iso={stagedDueIso} status={task.status} completedAt={task.statusChangedAt} isDue inline /> : <span className="muted">—</span>}
          </span>

          {task.tags.map((t) => (
            <span key={t} className="badge tag">
              {t}
              {canEdit && (
                <button type="button" className="tag-x" onClick={() => removeTag(t)} disabled={tagBusy} aria-label={`Remove tag ${t}`}>
                  ×
                </button>
              )}
            </span>
          ))}
          {canEdit && (
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
          )}
        </div>

        {isInReview && (
          <div className="review-card" role="status">
            <div className="review-card-row">
              <span>Review initiated by</span>
              <strong>{task.reviewInitiator ? userLabel(task.reviewInitiator) : '—'}</strong>
            </div>
            <div className="review-card-row">
              <span>Will restore assignee</span>
              <strong>{task.priorAssignee ? userLabel(task.priorAssignee) : 'Unassigned'}</strong>
            </div>
            <div className="review-card-row">
              <span>Will restore status to</span>
              <strong>{task.priorStatus ? TASK_STATUS_LABELS[task.priorStatus] : '—'}</strong>
            </div>
          </div>
        )}

        {/* Save bar for the staged Status / Priority / Assignee / Due chips */}
        {canEdit && (
        <div className={`detail-savebar${fieldsDirty ? ' is-dirty' : ''}`} role="status">
          {fieldsDirty ? (
            <span className="savebar-flag unsaved">
              <span className="savebar-dot" aria-hidden="true" />
              Unsaved changes
            </span>
          ) : savedState !== 'hidden' ? (
            <span className={`savebar-flag saved${savedState === 'fading' ? ' is-fading' : ''}`}>
              All changes saved
            </span>
          ) : null}
          {fieldsError && <span className="savebar-error">{fieldsError}</span>}
          <div className="spacer" />
          {fieldsDirty && (
            <button type="button" className="secondary btn-sm" disabled={savingFields} onClick={discardFields}>
              Discard
            </button>
          )}
          <button type="button" className="btn-sm" disabled={savingFields || !fieldsDirty} onClick={() => void saveFields()}>
            {savingFields ? 'Saving…' : 'Save changes'}
          </button>
        </div>
        )}
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
                  {!editingDesc && canEdit && (
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
                  <div className="spacer" />
                  {canEdit && (
                    <button type="button" className="tertiary btn-sm" onClick={() => setPicker('child')}>
                      + Link
                    </button>
                  )}
                </div>
                {task.children.length > 0 && (
                  <div className="subtask-progress" aria-hidden="true">
                    <span style={{ width: `${(doneChildren / task.children.length) * 100}%` }} />
                  </div>
                )}
                {task.children.length === 0 ? (
                  <p className="muted rel-empty">
                    No sub-tasks. Use “+ Link” to add an existing task to this one.
                  </p>
                ) : (
                  <ul className="subtask-list">
                    {task.children.map((c) => {
                      const done = c.status === 'Completed';
                      return (
                        <li key={c.id} className={`subtask-row${done ? ' is-done' : ''}`}>
                          {c.accessible ? (
                            <>
                              <span className="mono subtask-id">#{c.id}</span>
                              <Link to={`/tasks/${c.id}`} className="subtask-name">
                                {c.name}
                              </Link>
                            </>
                          ) : (
                            <span className="subtask-name task-ref-locked" title="You do not have access to this task">
                              #{c.id} <span className="task-ref-lock" aria-label="No access">🔒</span>
                            </span>
                          )}
                          <StatusPill status={c.status} />
                        </li>
                      );
                    })}
                  </ul>
                )}
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
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => handleStartDate(e.target.value)}
                  aria-label="Start date"
                  disabled={!canEdit}
                />
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  aria-label="Start time"
                  disabled={!startDate || !canEdit}
                />
                {startTime && (
                  <button
                    type="button"
                    className="rail-clear-time"
                    onClick={() => setStartTime('')}
                    aria-label="Clear start time"
                  >
                    Clear
                  </button>
                )}
              </span>
            </div>
            <div className="rail-row">
              <span className="rail-label">Due</span>
              <span className="rail-dates">
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => handleDueDate(e.target.value)}
                  aria-label="Due date"
                  disabled={!canEdit}
                />
                <input
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                  aria-label="Due time"
                  disabled={!dueDate || !canEdit}
                />
                {dueTime && (
                  <button
                    type="button"
                    className="rail-clear-time"
                    onClick={() => setDueTime('')}
                    aria-label="Clear due time"
                  >
                    Clear
                  </button>
                )}
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
                {!task.parent && canEdit && (
                  <button type="button" className="tertiary btn-sm rel-add" onClick={() => setPicker('parent')}>
                    + Link
                  </button>
                )}
              </div>
              {task.parent ? (
                <div className="rel-row">
                  <TaskRefLink task={task.parent} />
                  {canEdit && (
                    <button type="button" className="rel-x" aria-label="Remove parent" onClick={() => runRel(() => api.clearParent(task.id))}>
                      ×
                    </button>
                  )}
                </div>
              ) : (
                <p className="muted rel-empty">None</p>
              )}
            </div>

            <div className="rel-section">
              <div className="rel-heading">
                <span>Blocked by</span>
                {canEdit && (
                  <button type="button" className="tertiary btn-sm rel-add" onClick={() => setPicker('blockedBy')}>
                    + Link
                  </button>
                )}
              </div>
              {task.isBlockedBy.length === 0 ? (
                <p className="muted rel-empty">Nothing</p>
              ) : (
                task.isBlockedBy.map((t) => (
                  <div key={t.id} className="rel-row rel-blocked">
                    <TaskRefLink task={t} />
                    {canEdit && (
                      <button type="button" className="rel-x" aria-label={`Remove is-blocked-by #${t.id}`} onClick={() => runRel(() => api.removeDependency(task.id, 'blockedBy', t.id))}>
                        ×
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="rel-section">
              <div className="rel-heading">
                <span>Blocks</span>
                {canEdit && (
                  <button type="button" className="tertiary btn-sm rel-add" onClick={() => setPicker('blocks')}>
                    + Link
                  </button>
                )}
              </div>
              {task.blocks.length === 0 ? (
                <p className="muted rel-empty">Nothing</p>
              ) : (
                task.blocks.map((t) => (
                  <div key={t.id} className="rel-row">
                    <TaskRefLink task={t} />
                    {canEdit && (
                      <button type="button" className="rel-x" aria-label={`Remove blocks #${t.id}`} onClick={() => runRel(() => api.removeDependency(task.id, 'blocks', t.id))}>
                        ×
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <TaskRecurrencePanel task={task} onChanged={applyTask} />

          <div className="rail-section">
            <div className="rail-section-title">Reminders</div>
            <TaskReminders taskId={task.id} />
          </div>
        </aside>
      </div>

      {picker && (
        <TaskPickerModal title={PICKER_TITLES[picker]} excludeId={task.id} onPick={handlePick} onClose={() => setPicker(null)} />
      )}

      {pendingReview && (
        <ReviewerPickerModal
          taskId={task.id}
          taskRef={`#${task.id}`}
          taskName={task.name}
          currentAssignee={task.assignee ? userLabel(task.assignee) : null}
          returnStatus={TASK_STATUS_LABELS[task.status]}
          onClose={() => setPendingReview(false)}
          onPick={(reviewerId) => saveReview(reviewerId)}
        />
      )}

      {dupOpen && (
        <div className="modal-backdrop" onClick={() => setDupOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Duplicate task</h3>
            <p>
              “{task.name}” has {task.children.length} sub-task
              {task.children.length === 1 ? '' : 's'}. Duplicate just this task, or the whole tree
              beneath it?
            </p>
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="secondary" disabled={duplicating} onClick={() => void doDuplicate(false)}>
                This task only
              </button>
              <button type="button" disabled={duplicating} onClick={() => void doDuplicate(true)}>
                Task &amp; all sub-tasks
              </button>
            </div>
          </div>
        </div>
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
