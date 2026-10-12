/**
 * Time Review roll-ups (Department Duties). One pivot engine drives all three
 * groupings — Person › Dept › Duty, Dept › Duty › Person, Dept › Person › Duty —
 * over a set of logged amounts, bucketed into columns (days of a week, or the
 * Sun–Sat weeks of a month).
 */

export type PivotDim = 'p' | 'd' | 'u';

export const PIVOT_VIEWS = {
  pdd: { label: 'Person › Dept › Duty', dims: ['p', 'd', 'u'] as PivotDim[] },
  ddp: { label: 'Dept › Duty › Person', dims: ['d', 'u', 'p'] as PivotDim[] },
  dpd: { label: 'Dept › Person › Duty', dims: ['d', 'p', 'u'] as PivotDim[] },
} as const;
export type PivotView = keyof typeof PIVOT_VIEWS;

/** One logged amount: person, department, duty, column key, minutes. */
export interface PivotRecord {
  p: string;
  d: string;
  u: string;
  c: string;
  min: number;
}

export interface PivotNode {
  dim: PivotDim | null;
  key: string;
  /** "p:id|d:id|u:id" — the node's identity and its selection filter. */
  path: string;
  children: Map<string, PivotNode>;
  cells: Record<string, number>;
  total: number;
}

export function buildPivot(records: PivotRecord[], dims: PivotDim[]): PivotNode {
  const root: PivotNode = {
    dim: null,
    key: '',
    path: '',
    children: new Map(),
    cells: {},
    total: 0,
  };
  const add = (n: PivotNode, r: PivotRecord) => {
    n.cells[r.c] = (n.cells[r.c] ?? 0) + r.min;
    n.total += r.min;
  };
  for (const r of records) {
    let n = root;
    add(n, r);
    for (const dim of dims) {
      const k = r[dim];
      let child = n.children.get(k);
      if (!child) {
        child = {
          dim,
          key: k,
          path: `${n.path ? `${n.path}|` : ''}${dim}:${k}`,
          children: new Map(),
          cells: {},
          total: 0,
        };
        n.children.set(k, child);
      }
      n = child;
      add(n, r);
    }
  }
  return root;
}

/** Paths of every node that has children (for Expand all). */
export function expandablePaths(node: PivotNode, out: string[] = []): string[] {
  for (const c of node.children.values()) {
    if (c.children.size) {
      out.push(c.path);
      expandablePaths(c, out);
    }
  }
  return out;
}

/** Parse a node path into its dimension filters. */
export function parsePath(path: string): Partial<Record<PivotDim, string>> {
  const out: Partial<Record<PivotDim, string>> = {};
  for (const part of path.split('|').filter(Boolean)) {
    const [k, v] = part.split(':') as [PivotDim, string];
    out[k] = v;
  }
  return out;
}

/** Depth-first rows, children sorted by `labelOf`; only into `expanded` nodes unless `all`. */
export function flattenPivot(
  root: PivotNode,
  labelOf: (n: PivotNode) => string,
  expanded: Set<string> | 'all',
): { node: PivotNode; level: number }[] {
  const out: { node: PivotNode; level: number }[] = [];
  const walk = (n: PivotNode, level: number) => {
    const kids = [...n.children.values()].sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
    for (const c of kids) {
      out.push({ node: c, level });
      if (c.children.size && (expanded === 'all' || expanded.has(c.path))) walk(c, level + 1);
    }
  };
  walk(root, 0);
  return out;
}

/**
 * CSV-escape one cell. Text that a spreadsheet would read as a formula (a name
 * typed as "=…", "+…", "@…" or "-…") is prefixed with an apostrophe so it stays
 * text — names and duty labels here are user-entered.
 */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (typeof v === 'string' && /^\s*[=+@-]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s.trim()))
    s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

/** Minutes as decimal hours for spreadsheets ("7.25"). */
export const hoursCell = (min: number): string => (min ? (min / 60).toFixed(2) : '0');
