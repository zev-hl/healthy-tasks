import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  REMINDER_BLOCK_LABELS,
  reminderAddBlock,
  TASK_NAME_MIN_LENGTH,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type ActiveUserDto,
  type DependencyType,
  type TaskDetailDto,
  type TaskPriority,
  type TaskRef,
  type ExclusivesAlertType,
  type ExclusivesGroupOptionDto,
  type TaskStatus,
  type UserDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useStaleWriteGuard } from '../lib/useStaleWriteGuard';
import { ConflictBanner } from './ConflictBanner';
import { RichText } from './RichText';
import { RichTextEditor } from './RichTextEditor';
import { AttachmentSection } from './AttachmentSection';
import { Comments } from './Comments';
import { TaskRefLink } from './TaskRefLink';
import { TaskLinkPicker } from './TaskLinkPicker';
import { ReviewerPicker } from './ReviewerPicker';
import { TaskHistory } from './TaskHistory';
import { TaskReminders } from './TaskReminders';
import { TaskRecurrencePanel } from './TaskRecurrencePanel';
import { Avatar, userLabel } from './ui/Avatar';
import {
  AlarmClock,
  Repeat,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  FileStack,
  Link as LinkIcon,
  Link2,
  ListChecks,
  ListTree,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  Unlock,
  X,
  ChevronDown,
  Search,
} from 'lucide-react';
import {
  Bar,
  Btn,
  Empty,
  Pill,
  PriorityMark,
  PRIORITY_DOT,
  Segmented,
  StatusPill,
  STATUS_DOT,
  STATUS_TONE,
} from './harbor/ui';
import { Select, type SelectOption } from './harbor/Select';
import { DatePicker, formatShortDay } from './harbor/DatePicker';
import { Popover } from './harbor/Popover';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { TimeBlock } from './harbor/TimeBlock';
import { useToast } from './harbor/Toast';
import { PRIORITY_OPTIONS, dueInfo } from './harbor/taskHelpers';
import { formatClock, useTimer } from '../lib/timer';
import { isoToParts, partsToIso, DEFAULT_START_HOUR, DEFAULT_DUE_HOUR } from '../lib/datetime';
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning';
import { isMismatch, useDutyCatalog } from '../lib/duties';
import { DutyCrossCheck } from './duties/DutyCrossCheck';
import { TaskAttributesBar } from './TaskAttributesBar';
import { TaskAttributeChips } from './TaskAttributeChips';
import { ExpandIcon } from './ui/ExpandIcon';

type PickerKind = 'parent' | 'child' | DependencyType;

const PICKER_TEXT: Record<PickerKind, { title: string; hint: string }> = {
  parent: {
    title: 'Set the parent task',
    hint: 'This task becomes a sub-task of the one you pick.',
  },
  child: { title: 'Link an existing sub-task', hint: 'The task you pick moves under this one.' },
  blockedBy: {
    title: 'Blocked by',
    hint: 'This task waits until the one you pick is done.',
  },
  blocks: { title: 'Blocks', hint: 'The task you pick waits until this one is done.' },
};

/** The type column of the Linked tasks list. */
const LINK_LABEL: Record<Exclude<PickerKind, 'child'>, string> = {
  parent: 'Parent',
  blockedBy: 'Blocked by',
  blocks: 'Blocks',
};

interface Props {
  initialTask: TaskDetailDto;
  currentUser: UserDto;
}

