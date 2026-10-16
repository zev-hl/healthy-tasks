import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Link } from 'react-router-dom';
import type { RelatedTaskDto, TimeDayDto } from '@healthy-tasks/shared';
import type { CatalogDuty } from '../../lib/duties';

vi.mock('../../api/client', () => ({
  api: {
    listTimeDays: vi.fn(),
    listTimeRelatedTasks: vi.fn(),
    saveTimeDay: vi.fn(),
    setTimeDayCompleted: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    details?: unknown;
    constructor(status: number, message: string, details?: unknown) {
      super(message);
      this.status = status;
      this.details = details;
    }
  },
}));

const { api } = await import('../../api/client');
const { DayEditorModal } = await import('./DayEditorModal');
const { renderWithDataRouter } = await import('../../test/render');

const listDays = api.listTimeDays as unknown as ReturnType<typeof vi.fn>;
const listRelated = api.listTimeRelatedTasks as unknown as ReturnType<typeof vi.fn>;
const saveDay = api.saveTimeDay as unknown as ReturnType<typeof vi.fn>;
const setCompleted = api.setTimeDayCompleted as unknown as ReturnType<typeof vi.fn>;

const D = (id: string, name: string, archived = false): CatalogDuty => ({
  id,
  name,
  departmentId: 'ful',
  departmentName: 'Fulfillment',
  color: '#b8720a',
  archived,
  description: null,
});
const DUTIES = new Map([
  ['pack', D('pack', 'Packing')],
  ['recv', D('recv', 'Receiving')],
  ['gone', D('gone', 'Label printing')],
]);

const day = (over: Partial<TimeDayDto> = {}): TimeDayDto => ({
  userId: 'me',
  date: '2026-09-21',
  entries: [],
  completed: false,
  completedAt: null,
  note: null,
  updatedAt: null,
  ...over,
});

function open(props: Partial<Parameters<typeof DayEditorModal>[0]> = {}) {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  // A data router: the editor's unsaved-changes guard uses useBlocker.
  renderWithDataRouter(
    <DayEditorModal
      date="2026-09-21"
      readOnly={false}
      person={null}
      duties={DUTIES}
      heldDutyIds={['pack', 'recv']}
      onClose={onClose}
      onChanged={onChanged}
      onNavigate={vi.fn()}
      {...props}
    />,
    { extraRoutes: [{ path: '/tasks/:id', element: <div>Task page</div> }] },
  );
  return { onClose, onChanged };
}

beforeEach(() => {
  vi.clearAllMocks();
  listRelated.mockResolvedValue([]);
});

const RELATED: RelatedTaskDto = {
  id: 42,
  name: 'Pack the Tuesday orders',
  status: 'InProgress',
  assignee: { id: 'me', email: 'me@x', firstName: 'Me', lastName: 'Test', title: null },
  duty: {
    id: 'pack',
    name: 'Packing',
    departmentId: 'ful',
    departmentName: 'Fulfillment',
    color: '#b8720a',
    archived: false,
  },
  startAt: '2026-09-21T13:00:00Z',
  dueAt: null,
};

