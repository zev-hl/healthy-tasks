import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <>
      <header className="app-header">
        <h1>
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            Healthy Tasks
          </Link>
        </h1>
        <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Link to="/tasks">Tasks</Link>
          {user?.role === 'Admin' && <Link to="/admin/users">Users</Link>}
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {user?.email} · {user?.role}
          </span>
          <button className="secondary" onClick={handleLogout}>
            Log out
          </button>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
