import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Role } from '@healthy-tasks/shared';

let role: Role | null = 'Admin';
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: role ? { role } : null }),
}));

const { QueueDashboardCard } = await import('./QueueDashboardCard');

const STAGING = 'https://hlcentral-api-staging.onrender.com/bullmq';

afterEach(() => {
  vi.unstubAllEnvs();
  role = 'Admin';
});

describe('QueueDashboardCard', () => {
  it('gives an Admin the way into this environment’s queue dashboard, in a new tab', () => {
    vi.stubEnv('VITE_QUEUE_DASHBOARD_URL', STAGING);
    render(<QueueDashboardCard />);

    expect(screen.getByRole('heading', { name: 'Queues Dashboard' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Open queue dashboard/ });
    expect(link).toHaveAttribute('href', STAGING);
    expect(link).toHaveAttribute('target', '_blank');
    // The new tab gets no handle back to the app.
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
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
