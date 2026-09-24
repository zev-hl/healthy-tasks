import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import {
  EXCLUSIVES_ALERT_TYPES,
  type ExclusivesGroupDto,
  type ExclusivesLookupResponseDto,
} from '@healthy-tasks/shared';

vi.mock('../api/client', () => ({
  api: {
    getExclusivesGroup: vi.fn(),
    createExclusivesGroup: vi.fn(),
    updateExclusivesGroup: vi.fn(),
    lookupExclusivesAsins: vi.fn(),
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
const { ExclusivesEditorPage } = await import('./ExclusivesEditorPage');
const { renderWithDataRouter } = await import('../test/render');

const getGroup = api.getExclusivesGroup as unknown as ReturnType<typeof vi.fn>;
const createGroup = api.createExclusivesGroup as unknown as ReturnType<typeof vi.fn>;
const updateGroup = api.updateExclusivesGroup as unknown as ReturnType<typeof vi.fn>;
const lookup = api.lookupExclusivesAsins as unknown as ReturnType<typeof vi.fn>;

const allOff = () =>
  Object.fromEntries(
    EXCLUSIVES_ALERT_TYPES.map((t) => [t, 'off']),
  ) as ExclusivesGroupDto['settings'];

const group = (over: Partial<ExclusivesGroupDto> = {}): ExclusivesGroupDto => ({
  id: 7,
  name: 'Versure Exclusives',
  groupType: 'GROUP',
  listings: [
    {
      id: 1,
      asin: 'B00024D8SA',
      marketplace: 'USA',
      sku: 'WF-3110-A',
      title: 'A watched product',
      lastCheckedAt: '2026-09-22T17:59:00.000Z',
    },
  ],
  settings: allOff(),
  createdAt: '2026-09-21T19:13:00.000Z',
  updatedAt: '2026-09-22T19:13:00.000Z',
  ...over,
});

const found = (asin: string, over: Partial<ExclusivesLookupResponseDto> = {}) =>
  ({
    results: [
      {
        asin,
        status: 'found',
        listings: [
          {
            marketplace: 'USA',
            sku: `SKU-${asin}`,
            title: `Item ${asin}`,
            groupId: null,
            groupName: null,
          },
        ],
      },
    ],
    invalid: [],
    amazonCalls: 1,
    ...over,
  }) as ExclusivesLookupResponseDto;

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

// Both routes, because saving a new group redirects to its edit URL.
const EDITOR_PATHS = ['/exclusives/groups/new', '/exclusives/groups/:id/edit'];

const newEditor = () =>
  renderWithDataRouter(<ExclusivesEditorPage />, {
    path: EDITOR_PATHS,
    initialEntries: ['/exclusives/groups/new'],
  });

const GROUPS_ROUTE = [{ path: '/exclusives/groups', element: <p>Alert Groups screen</p> }];

const editEditor = () =>
  renderWithDataRouter(<ExclusivesEditorPage />, {
    path: EDITOR_PATHS,
    initialEntries: ['/exclusives/groups/7/edit'],
    extraRoutes: GROUPS_ROUTE,
  });

const typeAsin = (value: string) =>
  fireEvent.change(screen.getByLabelText('Add ASIN'), { target: { value } });

beforeEach(() => {
  vi.useFakeTimers();
  getGroup.mockResolvedValue(group());
  createGroup.mockResolvedValue(group({ id: 9, name: 'New group' }));
  updateGroup.mockResolvedValue(group());
  lookup.mockResolvedValue(found('B000000001'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ExclusivesEditorPage — a new group', () => {
  it('starts with every alert type off', async () => {
    newEditor();
    await settle();
    expect(screen.getByText('0 of 12 on')).toBeInTheDocument();
    expect(screen.getByText('Not yet saved')).toBeInTheDocument();
  });

  it('checks an ASIN against the seller account before adding it', async () => {
    newEditor();
    await settle();

    typeAsin('b000000001');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await settle();

    expect(lookup).toHaveBeenCalledWith({ asins: ['B000000001'], marketplaces: ['USA'] });
    expect(screen.getByText('B000000001')).toBeInTheDocument();
    expect(screen.getByText('Item B000000001')).toBeInTheDocument();
  });

  it('says so, briefly, when an ASIN is not on the seller account', async () => {
    lookup.mockResolvedValue({
      results: [{ asin: 'B000000002', status: 'not-listed', listings: [] }],
      invalid: [],
      amazonCalls: 1,
    });
    newEditor();
    await settle();

    typeAsin('B000000002');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await settle();

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'was not found on the seller account',
    );
    expect(screen.queryByText('B000000002')).not.toBeInTheDocument();
  });

  it('never reports an Amazon outage as "not on the account"', async () => {
    lookup.mockResolvedValue({
      results: [{ asin: 'B000000003', status: 'unavailable', listings: [] }],
      invalid: [],
      amazonCalls: 1,
    });
    newEditor();
    await settle();

    typeAsin('B000000003');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await settle();

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Amazon did not answer');
    expect(dialog).not.toHaveTextContent('not found on the seller account');
  });

  it('rejects a malformed code without adding a row', async () => {
    lookup.mockResolvedValue({ results: [], invalid: ['NOPE'], amazonCalls: 0 });
    newEditor();
    await settle();

    typeAsin('nope');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await settle();

    expect(screen.getByRole('alertdialog')).toHaveTextContent('An ASIN should be 10 characters long');
  });

  it('will not add the same ASIN twice, and does not ask Amazon again', async () => {
    newEditor();
    await settle();

    typeAsin('B000000001');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await settle();
    expect(lookup).toHaveBeenCalledTimes(1);

    typeAsin('B000000001');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await settle();

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Already in this group');
  });

  it('stays open until the message is acknowledged', async () => {
    lookup.mockResolvedValue({
      results: [{ asin: 'B000000002', status: 'not-listed', listings: [] }],
      invalid: [],
      amazonCalls: 1,
    });
    newEditor();
    await settle();

    typeAsin('B000000002');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await settle();

    // It does not fade, and clicking away does not dismiss it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('closes the add controls once an individual has its one product', async () => {
    newEditor();
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Individual' }));
    typeAsin('B000000001');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await settle();

    expect(screen.getByLabelText('Add ASIN')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'USA' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Canada' })).toBeDisabled();

    // Removing it opens them again.
    fireEvent.click(screen.getByRole('button', { name: 'Remove B000000001' }));
    expect(screen.getByLabelText('Add ASIN')).not.toBeDisabled();
  });

  it('creates the group, sending the whole list', async () => {
    newEditor();
    await settle();

    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'New group' } });
    typeAsin('B000000001');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();

    expect(createGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New group',
        groupType: 'GROUP',
        listings: [{ asin: 'B000000001', marketplace: 'USA' }],
        listingsMode: 'replace',
      }),
    );
  });
});

describe('ExclusivesEditorPage — an existing group', () => {
  it('loads the group, its products and its settings', async () => {
    getGroup.mockResolvedValue(group({ settings: { ...allOff(), PriceChanged: 'immediate' } }));
    editEditor();
    await settle();

    expect(getGroup).toHaveBeenCalledWith(7);
    expect(screen.getByLabelText('Group name')).toHaveValue('Versure Exclusives');
    expect(screen.getByText('B00024D8SA')).toBeInTheDocument();
    expect(screen.getByText('A watched product')).toBeInTheDocument();
    expect(screen.getByText('1 of 12 on')).toBeInTheDocument();
  });

  it('only says "Unsaved changes" once something has changed', async () => {
    editEditor();
    await settle();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Renamed' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('sends the concurrency token so a stale edit can be caught', async () => {
    editEditor();
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();

    expect(updateGroup).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ expectedUpdatedAt: '2026-09-22T19:13:00.000Z' }),
    );
  });

  it('offers Refresh instead of Save when someone else got there first', async () => {
    updateGroup.mockRejectedValue(
      new ApiError(409, 'This record was updated while you were viewing it.', {
        code: 'STALE_WRITE',
      }),
    );
    editEditor();
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent('updated while viewed here');
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('confirms the save in the middle of the screen, then returns to the list', async () => {
    editEditor();
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Saved');
    expect(dialog).toHaveTextContent('now watches 1 ASIN(s)');
    // Still on the editor until it is acknowledged.
    expect(screen.queryByText('Alert Groups screen')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await settle();
    expect(screen.getByText('Alert Groups screen')).toBeInTheDocument();
  });

  it('lets a save error step out of the way by itself', async () => {
    updateGroup.mockRejectedValue(
      new ApiError(400, 'An individual listing must have exactly one ASIN.'),
    );
    editEditor();
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();
    expect(
      screen.getByText('An individual listing must have exactly one ASIN.'),
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(
      screen.queryByText('An individual listing must have exactly one ASIN.'),
    ).not.toBeInTheDocument();
  });

  it('flags the exact rows a save refused', async () => {
    updateGroup.mockRejectedValue(
      new ApiError(400, 'Some ASINs are not listed on the seller account.', {
        listings: [{ asin: 'B00024D8SA', marketplace: 'USA', reason: 'not-listed' }],
      }),
    );
    editEditor();
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();

    expect(screen.getByText('Not on the seller account')).toBeInTheDocument();
    expect(
      screen.getByText('Some ASINs are not listed on the seller account.'),
    ).toBeInTheDocument();
  });

  it('offers to move an ASIN another group holds, keeping its history', async () => {
    updateGroup.mockRejectedValueOnce(
      new ApiError(409, 'Some ASINs are already watched by another group.', {
        code: 'LISTING_IN_ANOTHER_GROUP',
        clashes: [
          { asin: 'B00024D8SA', marketplace: 'USA', groupId: 3, groupName: 'Another group' },
        ],
      }),
    );
    editEditor();
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();
    // The row says where it is coming from, and the banner explains it.
    // There is no extra button: saving again is what performs the move.
    expect(screen.getByText(/Moving from “Another group”/)).toBeInTheDocument();
    expect(screen.getByText(/Saving moves it here/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();

    expect(updateGroup).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ moveExisting: true }),
    );
  });

  it('flags a duplicate name on the name field', async () => {
    updateGroup.mockRejectedValue(
      new ApiError(409, 'Another group already has that name.', {
        code: 'DUPLICATE_NAME',
        name: ['Another group already has that name.'],
      }),
    );
    editEditor();
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();

    expect(screen.getAllByText('Another group already has that name.').length).toBeGreaterThan(1);
  });

  it('refuses a replace while Amazon is down, and says to try again', async () => {
    updateGroup.mockRejectedValue(
      new ApiError(409, 'Amazon did not answer for some ASINs. Nothing was saved — try again.', {
        code: 'AMAZON_UNAVAILABLE',
        listings: [{ asin: 'B00024D8SA', marketplace: 'USA', reason: 'unavailable' }],
      }),
    );
    editEditor();
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settle();

    expect(screen.getByText(/Nothing was saved — try again/)).toBeInTheDocument();
    expect(screen.getByText('Amazon did not answer')).toBeInTheDocument();
  });
});
