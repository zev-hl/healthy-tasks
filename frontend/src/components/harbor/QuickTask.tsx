import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { TASK_NAME_MIN_LENGTH } from '@healthy-tasks/shared';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { DEFAULT_DUE_HOUR, partsToIso } from '../../lib/datetime';
import { Popover } from './Popover';
import { DatePicker } from './DatePicker';
import { Btn } from './ui';
import { useToast } from './Toast';

/** Fired on `window` after a quick task is made, so open lists can refresh. */
export const TASK_CREATED_EVENT = 'hb:task-created';

/**
 * "New task" in the page header (meeting decision, Nov 11): two ways to make a
 * task. The button opens a quick panel right there (title, due date and time)
 * that saves without leaving the page: the task is assigned to you, and a toast
 * offers to open it. "More details" carries what was typed to the full New task
 * page, for everything else (assignee, duty, description, dates, tags).
 */
export function QuickTaskButton() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const btnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  // The draft stays while the panel is closed, so a stray click loses nothing.
  const [name, setName] = useState('');
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [dueTime, setDueTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The popover is hidden while it measures, so focus once it is shown.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  const ok = name.trim().length >= TASK_NAME_MIN_LENGTH;

  function reset() {
    setName('');
    setDueDate(null);
    setDueTime('');
    setError(null);
  }

  async function add(e?: FormEvent) {
    e?.preventDefault();
    if (!ok || busy || !user) return;
    setBusy(true);
    setError(null);
    try {
      const t = await api.createTask({
        name: name.trim(),
        assigneeId: user.id,
        dueAt: partsToIso(dueDate ?? '', dueTime, DEFAULT_DUE_HOUR),
      });
      reset();
      setOpen(false);
      window.dispatchEvent(new CustomEvent(TASK_CREATED_EVENT, { detail: { id: t.id } }));
      toast({
        message: `Added “${t.name}” to your tasks.`,
        tone: 'success',
        action: { label: 'Open', run: () => navigate(`/tasks/${t.id}`) },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the task.');
    } finally {
      setBusy(false);
    }
  }

  function moreDetails() {
    setOpen(false);
    navigate('/tasks/new', {
      state: { name: name.trim(), dueDate: dueDate ?? '', dueTime },
    });
    reset();
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="hb-btn hb-btn-primary"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Plus size={18} aria-hidden="true" />
        New task
      </button>
      <Popover
        anchorRef={btnRef}
        open={open}
        onClose={() => !busy && setOpen(false)}
        minWidth={400}
        matchWidth={false}
        closeOnTab={false}
        className="hb-quicktask"
        label="New task"
      >
        <form onSubmit={add}>
          <div className="hb-quicktask-head">
            <span className="hb-quicktask-title">New task</span>
            <span className="hb-quicktask-hint">Assigned to you. Add the rest any time.</span>
          </div>
          <input
            ref={inputRef}
            className="hb-tpl-input"
            value={name}
            maxLength={300}
            placeholder="What needs doing?"
            aria-label="Task title"
            onChange={(e) => setName(e.target.value)}
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
          {error && (
            <p className="hb-quicktask-error" role="alert">
              {error}
            </p>
          )}
          <div className="hb-quicktask-foot">
            <Btn kind="link" onClick={moreDetails}>
              More details
            </Btn>
            <span className="hb-grow" />
            <Btn onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Btn>
            <Btn kind="primary" type="submit" disabled={!ok || busy}>
              {busy ? 'Adding…' : 'Add task'}
            </Btn>
          </div>
        </form>
      </Popover>
    </>
  );
}
