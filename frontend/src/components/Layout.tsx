import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { NotificationProvider } from '../notifications/NotificationContext';
import { NotificationBell } from './NotificationBell';
import { CommandPalette } from './CommandPalette';
import { UserChip } from './ui/Avatar';

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [cmdkOpen, setCmdkOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate('/login');
  }

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

  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `nav-link${isActive ? ' active' : ''}`;

  return (
    <NotificationProvider>
      <header className="app-header">
        <h1>
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="brand-mark" aria-hidden="true">
              ✓
            </span>
            Healthy Tasks
          </Link>
        </h1>
        <nav>
          <button
            type="button"
            className="cmdk-trigger"
            onClick={() => setCmdkOpen(true)}
            aria-label="Open command palette"
            title="Command palette"
          >
            <span className="cmdk-trigger-label">Search…</span>
            <span className="kbd">{isMac ? '⌘K' : 'Ctrl K'}</span>
          </button>
          <NavLink to="/tasks" className={navClass}>
            Tasks
          </NavLink>
          {user?.role === 'Admin' && (
            <NavLink to="/admin/users" className={navClass}>
              Users
            </NavLink>
          )}
          <NotificationBell />
          <Link to="/profile" className="nav-email" style={{ textDecoration: 'none' }}>
            {user && <UserChip user={user} />}
          </Link>
          <button className="secondary btn-sm" onClick={handleLogout}>
            Log out
          </button>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
      {cmdkOpen && <CommandPalette onClose={() => setCmdkOpen(false)} />}
    </NotificationProvider>
  );
}
