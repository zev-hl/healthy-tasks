import type { FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { getToken } from '../api/client';

/**
 * The way into the email queue dashboard (Bull Board) from the profile page:
 * what is waiting, sent and failed, with Retry. Which dashboard comes from the
 * build's VITE_QUEUE_DASHBOARD_URL — the local container, or on staging and
 * production the API's own /bullmq.
 *
 * Admins only. The button sends the Admin's HL Central sign-in to the
 * dashboard's `/enter`, in a new tab, which lets an Admin in with no user name
 * and password until the browser is closed. Anyone else, or the address typed,
 * is asked for the dashboard's shared user name and password.
 * Without the setting there is no card, rather than a button that goes nowhere.
 */
export function QueueDashboardCard() {
  const { user } = useAuth();
  // Read on render, not at load, so a test can set it.
  const url = import.meta.env.VITE_QUEUE_DASHBOARD_URL?.trim();
  if (user?.role !== 'Admin' || !url) return null;

  // The newest sign-in, read at the click: it is renewed on every request.
  function putSignIn(e: FormEvent<HTMLFormElement>) {
    const field = e.currentTarget.elements.namedItem('token') as HTMLInputElement;
    field.value = getToken() ?? '';
  }

  return (
    <div className="card">
      <div className="profile-card-head">
        <h3>Queues Dashboard</h3>
      </div>
      <p className="profile-card-sub">
        Track the status of pending, completed, and failed queues.
      </p>
      {/* No "noreferrer": it would send the form's Origin as "null", and the
          dashboard lets an Admin in only from this website. */}
      <form
        method="post"
        action={`${url.replace(/\/+$/, '')}/enter`}
        target="_blank"
        rel="noopener"
        onSubmit={putSignIn}
      >
        <input type="hidden" name="token" />
        <button type="submit" className="secondary">
          Open queue dashboard <span aria-hidden="true">↗</span>
        </button>
      </form>
    </div>
  );
}
