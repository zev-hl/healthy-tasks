import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import type { ExclusivesAlertRowDto, PaginatedResult } from '@healthy-tasks/shared';

vi.mock('../api/client', () => ({
  api: {
    queryExclusivesAlerts: vi.fn(),
    listExclusivesGroupOptions: vi.fn(),
    getExclusivesStatus: vi.fn(),
  },
  exportExclusivesAlertsToCsv: vi.fn(),
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

const { api, ApiError, exportExclusivesAlertsToCsv } = await import('../api/client');
const { ExclusivesLogPage } = await import('./ExclusivesLogPage');
const { renderWithRouter } = await import('../test/render');

const queryAlerts = api.queryExclusivesAlerts as unknown as ReturnType<typeof vi.fn>;
const getStatus = api.getExclusivesStatus as unknown as ReturnType<typeof vi.fn>;
const listGroups = api.listExclusivesGroupOptions as unknown as ReturnType<typeof vi.fn>;
const exportCsv = exportExclusivesAlertsToCsv as unknown as ReturnType<typeof vi.fn>;

const alert = (over: Partial<ExclusivesAlertRowDto> = {}): ExclusivesAlertRowDto => ({
  id: 1,
  groupId: 2,
  groupName: 'Versure Exclusives',
  listingId: 10,
  asin: 'B0CKM2SSK3',
  marketplace: 'USA',
  title: 'RASASI Hawas Ice for Men',
  alertType: 'PriceChanged',
  category: null,
  message: 'List price changed from $33.95 to $33.90 (-0.1%).',
  previousValue: '$33.95',
  newValue: '$33.90',
  createdAt: '2026-09-22T00:47:00.000Z',
  ...over,
});

const pageOf = (rows: ExclusivesAlertRowDto[]): PaginatedResult<ExclusivesAlertRowDto> => ({
  rows,
  total: rows.length,
  page: 1,
  pageSize: 25,
});

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  queryAlerts.mockResolvedValue(pageOf([alert()]));
  listGroups.mockResolvedValue([
    { id: 2, name: 'Versure Exclusives', groupType: 'GROUP' },
    { id: 3, name: 'Test 3', groupType: 'GROUP' },
  ]);
  exportCsv.mockResolvedValue(undefined);
  getStatus.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ExclusivesLogPage', () => {
  it('shows the real alerts, with the message and the before/after values', async () => {
    renderWithRouter(<ExclusivesLogPage />);
    await settle();

    expect(screen.getByText('B0CKM2SSK3')).toBeInTheDocument();
    expect(screen.getByText('RASASI Hawas Ice for Men')).toBeInTheDocument();
    expect(
      screen.getByText('List price changed from $33.95 to $33.90 (-0.1%).'),
    ).toBeInTheDocument();
    expect(screen.getByText('$33.95 → $33.90')).toBeInTheDocument();
    expect(screen.getByText(/1 alert · newest first/)).toBeInTheDocument();
  });

  it('opens filtered to a group when the Groups screen sends one', async () => {
    renderWithRouter(<ExclusivesLogPage />, [
      { pathname: '/exclusives/log', state: { gid: 2, gname: 'Versure Exclusives' } },
    ]);
    await settle();

    expect(queryAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ groupIds: [2] }));
    expect(screen.getByText(/Showing “Versure Exclusives” only/)).toBeInTheDocument();
  });

  it('clears the group filter from the chip', async () => {
    renderWithRouter(<ExclusivesLogPage />, [
      { pathname: '/exclusives/log', state: { gid: 2, gname: 'Versure Exclusives' } },
    ]);
    await settle();

    fireEvent.click(screen.getByText(/Showing “Versure Exclusives” only/));
    await settle();

    expect(queryAlerts).toHaveBeenLastCalledWith(
      expect.objectContaining({ groupIds: undefined, page: 1 }),
    );
    expect(screen.queryByText(/Showing “Versure Exclusives” only/)).not.toBeInTheDocument();
  });

  it('keeps only one filter open at a time, whichever order they are opened', async () => {
    renderWithRouter(<ExclusivesLogPage />);
    await settle();

    const dates = screen.getByRole('button', { name: /Filter by date/ });
    const types = screen.getByRole('button', { name: /Filter by alert type/ });
    const groups = screen.getByRole('button', { name: /Filter by group/ });

    fireEvent.click(groups);
    expect(groups).toHaveAttribute('aria-expanded', 'true');

    // Opening another closes the group one — it used to stay open.
    fireEvent.click(types);
    expect(groups).toHaveAttribute('aria-expanded', 'false');
    expect(types).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(dates);
    expect(types).toHaveAttribute('aria-expanded', 'false');
    expect(dates).toHaveAttribute('aria-expanded', 'true');

    // And clicking the open one again closes it.
    fireEvent.click(dates);
    expect(dates).toHaveAttribute('aria-expanded', 'false');
  });

  it('offers every group in a filter of its own', async () => {
    renderWithRouter(<ExclusivesLogPage />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /Filter by group/ }));
    expect(screen.getByLabelText('Versure Exclusives')).toBeInTheDocument();
    expect(screen.getByLabelText('Test 3')).toBeInTheDocument();
  });

  it('narrows the log to the groups ticked, and can hold several at once', async () => {
    renderWithRouter(<ExclusivesLogPage />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /Filter by group/ }));
    fireEvent.click(screen.getByLabelText('Versure Exclusives'));
    await settle();
    expect(queryAlerts).toHaveBeenLastCalledWith(
      expect.objectContaining({ groupIds: [2], page: 1 }),
    );

    fireEvent.click(screen.getByLabelText('Test 3'));
    await settle();
    expect(queryAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ groupIds: [2, 3] }));
    expect(screen.getByText(/Showing “Versure Exclusives”, “Test 3” only/)).toBeInTheDocument();
  });

  it('unticks a group again, and clears them all at once', async () => {
    renderWithRouter(<ExclusivesLogPage />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /Filter by group/ }));
    fireEvent.click(screen.getByLabelText('Versure Exclusives'));
    fireEvent.click(screen.getByLabelText('Test 3'));
    await settle();

    fireEvent.click(screen.getByLabelText('Test 3'));
    await settle();
    expect(queryAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ groupIds: [2] }));

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await settle();
    expect(queryAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ groupIds: undefined }));
  });

  it('shows the filter already ticked when the Groups screen chose it', async () => {
    renderWithRouter(<ExclusivesLogPage />, [
      { pathname: '/exclusives/log', state: { gid: 3, gname: 'Test 3' } },
    ]);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /Filter by group/ }));
    expect(screen.getByLabelText('Test 3')).toBeChecked();
    expect(screen.getByLabelText('Versure Exclusives')).not.toBeChecked();
  });

  it('carries on without the filter if the group list cannot be loaded', async () => {
    listGroups.mockRejectedValue(new ApiError(500, 'Internal server error'));
    renderWithRouter(<ExclusivesLogPage />);
    await settle();

    // The log itself is unaffected; no error banner for a picker.
    expect(screen.getByText('B0CKM2SSK3')).toBeInTheDocument();
    expect(screen.queryByText('Internal server error')).not.toBeInTheDocument();
  });

  it('shows a spinner on Export until the server answers', async () => {
    let finish = () => {};
    exportCsv.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    renderWithRouter(<ExclusivesLogPage />);
    await settle();

    const button = screen.getByRole('button', { name: 'Export' });
    fireEvent.click(button);
    await settle();

    const busy = screen.getByRole('button', { name: /Exporting/ });
    expect(busy).toBeDisabled();
    expect(busy.querySelector('.spinner')).not.toBeNull();

    finish();
    await settle();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('sends the chosen alert types to the server', async () => {
    renderWithRouter(<ExclusivesLogPage />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /Filter by alert type/ }));
    fireEvent.click(screen.getByTitle('Buy Box Lost'));
    await settle();

    expect(queryAlerts).toHaveBeenLastCalledWith(
      expect.objectContaining({ alertTypes: ['BuyBoxLost'], page: 1 }),
    );
  });

  it('turns the local date pickers into instants for the server', async () => {
    renderWithRouter(<ExclusivesLogPage />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /Filter by date \/ time/ }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-20T00:00' } });
    await settle();

    const sent = queryAlerts.mock.calls.at(-1)?.[0] as { from?: string };
    expect(sent.from).toMatch(/^2026-09-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('asks the server for the span a quick range names, open-ended at the top', async () => {
    renderWithRouter(<ExclusivesLogPage />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /Filter by date \/ time/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Past 7 days' }));
    await settle();

    const sent = queryAlerts.mock.calls.at(-1)?.[0] as { from?: string; to?: string };
    const days = (Date.now() - new Date(sent.from as string).getTime()) / 86_400_000;
    expect(days).toBeCloseTo(7, 1);
    expect(sent.to).toBeUndefined();
  });

  it('lets the chosen quick range be pressed again to clear it', async () => {
    renderWithRouter(<ExclusivesLogPage />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /Filter by date \/ time/ }));
    const past24 = screen.getByRole('button', { name: 'Past 24 hours' });
    fireEvent.click(past24);
    await settle();
    expect(past24).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(past24);
    await settle();
    expect(past24).toHaveAttribute('aria-pressed', 'false');
    expect(queryAlerts.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ from: undefined, to: undefined }),
    );
  });
  it('sends the search once, after the debounce', async () => {
    renderWithRouter(<ExclusivesLogPage />);
    await settle();
    expect(queryAlerts).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Search alerts'), { target: { value: 'hawas' } });
    await advance(100);
    expect(queryAlerts).toHaveBeenCalledTimes(1);

    await advance(400);
    expect(queryAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'hawas' }));
  });

  it('downloads the log with the filters that are on screen, not just this page', async () => {
    renderWithRouter(<ExclusivesLogPage />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await settle();

    expect(exportCsv).toHaveBeenCalledWith(expect.objectContaining({ page: undefined }));
  });

  it('cannot export an empty log', async () => {
    queryAlerts.mockResolvedValue(pageOf([]));
    renderWithRouter(<ExclusivesLogPage />);
    await settle();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });

  it('says whether an empty log is empty or just filtered', async () => {
    queryAlerts.mockResolvedValue(pageOf([]));
    renderWithRouter(<ExclusivesLogPage />);
    await settle();
    expect(screen.getByText('No alerts yet')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search alerts'), { target: { value: 'nothing' } });
    await advance(400);
    expect(screen.getByText('No alerts match these filters')).toBeInTheDocument();
  });

  it('still names the group of an alert whose group was deleted', async () => {
    queryAlerts.mockResolvedValue(pageOf([alert({ groupId: null, groupName: 'Deleted group' })]));
    renderWithRouter(<ExclusivesLogPage />);
    await settle();
    expect(screen.getByText('Deleted group')).toBeInTheDocument();
  });

  it('shows the server message when loading fails', async () => {
    queryAlerts.mockRejectedValue(new ApiError(500, 'Internal server error'));
    renderWithRouter(<ExclusivesLogPage />);
    await settle();
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
  });
});
