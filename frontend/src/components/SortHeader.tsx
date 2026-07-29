import type { SortDirection } from '@healthy-tasks/shared';

interface Props {
  label: string;
  /** Current sort position+direction for this column, or null if not sorted. */
  state: { index: number; dir: SortDirection } | null;
  /** Called on click; `additive` is true when Shift was held. */
  onSort: (additive: boolean) => void;
  sortable?: boolean;
  /** True when more than one sort key is active (shows the precedence number). */
  multi?: boolean;
}

/** A table header cell that toggles/cycles multi-column sort on click. */
export function SortHeader({ label, state, onSort, sortable = true, multi = false }: Props) {
  if (!sortable) return <th>{label}</th>;
  return (
    <th
      className="sortable"
      onClick={(e) => onSort(e.shiftKey)}
      title="Click to sort; Shift-click to add a secondary sort"
    >
      {label}
      {state ? (
        <span className="sort-ind">
          {state.dir === 'asc' ? ' ▲' : ' ▼'}
          {multi ? <sup>{state.index + 1}</sup> : null}
        </span>
      ) : (
        <span className="sort-hint" aria-hidden="true">
          {' '}
          ↕
        </span>
      )}
    </th>
  );
}
