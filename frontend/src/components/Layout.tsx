import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { NotificationProvider } from '../notifications/NotificationContext';
import { NotificationBell } from './NotificationBell';

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <NotificationProvider>
      <header className="app-header">
        <h1>
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            Healthy Tasks
          </Link>
        </h1>
        <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Link to="/tasks">Tasks</Link>
          {user?.role === 'Admin' && <Link to="/admin/users">Users</Link>}
          <NotificationBell />
          <Link to="/profile" className="muted" style={{ fontSize: '0.85rem' }}>
            {user?.email} · {user?.role}
          </Link>
          <button className="secondary" onClick={handleLogout}>
            Log out
          </button>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </NotificationProvider>
  );
}
