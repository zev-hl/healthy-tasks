import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import {
  EXCLUSIVES_ALERT_TYPES,
  type ExclusivesGroupRowDto,
  type ExclusivesSummaryDto,
  type PaginatedResult,
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
  isActive: true,
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
  inactiveCount: 0,
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
    expect(screen.getByText(`0 of ${EXCLUSIVES_ALERT_TYPES.length}`)).toBeInTheDocument();
    // The ASIN preview shows what the server sent, plus how many it left out.
    expect(screen.getByText(/B00024D8SA · B0CKM2SSK3 · B000E9CCSA\s+\+442/)).toBeInTheDocument();
  });

  it('builds the run line from the real sweep times', async () => {
    renderWithRouter(<ExclusivesGroupsPage />);
    await settle();
    expect(screen.getByText(/last check .* · next .* · every 30 min/)).toBeInTheDocument();
  });

  it('names no next check when every group is switched off', async () => {
    getSummary.mockResolvedValue({ ...summary, inactiveCount: 1, asinsMonitored: 0 });
    renderWithRouter(<ExclusivesGroupsPage />);
    await settle();
    expect(screen.getByText(/no active group to check/)).toBeInTheDocument();
    expect(screen.queryByText(/· next /)).not.toBeInTheDocument();
  });

  it('names no next check when there are no groups at all', async () => {
    getSummary.mockResolvedValue({
      ...summary,
      groupCount: 0,
      individualCount: 0,
      inactiveCount: 0,
      asinsMonitored: 0,
    });
    renderWithRouter(<ExclusivesGroupsPage />);
    await settle();
    expect(screen.getByText(/no active group to check/)).toBeInTheDocument();
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

  it('leaves the stat line alone when every group is active', async () => {
    renderWithRouter(<ExclusivesGroupsPage />);
    await settle();
    expect(screen.getByText('1 groups · 0 individual')).toBeInTheDocument();
  });

  it('counts the kinds only, leaving the inactive tally out', async () => {
    getSummary.mockResolvedValue({
      ...summary,
      groupCount: 3,
      individualCount: 1,
      inactiveCount: 2,
    });
    renderWithRouter(<ExclusivesGroupsPage />);
    await settle();
    expect(screen.getByText('3 groups · 1 individual')).toBeInTheDocument();
    expect(screen.queryByText(/inactive/)).not.toBeInTheDocument();
  });
  it('marks an inactive group and leaves an active one plain', async () => {
    queryGroups.mockResolvedValue(
      pageOf([
        group({ id: 1, name: 'Still watching', isActive: true }),
        group({ id: 2, name: 'Switched off', isActive: false }),
      ]),
    );
    renderWithRouter(<ExclusivesGroupsPage />);
    await settle();

    const off = screen.getByRole('button', { name: 'Switched off' }).closest('tr');
    const on = screen.getByRole('button', { name: 'Still watching' }).closest('tr');
    expect(off).toHaveClass('exc-row-inactive');
    expect(on).not.toHaveClass('exc-row-inactive');

    // One mark on the page, and it belongs to the switched-off row.
    const marks = screen.getAllByRole('img', { name: 'Inactive — not being checked' });
    expect(marks).toHaveLength(1);
    expect(off).toContainElement(marks[0] as HTMLElement);
  });
  it('deletes through the API and reloads', async () => {
    renderWithRouter(<ExclusivesGroupsPage />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/445 ASINs stop being monitored/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await settle();

    expect(deleteGroup).toHaveBeenCalledWith(1);
    expect(queryGroups).toHaveBeenCalledTimes(2);
  });

  it('confirms the delete by name once it has gone through', async () => {
    renderWithRouter(<ExclusivesGroupsPage />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await settle();

    const done = screen.getByRole('alertdialog');
    expect(within(done).getByText('Group deleted successfully')).toBeInTheDocument();
    expect(within(done).getByText(/is no longer monitored/)).toBeInTheDocument();

    // It stays until OK is pressed.
    fireEvent.click(within(done).getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows the server message when loading fails', async () => {
    queryGroups.mockRejectedValue(new ApiError(500, 'Internal server error'));
    renderWithRouter(<ExclusivesGroupsPage />);
    await settle();
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
  });
});

describe('ExclusivesGroupsPage — keeping its place', () => {
  /** The address the list is on, shown so the tests can read it. */
  function Address() {
    const { pathname, search } = useLocation();
    return <output aria-label="address">{pathname + search}</output>;
  }

  /** Stands in for the editor: shows what the list handed it. */
  function Editor() {
    return <p>editor opened with {JSON.stringify(useLocation().state)}</p>;
  }

  const renderList = (address = '/exclusives/groups') =>
    renderWithRouter(
      <>
        <Routes>
          <Route path="/exclusives/groups" element={<ExclusivesGroupsPage />} />
          <Route path="/exclusives/groups/new" element={<Editor />} />
          <Route path="/exclusives/groups/:id/edit" element={<Editor />} />
        </Routes>
        <Address />
        {/* Like the sidebar's Alert Groups link. */}
        <Link to="/exclusives/groups">Sidebar link</Link>
      </>,
      [address],
    );

  const address = () => screen.getByLabelText('address').textContent;

  /** Sixty groups: three pages of 25. */
  const sixty = () =>
    queryGroups.mockImplementation(async (q: { page: number; pageSize: number }) => ({
      rows: [group({ id: q.page })],
      total: 60,
      page: q.page,
      pageSize: q.pageSize,
    }));

  it('opens on the page, rows per page, search and sort in its address', async () => {
    renderList('/exclusives/groups?page=2&size=50&q=rasasi&sort=name.asc');
    await settle();

    expect(queryGroups).toHaveBeenCalledTimes(1);
    expect(queryGroups).toHaveBeenLastCalledWith({
      text: 'rasasi',
      sort: [{ field: 'name', dir: 'asc' }],
      page: 2,
      pageSize: 50,
    });
    expect(screen.getByLabelText('Search alert groups')).toHaveValue('rasasi');
  });

  it('starts from the first page when the address cannot be read', async () => {
    renderList('/exclusives/groups?page=abc&size=7&sort=bogus.up');
    await settle();
    expect(queryGroups).toHaveBeenLastCalledWith({
      text: undefined,
      sort: undefined,
      page: 1,
      pageSize: 25,
    });
  });

  it('puts the page in its address and hands it to the editor', async () => {
    sixty();
    renderList();
    await settle();

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await settle();
    expect(address()).toBe('/exclusives/groups?page=2');
    expect(queryGroups).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('editor opened with {"listSearch":"?page=2"}')).toBeInTheDocument();
  });

  it('hands the place to the editor from New group too', async () => {
    sixty();
    renderList('/exclusives/groups?page=3');
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'New group' }));
    expect(screen.getByText('editor opened with {"listSearch":"?page=3"}')).toBeInTheDocument();
  });

  it('keeps rows per page, search and sort in its address, each back on page 1', async () => {
    sixty();
    renderList('/exclusives/groups?page=2');
    await settle();

    fireEvent.click(screen.getByRole('button', { name: '50' }));
    await settle();
    expect(address()).toBe('/exclusives/groups?size=50');

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await settle();
    type('Search alert groups', 'rasasi');
    await advance(400);
    expect(address()).toBe('/exclusives/groups?size=50&q=rasasi');

    fireEvent.click(screen.getByText(/ASIN title \/ group name/));
    await settle();
    expect(address()).toBe('/exclusives/groups?size=50&q=rasasi&sort=name.asc');
    expect(queryGroups).toHaveBeenLastCalledWith({
      text: 'rasasi',
      sort: [{ field: 'name', dir: 'asc' }],
      page: 1,
      pageSize: 50,
    });
  });

  it('shows the last page when its page is past the end', async () => {
    queryGroups.mockImplementation(async (q: { page: number; pageSize: number }) => ({
      rows: q.page > 2 ? [] : [group({ id: q.page })],
      total: 30,
      page: q.page,
      pageSize: q.pageSize,
    }));
    renderList('/exclusives/groups?page=5');
    await settle();
    await settle();

    expect(address()).toBe('/exclusives/groups?page=2');
    expect(queryGroups).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(screen.queryByText('No alert groups yet')).not.toBeInTheDocument();
  });

  it('empties the search box when the address is cleared', async () => {
    renderList('/exclusives/groups?q=rasasi');
    await settle();
    expect(screen.getByLabelText('Search alert groups')).toHaveValue('rasasi');

    fireEvent.click(screen.getByText('Sidebar link'));
    await settle();
    await advance(400);

    expect(screen.getByLabelText('Search alert groups')).toHaveValue('');
    expect(address()).toBe('/exclusives/groups');
    expect(queryGroups).toHaveBeenLastCalledWith(expect.objectContaining({ text: undefined }));
  });
});
