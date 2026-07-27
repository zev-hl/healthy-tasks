import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function HomePage() {
  const { user } = useAuth();
  return (
    <div className="container">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Welcome, {user?.email}</h2>
        <p className="muted">
          Go to <Link to="/tasks">Tasks</Link> to create and edit tasks. Notifications and the full
          search screen arrive in later phases.
        </p>
        {user?.role === 'Admin' && (
          <p>
            As an admin you can <Link to="/admin/users">manage users</Link>.
          </p>
        )}
      </div>
    </div>
  );
}
