import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { TaskRowDto } from '@healthy-tasks/shared';

// Every API call answers with an empty list unless a test says otherwise.
vi.mock('../../api/client', () => {
  const fns: Record<string | symbol, unknown> = {};
  return {
    api: new Proxy(fns, {
      get: (t, k) => (t[k] ??= vi.fn(() => Promise.resolve([]))),
    }),
    ApiError: class ApiError extends Error {},
  };
});
// One user object, as the real sign-in keeps it.
const auth = { user: { id: 'me', firstName: 'Ada', lastName: 'A', role: 'Member' } };
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => auth }));
const notes = {
  unread: { total: 3, mentioned: 1, reminders: 0, assigned: 2, schedulerDown: false },
  refresh: () => {},
};
vi.mock('../../notifications/NotificationContext', () => ({ useNotifications: () => notes }));

const { api } = await import('../../api/client');
const { Dashboard, ME } = await import('./Dashboard');
const { renderWithDataRouter } = await import('../../test/render');
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const row = (id: number, name: string): TaskRowDto =>
  ({
    id,
    name,
    status: 'Open',
    priority: 'Medium',
    dueAt: '2020-01-01T17:00:00.000Z',
    assignee: null,
    tags: [],
    duty: null,
    childrenCount: 0,
  }) as unknown as TaskRowDto;

describe('Dashboard — numbers first, lists on demand', () => {
  it('shows the numbers, opens a list under its row, and closes it again', async () => {
    m(api.getTaskDashboard).mockResolvedValue({
      total: 6,
      byStatus: { Open: 4, InProgress: 2, OnHold: 0, Review: 0, Completed: 1, Canceled: 0 },
      overdue: 2,
      completedToday: 0,
      dueToday: 0,
    });
    m(api.queryTasks).mockResolvedValue({ rows: [row(9, 'Ship order 8812')], total: 1 });
    m(api.getNotifications).mockResolvedValue({ mentioned: [], reminders: [], assigned: [] });

    renderWithDataRouter(<Dashboard period="today" scope={ME} dept="__all" onScope={() => {}} />);
    await act(async () => {});

    const overdue = screen.getByRole('button', { name: /Overdue/ });
    expect(within(overdue).getByText('2')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Not done/ })).toHaveTextContent('6');
    expect(screen.getByRole('button', { name: /Mentions/ })).toHaveTextContent('1');
    // Nothing is listed until a number is clicked.
    expect(screen.queryByRole('heading', { name: 'Overdue' })).toBeNull();

    fireEvent.click(overdue);
    await act(async () => {});
    expect(overdue).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'Overdue' })).toBeTruthy();
    expect(screen.getAllByText('Ship order 8812').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Close Overdue' }));
    expect(screen.queryByRole('heading', { name: 'Overdue' })).toBeNull();
  });
});
