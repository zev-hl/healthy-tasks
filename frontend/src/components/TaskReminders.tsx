import { useCallback, useEffect, useState } from 'react';
import {
  REMINDER_BLOCK_LABELS,
  REMINDER_LEAD_OPTIONS,
  reminderAddBlock,
  reminderLeadLabel,
  type ReminderDto,
  type TaskStatus,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useNotifications } from '../notifications/NotificationContext';

interface Props {
  taskId: number;
  /** The task's Start Date/Time (ISO) and Status — drive the add-block (B). */
  startAt: string | null;
  status: TaskStatus;
}

/** The current user's personal reminders on a task (add/remove), on Task Detail. */
export function TaskReminders({ taskId, startAt, status }: Props) {
  const [reminders, setReminders] = useState<ReminderDto[]>([]);
  const [lead, setLead] = useState<number>(60); // default: 1 hour before
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useNotifications();

  // Whether Add is blocked, and why (shared with the server, which also 400s).
  const block = reminderAddBlock(startAt, status, new Date());

  const load = useCallback(async () => {
    try {
      setReminders(await api.listTaskReminders(taskId));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load reminders');
    }
  }, [taskId]);

  // Reload when the task's Start/Status changes too: a Save that clears the
  // Start Date or Cancels the task removes this user's reminders server-side.
  useEffect(() => {
    void load();
  }, [load, startAt, status]);

  const add = async () => {
    setBusy(true);
    try {
      const created = await api.addTaskReminder(taskId, { leadMinutes: lead });
      setReminders((rs) => [...rs, created]);
      refresh();
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add reminder');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.removeReminder(id);
      setReminders((rs) => rs.filter((r) => r.id !== id));
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove reminder');
    }
  };

  // Rendered bare inside the Task Detail right-rail "Reminders" section.
  return (
    <div className="rail-reminders">
      <p className="muted rail-reminders-hint">Personal to you — surfaces in Notifications near the Start time.</p>
      {error && <div className="alert error">{error}</div>}
      <ul className="reminder-list">
        {reminders.map((r) => (
          <li key={r.id}>
            <span>{reminderLeadLabel(r.leadMinutes)}</span>
            <button className="tertiary btn-sm" onClick={() => void remove(r.id)}>
              Remove
            </button>
          </li>
        ))}
        {reminders.length === 0 && <li className="muted">No reminders set.</li>}
      </ul>
      <div className="reminder-add">
        <select
          value={lead}
          onChange={(e) => setLead(Number(e.target.value))}
          aria-label="Lead time"
          disabled={busy || block !== null}
        >
          {REMINDER_LEAD_OPTIONS.map((o) => (
            <option key={o.minutes} value={o.minutes}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          className="btn-sm"
          onClick={() => void add()}
          disabled={busy || block !== null}
          title={block ? REMINDER_BLOCK_LABELS[block] : undefined}
        >
          Add reminder
        </button>
      </div>
    </div>
  );
}
