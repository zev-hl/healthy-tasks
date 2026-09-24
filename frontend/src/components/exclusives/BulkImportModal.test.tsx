import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ExclusivesLookupResultDto, ExclusivesMarketplace } from '@healthy-tasks/shared';

vi.mock('../../api/client', () => ({
  api: { lookupExclusivesAsins: vi.fn() },
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
const { BulkImportModal, buildPreview, parseSheet } = await import('./BulkImportModal');
type Answer = import('./BulkImportModal').Answer;

const lookup = api.lookupExclusivesAsins as unknown as ReturnType<typeof vi.fn>;

const result = (
  asin: string,
  over: Partial<ExclusivesLookupResultDto> = {},
): ExclusivesLookupResultDto => ({
  asin,
  status: 'found',
  listings: [
    {
      marketplace: 'USA',
      sku: `SKU-${asin}`,
      title: `Item ${asin}`,
      groupId: null,
      groupName: null,
      addedAt: null,
      addedBy: null,
    },
  ],
  ...over,
});

const us = (asin: string) => ({ asin, marketplace: 'USA' as ExclusivesMarketplace });
const answers = (entries: [string, Answer][]) => new Map<string, Answer>(entries);
const found = (over: Partial<Extract<Answer, { kind: 'found' }>> = {}): Answer => ({
  kind: 'found',
  title: 'A product',
  ownerId: null,
  ownerName: null,
  ...over,
});

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('parseSheet', () => {
  it('reads the two columns: ASIN, then marketplace', () => {
    const { rows } = parseSheet('B000000001,US\nB000000002,CA');
    expect(rows).toEqual([
      { asin: 'B000000001', marketplace: 'USA' },
      { asin: 'B000000002', marketplace: 'Canada' },
    ]);
  });

  it('copes with quotes, semicolons, tabs, spacing and lower case', () => {
    const { rows } = parseSheet('"b000000001" ; us\nB000000002\tca\n');
    expect(rows).toEqual([
      { asin: 'B000000001', marketplace: 'USA' },
      { asin: 'B000000002', marketplace: 'Canada' },
    ]);
  });

  it('skips blank lines and a heading row, if one slipped in', () => {
    const { rows, bad } = parseSheet('ASIN,Marketplace\n\nB000000001,US\n');
    expect(rows).toEqual([{ asin: 'B000000001', marketplace: 'USA' }]);
    expect(bad).toEqual([]);
  });

  it('drops a repeated ASIN + marketplace pair, but keeps the other country', () => {
    const { rows } = parseSheet('B000000001,US\nB000000001,US\nB000000001,CA');
    expect(rows).toHaveLength(2);
  });

  it('reports a line it cannot read rather than dropping it silently', () => {
    const { rows, bad } = parseSheet('NOTANASIN,US\nB000000001,MX\nB000000002');
    expect(rows).toEqual([]);
    expect(bad).toEqual([
      { line: 'NOTANASIN,US', why: 'Not a valid ASIN' },
      { line: 'B000000001,MX', why: 'Unknown marketplace “MX”' },
      { line: 'B000000002', why: 'No marketplace' },
    ]);
  });
});

describe('buildPreview', () => {
  it('splits the sheet into new, kept and dropped', () => {
    const asked = [us('B000000001'), us('B000000002')];
    const preview = buildPreview(
      asked,
      answers([
        ['USA:B000000001', found()],
        ['USA:B000000002', found()],
      ]),
      [],
      [us('B000000002'), us('B000000003')],
      7,
    );
    expect(preview.added.map((r) => r.asin)).toEqual(['B000000001']);
    expect(preview.kept.map((r) => r.asin)).toEqual(['B000000002']);
    expect(preview.dropped.map((r) => r.asin)).toEqual(['B000000003']);
  });

  it('puts codes that are not the seller’s in the fourth column', () => {
    const preview = buildPreview(
      [us('B000000004')],
      answers([['USA:B000000004', { kind: 'not-listed' }]]),
      [{ line: 'NOPE,US', why: 'Not a valid ASIN' }],
      [],
      7,
    );
    expect(preview.notYours).toEqual([
      { asin: 'NOPE,US', reason: 'Not a valid ASIN' },
      { asin: 'B000000004', marketplace: 'USA', reason: 'Not on the seller account' },
    ]);
  });

  it('keeps "Amazon did not answer" separate from "not yours"', () => {
    const preview = buildPreview(
      [us('B000000005')],
      answers([['USA:B000000005', { kind: 'unavailable' }]]),
      [],
      [],
      7,
    );
    expect(preview.unavailable).toEqual(['B000000005']);
    expect(preview.notYours).toEqual([]);
  });

  it('marks a code another group holds as moving', () => {
    const preview = buildPreview(
      [us('B000000007')],
      answers([['USA:B000000007', found({ ownerId: 3, ownerName: 'Another group' })]]),
      [],
      [],
      7,
    );
    expect(preview.added[0]?.ownerName).toBe('Another group');
  });

  it('does not call a group’s own products a move', () => {
    const preview = buildPreview(
      [us('B000000008')],
      answers([['USA:B000000008', found({ ownerId: 7, ownerName: 'This group' })]]),
      [],
      [us('B000000008')],
      7,
    );
    expect(preview.kept[0]?.ownerName).toBeNull();
  });

  it('treats the two countries of one product separately', () => {
    const asked = [us('B000000009'), { asin: 'B000000009', marketplace: 'Canada' as const }];
    const preview = buildPreview(
      asked,
      answers([
        ['USA:B000000009', found()],
        ['Canada:B000000009', { kind: 'not-listed' }],
      ]),
      [],
      [],
      7,
    );
    expect(preview.added).toHaveLength(1);
    expect(preview.notYours[0]?.marketplace).toBe('Canada');
  });
});

describe('BulkImportModal', () => {
  const onImport = vi.fn();
  const onCancel = vi.fn();

  const open = (current: { asin: string; marketplace: ExclusivesMarketplace }[] = []) =>
    render(
      <BulkImportModal groupId={7} current={current} onCancel={onCancel} onImport={onImport} />,
    );

  const choose = async (text: string, name = 'asins.csv') => {
    const file = new File([text], name, { type: 'text/csv' });
    // jsdom reads a Blob through a timer, which fake timers would stall.
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
    fireEvent.change(screen.getByLabelText('Choose a .csv file'), { target: { files: [file] } });
    await settle();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    onImport.mockClear();
    onCancel.mockClear();
    lookup.mockResolvedValue({ results: [result('B000000001')], invalid: [], amazonCalls: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('offers only a file, with no box to paste into', () => {
    open();
    expect(screen.getByLabelText('Choose a .csv file')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('refuses anything that is not a .csv', async () => {
    open();
    await choose('B000000001,US', 'asins.txt');
    expect(screen.getByText(/upload a .csv file/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check ASINs' })).toBeDisabled();
  });

  it('shows the four columns of the design after checking', async () => {
    open([us('B000000009')]);
    lookup.mockResolvedValue({
      results: [result('B000000001'), result('B000000009')],
      invalid: [],
      amazonCalls: 1,
    });
    await choose('B000000001,US\nB000000009,US');

    fireEvent.click(screen.getByRole('button', { name: 'Check ASINs' }));
    await settle();

    expect(screen.getByText('New ASINs for this group')).toBeInTheDocument();
    expect(screen.getByText('Existing ASINs for this group')).toBeInTheDocument();
    expect(screen.getByText('ASINs that will be dropped from this group')).toBeInTheDocument();
    expect(screen.getByText('Not listed on Amazon as yours')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This will replace the group list only with the imported ASINs listed as yours on Amazon.',
      ),
    ).toBeInTheDocument();
  });

  it('lists what will be dropped, so nothing goes quietly', async () => {
    open([us('B0GOINGXXX')]);
    await choose('B000000001,US');
    fireEvent.click(screen.getByRole('button', { name: 'Check ASINs' }));
    await settle();

    const dropped = screen.getByText('ASINs that will be dropped from this group').closest('div')
      ?.parentElement as HTMLElement;
    expect(within(dropped).getByText('B0GOINGXXX')).toBeInTheDocument();
  });

  it('asks each marketplace separately, in batches', async () => {
    open();
    const rows = [
      ...Array.from({ length: 120 }, (_, i) => `B${String(i).padStart(9, '0')},US`),
      'B000000999,CA',
    ];
    await choose(rows.join('\n'));

    fireEvent.click(screen.getByRole('button', { name: 'Check ASINs' }));
    await settle();

    // 120 US codes -> two batches, plus one Canadian batch.
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(lookup.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ marketplaces: ['USA'] }));
    expect(lookup.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({ marketplaces: ['Canada'], asins: ['B000000999'] }),
    );
  });

  it('hands the kept and added rows back on Import', async () => {
    open([us('B000000009')]);
    lookup.mockResolvedValue({
      results: [result('B000000001'), result('B000000009')],
      invalid: [],
      amazonCalls: 1,
    });
    await choose('B000000001,US\nB000000009,US');
    fireEvent.click(screen.getByRole('button', { name: 'Check ASINs' }));
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ asin: 'B000000001' }),
        expect.objectContaining({ asin: 'B000000009' }),
      ]),
    );
  });

  it('blocks the import when Amazon did not answer', async () => {
    open([us('B0SAFEXXXX')]);
    lookup.mockResolvedValue({
      results: [result('B000000001', { status: 'unavailable', listings: [] })],
      invalid: [],
      amazonCalls: 1,
    });
    await choose('B000000001,US');
    fireEvent.click(screen.getByRole('button', { name: 'Check ASINs' }));
    await settle();

    expect(screen.getByText(/would drop products for no reason/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('cancels without importing', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });
});
