import { useState } from 'react';

interface Option {
  value: string;
  label: string;
}

interface Props {
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  /**
   * Adds a search box that narrows the list to options containing what was
   * typed (any case), for long lists. Ticked options stay ticked while hidden.
   */
  searchable?: boolean;
}

/** A scrollable checkbox group for multi-value filters (used inside a popover). */
export function MultiSelect({ options, selected, onChange, searchable = false }: Props) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const selectedSet = new Set(selected);
  const allValues = options.map((o) => o.value);
  const allSelected = options.length > 0 && allValues.every((v) => selectedSet.has(v));

  function toggle(value: string) {
    const next = new Set(selectedSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    // Preserve option order.
    onChange(allValues.filter((v) => next.has(v)));
  }
  function toggleAll() {
    // When everything is selected, this clears; otherwise it selects all.
    onChange(allSelected ? [] : allValues);
  }

  if (options.length === 0) {
    return (
      <div className="multi-select">
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          None
        </span>
      </div>
    );
  }

  return (
    <div className="multi-select">
      {searchable && (
        <input
          type="search"
          className="multi-search"
          placeholder="Type to search…"
          aria-label="Search options"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {/* Select all means all of them; while searching it would be unclear. */}
      {!q && (
        <button type="button" className="multi-all" onClick={toggleAll} aria-pressed={allSelected}>
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
      )}
      <div className="multi-options">
        {q && shown.length === 0 && <span className="muted multi-empty">No matches</span>}
        {shown.map((o) => (
          <label key={o.value} className="multi-option">
            <input type="checkbox" checked={selectedSet.has(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}
