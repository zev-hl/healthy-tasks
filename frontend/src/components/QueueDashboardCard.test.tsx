import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Role } from '@healthy-tasks/shared';

let role: Role | null = 'Admin';
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: role ? { role } : null }),
}));

const { QueueDashboardCard } = await import('./QueueDashboardCard');
const { setToken } = await import('../api/client');

const STAGING = 'https://hlcentral-api-staging.onrender.com/bullmq';

afterEach(() => {
  vi.unstubAllEnvs();
  setToken(null);
  role = 'Admin';
});

describe('QueueDashboardCard', () => {
  it('gives an Admin the way into this environment’s queue dashboard, in a new tab', () => {
    vi.stubEnv('VITE_QUEUE_DASHBOARD_URL', STAGING);
    render(<QueueDashboardCard />);

    expect(screen.getByRole('heading', { name: 'Queues Dashboard' })).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /Open queue dashboard/ });
    const form = button.closest('form')!;
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', `${STAGING}/enter`);
    expect(form).toHaveAttribute('target', '_blank');
    // The new tab gets no handle back to the app, but the dashboard still sees
    // where the form came from ("noreferrer" would hide that).
    expect(form).toHaveAttribute('rel', 'noopener');
  });

  it('sends the newest sign-in with the click, so the dashboard lets the Admin in', () => {
    vi.stubEnv('VITE_QUEUE_DASHBOARD_URL', `${STAGING}/`);
    setToken('first-token');
    render(<QueueDashboardCard />);
    const form = screen.getByRole('button', { name: /Open queue dashboard/ }).closest('form')!;
    expect(form).toHaveAttribute('action', `${STAGING}/enter`); // one slash, whatever was set

    setToken('renewed-token');
    // jsdom can't open the new tab, so the form's own submit is stopped here.
    form.addEventListener('submit', (e) => e.preventDefault());
    fireEvent.submit(form);
    expect(form.querySelector<HTMLInputElement>('input[name="token"]')!.value).toBe(
      'renewed-token',
    );
  });

  it('is not there for anyone but an Admin', () => {
    vi.stubEnv('VITE_QUEUE_DASHBOARD_URL', STAGING);
    for (const other of ['Manager', 'Member', null] as const) {
      role = other as Role | null;
      const { container, unmount } = render(<QueueDashboardCard />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('is not there without a dashboard for this environment', () => {
    vi.stubEnv('VITE_QUEUE_DASHBOARD_URL', '');
    const { container } = render(<QueueDashboardCard />);
    expect(container).toBeEmptyDOMElement();
  });
});
