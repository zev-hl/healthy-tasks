import type { SortDirection } from '@healthy-tasks/shared';

/** A single sort key shared by the Task Search and Users grids. */
export interface SortEntry<F extends string> {
  field: F;
  dir: SortDirection;
}

/**
 * Cycle a column's sort on header click: unsorted → asc → desc → removed.
 * `additive` (shift-click) keeps the other sort keys and appends/updates this
 * one; otherwise this column becomes the sole sort key.
 */
export function cycleSort<F extends string>(
  sorts: SortEntry<F>[],
  field: F,
  additive: boolean,
): SortEntry<F>[] {
  const existing = sorts.find((s) => s.field === field);
  const others = sorts.filter((s) => s.field !== field);

  let next: SortEntry<F> | null;
  if (!existing) next = { field, dir: 'asc' };
  else if (existing.dir === 'asc') next = { field, dir: 'desc' };
  else next = null; // desc → removed

  if (additive) {
    return next ? [...others, next] : others;
  }
  return next ? [next] : [];
}

/** The 0-based position and direction of `field` in the sort list, or null. */
export function sortState<F extends string>(
  sorts: SortEntry<F>[],
  field: F,
): { index: number; dir: SortDirection } | null {
  const index = sorts.findIndex((s) => s.field === field);
  const entry = index >= 0 ? sorts[index] : undefined;
  if (!entry) return null;
  return { index, dir: entry.dir };
}
