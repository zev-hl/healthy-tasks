import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { NotificationProvider, useNotifications } from '../notifications/NotificationContext';
import { CommandPalette } from './CommandPalette';
import { Avatar, userLabel } from './ui/Avatar';
import { SAVED_VIEWS } from '../lib/views';

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

  return (
    <aside className="sidebar">
      <Link to="/" className="side-brand">
        <span className="side-brand-mark" aria-hidden="true">
          H
        </span>
        <span className="side-brand-name">Healthy Tasks</span>
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
        <div className="side-group-label">Views</div>
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

      {user?.role === 'Admin' && (
        <div className="side-group">
          <div className="side-group-label">Admin</div>
          <NavLink to="/admin/users" className={navItemClass}>
            Users
          </NavLink>
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
          <Outlet />
        </main>
      </div>
      {cmdkOpen && <CommandPalette onClose={() => setCmdkOpen(false)} />}
    </NotificationProvider>
  );
}
