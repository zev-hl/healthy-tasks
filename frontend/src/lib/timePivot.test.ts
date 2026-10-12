import { describe, expect, it } from 'vitest';
import { formatDuration, formatHM } from '@healthy-tasks/shared';
import {
  PIVOT_VIEWS,
  buildPivot,
  csvCell,
  expandablePaths,
  flattenPivot,
  parsePath,
  toCsv,
  type PivotRecord,
} from './timePivot';

// Grace: Fulfillment › Packing on two days; Tomas: Packing + Receiving.
const RECS: PivotRecord[] = [
  { p: 'grace', d: 'ful', u: 'pack', c: 'mon', min: 240 },
  { p: 'grace', d: 'ful', u: 'pack', c: 'tue', min: 60 },
  { p: 'tomas', d: 'ful', u: 'pack', c: 'mon', min: 120 },
  { p: 'tomas', d: 'ful', u: 'recv', c: 'mon', min: 180 },
  { p: 'maria', d: 'fin', u: 'ap', c: 'tue', min: 30 },
];

const labels: Record<string, string> = {
  grace: 'Grace',
  tomas: 'Tomas',
  maria: 'Maria',
  ful: 'Fulfillment',
  fin: 'Finance',
  pack: 'Packing',
  recv: 'Receiving',
  ap: 'Accounts payable',
};
const labelOf = (n: { key: string }) => labels[n.key] ?? n.key;

describe('time pivot', () => {
  it('rolls minutes up through every level, per column and in total', () => {
    const root = buildPivot(RECS, PIVOT_VIEWS.pdd.dims);
    expect(root.total).toBe(630);
    expect(root.cells).toEqual({ mon: 540, tue: 90 });
    const tomas = root.children.get('tomas')!;
    expect(tomas.total).toBe(300);
    expect(tomas.children.get('ful')!.children.get('recv')!.total).toBe(180);
    expect(tomas.children.get('ful')!.path).toBe('p:tomas|d:ful');
  });

  it('the same numbers regroup by department first', () => {
    const root = buildPivot(RECS, PIVOT_VIEWS.ddp.dims);
    const ful = root.children.get('ful')!;
    expect(ful.total).toBe(600);
    expect(ful.children.get('pack')!.children.get('grace')!.total).toBe(300);
    // Dept › Person › Duty asks who works in each department before which duties.
    const dpd = buildPivot(RECS, PIVOT_VIEWS.dpd.dims);
    expect([...dpd.children.get('ful')!.children.keys()].sort()).toEqual(['grace', 'tomas']);
  });

  it('flattens depth-first, alphabetically, only into expanded nodes', () => {
    const root = buildPivot(RECS, PIVOT_VIEWS.pdd.dims);
    const collapsed = flattenPivot(root, labelOf, new Set());
    expect(collapsed.map((r) => labelOf(r.node))).toEqual(['Grace', 'Maria', 'Tomas']);
    const one = flattenPivot(root, labelOf, new Set(['p:tomas']));
    expect(one.map((r) => `${r.level}:${labelOf(r.node)}`)).toEqual([
      '0:Grace',
      '0:Maria',
      '0:Tomas',
      '1:Fulfillment',
    ]);
    const all = flattenPivot(root, labelOf, 'all');
    expect(all).toHaveLength(3 + 3 + 4); // people + their departments + their duties
    expect(expandablePaths(root)).toContain('p:tomas|d:ful');
  });

  it('reads a selection path back into its filters', () => {
    expect(parsePath('p:tomas|d:ful|u:recv')).toEqual({ p: 'tomas', d: 'ful', u: 'recv' });
    expect(parsePath('')).toEqual({});
  });

  it('writes CSV safely', () => {
    expect(csvCell('Plain')).toBe('Plain');
    expect(csvCell('Fulfillment › Packing, "rush"')).toBe('"Fulfillment › Packing, ""rush"""');
    expect(
      toCsv([
        ['a', 1],
        ['b', 2],
      ]),
    ).toBe('a,1\nb,2');
    // A name that a spreadsheet would run as a formula stays text.
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('7.25')).toBe('7.25');
  });

  it('formats durations the way the screens show them', () => {
    expect(formatHM(0)).toBe('—');
    expect(formatHM(105)).toBe('1:45');
    expect(formatHM(600)).toBe('10:00');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(195)).toBe('3h 15m');
  });
});
