import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckSquare, FolderOpen, Plus } from 'lucide-react';
import { TASK_NAME_MIN_LENGTH, type ActiveUserDto } from '@healthy-tasks/shared';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { DEFAULT_DUE_HOUR, partsToIso } from '../../lib/datetime';
import { dutyIdOf, heldDutyOptions, useDutyCatalog } from '../../lib/duties';
import { Avatar, userLabel } from '../ui/Avatar';
import { Popover } from './Popover';
import { DatePicker } from './DatePicker';
import { Select, type SelectOption } from './Select';
import { Btn } from './ui';
import { useToast } from './Toast';

/** Fired on `window` after a quick task is made, so open lists can refresh. */
export const TASK_CREATED_EVENT = 'hb:task-created';

export type NewKind = 'task' | 'project';

/** What the quick panel carries to the full New task page ("More details"). */
export interface NewTaskCarry {
  name?: string;
  dueDate?: string;
  dueTime?: string;
  assigneeId?: string;
  dutyChoice?: string;
  isProject?: boolean;
}

/**
 * "+ New" in the page header (Nov 2026 plan, C1–C5): a menu (Task, Project),
 * then a quick panel right there. Required: a title, an assignee (you, unless
 * changed) and a duty from that person's duties, "No duty" being one of the
 * choices. The due date is optional. A project is the same with its switch
 * on. "More details" carries what was typed to the full New task page.
 */
export function QuickTaskButton() {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<NewKind | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="hb-btn hb-btn-primary"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setKind(null);
        }}
      >
        <Plus size={18} aria-hidden="true" />
        New
      </button>
      <Popover
        anchorRef={btnRef}
        open={open}
        onClose={() => !busy && setOpen(false)}
        minWidth={kind ? 420 : 220}
        matchWidth={false}
        closeOnTab={false}
        className={kind ? 'hb-quicktask' : 'hb-newmenu'}
        label={kind === 'project' ? 'New project' : kind === 'task' ? 'New task' : 'New'}
      >
        {kind ? (
          <QuickTaskForm
            kind={kind}
            onKind={setKind}
            onBusy={setBusy}
            onDone={() => setOpen(false)}
          />
        ) : (
          <div className="hb-actions-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => setKind('task')}>
              <CheckSquare size={16} aria-hidden="true" /> Task
            </button>
            <button type="button" role="menuitem" onClick={() => setKind('project')}>
              <FolderOpen size={16} aria-hidden="true" /> Project
            </button>
          </div>
        )}
      </Popover>
    </>
  );
}

function QuickTaskForm({
  kind,
  onKind,
  onBusy,
  onDone,
}: {
  kind: NewKind;
  onKind: (k: NewKind) => void;
  onBusy: (b: boolean) => void;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const catalog = useDutyCatalog();
  const inputRef = useRef<HTMLInputElement>(null);
  const [users, setUsers] = useState<ActiveUserDto[]>([]);
  const [name, setName] = useState('');
  const [assigneeId, setAssigneeId] = useState(user?.id ?? '');
  const [dutyChoice, setDutyChoice] = useState('');
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [dueTime, setDueTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isProject = kind === 'project';

  useEffect(() => {
    api
      .listActiveUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
    // The popover is hidden while it measures, so focus once it is shown.
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, []);

  const peopleChoices: SelectOption<string>[] = [...users]
    .sort((a, b) => userLabel(a).localeCompare(userLabel(b)))
    .map((u) => ({
      value: u.id,
      label: u.id === user?.id ? `${userLabel(u)} (me)` : userLabel(u),
      lead: <Avatar user={u} px={22} decorative />,
    }));
  const dutyChoices = heldDutyOptions(catalog, assigneeId || null);
  const nameOk = name.trim().length >= TASK_NAME_MIN_LENGTH;
  const ok = nameOk && !!assigneeId && !!dutyChoice;
  const missing = !nameOk
    ? null
    : !assigneeId
      ? 'Pick who it’s for.'
      : !dutyChoice
        ? 'Pick a duty, or “No duty”.'
        : null;

  function pickAssignee(id: string) {
    setAssigneeId(id);
    // A duty the new person doesn't hold no longer fits.
    if (dutyChoice && !heldDutyOptions(catalog, id).some((o) => o.value === dutyChoice))
      setDutyChoice('');
  }

  async function add(e?: FormEvent) {
    e?.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    onBusy(true);
    setError(null);
    try {
      const t = await api.createTask({
        name: name.trim(),
        assigneeId,
        dutyId: dutyIdOf(dutyChoice),
        dueAt: partsToIso(dueDate ?? '', dueTime, DEFAULT_DUE_HOUR),
        ...(isProject && { isProject: true }),
      });
      onDone();
      window.dispatchEvent(new CustomEvent(TASK_CREATED_EVENT, { detail: { id: t.id } }));
      const forMe = assigneeId === user?.id;
      toast({
        message: `Added ${isProject ? 'the project ' : ''}“${t.name}”${forMe ? ' to your tasks' : ''}.`,
        tone: 'success',
        action: { label: 'Open', run: () => navigate(`/tasks/${t.id}`) },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add it.');
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  function moreDetails() {
    onDone();
    const carry: NewTaskCarry = {
      name: name.trim(),
      dueDate: dueDate ?? '',
      dueTime,
      assigneeId,
      dutyChoice,
      isProject,
    };
    navigate('/tasks/new', { state: carry });
  }

  return (
    <form onSubmit={add}>
      <div className="hb-quicktask-head is-row">
        <span className="hb-quicktask-title">{isProject ? 'New project' : 'New task'}</span>
        <label className="hb-switch">
          <input
            type="checkbox"
            checked={isProject}
            onChange={(e) => onKind(e.target.checked ? 'project' : 'task')}
          />
          <span className="hb-switch-track" aria-hidden="true" />
          Project
        </label>
      </div>
      <input
        ref={inputRef}
        className="hb-tpl-input"
        value={name}
        maxLength={300}
        placeholder={isProject ? 'Project name' : 'What needs doing?'}
        aria-label={isProject ? 'Project name' : 'Task title'}
        onChange={(e) => setName(e.target.value)}
      />
      <Select
        label="Assignee"
        value={assigneeId}
        options={peopleChoices}
        searchPlaceholder="Search people…"
        onChange={pickAssignee}
      />
      <Select
        label="Duty"
        value={dutyChoice}
        options={dutyChoices}
        placeholder={catalog.loading ? 'Loading duties…' : 'Pick a duty'}
        onChange={setDutyChoice}
      />
      <DatePicker
        variant="field"
        label="Due date"
        placeholder="Due date (optional)"
        value={dueDate}
        onChange={setDueDate}
        time={dueTime}
        onTimeChange={setDueTime}
        allowClear
        renderValue={(v) =>
          v
            ? `Due ${new Date(`${v}T12:00`).toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}${dueTime ? ` · ${dueTime}` : ''}`
            : 'Due date (optional)'
        }
      />
      {(error || missing) && (
        <p
          className={error ? 'hb-quicktask-error' : 'hb-quicktask-hint'}
          role={error ? 'alert' : undefined}
        >
          {error ?? missing}
        </p>
      )}
      <div className="hb-quicktask-foot">
        <Btn kind="link" onClick={moreDetails}>
          More details
        </Btn>
        <span className="hb-grow" />
        <Btn onClick={onDone} disabled={busy}>
          Cancel
        </Btn>
        <Btn kind="primary" type="submit" disabled={!ok || busy}>
          {busy ? 'Adding…' : isProject ? 'Add project' : 'Add task'}
        </Btn>
      </div>
    </form>
  );
}
