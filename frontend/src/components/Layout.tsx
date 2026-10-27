import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import type { ActiveUserDto } from '@healthy-tasks/shared';
import { useAuth } from '../auth/AuthContext';
import { NotificationProvider, useNotifications } from '../notifications/NotificationContext';
import { CommandPalette } from './CommandPalette';
import { Avatar, userLabel } from './ui/Avatar';
import { MenuIcon } from './ui/MenuIcon';
import { SAVED_VIEWS } from '../lib/views';
import { api } from '../api/client';
import { nowContext } from '../lib/taskSearch';

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

function navItemClass({ isActive }: { isActive: boolean }): string {
  return `side-nav-item${isActive ? ' active' : ''}`;
}

/**
 * The fixed 232px left rail — brand, primary nav, Views, Admin, user chip. On a
 * small screen it hides and slides in over the page while `open`.
 */
function Sidebar({
  onOpenCmdk,
  open,
  onClose,
  closeRef,
}: {
  onOpenCmdk: () => void;
  open: boolean;
  onClose: () => void;
  closeRef: React.RefObject<HTMLButtonElement>;
}) {
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
    <aside id="side-menu" className={`sidebar${open ? ' open' : ''}`}>
      <button
        ref={closeRef}
        type="button"
        className="icon-btn side-close"
        onClick={onClose}
        aria-label="Close the menu"
      >
        <MenuIcon close />
      </button>
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
        <div className="side-group-label">Time</div>
        <NavLink to="/time" className={navItemClass}>
          My Time
        </NavLink>
      </div>

      <div className="side-group">
        <div className="side-group-label">Reports</div>
        <NavLink to="/reports/due-date" className={navItemClass}>
          Due Date Performance
        </NavLink>
        {(user?.role === 'Admin' || user?.role === 'Manager') && (
          <NavLink to="/reports/time" className={navItemClass}>
            Time Review
          </NavLink>
        )}
      </div>

      <div className="side-group">
        <div className="side-group-label">Goals</div>
        {/* `end`: Team Goals lives under /goals, and must not light this up too. */}
        <NavLink to="/goals" end className={navItemClass}>
          My Goals
        </NavLink>
        {(user?.role === 'Admin' || user?.role === 'Manager') && (
          <NavLink to="/goals/team" className={navItemClass}>
            Team Goals
          </NavLink>
        )}
      </div>

      <div className="side-group">
        <div className="side-group-label">E-commerce exclusives</div>
        <NavLink to="/exclusives/groups" className={navItemClass}>
          Alert Groups
        </NavLink>
        <NavLink to="/exclusives/log" className={navItemClass}>
          Alert Log
        </NavLink>
        {user?.role === 'Admin' && (
          <NavLink to="/exclusives/alert-tasks" className={navItemClass}>
            Alert Task Setup
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
            <NavLink to="/admin/departments" className={navItemClass}>
              Departments &amp; Duties
            </NavLink>
          )}
          <NavLink to="/admin/organization" className={navItemClass}>
            Organization
          </NavLink>
          {user?.role === 'Admin' && (
            <NavLink to="/admin/users" className={navItemClass}>
              Users
            </NavLink>
          )}
          {user?.role === 'Admin' && (
            <NavLink to="/admin/settings" className={navItemClass}>
              Settings
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
  // Small screens only: the menu slid in over the page.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuCloseRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();

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

  // Going anywhere (a menu link, a Quick View, Back) puts the menu away.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.key]);

  // While it is open: focus starts on its close button, and Esc closes it.
  useEffect(() => {
    if (!menuOpen) return;
    menuCloseRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      menuBtnRef.current?.focus();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
    menuBtnRef.current?.focus();
  }

  return (
    <NotificationProvider>
      <div className="app-shell">
        <header className="mobile-bar">
          <button
            ref={menuBtnRef}
            type="button"
            className="icon-btn mobile-menu-btn"
            onClick={() => setMenuOpen(true)}
            aria-label="Open the menu"
            aria-expanded={menuOpen}
            aria-controls="side-menu"
          >
            <MenuIcon />
          </button>
          <Link to="/" className="side-brand">
            <img className="side-brand-mark" src="/hl-logo.png" alt="" aria-hidden="true" />
            <span className="side-brand-name">HL Central</span>
          </Link>
        </header>
        <Sidebar
          open={menuOpen}
          onClose={closeMenu}
          closeRef={menuCloseRef}
          onOpenCmdk={() => {
            setMenuOpen(false);
            setCmdkOpen(true);
          }}
        />
        {menuOpen && <div className="side-backdrop" onClick={closeMenu} aria-hidden="true" />}
        <main className="app-main">
          <SchedulerBanner />
          <Outlet />
        </main>
      </div>
      {cmdkOpen && <CommandPalette onClose={() => setCmdkOpen(false)} />}
    </NotificationProvider>
  );
}
