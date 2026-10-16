import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

export interface SearchSelectOption {
  value: string;
  label: string;
}

interface Props {
  options: SearchSelectOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  /** What is being chosen, e.g. "Alert Type": the button's and the list's name. */
  label: string;
  /** Shown when nothing is chosen, and as the first option, which clears the value. */
  noneLabel?: string;
  disabled?: boolean;
}

type Shown = { value: string | null; label: string };

/**
 * A single-choice dropdown with a search box at the top: typing narrows the
 * list to the options containing what was typed, in any case. Arrow keys move,
 * Enter picks, Escape closes.
 *
 * The list opens in place, pushing what is below it down, rather than floating:
 * inside a scrolling dialog a floating list would be cut off.
 */
export function SearchSelect({
  options,
  value,
  onChange,
  label,
  noneLabel = '— None —',
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  // While searching, only matches; otherwise the clearing option first.
  const shown = useMemo<Shown[]>(() => {
    const q = query.trim().toLowerCase();
    if (q) return options.filter((o) => o.label.toLowerCase().includes(q));
    return [{ value: null, label: noneLabel }, ...options];
  }, [options, query, noneLabel]);

  function openList() {
    setQuery('');
    // Start on the current choice (index 0 is the clearing option).
    setActive(Math.max(0, options.findIndex((o) => o.value === value) + 1));
    setOpen(true);
  }

  function close(focusTrigger: boolean) {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }

  function choose(next: string | null) {
    close(true);
    if (next !== value) onChange(next);
  }

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Clicking anywhere else closes the list.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the highlighted option in view while moving with the keys.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = shown[active];
      if (pick) choose(pick.value);
    } else if (e.key === 'Escape') {
      // Close the list only, not a dialog it sits in.
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  }

  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <div className={`search-select${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="search-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selected?.label ?? noneLabel}`}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
      >
        <span className={selected ? undefined : 'muted'}>{selected?.label ?? noneLabel}</span>
        <span className="prop-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="search-select-panel">
          <input
            ref={inputRef}
            className="search-select-input"
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={shown.length > 0 ? optionId(active) : undefined}
            aria-label={`Search ${label}`}
            placeholder="Type to search…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            className="search-select-list"
          >
            {shown.length === 0 ? (
              <li className="search-select-empty">No matches</li>
            ) : (
              shown.map((o, i) => (
                <li
                  key={o.value ?? '__none'}
                  id={optionId(i)}
                  data-index={i}
                  role="option"
                  aria-selected={o.value === value}
                  className={`search-select-option${i === active ? ' is-active' : ''}${o.value === null ? ' is-none' : ''}`}
                  // Keep focus in the search box; the click picks.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o.value)}
                >
                  {o.label}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
