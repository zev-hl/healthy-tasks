import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  type ActiveUserDto,
  type NotificationsDto,
  type TaskDashboardDto,
  type TaskRowDto,
  type TaskSearchFilters,
  type TaskStatus,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { nowContext, effectiveFilters } from '../lib/taskSearch';
import { Avatar, UnassignedAvatar, userLabel } from '../components/ui/Avatar';
import { PriorityRamp, statusColor } from '../components/ui/indicators';
import { DueDate, AgoDate } from '../components/ui/dates';

const ACTIVE_STATUSES: TaskStatus[] = ['Open', 'InProgress', 'OnHold', 'Review'];

function greetingWord(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

interface WaitingItem {
  key: string;
  taskId: number;
  time: string | null;
  unread: boolean;
  kind: 'mention' | 'assigned' | 'reminder';
  user?: { id: string; email: string; firstName?: string; lastName?: string } | null;
  text: string;
}

function buildWaiting(n: NotificationsDto): WaitingItem[] {
  const items: WaitingItem[] = [];
  for (const m of n.mentioned) {
    items.push({
      key: `m${m.id}`,
      taskId: m.taskId,
      time: m.commentAt,
      unread: !m.read,
      kind: 'mention',
      user: m.commenter,
      text: `${userLabel(m.commenter)} mentioned you on #${m.taskId}`,
    });
  }
  for (const a of n.assigned) {
    items.push({
      key: `a${a.id}`,
      taskId: a.taskId,
      time: a.startAt,
      unread: !a.read,
      kind: 'assigned',
      text: `${a.action === 'added' ? 'Assigned to you' : 'Unassigned'} · ${a.taskName}`,
    });
  }
  for (const r of n.reminders) {
    items.push({
      key: `r${r.id}`,
      taskId: r.taskId,
      time: r.startAt,
      unread: !r.read,
      kind: 'reminder',
      text: `Reminder · ${r.taskName}`,
    });
  }
  return items
    .sort((x, y) => (y.time ?? '').localeCompare(x.time ?? ''))
    .slice(0, 5);
}

function Check({ onDone, busy }: { onDone: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      className="mday-check"
      aria-label="Mark complete"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onDone();
      }}
    >
      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
        <path d="M2 6.5 L5 9 L10 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const me = user?.id ?? '';
  const isManager = user?.role !== 'Member';
  const firstName = user?.firstName?.trim() || user?.email?.split('@')[0] || 'there';

  const [dash, setDash] = useState<TaskDashboardDto | null>(null);
  const [today, setToday] = useState<TaskRowDto[]>([]);
  const [rightList, setRightList] = useState<TaskRowDto[]>([]);
  const [notif, setNotif] = useState<NotificationsDto | null>(null);
  const [reports, setReports] = useState<ActiveUserDto[]>([]);
  const [reportStats, setReportStats] = useState<{ id: string; open: number; late: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    const ctx = nowContext();
    const t = new Date();
    const tomorrow = new Date(t);
    tomorrow.setDate(t.getDate() + 1);
    const weekEnd = new Date(t);
    weekEnd.setDate(t.getDate() + 7);
    try {
      const [dashboard, todayRes, notifs, rightRes, users] = await Promise.all([
        api.getTaskDashboard({ filters: {}, ...ctx }),
        api.queryTasks({
          filters: effectiveFilters({ dueTo: dateStr(t), includeNoDue: false, statuses: ACTIVE_STATUSES }),
          sort: [{ field: 'dueAt', dir: 'asc' }],
          page: 1,
          pageSize: 50,
          ...ctx,
        }),
        api.getNotifications('all'),
        isManager
          ? api.queryTasks({
              filters: { statuses: ['Review'] },
              sort: [{ field: 'dueAt', dir: 'asc' }],
              page: 1,
              pageSize: 6,
              ...ctx,
            })
          : api.queryTasks({
              filters: effectiveFilters({
                dueFrom: dateStr(tomorrow),
                dueTo: dateStr(weekEnd),
                includeNoDue: false,
                statuses: ACTIVE_STATUSES,
              }),
              sort: [{ field: 'dueAt', dir: 'asc' }],
              page: 1,
              pageSize: 6,
              ...ctx,
            }),
        api.listActiveUsers(),
      ]);
      setDash(dashboard);
      setToday(todayRes.rows);
      setNotif(notifs);
      setRightList(rightRes.rows);

      // Manager team strip: direct reports + per-report open/overdue tallies.
      const directReports = users.filter((u) => u.supervisorId === me && u.id !== me);
      setReports(directReports);
      if (isManager && directReports.length > 0) {
        const stats = await Promise.all(
          directReports.map((r) =>
            api
              .getTaskDashboard({ filters: { assigneeIds: [r.id] }, ...ctx })
              .then((d) => ({
                id: r.id,
                open: d.total - (d.byStatus.Completed ?? 0) - (d.byStatus.Canceled ?? 0),
                late: d.overdue,
              })),
          ),
        );
        setReportStats(stats);
      } else {
        setReportStats([]);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load your day');
    } finally {
      setLoading(false);
    }
  }, [isManager, me]);

  useEffect(() => {
    void load();
  }, [load]);

  const dueTodayCount = useMemo(() => today.filter((r) => isToday(r.dueAt)).length, [today]);
  const waiting = useMemo(() => (notif ? buildWaiting(notif) : []), [notif]);
  const unreadCount = useMemo(
    () =>
      notif
        ? notif.mentioned.filter((m) => !m.read).length +
          notif.assigned.filter((a) => !a.read).length +
          notif.reminders.filter((r) => !r.read).length
        : 0,
    [notif],
  );

  const longDate = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  async function completeTask(id: number) {
    setCompleting((prev) => new Set(prev).add(id));
    try {
      await api.updateTask(id, { status: 'Completed' });
      window.setTimeout(() => {
        setToday((rows) => rows.filter((r) => r.id !== id));
        setCompleting((prev) => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
        void load();
      }, 400);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not complete the task');
      setCompleting((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  }

  const goFilter = (filters: TaskSearchFilters, viewLabel: string) =>
    navigate('/tasks', { state: { filters, viewLabel } });
  // Dashboard tiles refine the Tasks list: merge this metric onto the existing
  // filters (like the list's stat strip) rather than replacing them.
  const mergeFilter = (filters: TaskSearchFilters) =>
    navigate('/tasks', { state: { mergeFilters: filters } });

  const tiles = dash
    ? [
        { key: 'overdue', label: 'Overdue', sub: 'Past due, still open', value: dash.overdue, cls: 'tile-danger', f: { overdue: true } as TaskSearchFilters },
        { key: 'today', label: 'Due today', sub: 'On your plate today', value: dash.dueToday, cls: 'tile-warn', f: { dueFrom: dateStr(new Date()), dueTo: dateStr(new Date()), includeNoDue: false } as TaskSearchFilters },
        { key: 'wip', label: 'In progress', sub: 'Currently active', value: dash.byStatus.InProgress ?? 0, cls: 'tile-accent', f: { statuses: ['InProgress'] } as TaskSearchFilters },
        { key: 'review', label: 'In review', sub: 'Awaiting review', value: dash.byStatus.Review ?? 0, cls: 'tile-review', f: { statuses: ['Review'] } as TaskSearchFilters },
        { key: 'done', label: 'Completed today', sub: 'Nice work', value: dash.completedToday, cls: 'tile-plain', f: { completedToday: true } as TaskSearchFilters },
      ]
    : [];

  return (
    <div className="mday">
      <header className="mday-greet">
        <div>
          <h1 className="mday-hello serif">
            {greetingWord()}, {firstName}
          </h1>
          <div className="mday-sub mono">
            {longDate} · {dueTodayCount} {dueTodayCount === 1 ? 'task' : 'tasks'} due today
          </div>
        </div>
        <div className="mday-greet-actions">
          <button type="button" onClick={() => navigate('/tasks/new')}>
            New task
          </button>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}

      <div className="mday-tiles">
        {tiles.map((t) => (
          <button key={t.key} type="button" className={`mday-tile ${t.cls}`} onClick={() => mergeFilter(t.f)}>
            <span className="mday-tile-value">{t.value}</span>
            <span className="mday-tile-label">{t.label}</span>
            <span className="mday-tile-sub">{t.sub}</span>
          </button>
        ))}
      </div>

      {isManager && reports.length > 0 && (
        <section className="card mday-team">
          <div className="mday-card-head">
            <h3>My team</h3>
            <span className="mono mday-count">
              {reports.length} {reports.length === 1 ? 'person' : 'people'} ·{' '}
              {reportStats.reduce((s, x) => s + x.open, 0)} open
            </span>
            <div className="spacer" />
            <button
              type="button"
              className="link-button"
              onClick={() => goFilter({ assigneeIds: reports.map((r) => r.id) }, 'My team')}
            >
              Open in All tasks
            </button>
          </div>
          <div className="mday-team-grid">
            {reports.map((r) => {
              const s = reportStats.find((x) => x.id === r.id);
              const late = s?.late ?? 0;
              const open = s?.open ?? 0;
              return (
                <button
                  key={r.id}
                  type="button"
                  className="mday-team-card"
                  onClick={() => goFilter({ assigneeIds: [r.id] }, userLabel(r))}
                >
                  <Avatar user={r} px={28} decorative />
                  <span className="mday-team-info">
                    <span className="mday-team-name">{userLabel(r)}</span>
                    <span className="mono mday-team-open">{open} open</span>
                  </span>
                  <span className={`mday-team-pill ${late > 0 ? 'late' : 'ontime'}`}>
                    {late > 0 ? `${late} late` : 'on time'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="mday-grid">
        {/* Today list */}
        <section className="card mday-today">
          <div className="mday-card-head">
            <h3>Today</h3>
            <span className="mono mday-count">{today.length}</span>
            <div className="spacer" />
            <button
              type="button"
              className="link-button"
              onClick={() =>
                goFilter(
                  {
                    dueFrom: dateStr(new Date()),
                    dueTo: dateStr(new Date()),
                    includeNoDue: false,
                    assigneeIds: [me],
                  },
                  'Due today',
                )
              }
            >
              View all
            </button>
          </div>
          {loading && today.length === 0 ? (
            <div className="loading-inline" style={{ padding: '12px 0' }}>
              <span className="mono">Loading…</span>
            </div>
          ) : today.length === 0 ? (
            <div className="empty-state compact">
              <div className="empty-state-title">Nothing due today. Nice.</div>
              <div className="empty-state-text">Enjoy the clear runway, or get ahead on this week.</div>
            </div>
          ) : (
            <ul className="mday-list">
              {today.map((r) => {
                const overdue = !isToday(r.dueAt) && !!r.dueAt;
                const busy = completing.has(r.id);
                return (
                  <li
                    key={r.id}
                    className={`mday-row${overdue ? ' is-overdue' : ''}${busy ? ' is-completing' : ''}`}
                    onClick={() => navigate(`/tasks/${r.id}`)}
                  >
                    <Check onDone={() => completeTask(r.id)} busy={busy} />
                    <PriorityRamp priority={r.priority} />
                    <span className="mday-row-title">{r.name}</span>
                    <div className="spacer" />
                    <DueDate iso={r.dueAt} inline />
                    {r.assignee ? (
                      <Avatar user={r.assignee} px={22} decorative />
                    ) : (
                      <UnassignedAvatar px={22} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Right column */}
        <aside className="mday-side">
          <section className="card">
            <div className="mday-card-head">
              <h3>Waiting on you</h3>
            </div>
            {waiting.length === 0 ? (
              <p className="muted" style={{ fontSize: '12.5px', margin: '4px 0' }}>
                You&apos;re all caught up.
              </p>
            ) : (
              <ul className="mday-waiting">
                {waiting.map((w) => (
                  <li key={w.key} className="mday-waiting-item" onClick={() => navigate(`/tasks/${w.taskId}`)}>
                    {w.kind === 'mention' && w.user ? (
                      <Avatar user={w.user} px={24} decorative />
                    ) : (
                      <span className={`mday-notif-badge ${w.kind}`}>{w.kind === 'reminder' ? 'REM' : 'ASN'}</span>
                    )}
                    <span className="mday-waiting-text">{w.text}</span>
                    <AgoDate iso={w.time} />
                  </li>
                ))}
              </ul>
            )}
            <Link to="/notifications" className="mday-see-all">
              See all notifications{unreadCount > 0 ? ` (${unreadCount})` : ''}
            </Link>
          </section>

          <section className="card">
            <div className="mday-card-head">
              <h3>{isManager ? 'Needs my review' : 'Next up this week'}</h3>
            </div>
            {rightList.length === 0 ? (
              <p className="muted" style={{ fontSize: '12.5px', margin: '4px 0' }}>
                {isManager ? 'Nothing awaiting review.' : 'Nothing scheduled this week.'}
              </p>
            ) : (
              <ul className="mday-next">
                {rightList.map((r) => (
                  <li key={r.id} className="mday-next-item" onClick={() => navigate(`/tasks/${r.id}`)}>
                    {isManager ? (
                      <span className="mono mday-next-id">#{r.id}</span>
                    ) : (
                      <span className="mono mday-next-day">
                        {r.dueAt
                          ? new Date(r.dueAt).toLocaleDateString(undefined, { weekday: 'short' })
                          : '—'}
                      </span>
                    )}
                    <span className="mday-next-title">{r.name}</span>
                    <div className="spacer" />
                    {isManager && r.assignee ? (
                      <Avatar user={r.assignee} px={22} decorative />
                    ) : (
                      <span className="mday-status-sq" style={{ background: statusColor(r.status) }} aria-hidden="true" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
