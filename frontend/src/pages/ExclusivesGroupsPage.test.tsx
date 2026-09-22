import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type {
  ExclusivesGroupRowDto,
  ExclusivesSummaryDto,
  PaginatedResult,
} from '@healthy-tasks/shared';

// The whole API module is mocked, hoisted above the imports that use it.
vi.mock('../api/client', () => ({
  api: {
    queryExclusivesGroups: vi.fn(),
    getExclusivesSummary: vi.fn(),
    deleteExclusivesGroup: vi.fn(),
    getExclusivesStatus: vi.fn(),
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

const { api, ApiError } = await import('../api/client');
const { ExclusivesGroupsPage } = await import('./ExclusivesGroupsPage');
const { renderWithRouter } = await import('../test/render');

const queryGroups = api.queryExclusivesGroups as unknown as ReturnType<typeof vi.fn>;
const getSummary = api.getExclusivesSummary as unknown as ReturnType<typeof vi.fn>;
const deleteGroup = api.deleteExclusivesGroup as unknown as ReturnType<typeof vi.fn>;
const getStatus = api.getExclusivesStatus as unknown as ReturnType<typeof vi.fn>;

const group = (over: Partial<ExclusivesGroupRowDto> = {}): ExclusivesGroupRowDto => ({
  id: 1,
  name: 'Versure Exclusives',
  groupType: 'GROUP',
  listingCount: 445,
  asinPreview: ['B00024D8SA', 'B0CKM2SSK3', 'B000E9CCSA'],
  alerts24h: 26,
  alertTypesOn: 0,
  latestAlertAt: '2026-09-22T00:47:00.000Z',
  createdAt: '2026-09-21T19:13:00.000Z',
  updatedAt: '2026-09-21T19:13:00.000Z',
  ...over,
});

const summary: ExclusivesSummaryDto = {
  alerts24h: 26,
  asinsMonitored: 445,
  groupCount: 1,
  individualCount: 0,
  lastSweepAt: '2026-09-22T17:59:00.000Z',
  nextSweepAt: '2026-09-22T18:29:00.000Z',
  sweepEnabled: true,
  sweepMinutes: 30,
};

const pageOf = (rows: ExclusivesGroupRowDto[]): PaginatedResult<ExclusivesGroupRowDto> => ({
  rows,
  total: rows.length,
  page: 1,
  pageSize: 25,
});

/** Let effects and resolved promises flush. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

/** Push past the 350 ms search debounce. */
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.useFakeTimers();
  queryGroups.mockResolvedValue(pageOf([group()]));
  getSummary.mockResolvedValue(summary);
  deleteGroup.mockResolvedValue(undefined);
  // StatusDot fetches this on mount; never resolving leaves it in its
  // "checking" state, which is out of the way of these assertions.
  getStatus.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ExclusivesGroupsPage', () => {
  it('shows the real groups and header numbers', async () => {
    renderWithRouter(<ExclusivesGroupsPage />);
    await settle();

    expect(screen.getByText('Versure Exclusives')).toBeInTheDocument();
    expect(screen.getByText('1 groups · 0 individual')).toBeInTheDocument();
    expect(screen.getByText('0 of 12')).toBeInTheDocument();
    // The ASIN preview shows what the server sent, plus how many it left out.
    expect(screen.getByText(/B00024D8SA · B0CKM2SSK3 · B000E9CCSA\s+\+442/)).toBeInTheDocument();
  });

  it('builds the run line from the real sweep times', async () => {
    renderWithRouter(<ExclusivesGroupsPage />);
    await settle();
    expect(screen.getByText(/last check .* · next .* · every 30 min/)).toBeInTheDocument();
  });

  it('says so when automatic checks are switched off', async () => {
    getSummary.mockResolvedValue({ ...summary, sweepEnabled: false, nextSweepAt: null });
    renderWithRouter(<ExclusivesGroupsPage />);
    await settle();
    expect(screen.getByText(/automatic checks are off/)).toBeInTheDocument();
  });

  it('offers to create one when there are no groups at all', async () => {
    queryGroups.mockResolvedValue(pageOf([]));
    renderWithRouter(<ExclusivesGroupsPage />);
    await settle();
    expect(screen.getByText('No alert groups yet')).toBeInTheDocument();
  });

  it('sends the search to the server, once, after the debounce', async () => {
    renderWithRouter(<ExclusivesGroupsPage />);
    await settle();
    expect(queryGroups).toHaveBeenCalledTimes(1);

    type('Search alert groups', 'rasasi');
    await advance(100);
    expect(queryGroups).toHaveBeenCalledTimes(1);

    await advance(400);
    expect(queryGroups).toHaveBeenCalledTimes(2);
    expect(queryGroups).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'rasasi', page: 1 }),
    );
  });

  it('words the empty state differently when a search found nothing', async () => {
    renderWithRouter(<ExclusivesGroupsPage />);
    await settle();

    queryGroups.mockResolvedValue(pageOf([]));
    type('Search alert groups', 'nothing');
    await advance(400);

    expect(screen.getByText('No groups match that search')).toBeInTheDocument();
  });

  it('sorts on the server when a column header is clicked', async () => {
    renderWithRouter(<ExclusivesGroupsPage />);
    await settle();

    const header = screen.getByText(/ASIN title \/ group name/);
    fireEvent.click(header);
    await settle();
    expect(queryGroups).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: [{ field: 'name', dir: 'asc' }] }),
    );

    // A second click reverses it rather than adding a second key.
    fireEvent.click(header);
    await settle();
    expect(queryGroups).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: [{ field: 'name', dir: 'desc' }] }),
    );
  });

  it('deletes through the API and reloads', async () => {
    renderWithRouter(<ExclusivesGroupsPage />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/445 ASINs stop being monitored/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await settle();

    expect(deleteGroup).toHaveBeenCalledWith(1);
    expect(queryGroups).toHaveBeenCalledTimes(2);
  });

  it('shows the server message when loading fails', async () => {
    queryGroups.mockRejectedValue(new ApiError(500, 'Internal server error'));
    renderWithRouter(<ExclusivesGroupsPage />);
    await settle();
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
  });
});
