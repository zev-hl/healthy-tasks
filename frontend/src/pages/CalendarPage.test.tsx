import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

const auth = vi.hoisted(() => ({ user: { id: 'me', role: 'Member' } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../api/client', () => {
  const fns: Record<string | symbol, unknown> = {};
  return {
    api: new Proxy(fns, { get: (t, k) => (t[k] ??= vi.fn(() => Promise.resolve([]))) }),
    ApiError: class ApiError extends Error {},
  };
});

const { api } = await import('../api/client');
const { CalendarPage } = await import('./CalendarPage');
const { renderWithDataRouter } = await import('../test/render');
const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

const today = new Date();
today.setHours(14, 0, 0, 0);
const iso = (h: number) => {
  const d = new Date(today);
  d.setHours(h);
  return d.toISOString();
};

describe('Calendar page (H3, H4)', () => {
  beforeEach(() => {
    localStorage.clear();
    fn(api.queryTasks).mockResolvedValue({ rows: [], total: 0 });
    fn(api.getCalendar).mockResolvedValue({
      events: [
        {
          id: 'e1',
          kind: 'meeting',
          title: 'Weekly sync',
          startAt: iso(10),
          endAt: iso(11),
          allDay: false,
          location: null,
          notes: null,
          isPrivate: false,
          task: null,
          createdBy: { id: 'me', email: 'me@x', firstName: 'Mo', lastName: 'Me', title: null },
          attendees: [],
          canEdit: true,
          updatedAt: iso(9),
          connect: null,
        },
      ],
      reminders: [
        {
          id: 'r1',
          taskId: 3,
          taskName: 'Call the bank',
          remindAt: iso(9),
          note: null,
          kind: 'reminder',
        },
      ],
    });
    fn(api.listGoogleEvents).mockResolvedValue({
      connected: true,
      problem: null,
      events: [
        {
          id: 'g1',
          title: 'Dentist',
          startAt: iso(16),
          endAt: iso(17),
          allDay: false,
          location: null,
          link: null,
        },
      ],
    });
  });

  it('shows events, my reminders and my Google events; each layer can be hidden', async () => {
    renderWithDataRouter(<CalendarPage />, { path: '/calendar', initialEntries: ['/calendar'] });
    await settle();
    await settle();
    expect(screen.getByTitle('Meeting: Weekly sync')).toBeInTheDocument();
    expect(screen.getByTitle('Reminder: Call the bank')).toBeInTheDocument();
    expect(screen.getByTitle(/Google Calendar: Dentist/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Google Calendar/ }));
    expect(screen.queryByTitle(/Google Calendar: Dentist/)).toBeNull();
    // Clicking an event opens it beside the calendar.
    fireEvent.click(screen.getByTitle('Meeting: Weekly sync'));
    expect(screen.getByRole('heading', { name: 'Weekly sync' })).toBeInTheDocument();
  });

  it('Team asks for the team’s tasks and events', async () => {
    renderWithDataRouter(<CalendarPage />, { path: '/calendar', initialEntries: ['/calendar'] });
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    await settle();
    expect(fn(api.getCalendar).mock.calls.at(-1)![2]).toBe('team');
    expect(
      fn(api.queryTasks).mock.calls.some(
        (c) => (c[0] as { filters: { myTeam?: boolean } }).filters.myTeam,
      ),
    ).toBe(true);
  });

  it('?new=1 with a task opens New event with the task linked', async () => {
    renderWithDataRouter(<CalendarPage />, {
      path: '/calendar',
      initialEntries: ['/calendar?new=1&task=7&taskName=Restock'],
    });
    await settle();
    expect(screen.getByRole('form', { name: 'New event' })).toBeInTheDocument();
    expect(screen.getByText('#7 Restock')).toBeInTheDocument();
  });
});
