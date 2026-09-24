import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type {
  ExclusivesAlertRowDto,
  ExclusivesGroupAlertStatsDto,
  ExclusivesGroupRowDto,
  PaginatedResult,
} from '@healthy-tasks/shared';

vi.mock('../../api/client', () => ({
  api: {
    queryExclusivesAlerts: vi.fn(),
    getExclusivesGroupAlertStats: vi.fn(),
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

const { api, ApiError } = await import('../../api/client');
const { GroupAlertsPanel, dayHeading } = await import('./GroupAlertsPanel');

const queryAlerts = api.queryExclusivesAlerts as unknown as ReturnType<typeof vi.fn>;
const getStats = api.getExclusivesGroupAlertStats as unknown as ReturnType<typeof vi.fn>;

const group: ExclusivesGroupRowDto = {
  id: 5,
  name: 'Versure Exclusives',
  groupType: 'GROUP',
  listingCount: 429,
  asinPreview: [],
  alerts24h: 110,
  alertTypesOn: 6,
  latestAlertAt: null,
  createdAt: '2026-09-21T19:13:00.000Z',
  updatedAt: '2026-09-21T19:13:00.000Z',
};

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();

const alert = (over: Partial<ExclusivesAlertRowDto> = {}): ExclusivesAlertRowDto => ({
  id: 1,
  groupId: 5,
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
  createdAt: hoursAgo(1),
  ...over,
});

const pageOf = (rows: ExclusivesAlertRowDto[]): PaginatedResult<ExclusivesAlertRowDto> => ({
  rows,
  total: rows.length,
  page: 1,
  pageSize: 50,
});

const stats = (over: Partial<ExclusivesGroupAlertStatsDto> = {}): ExclusivesGroupAlertStatsDto => ({
  groupId: 5,
  windowHours: 24,
  total: 110,
  byType: { PriceChanged: 34, BuyBoxWon: 15, NumberOfSellersChanged: 43 },
  ...over,
});

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const open = (props: Partial<Parameters<typeof GroupAlertsPanel>[0]> = {}) =>
  render(
    <GroupAlertsPanel
      group={group}
      onClose={props.onClose ?? vi.fn()}
      onEdit={props.onEdit ?? vi.fn()}
      onOpenLog={props.onOpenLog ?? vi.fn()}
    />,
  );

beforeEach(() => {
  vi.useFakeTimers();
  queryAlerts.mockResolvedValue(pageOf([alert()]));
  getStats.mockResolvedValue(stats());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('dayHeading', () => {
  const now = new Date('2026-09-24T12:00:00');

  it('names today and yesterday, and dates anything older', () => {
    expect(dayHeading(new Date('2026-09-24T09:00:00').toISOString(), now)).toMatch(/^Today · /);
    expect(dayHeading(new Date('2026-09-23T23:00:00').toISOString(), now)).toMatch(/^Yesterday · /);
    expect(dayHeading(new Date('2026-09-20T09:00:00').toISOString(), now)).not.toMatch(/·/);
  });

  it('counts whole days, not 24-hour blocks', () => {
    // 01:00 today is only a few hours old but is still "today"; 23:00 yesterday
    // is two hours before it and must read as yesterday.
    const early = new Date('2026-09-24T01:00:00');
    expect(dayHeading(early.toISOString(), early)).toMatch(/^Today · /);
    expect(dayHeading(new Date('2026-09-23T23:00:00').toISOString(), early)).toMatch(
      /^Yesterday · /,
    );
  });
});

describe('GroupAlertsPanel', () => {
  it('names the group and sums up what it has been doing', async () => {
    open();
    await settle();

    expect(screen.getByRole('dialog')).toHaveTextContent('Versure Exclusives');
    expect(screen.getByText(/429 ASINs · 110 alerts in the past 24 hours/)).toBeInTheDocument();
    expect(queryAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ groupIds: [5], pageSize: 50 }),
    );
    expect(getStats).toHaveBeenCalledWith(5);
  });

  it('shows a chip per alert type with its count, and none for the quiet types', async () => {
    const { container } = open();
    await settle();

    // Scoped to the summary chips: the same labels also appear on each alert.
    const chips = within(container.querySelector('.exc-drawer-chips') as HTMLElement);
    expect(chips.getByText('Price Changed').parentElement).toHaveTextContent('· 34');
    expect(chips.getByText('Buy Box Won').parentElement).toHaveTextContent('· 15');
    expect(chips.getByText('Number of Sellers Changed').parentElement).toHaveTextContent('· 43');
    expect(chips.queryByText('Title Changed')).not.toBeInTheDocument();
  });

  it('shows each alert with its product, message and time', async () => {
    open();
    await settle();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('RASASI Hawas Ice for Men')).toBeInTheDocument();
    expect(
      within(dialog).getByText('List price changed from $33.95 to $33.90 (-0.1%).'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('B0CKM2SSK3')).toBeInTheDocument();
  });

  it('groups the alerts under the day they happened', async () => {
    queryAlerts.mockResolvedValue(
      pageOf([
        alert({ id: 1, createdAt: hoursAgo(1) }),
        alert({ id: 2, createdAt: hoursAgo(2) }),
        alert({ id: 3, createdAt: hoursAgo(30) }),
      ]),
    );
    open();
    await settle();

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toHaveLength(2);
    expect(headings[0]).toMatch(/^Today · /);
  });

  it('says so plainly when a group has no alerts yet', async () => {
    queryAlerts.mockResolvedValue(pageOf([]));
    getStats.mockResolvedValue(stats({ total: 0, byType: {} }));
    open();
    await settle();

    expect(screen.getByText(/No alerts for this group yet/)).toBeInTheDocument();
    expect(screen.getByText(/429 ASINs · 0 alerts in the past 24 hours/)).toBeInTheDocument();
  });

  it('closes on the control, on clicking away and on Escape', async () => {
    const onClose = vi.fn();
    const { container } = open({ onClose });
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(container.querySelector('.exc-panel-backdrop') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('does not close when the panel itself is clicked', async () => {
    const onClose = vi.fn();
    open({ onClose });
    await settle();

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers the way to the editor and to the full log', async () => {
    const onEdit = vi.fn();
    const onOpenLog = vi.fn();
    open({ onEdit, onOpenLog });
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Edit group' }));
    expect(onEdit).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Open in Alert Log/ }));
    expect(onOpenLog).toHaveBeenCalled();
  });

  it('says when it is only showing the most recent', async () => {
    queryAlerts.mockResolvedValue(
      pageOf(Array.from({ length: 50 }, (_, i) => alert({ id: i + 1 }))),
    );
    open();
    await settle();
    expect(screen.getByText(/Showing the 50 most recent/)).toBeInTheDocument();
  });

  it('shows the server message when it cannot load', async () => {
    queryAlerts.mockRejectedValue(new ApiError(500, 'Internal server error'));
    open();
    await settle();
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
  });
});