describe('DayEditorModal', () => {
  it('logs time against held duties with the quick buttons and saves the day', async () => {
    listDays.mockResolvedValue([]);
    saveDay.mockImplementation(async (_d: string, body: { entries: unknown[] }) =>
      day({ entries: body.entries as TimeDayDto['entries'] }),
    );
    const { onChanged, onClose } = open();

    await screen.findByText('Packing');
    const save = screen.getByRole('button', { name: 'Save day' });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getAllByRole('button', { name: '+1h' })[0]!);
    fireEvent.click(screen.getAllByRole('button', { name: '+30m' })[0]!);
    expect(screen.getByText('1:30')).toBeInTheDocument();
    fireEvent.click(save);

    await waitFor(() => expect(saveDay).toHaveBeenCalledTimes(1));
    expect(saveDay.mock.calls[0]![1]).toMatchObject({
      entries: [{ dutyId: 'pack', minutes: 90 }],
      expectedUpdatedAt: null,
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('won’t let a day go over 24 hours', async () => {
    listDays.mockResolvedValue([day({ entries: [{ dutyId: 'pack', minutes: 1380 }] })]);
    open();
    await screen.findByText('23:00');
    fireEvent.click(screen.getAllByRole('button', { name: '+1h' })[1]!); // Receiving
    fireEvent.click(screen.getAllByRole('button', { name: '+1h' })[1]!);
    expect(screen.getByText('More than 24 hours')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save day' })).toBeDisabled();
  });

  it('shows a duty no longer held as clear-only', async () => {
    listDays.mockResolvedValue([day({ entries: [{ dutyId: 'gone', minutes: 45 }] })]);
    open();
    expect(await screen.findByText(/No longer assigned/)).toBeInTheDocument();
    expect(screen.getByLabelText('Label printing hours')).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: 'Clear Label printing' }));
    expect(screen.queryByText(/No longer assigned/)).not.toBeInTheDocument();
  });

  it('locks a completed day until it is reopened', async () => {
    listDays.mockResolvedValue([
      day({
        entries: [{ dutyId: 'pack', minutes: 60 }],
        completed: true,
        updatedAt: '2026-09-21T20:00:00Z',
      }),
    ]);
    setCompleted.mockResolvedValue(
      day({
        entries: [{ dutyId: 'pack', minutes: 60 }],
        completed: false,
        updatedAt: '2026-09-22T08:00:00Z',
      }),
    );
    open();

    expect(
      await screen.findByText('Completed days are locked. Reopen the day to change it.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save day' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+1h' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reopen day' }));
    await waitFor(() => expect(setCompleted).toHaveBeenCalledWith('2026-09-21', false));
    expect(await screen.findByRole('button', { name: 'Save day' })).toBeInTheDocument();
  });

  it('is read-only for a supervisor looking at someone else’s day', async () => {
    listDays.mockResolvedValue([
      day({ userId: 'grace', entries: [{ dutyId: 'recv', minutes: 120 }] }),
    ]);
    open({
      readOnly: true,
      person: { id: 'grace', email: 'g@x', firstName: 'Grace', lastName: 'Kim', title: null },
    });
    expect(await screen.findByText('Grace · read-only')).toBeInTheDocument();
    expect(listDays).toHaveBeenCalledWith('2026-09-21', '2026-09-21', 'grace');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen day' })).not.toBeInTheDocument();
  });

  it('opens a related task in a new tab, so the day being edited stays put', async () => {
    listDays.mockResolvedValue([]);
    listRelated.mockResolvedValue([RELATED]);
    open();
    const link = await screen.findByRole('link', { name: RELATED.name });
    expect(link).toHaveAttribute('href', '/tasks/42');
    expect(link).toHaveAttribute('target', '_blank');
  });

  describe('leaving the page with unsaved time', () => {
    // Stands in for the sidebar (or any in-app link outside the editor).
    function openWithSidebar() {
      renderWithDataRouter(
        <>
          <Link to="/tasks/42">Sidebar link</Link>
          <DayEditorModal
            date="2026-09-21"
            readOnly={false}
            person={null}
            duties={DUTIES}
            heldDutyIds={['pack', 'recv']}
            onClose={vi.fn()}
            onChanged={vi.fn()}
            onNavigate={vi.fn()}
          />
        </>,
        { extraRoutes: [{ path: '/tasks/:id', element: <div>Task page</div> }] },
      );
    }
    beforeEach(() => listDays.mockResolvedValue([]));

    it('asks first, and staying keeps the edits', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      openWithSidebar();
      await screen.findByLabelText('Packing hours');
      fireEvent.click(screen.getAllByRole('button', { name: '+1h' })[0]!);

      fireEvent.click(screen.getByRole('link', { name: 'Sidebar link' }));

      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      expect(screen.queryByText('Task page')).not.toBeInTheDocument();
      expect(screen.getByText('1:00')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save day' })).toBeEnabled();
      confirm.mockRestore();
    });

    it('leaves when the person confirms', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      openWithSidebar();
      await screen.findByLabelText('Packing hours');
      fireEvent.click(screen.getAllByRole('button', { name: '+1h' })[0]!);

      fireEvent.click(screen.getByRole('link', { name: 'Sidebar link' }));

      expect(await screen.findByText('Task page')).toBeInTheDocument();
      expect(confirm).toHaveBeenCalledTimes(1);
      confirm.mockRestore();
    });

    it('does not ask when nothing has changed', async () => {
      const confirm = vi.spyOn(window, 'confirm');
      openWithSidebar();
      await screen.findByLabelText('Packing hours');

      fireEvent.click(screen.getByRole('link', { name: 'Sidebar link' }));

      expect(await screen.findByText('Task page')).toBeInTheDocument();
      expect(confirm).not.toHaveBeenCalled();
      confirm.mockRestore();
    });
  });
});
