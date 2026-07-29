import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  REMINDER_SNOOZE_OPTIONS,
  reminderLeadLabel,
  type AssignAction,
  type NotificationsDto,
  type TaskPriority,
  type TaskUserRef,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { RichText } from '../components/RichText';
import { useNotifications } from '../notifications/NotificationContext';
import { Avatar, userLabel } from '../components/ui/Avatar';
import { PriorityRamp } from '../components/ui/indicators';
import { TimeStamp } from '../components/ui/TimeStamp';
import { DueDate } from '../components/ui/dates';

const EMPTY: NotificationsDto = { mentioned: [], reminders: [], assigned: [] };

type FeedKind = 'mentioned' | 'assigned' | 'reminder';

/** One entry in the unified feed, normalized across the three source lists. */
interface FeedItem {
  key: string;
  kind: FeedKind;
  id: string; // notification / reminder id (mark-read / remove)
  taskId: number;
  taskName: string;
  at: string | null; // ISO — sort + day-group key
  read: boolean;
  commenter?: TaskUserRef;
  commentHtml?: string;
  priority?: TaskPriority;
  leadMinutes?: number;
  action?: AssignAction;
  actor?: TaskUserRef | null; // assigned: who assigned/unassigned
  dueAt?: string | null; // assigned: the task's due date
  blockedByCount?: number; // assigned: open blockers on the task
}

