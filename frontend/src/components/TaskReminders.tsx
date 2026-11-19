import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  REMINDER_BLOCK_LABELS,
  REMINDER_DEFAULT_HOURS,
  REMINDER_NOTE_MAX,
  reminderAddBlock,
  type ReminderDto,
  type TaskStatus,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useNotifications } from '../notifications/NotificationContext';
import { DatePicker, toYmd } from './harbor/DatePicker';
import { Btn } from './harbor/ui';

interface Props {
  taskId: number;
  status: TaskStatus;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Two hours from now (E4's default), rounded up to the next 5 minutes. */
export function defaultReminderParts(now = new Date()): { date: string; time: string } {
  const at = new Date(now.getTime() + REMINDER_DEFAULT_HOURS * 3_600_000);
  at.setSeconds(0, 0);
  at.setMinutes(Math.ceil(at.getMinutes() / 5) * 5);
  return { date: toYmd(at), time: `${pad(at.getHours())}:${pad(at.getMinutes())}` };
}

function whenLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * The current user's own reminders on a task (Nov 2026 plan, E4): each at an
 * exact date and time (two hours from now unless changed) with a note, any
 * number of them, seen only by you and delivered through your alerts. No start
 * date needed.
 */
export function TaskReminders({ taskId, status }: Props) {
  const [reminders, setReminders] = useState<ReminderDto[]>([]);
  const [{ date, time }, setWhen] = useState(() => defaultReminderParts());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useNotifications();

  // Whether Add is blocked, and why (shared with the server, which also 400s).
  const block = reminderAddBlock(status);

  const load = useCallback(async () => {
    try {
      setReminders(await api.listTaskReminders(taskId));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load reminders');
    }
  }, [taskId]);

  // Reload when the status changes too: Canceling removes them server-side.
  useEffect(() => {
    void load();
  }, [load, status]);

  const add = async () => {
    if (!date || !time) return;
    const at = new Date(`${date}T${time}`);
    if (at.getTime() <= Date.now()) {
      setError('Pick a time that hasn’t passed.');
      return;
    }
    setBusy(true);
    try {
      const created = await api.addTaskReminder(taskId, {
        remindAt: at.toISOString(),
        note: note.trim() || null,
      });
      setReminders((rs) => [...rs, created].sort((a, b) => a.remindAt.localeCompare(b.remindAt)));
      setNote('');
      setWhen(defaultReminderParts());
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

  const now = Date.now();
  return (
    <div className="hb-reminders">
      <p className="hb-small">Only you see these. They arrive in your alerts at the time set.</p>
      {error && (
        <p className="hb-quicktask-error" role="alert">
          {error}
        </p>
      )}
      {reminders.length === 0 ? (
        <p className="hb-small">No reminders set.</p>
      ) : (
        <ul className="hb-reminder-list">
          {reminders.map((r) => (
            <li
              key={r.id}
              className={new Date(r.remindAt).getTime() <= now ? 'is-past' : undefined}
            >
              <span className="hb-stack">
                <span className="hb-name">
                  {r.kind === 'snooze' ? 'Back from snooze · ' : ''}
                  {whenLabel(r.remindAt)}
                </span>
                {r.note && <span className="hb-sub">{r.note}</span>}
              </span>
              <button
                type="button"
                className="hb-icon-btn hb-icon-btn-sm"
                aria-label={`Remove the reminder for ${whenLabel(r.remindAt)}`}
                onClick={() => void remove(r.id)}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="hb-reminder-add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <DatePicker
          variant="field"
          label="Reminder date"
          value={date || null}
          allowClear={false}
          disabled={busy || block !== null}
          time={time}
          onTimeChange={(t) => setWhen((w) => ({ ...w, time: t }))}
          onChange={(v) => setWhen((w) => ({ ...w, date: v ?? w.date }))}
          renderValue={(v) =>
            v ? whenLabel(new Date(`${v}T${time || '09:00'}`).toISOString()) : 'Pick a time'
          }
        />
        <input
          className="hb-tpl-input"
          value={note}
          maxLength={REMINDER_NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          aria-label="Reminder note"
          disabled={busy || block !== null}
        />
        <Btn
          type="submit"
          disabled={busy || block !== null}
          title={block ? REMINDER_BLOCK_LABELS[block] : undefined}
        >
          Add reminder
        </Btn>
      </form>
    </div>
  );
}
