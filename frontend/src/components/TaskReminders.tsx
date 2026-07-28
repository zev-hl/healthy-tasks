import { useCallback, useEffect, useState } from 'react';
import { REMINDER_LEAD_OPTIONS, reminderLeadLabel, type ReminderDto } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useNotifications } from '../notifications/NotificationContext';

/** The current user's personal reminders on a task (add/remove), on Task Detail. */
export function TaskReminders({ taskId }: { taskId: number }) {
  const [reminders, setReminders] = useState<ReminderDto[]>([]);
  const [lead, setLead] = useState<number>(60); // default: 1 hour before
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useNotifications();

  const load = useCallback(async () => {
    try {
      setReminders(await api.listTaskReminders(taskId));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load reminders');
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <div className="container">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Your reminders</h3>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Personal to you. Each reminder surfaces in your Notifications once the task&apos;s Start
          time is within the chosen lead time.
        </p>
        {error && <div className="alert error">{error}</div>}
        <ul className="reminder-list">
          {reminders.map((r) => (
            <li key={r.id}>
              <span>{reminderLeadLabel(r.leadMinutes)}</span>
              <button className="secondary" onClick={() => void remove(r.id)}>
                Remove
              </button>
            </li>
          ))}
          {reminders.length === 0 && <li className="muted">No reminders set.</li>}
        </ul>
        <div className="reminder-add">
          <select value={lead} onChange={(e) => setLead(Number(e.target.value))} aria-label="Lead time">
            {REMINDER_LEAD_OPTIONS.map((o) => (
              <option key={o.minutes} value={o.minutes}>
                {o.label}
              </option>
            ))}
          </select>
          <button onClick={() => void add()} disabled={busy}>
            Add reminder
          </button>
        </div>
      </div>
    </div>
  );
}
