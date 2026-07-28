import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  MENTIONED_FILTERS,
  reminderLeadLabel,
  type MentionedFilter,
  type NotificationsDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { RichText } from '../components/RichText';
import { useNotifications } from '../notifications/NotificationContext';

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

const EMPTY: NotificationsDto = { mentioned: [], reminders: [], assigned: [] };

export function NotificationsPage() {
  const [filter, setFilter] = useState<MentionedFilter>('all');
  const [data, setData] = useState<NotificationsDto>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { refresh: refreshUnread } = useNotifications();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.getNotifications(filter));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Click-through: mark the entry read, refresh the bell, then open the task.
  const openTask = (
    kind: 'notification' | 'reminder',
    id: string,
    taskId: number,
  ) => {
    const call =
      kind === 'notification' ? api.markNotificationRead(id) : api.markReminderRead(id);
    void call.then(refreshUnread).catch(() => {});
    navigate(`/tasks/${taskId}`);
  };

  const removeReminder = async (id: string) => {
    try {
      await api.removeReminder(id);
      setData((d) => ({ ...d, reminders: d.reminders.filter((r) => r.id !== id) }));
      refreshUnread();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove reminder');
    }
  };

  const taskIdCell = (
    kind: 'notification' | 'reminder',
    id: string,
    taskId: number,
    read: boolean,
  ) => (
    <td>
      {!read && <span className="unread-dot" aria-label="Unread" />}
      <a
        href={`/tasks/${taskId}`}
        onClick={(e) => {
          e.preventDefault();
          openTask(kind, id, taskId);
        }}
      >
        #{taskId}
      </a>
    </td>
  );

  return (
    <div className="container container-wide">
      <h2>Notifications</h2>
      {error && <div className="alert error">{error}</div>}

      {/* --- Mentioned --- */}
      <section className="card notif-section">
        <div className="notif-head">
          <h3>Mentioned</h3>
          <div className="spacer" />
          <div className="seg">
            {MENTIONED_FILTERS.map((f) => (
              <button
                key={f}
                className={`seg-btn${filter === f ? ' active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'unread' ? 'Unread' : 'Read'}
              </button>
            ))}
          </div>
        </div>
        <table className="results-table notif-table">
          <thead>
            <tr>
              <th>Task Id</th>
              <th>Task Name</th>
              <th>When</th>
              <th>From</th>
              <th>Comment</th>
            </tr>
          </thead>
          <tbody>
            {data.mentioned.map((m) => (
              <tr key={m.id} className={m.read ? '' : 'unread-row'}>
                {taskIdCell('notification', m.id, m.taskId, m.read)}
                <td>{m.taskName}</td>
                <td>{fmt(m.commentAt)}</td>
                <td>{m.commenter.email}</td>
                <td className="comment-cell">
                  <RichText html={m.commentHtml} />
                </td>
              </tr>
            ))}
            {!loading && data.mentioned.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ padding: '0.75rem' }}>
                  No mentions.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* --- Reminders --- */}
      <section className="card notif-section">
        <h3>Reminders</h3>
        <table className="results-table notif-table">
          <thead>
            <tr>
              <th>Task Id</th>
              <th>Task Name</th>
              <th>Start</th>
              <th>Priority</th>
              <th>Lead</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.reminders.map((r) => (
              <tr key={r.id} className={r.read ? '' : 'unread-row'}>
                {taskIdCell('reminder', r.id, r.taskId, r.read)}
                <td>{r.taskName}</td>
                <td>{fmt(r.startAt)}</td>
                <td>{r.priority}</td>
                <td className="muted">{reminderLeadLabel(r.leadMinutes)}</td>
                <td>
                  <button className="secondary" onClick={() => void removeReminder(r.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {!loading && data.reminders.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ padding: '0.75rem' }}>
                  No due reminders.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* --- Assigned --- */}
      <section className="card notif-section">
        <h3>Assigned</h3>
        <table className="results-table notif-table">
          <thead>
            <tr>
              <th>Task Id</th>
              <th>Task Name</th>
              <th>Start</th>
              <th>Priority</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {data.assigned.map((a) => (
              <tr key={a.id} className={a.read ? '' : 'unread-row'}>
                {taskIdCell('notification', a.id, a.taskId, a.read)}
                <td>{a.taskName}</td>
                <td>{fmt(a.startAt)}</td>
                <td>{a.priority}</td>
                <td className="muted">{a.action === 'added' ? 'Assigned' : 'Unassigned'}</td>
              </tr>
            ))}
            {!loading && data.assigned.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ padding: '0.75rem' }}>
                  No assignment notifications.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <p className="muted" style={{ fontSize: '0.8rem' }}>
        <Link to="/profile">Notification settings</Link> · Updates every 30 seconds.
      </p>
    </div>
  );
}
