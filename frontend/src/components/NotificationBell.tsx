import { Link } from 'react-router-dom';
import { useNotifications } from '../notifications/NotificationContext';

/** Top-right bell with an unread badge; links to the Notifications screen. */
export function NotificationBell() {
  const { unread } = useNotifications();
  const count = unread?.total ?? 0;
  return (
    <Link
      to="/notifications"
      className="bell"
      aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      title="Notifications"
    >
      <span aria-hidden="true">🔔</span>
      {count > 0 && <span className="bell-badge">{count > 99 ? '99+' : count}</span>}
    </Link>
  );
}
