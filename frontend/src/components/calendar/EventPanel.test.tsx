import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import type { EventDto } from '@healthy-tasks/shared';

vi.mock('../../api/client', () => ({
  api: {
    listActiveUsers: vi.fn(async () => [
      { id: 'u-ana', email: 'ana@x', firstName: 'Ana', lastName: 'Khan' },
    ]),
    searchTasks: vi.fn(async () => []),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    cancelEvent: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const { api } = await import('../../api/client');
const { EventPanel } = await import('./EventPanel');
const { renderWithRouter } = await import('../../test/render');
const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

const ev = (over: Partial<EventDto> = {}): EventDto => ({
  id: 'e1',
  kind: 'call',
  title: 'Supplier call',
  startAt: '2026-11-20T15:00:00.000Z',
  endAt: '2026-11-20T15:30:00.000Z',
  allDay: false,
  location: 'https://meet.example.com/x',
  notes: 'Ask about lead times',
  isPrivate: false,
  task: { id: 4, name: 'Restock' },
  createdBy: { id: 'u-mo', email: 'mo@x', firstName: 'Mo', lastName: 'Me', title: null },
  attendees: [],
  canEdit: false,
  updatedAt: '2026-11-19T10:00:00.000Z',
  connect: null,
  ...over,
});

describe('EventPanel (H4a)', () => {
  it('makes a new event on the day it was opened from, with the linked task', async () => {
    fn(api.createEvent).mockImplementation(async (b) => ev({ ...b, id: 'new', canEdit: true }));
    const onSaved = vi.fn();
    renderWithRouter(
      <EventPanel
        event={null}
        seed={{ day: new Date(2026, 10, 24), task: { id: 9, name: 'Launch' } }}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    await settle();
    const add = screen.getByRole('button', { name: 'Add event' });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Kickoff' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    await act(async () => fireEvent.click(add));
    await settle();
    const body = fn(api.createEvent).mock.calls[0]![0];
    expect(body).toMatchObject({ kind: 'call', title: 'Kickoff', taskId: 9, allDay: false });
    expect(new Date(body.startAt).getDate()).toBe(24);
    expect(new Date(body.startAt).getHours()).toBe(9);
    expect(onSaved).toHaveBeenCalled();
  });

  it('all day keeps each day at midnight UTC', async () => {
    fn(api.createEvent)
      .mockClear()
      .mockImplementation(async (b) => ev(b));
    renderWithRouter(
      <EventPanel
        event={null}
        seed={{ day: new Date(2026, 10, 24) }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    await settle();
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Offsite' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'All day' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add event' })));
    expect(fn(api.createEvent).mock.calls[0]![0]).toMatchObject({
      allDay: true,
      startAt: '2026-11-24T00:00:00.000Z',
      endAt: '2026-11-24T00:00:00.000Z',
    });
  });

  it('shows someone else’s event read-only, its link and task', async () => {
    renderWithRouter(<EventPanel event={ev()} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Supplier call' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://meet.example.com/x' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#4 Restock' })).toHaveAttribute('href', '/tasks/4');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.getByText(/Only Mo Me or an Admin can change it/)).toBeInTheDocument();
  });
});