export function TaskDetailView({ initialTask, currentUser }: Props) {
  const navigate = useNavigate();
  const toast = useToast();
  const [task, setTask] = useState<TaskDetailDto>(initialTask);
  const { timer: runningTimer, elapsed: timerElapsed } = useTimer();
  const timerHere = runningTimer?.taskId === initialTask.id;

  const [historyVersion, setHistoryVersion] = useState(0);
  const applyTask = useCallback((t: TaskDetailDto) => {
    setTask(t);
    setHistoryVersion((v) => v + 1);
  }, []);

  // Optimistic concurrency for the task's own saves (fields / name / description).
  const { conflict, bannerShown, guard, review, reset: resetConflict } = useStaleWriteGuard();

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [linkType, setLinkType] = useState<Exclude<PickerKind, 'child'>>('blockedBy');
  // The button the link picker opened from: the popover sits under it.
  const pickerAnchor = useRef<HTMLElement | null>(null);
  function openPicker(kind: PickerKind, el: HTMLElement) {
    pickerAnchor.current = el;
    // Room below for the results: bring a button near the bottom up to the middle.
    if (el.getBoundingClientRect().bottom > window.innerHeight * 0.55) {
      el.scrollIntoView({ block: 'center' });
    }
    setPicker(kind);
  }
  const [confirmDelete, setConfirmDelete] = useState(false);
  // HLAI-118: the attributes pop-up behind the pencil.
  // HLAI-118 attributes, staged like the other chips (saved with the Save bar).
  const [attrGroupId, setAttrGroupId] = useState(
    initialTask.alertGroup ? String(initialTask.alertGroup.id) : '',
  );
  const [attrType, setAttrType] = useState<string>(initialTask.alertType ?? '');
  const [alertGroups, setAlertGroups] = useState<ExclusivesGroupOptionDto[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [copyAttachments, setCopyAttachments] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  // Save-as-Template (task -> template conversion) modal state.
  // "New" sub-task prompt: just a name; the server creates it under this task.
  const [newSubOpen, setNewSubOpen] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [newSubError, setNewSubError] = useState<string | null>(null);
  const [creatingSub, setCreatingSub] = useState(false);
  const newSubDirty = newSubOpen && newSubName.trim() !== '';
  const closeNewSub = () => {
    setNewSubOpen(false);
    setNewSubName('');
    setNewSubError(null);
  };
  const [tplOpen, setTplOpen] = useState(false);
  const [tplName, setTplName] = useState('');
  const [tplScope, setTplScope] = useState<'single' | 'tree'>('single');
  const [tplRole, setTplRole] = useState('');
  const [tplAttachments, setTplAttachments] = useState(false);
  const [savingTpl, setSavingTpl] = useState(false);
  const [savedTplId, setSavedTplId] = useState<number | null>(null);
  const [commentsDirty, setCommentsDirty] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const [copied, setCopied] = useState(false);
  // Review workflow (Phase 10): reviewer-picker visibility + a busy flag for the
  // Reviewed / Recall actions.
  const [pendingReview, setPendingReview] = useState(false);
  // The reviewer menu opens under the Status chip.
  const statusChipRef = useRef<HTMLSpanElement>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  // Reminders overhaul: when a Save would clear the Start Date or Cancel a task
  // that HAS reminders, confirm first (the reason drives the dialog copy).
  const [pendingReminderRemoval, setPendingReminderRemoval] = useState<
    'start-date-removed' | 'task-canceled' | null
  >(null);

  // Saving confirms with a toast; the Save bar goes away once nothing is unsaved.
  const flashSaved = useCallback(() => {
    toast({ message: 'Saved. Everyone who can see this task sees the update.', tone: 'success' });
  }, [toast]);

  // The title is a field like the others: staged, and saved with Save changes.
  const [nameDraft, setNameDraft] = useState(initialTask.name);

  // Inline description edit.
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(initialTask.description ?? '');
  // The description in a pop-up filling the window (the expand button), for reading
  // and editing alike. The shrink button closes it.
  const [descExpanded, setDescExpanded] = useState(false);
  const descModalRef = useRef<HTMLDivElement>(null);
  // Escape closes it too, unless one of the editor's menus is open (Escape closes that first).
  // Listened to before the menu's own listener, which would already have closed it.
  useEffect(() => {
    if (!descExpanded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !descModalRef.current?.querySelector('.rte-listpop'))
        setDescExpanded(false);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [descExpanded]);
  const [savingDesc, setSavingDesc] = useState(false);

  // Tags quick-add.
  const [tagDraft, setTagDraft] = useState('');
  const [tagBusy, setTagBusy] = useState(false);

  const [users, setUsers] = useState<ActiveUserDto[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  useEffect(() => {
    api
      .listActiveUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
    api
      .listTaskTags()
      .then(setAllTags)
      .catch(() => setAllTags([]));
    api
      .listExclusivesGroupOptions()
      .then(setAlertGroups)
      .catch(() => setAlertGroups([]));
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
  // Department Duties: the staged duty, checked live against the assignee.
  const [dutyId, setDutyId] = useState(initialTask.dutyId ?? '');
  const catalog = useDutyCatalog();
  const [granting, setGranting] = useState(false);
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

  // Whether (and why) adding a reminder is blocked for the task's CURRENT saved
  // state — shown as a note on the Reminders section title (see TaskReminders,
  // which disables Add for the same reason, and the server, which also 400s).
  const reminderBlock = reminderAddBlock(task.startAt, task.status, new Date());
  const savedAttrGroupId = task.alertGroup ? String(task.alertGroup.id) : '';
  // Only a changed attribute is sent.
  const attrChanges = {
    ...(attrGroupId !== savedAttrGroupId && {
      alertGroupId: attrGroupId === '' ? null : Number(attrGroupId),
    }),
    ...(attrType !== (task.alertType ?? '') && {
      alertType: (attrType || null) as ExclusivesAlertType | null,
    }),
  };
  const fieldsDirty =
    assigneeId !== (task.assigneeId ?? '') ||
    priority !== task.priority ||
    status !== task.status ||
    startDate !== persistedStart.date ||
    startTime !== persistedStart.time ||
    dueDate !== persistedDue.date ||
    dueTime !== persistedDue.time ||
    dutyId !== (task.dutyId ?? '') ||
    attrGroupId !== savedAttrGroupId ||
    attrType !== (task.alertType ?? '') ||
    nameDraft.trim() !== task.name;

  // Commit all staged fields at once (status, priority, assignee, and dates),
  // always via the explicit "Save changes" button.
  async function saveFields(skipReminderConfirm = false) {
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
    const nameChanged = nameDraft.trim() !== task.name;
    if (nameChanged && nameDraft.trim().length < TASK_NAME_MIN_LENGTH) {
      setFieldsError('Give the task a title first.');
      return;
    }
    if (stagedStartIso && stagedDueIso && new Date(stagedStartIso) >= new Date(stagedDueIso)) {
      setFieldsError('Start must be earlier than Due');
      return;
    }
    // Reminders overhaul: clearing the Start Date or moving into Canceled removes
    // the task's reminders (the actor's own are hard-deleted). Confirm first when
    // the task actually has reminders.
    const startCleared = !stagedStartIso && task.startAt !== null;
    const becameCanceled = nextStatus === 'Canceled' && task.status !== 'Canceled';
    if (!skipReminderConfirm && (startCleared || becameCanceled) && task.reminderCount > 0) {
      setPendingReminderRemoval(becameCanceled ? 'task-canceled' : 'start-date-removed');
      return;
    }
    // Transitioning INTO Review requires choosing a reviewer first — the actual
    // save happens in saveReview() once the reviewer-picker is confirmed.
    if (nextStatus === 'Review' && task.status !== 'Review') {
      // The menu opens under the Status chip: bring it into view first.
      statusChipRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
      setPendingReview(true);
      return;
    }
    const becameCompleted = nextStatus === 'Completed' && task.status !== 'Completed';
    setSavingFields(true);
    try {
      await guard(async () => {
        const updated = await api.updateTask(
          task.id,
          {
            assigneeId: assigneeId === '' ? null : assigneeId,
            priority,
            status: nextStatus,
            startAt: stagedStartIso,
            dueAt: stagedDueIso,
            dutyId: dutyId === '' ? null : dutyId,
            ...attrChanges,
            ...(nameChanged ? { name: nameDraft.trim() } : {}),
          },
          task.updatedAt,
        );
        applyTask(updated);
        syncStaged(updated);
        flashSaved();
        if (becameCompleted) {
          setJustCompleted(true);
          window.setTimeout(() => setJustCompleted(false), 1300);
        }
      });
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
    setNameDraft(t.name);
    setAssigneeId(t.assigneeId ?? '');
    setDutyId(t.dutyId ?? '');
    setPriority(t.priority);
    setStatus(t.status);
    const s = isoToParts(t.startAt);
    const d = isoToParts(t.dueAt);
    setStartDate(s.date);
    setStartTime(s.time);
    setDueDate(d.date);
    setDueTime(d.time);
    setAttrGroupId(t.alertGroup ? String(t.alertGroup.id) : '');
    setAttrType(t.alertType ?? '');
  }

  // Revert staged fields to the persisted task.
  function discardFields() {
    setFieldsError(null);
    syncStaged(task);
  }

  // Reload the task from the server after a stale-write conflict (Refresh) —
  // discards the on-screen edits and shows the current data.
  async function handleConflictRefresh() {
    try {
      const fresh = await api.getTask(task.id);
      applyTask(fresh);
      syncStaged(fresh);
      setEditingDesc(false);
      setFieldsError(null);
      resetConflict();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not refresh the task');
    }
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
      await guard(async () => {
        const updated = await api.updateTask(
          task.id,
          {
            priority,
            status: 'Review',
            reviewerId,
            startAt: stagedStartIso,
            dueAt: stagedDueIso,
            dutyId: dutyId === '' ? null : dutyId,
            ...attrChanges,
            ...(nameDraft.trim() !== task.name && nameDraft.trim().length >= TASK_NAME_MIN_LENGTH
              ? { name: nameDraft.trim() }
              : {}),
          },
          task.updatedAt,
        );
        applyTask(updated);
        syncStaged(updated);
        flashSaved();
      });
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

  async function createSubtask() {
    const name = newSubName.trim();
    if (name.length < TASK_NAME_MIN_LENGTH) return;
    setCreatingSub(true);
    setNewSubError(null);
    try {
      applyTask(await api.createSubtask(task.id, name));
      closeNewSub();
    } catch (err) {
      setNewSubError(err instanceof ApiError ? err.message : 'Could not create the sub-task');
    } finally {
      setCreatingSub(false);
    }
  }

  // --- Name / description ---------------------------------------------------
  async function saveDesc() {
    setSavingDesc(true);
    try {
      await guard(async () => {
        applyTask(
          await api.updateTask(
            task.id,
            { description: descDraft === '' ? null : descDraft },
            task.updatedAt,
          ),
        );
        setEditingDesc(false);
        flashSaved();
      });
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
      const dup = await api.duplicateTask(task.id, includeDescendants, copyAttachments);
      navigate(`/tasks/${dup.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not duplicate the task');
      setDuplicating(false);
    }
  }
  function onDuplicateClick() {
    // Always open the dialog so the copy options (whole tree, attachments) can be
    // chosen — attachments default to OFF each time.
    setCopyAttachments(false);
    setDupOpen(true);
  }

  // Only Admin/Manager with full edit access to this task may convert it into a
  // template (mirrors the server-side permission check).
  const canSaveAsTemplate =
    (currentUser.role === 'Admin' || currentUser.role === 'Manager') && task.access === 'full';

  function onSaveAsTemplateClick() {
    setTplName('');
    setTplScope('single');
    setTplRole(task.assignee ? userLabel(task.assignee) : '');
    setTplAttachments(false);
    setSavedTplId(null);
    setError(null);
    setTplOpen(true);
  }

  async function doSaveAsTemplate() {
    const name = tplName.trim();
    if (!name) {
      setError('A template name is required');
      return;
    }
    setSavingTpl(true);
    setError(null);
    try {
      const tpl = await api.saveTaskAsTemplate(task.id, {
        name,
        includeDescendants: tplScope === 'tree',
        includeAttachments: tplAttachments,
        rootRoleLabel: tplRole.trim() || null,
      });
      setSavedTplId(tpl.id);
      setNotice(`Saved as template “${tpl.name}”.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save as template');
    } finally {
      setSavingTpl(false);
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

  const descUnsaved = editingDesc && descDraft !== (task.description ?? '');
  useUnsavedChangesWarning(fieldsDirty || descUnsaved || commentsDirty || newSubDirty);

  const availableTags = allTags.filter((t) => !task.tags.includes(t));
  // Tasks already linked each way: the link picker shows them as taken.
  const linkedIds = useMemo<Record<PickerKind, ReadonlySet<number>>>(
    () => ({
      parent: new Set(task.parent ? [task.parent.id] : []),
      child: new Set(task.children.map((c) => c.id)),
      blockedBy: new Set(task.isBlockedBy.map((t) => t.id)),
      blocks: new Set(task.blocks.map((t) => t.id)),
    }),
    [task.parent, task.children, task.isBlockedBy, task.blocks],
  );
  // One list of links, parent first (the brief's Linked tasks card).
  const links: { kind: Exclude<PickerKind, 'child'>; task: TaskRef }[] = [
    ...(task.parent ? [{ kind: 'parent' as const, task: task.parent }] : []),
    ...task.isBlockedBy.map((t) => ({ kind: 'blockedBy' as const, task: t })),
    ...task.blocks.map((t) => ({ kind: 'blocks' as const, task: t })),
  ];
  const linkTypeChoices: SelectOption<Exclude<PickerKind, 'child'>>[] = [
    { value: 'blockedBy', label: 'Blocked by', hint: 'waits for it' },
    { value: 'blocks', label: 'Blocks', hint: 'it waits for this' },
    ...(task.parent
      ? []
      : [{ value: 'parent' as const, label: 'Parent', hint: 'this goes under it' }]),
  ];
  // Once a parent is set, "Parent" leaves the type list: fall back to Blocked by.
  const addType = linkType === 'parent' && task.parent ? 'blockedBy' : linkType;
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
        : (users.find((u) => u.id === assigneeId) ?? null);

  // --- Department Duties: the assignee ⇄ duty check -------------------------
  // The person doing the work is the assignee — except in Review, where the
  // assignee is the reviewer (exempt) and the rule is judged against the prior
  // assignee. The check runs whichever field was changed first; while it fails
  // because one of them is being changed, Save is blocked. A mismatch that
  // already existed (a duty taken away later) only warns.
  const stagedDuty = dutyId
    ? (catalog.duties.get(dutyId) ?? (task.duty?.id === dutyId ? task.duty : null))
    : null;
  const doerId = isInReview ? (task.priorAssigneeId ?? null) : assigneeId || null;
  const doer = doerId
    ? (users.find((u) => u.id === doerId) ?? (isInReview ? task.priorAssignee : assigneeUser))
    : null;
  const pairChanged = assigneeId !== (task.assigneeId ?? '') || dutyId !== (task.dutyId ?? '');
  const dutyMismatch = catalog.loading
    ? task.dutyMismatch && !pairChanged
    : isMismatch(catalog.holdings, doerId, dutyId || null);
  const dutyBlocking = dutyMismatch && pairChanged;
  const canGrantDuty =
    !!doerId && (currentUser.role === 'Admin' || isSupervisorAbove(currentUser.id, doerId));
  const doerSupervisor = (() => {
    const supId = users.find((u) => u.id === doerId)?.supervisorId;
    const sup = supId ? users.find((u) => u.id === supId) : null;
    return sup ? userLabel(sup) : null;
  })();

  async function grantDutyToDoer() {
    if (!doerId || !dutyId) return;
    setGranting(true);
    setFieldsError(null);
    try {
      await api.grantDuty(doerId, dutyId);
      catalog.grantLocally(doerId, dutyId);
    } catch (err) {
      setFieldsError(err instanceof ApiError ? err.message : 'Could not give the duty');
    } finally {
      setGranting(false);
    }
  }

  // The Description head and body, shown in the card or, expanded, in the pop-up.
  // The editor is in one place only: the pop-up while expanded, the card otherwise.
  const descHead = (expanded: boolean) => (
    <div className="section-head">
      <h3 id={expanded ? 'desc-modal-title' : undefined}>Description</h3>
      {!editingDesc && canEdit && (
        <button
          type="button"
          className="edit-chip"
          onClick={() => {
            setDescDraft(task.description ?? '');
            setEditingDesc(true);
          }}
        >
          Edit
        </button>
      )}
      {(expanded || editingDesc || task.description) && (
        <button
          type="button"
          className="icon-btn desc-expand"
          aria-label={expanded ? 'Shrink the description' : 'Expand the description'}
          title={expanded ? 'Shrink' : 'Expand'}
          onClick={() => setDescExpanded(!expanded)}
        >
          <ExpandIcon shrink={expanded} />
        </button>
      )}
    </div>
  );
  const descText = task.description ? (
    <RichText html={task.description} />
  ) : (
    <p className="muted" style={{ margin: 0 }}>
      No description yet.
    </p>
  );
  const descBody = editingDesc ? (
    <div className="desc-edit">
      <RichTextEditor
        value={descDraft}
        onChange={setDescDraft}
        ariaLabel="Task description"
        autoFocus
      />
      <div className="btn-row">
        {conflict ? (
          <button type="button" disabled={savingDesc} onClick={() => void handleConflictRefresh()}>
            {savingDesc ? 'Refreshing…' : 'Refresh'}
          </button>
        ) : (
          <button type="button" disabled={savingDesc} onClick={saveDesc}>
            {savingDesc ? 'Saving…' : 'Save'}
          </button>
        )}
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
    descText
  );

  // --- Harbor: the one Save bar's summary, Mark done, Ctrl+S, the stepper ----
  const changedFields = [
    nameDraft.trim() !== task.name && 'title',
    status !== task.status && 'status',
    assigneeId !== (task.assigneeId ?? '') && 'assignee',
    (dueDate !== persistedDue.date || dueTime !== persistedDue.time) && 'due date',
    (startDate !== persistedStart.date || startTime !== persistedStart.time) && 'start date',
    priority !== task.priority && 'priority',
    dutyId !== (task.dutyId ?? '') && 'duty',
    attrGroupId !== savedAttrGroupId && 'alert group',
    attrType !== (task.alertType ?? '') && 'alert type',
  ].filter(Boolean) as string[];

  const saveRef = useRef(saveFields);
  saveRef.current = saveFields;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (canEdit) void saveRef.current();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit]);

  async function markDone(next: TaskStatus) {
    if (fieldsDirty) {
      setStatus(next);
      return;
    }
    const before = task.status;
    try {
      const updated = await api.updateTask(task.id, { status: next }, task.updatedAt);
      applyTask(updated);
      syncStaged(updated);
      if (next === 'Completed') {
        setJustCompleted(true);
        window.setTimeout(() => setJustCompleted(false), 1300);
      }
      toast({
        message: next === 'Completed' ? `“${task.name}” marked done.` : `“${task.name}” reopened.`,
        tone: next === 'Completed' ? 'success' : 'dark',
        undo: async () => {
          try {
            const back = await api.updateTask(task.id, { status: before });
            applyTask(back);
            syncStaged(back);
          } catch (err) {
            toast({
              message: err instanceof ApiError ? err.message : 'Could not undo',
              tone: 'error',
            });
          }
        },
      });
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : 'Could not change the status',
        tone: 'error',
      });
    }
  }

  // ‹ 2 of 28 ›: through the tasks the Tasks list last showed.
  const order: number[] = (() => {
    try {
      return JSON.parse(sessionStorage.getItem('hb-task-order') ?? '[]') as number[];
    } catch {
      return [];
    }
  })();
  const pos = order.indexOf(task.id);

  const statusChoices: SelectOption<TaskStatus>[] = TASK_STATUSES.map((s) => ({
    value: s,
    label: TASK_STATUS_LABELS[s],
    dot: STATUS_DOT[s],
    hint: s === 'Review' && task.status !== 'Review' ? 'pick a reviewer on save' : undefined,
  }));
  const assigneeChoices: SelectOption<string>[] = [
    { value: '', label: 'Unassigned', lead: <span className="hb-unassigned">?</span> },
    ...[...users]
      .sort((a, b) => userLabel(a).localeCompare(userLabel(b)))
      .map((u) => ({
        value: u.id,
        label: userLabel(u),
        lead: <Avatar user={u} px={24} decorative />,
        hint:
          stagedDuty && !catalog.loading && isMismatch(catalog.holdings, u.id, stagedDuty.id)
            ? 'doesn’t hold the duty'
            : undefined,
      })),
  ];
  const dutyChoices: SelectOption<string>[] = [
    { value: '', label: 'No duty' },
    ...catalog.departments
      .filter((d) => !d.archived)
      .flatMap((d) =>
        d.duties
          .filter((x) => !x.archived || x.id === dutyId)
          .map((x) => ({
            value: x.id,
            label: `${d.name} › ${x.name}`,
            dot: d.color,
            hint:
              doerId && !catalog.loading && isMismatch(catalog.holdings, doerId, x.id)
                ? 'not held'
                : undefined,
          })),
      ),
  ];
  const stagedDue = dueInfo(stagedDueIso, task.status);
  const statusHint = isInReview
    ? 'Waiting on a review'
    : task.isBlockedBy.some((b) => b.status !== 'Completed' && b.status !== 'Canceled')
      ? 'Waiting on a linked task'
      : task.children.length > 0
        ? `${doneChildren} of ${task.children.length} sub-tasks done`
        : task.status === 'Open'
          ? 'Not started'
          : null;
  const [activity, setActivity] = useState<'comments' | 'history'>('comments');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const done = task.status === 'Completed';

  return (
    <div className="hb-task">
      {/* Sticky top bar */}
      <div className="hb-taskbar">
        <nav className="hb-crumbs" aria-label="Breadcrumb">
          <Link to="/tasks">
            <ChevronLeft size={16} aria-hidden="true" /> Tasks
          </Link>
          <span aria-hidden="true">/</span>
          <span>#{task.id}</span>
        </nav>
        {pos >= 0 && order.length > 1 && (
          <span className="hb-stepper">
            <button
              type="button"
              aria-label="Previous task"
              disabled={pos === 0}
              onClick={() => navigate(`/tasks/${order[pos - 1]}`)}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span>
              {pos + 1} of {order.length}
            </span>
            <button
              type="button"
              aria-label="Next task"
              disabled={pos === order.length - 1}
              onClick={() => navigate(`/tasks/${order[pos + 1]}`)}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </span>
        )}
        <span className="hb-grow" />
        {timerHere && (
          <span className="hb-mini-clock" title="The timer is running on this task">
            <span className="hb-live" aria-hidden="true" /> {formatClock(timerElapsed)}
          </span>
        )}
        {canEdit &&
          !isInReview &&
          (done ? (
            <Btn onClick={() => void markDone('Open')}>
              <RotateCcw size={15} aria-hidden="true" /> Reopen
            </Btn>
          ) : (
            <Btn kind="ok" onClick={() => void markDone('Completed')}>
              <CheckCircle2 size={16} aria-hidden="true" /> Mark done
            </Btn>
          ))}
        <button
          ref={menuRef}
          type="button"
          className="hb-icon-btn hb-icon-btn-sm"
          aria-label="More actions"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <MoreHorizontal size={18} aria-hidden="true" />
        </button>
        <Popover
          anchorRef={menuRef}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          minWidth={230}
          matchWidth={false}
          label="More actions"
        >
          <div className="hb-actions-menu">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                copyLink();
              }}
            >
              <LinkIcon size={16} aria-hidden="true" /> {copied ? 'Link copied' : 'Copy link'}
            </button>
            <button
              type="button"
              disabled={duplicating}
              onClick={() => {
                setMenuOpen(false);
                onDuplicateClick();
              }}
            >
              <Copy size={16} aria-hidden="true" /> Duplicate task
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                navigate('/tasks/new');
              }}
            >
              <Plus size={16} aria-hidden="true" /> New task
            </button>
            {canSaveAsTemplate && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onSaveAsTemplateClick();
                }}
              >
                <FileStack size={16} aria-hidden="true" /> Save as template
              </button>
            )}
            {task.canTogglePrivate && (
              <button
                type="button"
                disabled={privacyBusy}
                onClick={() => {
                  setMenuOpen(false);
                  void togglePrivate();
                }}
              >
                <Lock size={16} aria-hidden="true" />{' '}
                {task.isPrivate ? 'Make visible to the team' : 'Make private'}
              </button>
            )}
            {currentUser.role === 'Admin' && (
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDelete(true);
                }}
              >
                <Trash2 size={16} aria-hidden="true" /> Delete task
              </button>
            )}
          </div>
        </Popover>
      </div>

      {/* Header band */}
      <header className={`hb-taskhead${justCompleted ? ' just-completed' : ''}`}>
        <div className="hb-taskhead-main">
          {(done || task.isPrivate || !canEdit) && (
            <div className="hb-flags">
              {done && <Pill tone="green">Done</Pill>}
              {task.status === 'Canceled' && <Pill tone="grey">Canceled</Pill>}
              {task.isPrivate && (
                <Pill tone="blue">
                  <Lock size={12} aria-hidden="true" /> Private
                </Pill>
              )}
              {!canEdit && <Pill tone="grey">Read-only</Pill>}
            </div>
          )}
          {canEdit ? (
            <textarea
              className={`hb-title-input${nameDraft.trim() !== task.name ? ' is-dirty' : ''}`}
              value={nameDraft}
              rows={1}
              onChange={(e) => setNameDraft(e.target.value.replace(/\n/g, ' '))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.preventDefault();
              }}
              aria-label="Task title"
              maxLength={300}
            />
          ) : (
            <h1 className="hb-title-text">{task.name}</h1>
          )}
          <p className="hb-meta">
            #{task.id}
            {statusHint && <> · {statusHint}</>}
            {task.duty && (
              <>
                {' '}
                · Duty: {task.duty.departmentName} › {task.duty.name}
              </>
            )}
            {task.parent && (
              <>
                {' '}
                · Sub-task of <TaskRefLink task={task.parent} />
              </>
            )}{' '}
            · created by {userLabel(task.creator)} on{' '}
            {new Date(task.createdAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>

          <div className="hb-chips">
            {isInReview || !canEdit ? (
              <span className="hb-chip static">
                <StatusPill status={task.status} />
              </span>
            ) : (
              <span ref={statusChipRef} className="hb-prop-anchor">
                <Select
                  variant="chip"
                  hideLabel
                  className={`hb-prop tone-${STATUS_TONE[status]}${status !== task.status ? ' is-dirty' : ''}`}
                  label="Status"
                  value={status}
                  options={statusChoices}
                  renderValue={(o) => (
                    <>
                      <span
                        className="hb-dot"
                        style={{ background: STATUS_DOT[status] }}
                        aria-hidden="true"
                      />{' '}
                      {o?.label}
                    </>
                  )}
                  onChange={(v) => setStatus(v)}
                />
              </span>
            )}

            {isInReview || !canEdit ? (
              <span className="hb-chip static">
                {assigneeUser ? (
                  <Avatar user={assigneeUser} px={24} decorative />
                ) : (
                  <span className="hb-unassigned">?</span>
                )}
                {assigneeUser ? userLabel(assigneeUser) : 'Unassigned'}
                {isInReview && <span className="hb-small"> · reviewing</span>}
              </span>
            ) : (
              <Select
                variant="chip"
                hideLabel
                className={`hb-prop${assigneeId !== (task.assigneeId ?? '') ? ' is-dirty' : ''}${dutyBlocking ? ' is-bad' : ''}`}
                label="Assignee"
                value={assigneeId}
                options={assigneeChoices}
                searchPlaceholder="Search people…"
                renderValue={() => (
                  <>
                    {assigneeUser ? (
                      <Avatar user={assigneeUser} px={24} decorative />
                    ) : (
                      <span className="hb-unassigned">?</span>
                    )}
                    {assigneeUser ? userLabel(assigneeUser) : 'Unassigned'}
                  </>
                )}
                onChange={(v) => setAssigneeId(v)}
              />
            )}

            <DatePicker
              variant="chip"
              className={`hb-prop${stagedDue?.late ? ' is-late' : ''}${dueDate !== persistedDue.date || dueTime !== persistedDue.time ? ' is-dirty' : ''}`}
              label="Due date"
              value={dueDate || null}
              placeholder="Due date"
              disabled={!canEdit}
              time={dueTime}
              onTimeChange={setDueTime}
              overdueNote={stagedDue?.late ? `Currently ${stagedDue.text}` : undefined}
              renderValue={() =>
                stagedDue
                  ? `${stagedDue.late ? '' : 'Due '}${stagedDue.text}${dueTime ? ` · ${dueTime}` : ''}`
                  : 'No due date'
              }
              onChange={(v) => handleDueDate(v ?? '')}
            />

            <DatePicker
              variant="chip"
              className={`hb-prop${startDate !== persistedStart.date || startTime !== persistedStart.time ? ' is-dirty' : ''}`}
              label="Start date"
              value={startDate || null}
              placeholder="Start date"
              disabled={!canEdit}
              time={startTime}
              onTimeChange={setStartTime}
              renderValue={(v) =>
                v
                  ? `Starts ${formatShortDay(v)}${startTime ? ` · ${startTime}` : ''}`
                  : 'No start date'
              }
              onChange={(v) => handleStartDate(v ?? '')}
            />

            {canEdit ? (
              <Select
                variant="chip"
                hideLabel
                className={`hb-prop hb-prio prio-${priority.toLowerCase()}${priority !== task.priority ? ' is-dirty' : ''}`}
                label="Priority"
                value={priority}
                options={PRIORITY_OPTIONS}
                renderValue={() => (
                  <>
                    <span
                      className="hb-dot"
                      style={{ background: PRIORITY_DOT[priority] }}
                      aria-hidden="true"
                    />{' '}
                    {priority} priority
                  </>
                )}
                onChange={(v) => setPriority(v)}
              />
            ) : (
              <span className="hb-chip static">
                <PriorityMark priority={task.priority} />
              </span>
            )}

            {canEdit ? (
              <Select
                variant="chip"
                hideLabel
                className={`hb-prop${dutyId !== (task.dutyId ?? '') ? ' is-dirty' : ''}${dutyBlocking ? ' is-bad' : ''}`}
                label="Duty"
                value={dutyId}
                options={dutyChoices}
                searchPlaceholder="Search duties…"
                renderValue={() =>
                  stagedDuty ? `${stagedDuty.departmentName} › ${stagedDuty.name}` : '+ Duty'
                }
                onChange={(v) => setDutyId(v)}
              />
            ) : (
              task.duty && (
                <span className="hb-chip static">
                  {task.duty.departmentName} › {task.duty.name}
                </span>
              )
            )}

            {task.tags.map((t) => (
              <span key={t} className="hb-chip hb-tagchip">
                {t}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => removeTag(t)}
                    disabled={tagBusy}
                    aria-label={`Remove tag ${t}`}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                )}
              </span>
            ))}
            {canEdit && (
              <span className="hb-chip hb-addtag">
                <Tag size={13} aria-hidden="true" />
                <input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void addTagFromDraft();
                    }
                  }}
                  placeholder="Add tag"
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

            <span className="hb-chip-divider" aria-hidden="true" />
            <span
              className="hb-chip static soon"
              title="Watching tasks needs a backend change (coming later)"
            >
              <Eye size={14} aria-hidden="true" /> Watching · soon
            </span>
            {task.canTogglePrivate ? (
              <button
                type="button"
                className={`hb-chip hb-privacy${task.isPrivate ? ' on' : ''}`}
                disabled={privacyBusy}
                aria-pressed={task.isPrivate}
                title={
                  task.isPrivate
                    ? 'Visible only to the assignee and their supervisor chain'
                    : 'Everyone with access can see it'
                }
                onClick={() => void togglePrivate()}
              >
                {task.isPrivate ? (
                  <Lock size={14} aria-hidden="true" />
                ) : (
                  <Unlock size={14} aria-hidden="true" />
                )}
                {task.isPrivate ? 'Private' : 'Visible to team'}
              </button>
            ) : (
              task.isPrivate && (
                <span className="hb-chip static">
                  <Lock size={14} aria-hidden="true" /> Private
                </span>
              )
            )}
          </div>

          {/* HLAI-118: the special attributes, under the chips. */}
          {canEdit ? (
            <TaskAttributeChips
              savedGroup={task.alertGroup}
              groups={alertGroups}
              groupId={attrGroupId}
              onGroup={setAttrGroupId}
              alertType={attrType}
              onType={setAttrType}
              savedType={task.alertType ?? ''}
            />
          ) : (
            <TaskAttributesBar task={task} />
          )}

          {dutyMismatch && stagedDuty && doer && doerId && (
            <DutyCrossCheck
              personName={userLabel(doer)}
              personFirstName={doer.firstName || userLabel(doer)}
              duty={stagedDuty}
              blocking={dutyBlocking}
              canGrant={canGrantDuty && canEdit}
              supervisorName={doerSupervisor}
              granting={granting}
              onGrant={() => void grantDutyToDoer()}
              onPickAssignee={() => undefined}
              onClearDuty={() => setDutyId('')}
            />
          )}
        </div>
        <TimeBlock
          task={{
            id: task.id,
            name: task.name,
            dutyId: task.dutyId,
            dutyLabel: task.duty ? `${task.duty.departmentName} › ${task.duty.name}` : null,
          }}
        />
      </header>

      <div className="hb-task-body">
        {notice && <div className="hb-note ok">{notice}</div>}
        {error && (
          <div className="hb-alert" role="alert">
            {error}
          </div>
        )}
        {bannerShown && <ConflictBanner entity="task" onReview={review} />}
        {!canEdit && (
          <div className="hb-note" role="status">
            {task.access === 'tree'
              ? 'You can see this task because it sits under (or above) a task you have access to. It’s read-only.'
              : 'You can see this task because you were mentioned in it. It’s read-only, but you can comment.'}
          </div>
        )}

        {isInReview && (
          <section className="hb-review" role="status">
            {task.reviewInitiator && <Avatar user={task.reviewInitiator} px={36} decorative />}
            <div className="hb-review-text">
              <strong>
                {task.reviewInitiator ? userLabel(task.reviewInitiator) : 'Someone'} sent this to{' '}
                {task.assignee
                  ? task.assigneeId === currentUser.id
                    ? 'you'
                    : userLabel(task.assignee)
                  : 'a reviewer'}{' '}
                for review.
              </strong>
              <span>
                When it’s reviewed it goes back to{' '}
                {task.priorAssignee ? userLabel(task.priorAssignee) : 'no one'} as{' '}
                {task.priorStatus ? TASK_STATUS_LABELS[task.priorStatus] : 'Open'}. Leave a note in
                the comments if something needs fixing.
              </span>
            </div>
            <div className="hb-review-actions">
              {canRecall && (
                <Btn disabled={reviewBusy} onClick={() => void exitReview('recall')}>
                  Recall from review
                </Btn>
              )}
              <button
                type="button"
                className="hb-btn hb-btn-primary"
                disabled={reviewBusy || !canReview}
                title={
                  canReview
                    ? undefined
                    : 'Only an admin, the reviewer, or a supervisor above them can finish this review'
                }
                onClick={() => void exitReview('reviewed')}
              >
                {reviewBusy ? 'Saving…' : 'Reviewed'}
              </button>
            </div>
          </section>
        )}

        <div className="hb-task-cols">
          {/* Meeting decision (Nov 11): the conversation is front and center and the
              description sits on the right. Phones: description, then comments. */}
          <div className="hb-col hb-tc-act">
            <section className="hb-card hb-activity">
              <div className="hb-card-head">
                <span className="hb-ic tone-blue">
                  <MessageSquare size={16} aria-hidden="true" />
                </span>
                <h3>Activity</h3>
                <Segmented
                  small
                  label="Show"
                  value={activity}
                  onChange={setActivity}
                  options={[
                    {
                      value: 'comments',
                      label: `Comments${task.comments.length ? ` (${task.comments.length})` : ''}`,
                    },
                    { value: 'history', label: 'History' },
                  ]}
                />
              </div>
              {/* Always mounted, only hidden: switching to History keeps a comment being written. */}
              <div className="hb-card-pad" hidden={activity !== 'comments'}>
                <Comments
                  task={task}
                  currentUser={currentUser}
                  onChanged={applyTask}
                  onDirtyChange={setCommentsDirty}
                />
              </div>
              {activity === 'history' && (
                <div className="hb-card-pad">
                  <TaskHistory taskId={task.id} version={historyVersion} />
                </div>
              )}
            </section>
          </div>

          <div className="hb-col hb-tc-desc">
            <section className="hb-card detail-desc">
              <div className="hb-card-pad">
                {descHead(false)}
                {descExpanded ? descText : descBody}
              </div>
            </section>

            <section className="hb-card detail-attachments">
              <div className="hb-card-head">
                <span className="hb-ic tone-blue">
                  <Paperclip size={16} aria-hidden="true" />
                </span>
                <h3>Files</h3>
                <span className="hb-small">{task.attachments.length || ''}</span>
              </div>
              <div className="hb-card-pad">
                <AttachmentSection
                  attachments={task.attachments}
                  target={{ kind: 'task', taskId: task.id }}
                  canUpload
                  currentUser={currentUser}
                  onChanged={applyTask}
                />
              </div>
            </section>
          </div>

          <div className="hb-col hb-tc-rest">
            <section className="hb-card">
              <div className="hb-card-head">
                <span className="hb-ic tone-blue">
                  <ListTree size={16} aria-hidden="true" />
                </span>
                <h3>Sub-tasks</h3>
                {task.children.length > 0 && (
                  <span className="hb-small">
                    {doneChildren} of {task.children.length} done
                  </span>
                )}
                {canEdit && (
                  <>
                    <Btn onClick={() => setNewSubOpen(true)}>
                      <Plus size={14} aria-hidden="true" /> New
                    </Btn>
                    <Btn onClick={(e) => openPicker('child', e.currentTarget)}>Link existing</Btn>
                  </>
                )}
              </div>
              {task.children.length > 0 && (
                <div className="hb-pad hb-pad-tight">
                  <Bar value={doneChildren} max={task.children.length} tone="green" />
                </div>
              )}
              {newSubOpen && (
                <form
                  className="hb-newsub"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void createSubtask();
                  }}
                >
                  <input
                    className="hb-tpl-input"
                    aria-label="New sub-task name"
                    placeholder="Sub-task name, then Enter"
                    value={newSubName}
                    autoFocus
                    maxLength={300}
                    disabled={creatingSub}
                    onChange={(e) => setNewSubName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        closeNewSub();
                      }
                    }}
                  />
                  <Btn
                    kind="primary"
                    type="submit"
                    disabled={creatingSub || newSubName.trim().length < TASK_NAME_MIN_LENGTH}
                  >
                    {creatingSub ? 'Creating…' : 'Create'}
                  </Btn>
                  <Btn onClick={closeNewSub} disabled={creatingSub}>
                    Cancel
                  </Btn>
                  <span className={`hb-newsub-hint${newSubError ? ' is-error' : ''}`}>
                    {newSubError ?? 'Assigned to you, with no dates; fill in the rest later.'}
                  </span>
                </form>
              )}
              {task.children.length === 0 ? (
                <Empty>No sub-tasks yet.</Empty>
              ) : (
                task.children.map((c) =>
                  c.accessible ? (
                    <Link
                      key={c.id}
                      to={`/tasks/${c.id}`}
                      className={`hb-row${c.status === 'Completed' ? ' is-done' : ''}`}
                    >
                      <span className="hb-stack">
                        <span className="hb-name">{c.name}</span>
                        <span className="hb-sub">#{c.id}</span>
                      </span>
                      <StatusPill status={c.status} />
                    </Link>
                  ) : (
                    <div key={c.id} className="hb-row" title="You do not have access to this task">
                      <span className="hb-stack">
                        <span className="hb-sub">
                          <Lock size={12} aria-hidden="true" /> #{c.id} · no access
                        </span>
                      </span>
                      <StatusPill status={c.status} />
                    </div>
                  ),
                )
              )}
            </section>

            <section className="hb-card">
              <div className="hb-card-head">
                <span className="hb-ic tone-blue">
                  <Link2 size={16} aria-hidden="true" />
                </span>
                <h3>Linked tasks</h3>
              </div>
              {links.length === 0 ? (
                <p className="hb-link-none">Nothing linked yet.</p>
              ) : (
                <ul className="hb-links">
                  {links.map((l) => (
                    <li key={`${l.kind}-${l.task.id}`} className="hb-link-row">
                      <span className="hb-link-type">{LINK_LABEL[l.kind]}</span>
                      <TaskRefLink task={l.task} hideStatus />
                      {l.task.status && <StatusPill status={l.task.status} />}
                      {canEdit && (
                        <button
                          type="button"
                          className="hb-x"
                          aria-label={`Unlink ${LINK_LABEL[l.kind].toLowerCase()} #${l.task.id}`}
                          onClick={() =>
                            l.kind === 'parent'
                              ? runRel(() => api.clearParent(task.id))
                              : runRel(() =>
                                  api.removeDependency(
                                    task.id,
                                    l.kind as DependencyType,
                                    l.task.id,
                                  ),
                                )
                          }
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <div className="hb-link-add">
                  <Select
                    label="Link type"
                    variant="field"
                    value={addType}
                    options={linkTypeChoices}
                    onChange={setLinkType}
                    className="hb-link-add-type"
                  />
                  <button
                    type="button"
                    className="hb-select hb-select-field is-empty hb-link-add-task"
                    aria-haspopup="dialog"
                    aria-expanded={picker === addType}
                    onClick={(e) => openPicker(addType, e.currentTarget)}
                  >
                    <Search size={14} aria-hidden="true" className="hb-link-add-ic" />
                    <span className="hb-select-value">Find a task</span>
                    <ChevronDown
                      className="hb-select-caret"
                      size={14}
                      strokeWidth={2.4}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              )}
            </section>

            <section className="hb-card hb-soon-card" aria-disabled="true">
              <div className="hb-card-head">
                <span className="hb-ic tone-grey">
                  <ListChecks size={16} aria-hidden="true" />
                </span>
                <h3>Checklist</h3>
                <Pill tone="grey">Coming soon</Pill>
              </div>
              <p className="hb-soon-text">
                Steps you tick off inside a task. This needs a backend change first; until then, use
                sub-tasks.
              </p>
            </section>

            <section className="hb-card hb-recur-card">
              <div className="hb-card-head">
                <span className="hb-ic tone-blue">
                  <Repeat size={16} aria-hidden="true" />
                </span>
                <h3>Repeats</h3>
              </div>
              <div className="hb-card-pad hb-legacy-rail">
                <TaskRecurrencePanel task={task} onChanged={applyTask} />
              </div>
            </section>

            <section className="hb-card">
              <div className="hb-card-head">
                <span className="hb-ic tone-blue">
                  <AlarmClock size={16} aria-hidden="true" />
                </span>
                <h3>Reminders</h3>
                {reminderBlock && (
                  <span className="hb-small">{REMINDER_BLOCK_LABELS[reminderBlock]}</span>
                )}
              </div>
              <div className="hb-card-pad hb-legacy-rail">
                <TaskReminders taskId={task.id} startAt={task.startAt} status={task.status} />
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* One Save for the task's own fields */}
      {canEdit && (fieldsDirty || conflict || fieldsError) && (
        <div className="hb-savebar" role="region" aria-label="Unsaved changes">
          <span className="hb-savebar-dot" aria-hidden="true" />
          <strong>
            {fieldsDirty
              ? `${changedFields.length} unsaved ${changedFields.length === 1 ? 'change' : 'changes'}`
              : 'Not saved'}
          </strong>
          <span className="hb-savebar-what">{changedFields.join(', ')}</span>
          {fieldsError && <span className="hb-savebar-err">{fieldsError}</span>}
          {!fieldsError && dutyBlocking && (
            <span className="hb-savebar-err">Fix the duty mismatch to save.</span>
          )}
          <span className="hb-grow" />
          <span className="hb-kbd">Ctrl + S</span>
          {fieldsDirty && !conflict && (
            <button
              type="button"
              className="hb-savebar-discard"
              disabled={savingFields}
              onClick={discardFields}
            >
              Discard
            </button>
          )}
          {conflict ? (
            <button
              type="button"
              className="hb-savebar-save"
              disabled={savingFields}
              onClick={() => void handleConflictRefresh()}
            >
              {savingFields ? 'Refreshing…' : 'Refresh'}
            </button>
          ) : (
            <button
              type="button"
              className="hb-savebar-save"
              disabled={savingFields || !fieldsDirty || dutyBlocking}
              onClick={() => void saveFields()}
            >
              {savingFields ? 'Saving…' : 'Save changes'}
            </button>
          )}
        </div>
      )}

      {picker && (
        <TaskLinkPicker
          anchorRef={pickerAnchor}
          title={PICKER_TEXT[picker].title}
          hint={PICKER_TEXT[picker].hint}
          excludeId={task.id}
          linkedIds={linkedIds[picker]}
          onPick={handlePick}
          onClose={() => setPicker(null)}
        />
      )}

      {pendingReview && (
        <ReviewerPicker
          anchorRef={statusChipRef}
          taskId={task.id}
          taskRef={`#${task.id}`}
          taskName={task.name}
          currentAssignee={task.assignee ? userLabel(task.assignee) : null}
          returnStatus={TASK_STATUS_LABELS[task.status]}
          onClose={() => setPendingReview(false)}
          onPick={(reviewerId) => saveReview(reviewerId)}
        />
      )}

      {descExpanded && (
        <div className="modal-backdrop desc-backdrop">
          <div
            ref={descModalRef}
            className="modal desc-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="desc-modal-title"
          >
            {descHead(true)}
            {descBody}
          </div>
        </div>
      )}

      {pendingReminderRemoval && (
        <ConfirmDialog
          tone="warn"
          title={
            pendingReminderRemoval === 'task-canceled'
              ? 'Cancel this task?'
              : 'Clear the Start Date?'
          }
          message={`${
            pendingReminderRemoval === 'task-canceled'
              ? 'Canceling this task removes its reminders.'
              : 'Clearing the Start Date removes this task’s reminders.'
          } Your own reminders are deleted; anyone else with one sees a “Canceled” notice.`}
          confirmLabel="Save"
          cancelLabel="Keep editing"
          busy={savingFields}
          onCancel={() => setPendingReminderRemoval(null)}
          onConfirm={() => {
            setPendingReminderRemoval(null);
            void saveFields(true);
          }}
        />
      )}

      {dupOpen && (
        <Popover
          anchorRef={menuRef}
          open
          onClose={() => !duplicating && setDupOpen(false)}
          minWidth={420}
          matchWidth={false}
          closeOnTab={false}
          className="hb-actpanel"
          label="Duplicate task"
        >
          <div>
            <h3 className="hb-actpanel-title">Duplicate task</h3>
            {task.children.length > 0 ? (
              <p>
                “{task.name}” has {task.children.length} sub-task
                {task.children.length === 1 ? '' : 's'}. Duplicate just this task, or the whole tree
                beneath it?
              </p>
            ) : (
              <p>Create a fresh copy of “{task.name}”.</p>
            )}
            <label className="dup-attachments-toggle">
              <input
                type="checkbox"
                checked={copyAttachments}
                onChange={(e) => setCopyAttachments(e.target.checked)}
              />
              Copy attachments
            </label>
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              {task.children.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="secondary"
                    disabled={duplicating}
                    onClick={() => void doDuplicate(false)}
                  >
                    This task only
                  </button>
                  <button
                    type="button"
                    disabled={duplicating}
                    onClick={() => void doDuplicate(true)}
                  >
                    Task &amp; all sub-tasks
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="secondary"
                    disabled={duplicating}
                    onClick={() => setDupOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={duplicating}
                    onClick={() => void doDuplicate(false)}
                  >
                    Duplicate
                  </button>
                </>
              )}
            </div>
          </div>
        </Popover>
      )}

      {tplOpen && (
        <Popover
          anchorRef={menuRef}
          open
          onClose={() => !savingTpl && setTplOpen(false)}
          minWidth={420}
          matchWidth={false}
          closeOnTab={false}
          className="hb-actpanel"
          label="Save as template"
        >
          <div>
            <h3 className="hb-actpanel-title">Save as template</h3>
            {savedTplId != null ? (
              <>
                <p>Created a reusable template from “{task.name}”. Your task is unchanged.</p>
                <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="secondary" onClick={() => setTplOpen(false)}>
                    Close
                  </button>
                  <button type="button" onClick={() => navigate('/admin/templates')}>
                    Manage templates
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  Creates a new, independent template. The source task is not changed. Assignees
                  become editable role placeholders and dates become offsets from the root’s start.
                </p>
                <div className="field">
                  <label htmlFor="tpl-name">Template name</label>
                  <input
                    id="tpl-name"
                    value={tplName}
                    autoFocus
                    placeholder="e.g. Monthly inspection"
                    onChange={(e) => setTplName(e.target.value)}
                  />
                </div>
                {task.children.length > 0 && (
                  <div className="field">
                    <label>Scope</label>
                    <div className="seg" role="group" aria-label="Conversion scope">
                      <button
                        type="button"
                        className={`seg-btn${tplScope === 'single' ? ' active' : ''}`}
                        aria-pressed={tplScope === 'single'}
                        onClick={() => setTplScope('single')}
                      >
                        This task only
                      </button>
                      <button
                        type="button"
                        className={`seg-btn${tplScope === 'tree' ? ' active' : ''}`}
                        aria-pressed={tplScope === 'tree'}
                        onClick={() => setTplScope('tree')}
                      >
                        Task &amp; all sub-tasks
                      </button>
                    </div>
                  </div>
                )}
                <div className="field">
                  <label htmlFor="tpl-role">Role placeholder (root)</label>
                  <input
                    id="tpl-role"
                    value={tplRole}
                    placeholder="e.g. Inspector"
                    onChange={(e) => setTplRole(e.target.value)}
                  />
                  <p className="muted" style={{ fontSize: '0.72rem', margin: '0.25rem 0 0' }}>
                    Seeded from the current assignee’s name; edit any role later in the template
                    editor.
                  </p>
                </div>
                <label className="dup-attachments-toggle">
                  <input
                    type="checkbox"
                    checked={tplAttachments}
                    onChange={(e) => setTplAttachments(e.target.checked)}
                  />
                  Include attachments from these tasks in the template
                </label>
                <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="secondary"
                    disabled={savingTpl}
                    onClick={() => setTplOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={savingTpl || !tplName.trim()}
                    onClick={() => void doSaveAsTemplate()}
                  >
                    {savingTpl ? 'Saving…' : 'Save template'}
                  </button>
                </div>
              </>
            )}
          </div>
        </Popover>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this task?"
          message={`This permanently deletes #${task.id} “${task.name}”, with its comments and files. This cannot be undone.`}
          confirmLabel={deleting ? 'Deleting…' : 'Delete task'}
          busy={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={handleDeleteTask}
        />
      )}
    </div>
  );
}
