import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

function greetingWord(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HomePage() {
  const { user } = useAuth();
  const firstName =
    user?.firstName?.trim() || user?.email?.split('@')[0] || 'there';

  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

  return (
    <div className="container">
      <div className="greeting">
        <h2>
          {greetingWord()}, {firstName}
        </h2>
        <p className="greeting-sub">
          Here&apos;s your workspace. Press{' '}
          <span className="kbd">{isMac ? '⌘K' : 'Ctrl K'}</span> to jump to any task or action.
        </p>
      </div>

      <div className="quick-grid">
        <Link to="/tasks" className="quick-card">
          <span className="quick-card-icon" aria-hidden="true">
            ⌕
          </span>
          <span className="quick-card-title">Search tasks</span>
          <span className="quick-card-sub">Filter, sort, and browse every task.</span>
        </Link>

        <Link to="/tasks/new" className="quick-card">
          <span className="quick-card-icon" aria-hidden="true">
            ＋
          </span>
          <span className="quick-card-title">New task</span>
          <span className="quick-card-sub">Create a task and assign it out.</span>
        </Link>

        <Link to="/notifications" className="quick-card">
          <span className="quick-card-icon" aria-hidden="true">
            ◔
          </span>
          <span className="quick-card-title">Notifications</span>
          <span className="quick-card-sub">Mentions, reminders, and assignments.</span>
        </Link>

        {user?.role === 'Admin' && (
          <Link to="/admin/users" className="quick-card">
            <span className="quick-card-icon" aria-hidden="true">
              ⚇
            </span>
            <span className="quick-card-title">Manage users</span>
            <span className="quick-card-sub">Add, edit, and merge accounts.</span>
          </Link>
        )}
      </div>
    </div>
  );
}
