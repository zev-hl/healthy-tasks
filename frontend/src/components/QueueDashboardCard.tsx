import { useAuth } from '../auth/AuthContext';

/**
 * The way into the email queue dashboard (Bull Board) from the profile page:
 * what is waiting, sent and failed, with Retry. Which dashboard comes from the
 * build's VITE_QUEUE_DASHBOARD_URL — the local container, or on staging and
 * production the API's own /bullmq, which asks for its shared user name and
 * password.
 *
 * Admins only. That hides the way in, it does not lock it: the dashboard checks
 * its password, not the HL Central role, so the password goes to Admins alone.
 * Without the setting there is no card, rather than a button that goes nowhere.
 */
export function QueueDashboardCard() {
  const { user } = useAuth();
  // Read on render, not at load, so a test can set it.
  const url = import.meta.env.VITE_QUEUE_DASHBOARD_URL?.trim();
  if (user?.role !== 'Admin' || !url) return null;

  return (
    <div className="card">
      <div className="profile-card-head">
        <h3>Email queue</h3>
      </div>
      <p className="profile-card-sub">
        See emails waiting, sent and failed, and retry failed ones.
      </p>
      <a className="button-link secondary" href={url} target="_blank" rel="noopener noreferrer">
        Open queue dashboard <span aria-hidden="true">↗</span>
      </a>
      <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 0, marginTop: '1rem' }}>
        Opens in a new tab.
      </p>
    </div>
  );
}
