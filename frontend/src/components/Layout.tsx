import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { ActiveUserDto } from '@healthy-tasks/shared';
import { useAuth } from '../auth/AuthContext';
import { NotificationProvider, useNotifications } from '../notifications/NotificationContext';
import { CommandPalette } from './CommandPalette';
import { Avatar, userLabel } from './ui/Avatar';
import { SAVED_VIEWS } from '../lib/views';
import { api } from '../api/client';
import { nowContext } from '../lib/taskSearch';

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

function navItemClass({ isActive }: { isActive: boolean }): string {
  return `side-nav-item${isActive ? ' active' : ''}`;
}

/** The fixed 232px left rail — brand, primary nav, Views, Admin, user chip. */
function Sidebar({ onOpenCmdk }: { onOpenCmdk: () => void }) {
  const { user } = useAuth();
  const { unread } = useNotifications();
  const navigate = useNavigate();
  const me = user?.id ?? '';
  const unreadTotal = unread?.total ?? 0;

  // MY TEAM group: the current user's direct reports + aggregate team tallies.
  const [reports, setReports] = useState<ActiveUserDto[]>([]);
  const [teamStats, setTeamStats] = useState<{ open: number; overdue: number } | null>(null);
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    api
      .listActiveUsers()
      .then(async (users) => {
        const r = users.filter((u) => u.supervisorId === me && u.id !== me);
        if (cancelled) return;
        setReports(r);
        if (r.length > 0) {
          const d = await api.getTaskDashboard({
            filters: { assigneeIds: r.map((x) => x.id) },
            ...nowContext(),
          });
          if (!cancelled) {
            setTeamStats({
              open: d.total - (d.byStatus.Completed ?? 0) - (d.byStatus.Canceled ?? 0),
              overdue: d.overdue,
            });
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [me]);
  const reportIds = reports.map((r) => r.id);

  return (
    <aside className="sidebar">
      <Link to="/" className="side-brand">
        <img className="side-brand-mark" src="/hl-logo.png" alt="" aria-hidden="true" />
        <span className="side-brand-name">HL Central</span>
      </Link>

      <nav className="side-nav">
        <NavLink to="/" end className={navItemClass}>
          My Day
        </NavLink>
        <NavLink to="/notifications" className={navItemClass}>
          Notifications
          {unreadTotal > 0 && (
            <span className="side-unread">{unreadTotal > 99 ? '99+' : unreadTotal}</span>
          )}
        </NavLink>
        <NavLink to="/tasks" className={navItemClass}>
          All tasks
        </NavLink>
      </nav>

      <div className="side-group">
        <div className="side-group-label">Goals</div>
        <NavLink to="/goals" className={navItemClass}>
          My Goals
        </NavLink>
        {(user?.role === 'Admin' || user?.role === 'Manager') && (
          <NavLink to="/goals/team" className={navItemClass}>
            Team Goals
          </NavLink>
        )}
      </div>

      <div className="side-group">
        <div className="side-group-label">Quick Views</div>
        {SAVED_VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            className="view-item"
            onClick={() => navigate('/tasks', { state: { filters: v.filters(me), viewLabel: v.label } })}
          >
            <span className="view-square" style={{ background: v.color }} aria-hidden="true" />
            <span className="view-label">{v.label}</span>
          </button>
        ))}
      </div>

      {reports.length > 0 && (
        <div className="side-group">
          <div className="side-group-label">My team</div>
          <button
            type="button"
            className="view-item"
            onClick={() =>
              navigate('/tasks', { state: { filters: { assigneeIds: reportIds }, viewLabel: 'Everyone reporting to me' } })
            }
          >
            <span className="view-square" style={{ background: 'var(--accent)' }} aria-hidden="true" />
            <span className="view-label">Everyone reporting to me</span>
            {teamStats && <span className="view-count">{teamStats.open}</span>}
          </button>
          <button
            type="button"
            className="view-item"
            onClick={() =>
              navigate('/tasks', {
                state: { filters: { assigneeIds: reportIds, overdue: true }, viewLabel: 'Their overdue' },
              })
            }
          >
            <span className="view-square" style={{ background: 'var(--danger)' }} aria-hidden="true" />
            <span className="view-label">Their overdue</span>
            {teamStats && <span className="view-count">{teamStats.overdue}</span>}
          </button>
        </div>
      )}

      {(user?.role === 'Admin' || user?.role === 'Manager') && (
        <div className="side-group">
          <div className="side-group-label">Manage</div>
          <NavLink to="/admin/templates" className={navItemClass}>
            Templates
          </NavLink>
          {user?.role === 'Admin' && (
            <NavLink to="/admin/users" className={navItemClass}>
              Users
            </NavLink>
          )}
        </div>
      )}

      <button type="button" className="side-cmdk" onClick={onOpenCmdk}>
        <span>Search…</span>
        <span className="kbd">{isMac ? '⌘K' : 'Ctrl K'}</span>
      </button>

      {user && (
        <Link to="/profile" className="side-user">
          <Avatar user={user} px={28} decorative />
          <span className="side-user-text">
            <span className="side-user-name">{userLabel(user)}</span>
            <span className="side-user-role">{user.role}</span>
          </span>
        </Link>
      )}
    </aside>
  );
}

/**
 * Global banner shown to EVERY user (not just admins) when the recurrence
 * background timer has gone stale — driven by the `schedulerDown` flag on the
 * unread-count heartbeat that the whole app already polls (Phase 11).
 */
function SchedulerBanner() {
  const { unread } = useNotifications();
  if (!unread?.schedulerDown) return null;
  return (
    <div className="scheduler-banner" role="alert">
      <span aria-hidden="true">⚠️</span>
      <span>
        <strong>Background timer not running.</strong> Recurring tasks won’t be created — please
        contact an administrator.
      </span>
    </div>
  );
}

export function Layout() {
  const [cmdkOpen, setCmdkOpen] = useState(false);

  // Global Cmd/Ctrl+K toggles the command palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCmdkOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <NotificationProvider>
      <div className="app-shell">
        <Sidebar onOpenCmdk={() => setCmdkOpen(true)} />
        <main className="app-main">
          <SchedulerBanner />
          <Outlet />
        </main>
      </div>
      {cmdkOpen && <CommandPalette onClose={() => setCmdkOpen(false)} />}
    </NotificationProvider>
  );
}