/** Flatten the three lists into one timestamp-sorted feed (newest first). */
function buildFeed(d: NotificationsDto): FeedItem[] {
  const items: FeedItem[] = [];
  for (const m of d.mentioned)
    items.push({
      key: `m${m.id}`,
      kind: 'mentioned',
      id: m.id,
      taskId: m.taskId,
      taskName: m.taskName,
      at: m.commentAt,
      read: m.read,
      commenter: m.commenter,
      commentHtml: m.commentHtml,
    });
  for (const a of d.assigned)
    items.push({
      key: `a${a.id}`,
      kind: 'assigned',
      id: a.id,
      taskId: a.taskId,
      taskName: a.taskName,
      at: a.createdAt,
      read: a.read,
      priority: a.priority,
      action: a.action,
      actor: a.actor,
      dueAt: a.dueAt,
      blockedByCount: a.blockedByCount,
    });
  for (const r of d.reminders)
    items.push({
      key: `r${r.id}`,
      kind: 'reminder',
      id: r.id,
      taskId: r.taskId,
      taskName: r.taskName,
      at: r.startAt,
      read: r.read,
      priority: r.priority,
      leadMinutes: r.leadMinutes,
    });
  // Newest first; undated (null) entries sort to the bottom.
  return items.sort((x, y) => (y.at ?? '').localeCompare(x.at ?? ''));
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function dayKey(iso: string | null): string {
  if (!iso) return 'undated';
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today" / "Yesterday" / weekday within a week / else an absolute date. */
function dayLabel(iso: string | null): string {
  if (!iso) return 'No date';
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

const TYPE_PILLS: { key: 'all' | FeedKind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'mentioned', label: 'Mentioned' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'reminder', label: 'Reminders' },
];

export function NotificationsPage() {
  const [data, setData] = useState<NotificationsDto>(EMPTY);
  const [typeFilter, setTypeFilter] = useState<'all' | FeedKind>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null); // reminder id with its snooze menu open
  const navigate = useNavigate();
  const { refresh: refreshUnread } = useNotifications();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.getNotifications('all'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const feed = useMemo(() => buildFeed(data), [data]);

  // Total per-type tallies for the pill badges (matches the mock, which shows
  // totals rather than unread-only counts).
  const countByType = useMemo(() => {
    const c = { all: 0, mentioned: 0, assigned: 0, reminder: 0 };
    for (const it of feed) {
      c.all += 1;
      c[it.kind] += 1;
    }
    return c;
  }, [feed]);

  const unreadTotal = useMemo(() => feed.filter((it) => !it.read).length, [feed]);

  const visible = useMemo(
    () =>
      feed.filter(
        (it) =>
          (typeFilter === 'all' || it.kind === typeFilter) && (!unreadOnly || !it.read),
      ),
    [feed, typeFilter, unreadOnly],
  );

  // Group the (already sorted) visible items into day sections.
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: FeedItem[] }[] = [];
    for (const it of visible) {
      const k = dayKey(it.at);
      let g = out.find((x) => x.key === k);
      if (!g) {
        g = { key: k, label: dayLabel(it.at), items: [] };
        out.push(g);
      }
      g.items.push(it);
    }
    return out;
  }, [visible]);

  // --- Optimistic local mutations ------------------------------------------
  const applyRead = (kind: FeedKind, id: string) =>
    setData((d) => ({
      mentioned:
        kind === 'mentioned' ? d.mentioned.map((m) => (m.id === id ? { ...m, read: true } : m)) : d.mentioned,
      assigned:
        kind === 'assigned' ? d.assigned.map((a) => (a.id === id ? { ...a, read: true } : a)) : d.assigned,
      reminders:
        kind === 'reminder' ? d.reminders.map((r) => (r.id === id ? { ...r, read: true } : r)) : d.reminders,
    }));

  const readCall = (kind: FeedKind, id: string) =>
    kind === 'reminder' ? api.markReminderRead(id) : api.markNotificationRead(id);

  const markRead = (item: FeedItem) => {
    if (item.read) return;
    applyRead(item.kind, item.id);
    void readCall(item.kind, item.id).then(refreshUnread).catch(() => {});
  };

  const markAllRead = async () => {
    const unread = feed.filter((it) => !it.read);
    if (unread.length === 0) return;
    setData((d) => ({
      mentioned: d.mentioned.map((m) => (m.read ? m : { ...m, read: true })),
      assigned: d.assigned.map((a) => (a.read ? a : { ...a, read: true })),
      reminders: d.reminders.map((r) => (r.read ? r : { ...r, read: true })),
    }));
    try {
      await Promise.all(unread.map((it) => readCall(it.kind, it.id)));
    } catch {
      /* optimistic; a background poll will reconcile */
    }
    refreshUnread();
  };

  const snooze = async (id: string, minutes: number) => {
    setSnoozeFor(null);
    try {
      await api.snoozeReminder(id, minutes);
      setData((d) => ({ ...d, reminders: d.reminders.filter((r) => r.id !== id) }));
      refreshUnread();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to snooze reminder');
    }
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

  // Click-through: mark read, refresh the bell, open the task.
  const openTask = (item: FeedItem) => {
    markRead(item);
    navigate(`/tasks/${item.taskId}`);
  };

  return (
    <div className="notif-page">
      <header className="notif-topbar">
        <h1>Notifications</h1>
        <span className="mono notif-topcount">{unreadTotal > 0 ? `${unreadTotal} unread` : 'All caught up'}</span>
        <div className="spacer" />
        {unreadTotal > 0 && (
          <button type="button" className="link-button" onClick={() => void markAllRead()}>
            Mark all read
          </button>
        )}
        <Link to="/profile" className="link-button">
          Settings
        </Link>
      </header>

      {error && <div className="alert error">{error}</div>}

      <div className="notif-controls">
        <div className="notif-pills">
          {TYPE_PILLS.map((p) => {
            const n = countByType[p.key];
            return (
              <button
                key={p.key}
                type="button"
                className={`notif-pill${typeFilter === p.key ? ' active' : ''}`}
                onClick={() => setTypeFilter(p.key)}
              >
                {p.label}
                {n > 0 && <span className="notif-pill-count">{n}</span>}
              </button>
            );
          })}
        </div>
        <div className="spacer" />
        <label className="notif-unread-toggle">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          Unread only
        </label>
      </div>

      <section className="card notif-feed">
        {loading && feed.length === 0 ? (
          <div className="loading-inline notif-feed-loading">
            <span className="mono">Loading…</span>
          </div>
        ) : groups.length === 0 ? (
          <div className="empty-state compact">
            <div className="empty-state-title">
              {unreadOnly ? "You're all caught up" : 'Nothing here yet'}
            </div>
            <div className="empty-state-text">
              {unreadOnly
                ? 'No unread notifications in this view.'
                : 'Mentions, assignments, and due reminders will collect here.'}
            </div>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.key} className="notif-day-group">
              <div className="notif-day-head">{g.label}</div>
              <ul className="notif-list">
                {g.items.map((it) => (
                  <li
                    key={it.key}
                    className={`notif-item kind-${it.kind}${it.read ? '' : ' is-unread'}`}
                    onClick={() => openTask(it)}
                  >
                    <span className="notif-item-dot" aria-label={it.read ? undefined : 'Unread'} />

                    <span className="notif-item-icon" aria-hidden="true">
                      {it.kind === 'mentioned' && it.commenter ? (
                        <Avatar user={it.commenter} px={30} decorative />
                      ) : it.kind === 'assigned' && it.actor ? (
                        <Avatar user={it.actor} px={30} decorative />
                      ) : (
                        <span className={`notif-badge ${it.kind}`}>
                          {it.kind === 'reminder' ? 'REM' : 'ASN'}
                        </span>
                      )}
                    </span>

                    <div className="notif-item-body">
                      <div className="notif-item-line">
                        <span className="notif-item-title">
                          {it.kind === 'mentioned' && it.commenter ? (
                            <>
                              <strong>{userLabel(it.commenter)}</strong> mentioned you
                            </>
                          ) : it.kind === 'assigned' ? (
                            it.actor ? (
                              <>
                                <strong>{userLabel(it.actor)}</strong>{' '}
                                {it.action === 'added' ? 'assigned you' : 'unassigned you'}
                              </>
                            ) : (
                              <strong>{it.action === 'added' ? 'Assigned to you' : 'Unassigned from you'}</strong>
                            )
                          ) : (
                            <strong>Reminder due</strong>
                          )}
                        </span>
                        <Link
                          to={`/tasks/${it.taskId}`}
                          className="notif-item-task"
                          onClick={(e) => {
                            e.stopPropagation();
                            markRead(it);
                          }}
                        >
                          <span className="mono notif-item-id">#{it.taskId}</span> {it.taskName}
                        </Link>
                      </div>

                      {it.kind === 'mentioned' && it.commentHtml && (
                        <div className="notif-item-comment">
                          <RichText html={it.commentHtml} />
                        </div>
                      )}

                      {(it.priority ||
                        (it.kind === 'reminder' && it.leadMinutes != null) ||
                        (it.kind === 'assigned' && (it.dueAt || (it.blockedByCount ?? 0) > 0))) && (
                        <div className="notif-item-meta">
                          {it.priority && <PriorityRamp priority={it.priority} label />}
                          {it.kind === 'assigned' && it.dueAt && (
                            <>
                              <span className="notif-meta-sep">·</span>
                              <span className="notif-meta-due">
                                Due <DueDate iso={it.dueAt} inline />
                              </span>
                            </>
                          )}
                          {it.kind === 'assigned' && (it.blockedByCount ?? 0) > 0 && (
                            <>
                              <span className="notif-meta-sep">·</span>
                              <span className="notif-meta-blocked">
                                blocked by {it.blockedByCount}
                              </span>
                            </>
                          )}
                          {it.kind === 'reminder' && it.leadMinutes != null && (
                            <>
                              {it.priority && <span className="notif-meta-sep">·</span>}
                              <span className="muted">{reminderLeadLabel(it.leadMinutes)}</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="notif-item-right">
                      <span className="notif-item-time">
                        <TimeStamp iso={it.at} />
                      </span>
                      <div className="notif-item-actions">
                        {!it.read && (
                          <button
                            type="button"
                            className="notif-action"
                            onClick={(e) => {
                              e.stopPropagation();
                              markRead(it);
                            }}
                          >
                            Mark read
                          </button>
                        )}
                        {it.kind === 'reminder' && (
                          <span className="notif-snooze">
                            <button
                              type="button"
                              className="notif-action"
                              aria-expanded={snoozeFor === it.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSnoozeFor(snoozeFor === it.id ? null : it.id);
                              }}
                            >
                              Snooze
                            </button>
                            {snoozeFor === it.id && (
                              <span className="notif-snooze-menu" onClick={(e) => e.stopPropagation()}>
                                {REMINDER_SNOOZE_OPTIONS.map((o) => (
                                  <button
                                    key={o.minutes}
                                    type="button"
                                    className="notif-snooze-opt"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void snooze(it.id, o.minutes);
                                    }}
                                  >
                                    {o.label}
                                  </button>
                                ))}
                              </span>
                            )}
                          </span>
                        )}
                        {it.kind === 'reminder' && (
                          <button
                            type="button"
                            className="notif-action"
                            onClick={(e) => {
                              e.stopPropagation();
                              void removeReminder(it.id);
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <p className="muted notif-foot">
        <Link to="/profile">Notification settings</Link> · Updates every 30 seconds.
      </p>
    </div>
  );
}
