import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Popover } from './Popover';
import { cx } from './ui';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** A colored dot before the label (status, priority). */
  dot?: string;
  /** A leading visual (an avatar), replacing the dot. */
  lead?: ReactNode;
  /** Small grey text after the label. */
  hint?: string;
}

/**
 * Harbor's custom dropdown (§5): never the browser's own popup. Rows are 36px,
 * the current choice is bold with a ✓, lists over 8 get a search box, and the
 * keyboard works as in a native select (Enter/Space/↓/↑/F4 open; ↑/↓, Home/End
 * move; typing jumps; Enter picks; Esc closes and returns focus).
 *
 * `variant` sets the trigger's look: `field` (a 40px input-like box), `chip`
 * (a rounded filter chip: label + value), `pill` (the value as a colored pill,
 * e.g. status in a row), or `plain` (text with a faint ▾, e.g. a table cell).
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  variant = 'field',
  label,
  placeholder = 'Choose…',
  disabled,
  className,
  renderValue,
  active,
  searchPlaceholder = 'Search…',
  hideLabel,
}: {
  value: T | null;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  variant?: 'field' | 'chip' | 'pill' | 'plain';
  /** Accessible name; for `chip` also shown before the value. */
  label: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  renderValue?: (o: SelectOption<T> | undefined) => ReactNode;
  /** chip: draw as a non-default (accent) filter. */
  active?: boolean;
  searchPlaceholder?: string;
  /** chip: show only the value (the label is still its accessible name). */
  hideLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const listId = useId();

  const current = options.find((o) => o.value === value);
  const searchable = options.length > 8;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const openMenu = useCallback(() => {
    if (disabled) return;
    setQuery('');
    setHi(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  }, [disabled, options, value]);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    if (searchable) searchRef.current?.focus();
    else listRef.current?.focus();
  }, [open, searchable]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-i="${hi}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  function pick(o: SelectOption<T> | undefined) {
    if (!o) return;
    close();
    if (o.value !== value) onChange(o.value);
  }

  function onListKey(e: React.KeyboardEvent) {
    const last = shown.length - 1;
    if (e.key === 'ArrowDown') setHi((i) => Math.min(last, i + 1));
    else if (e.key === 'ArrowUp') setHi((i) => Math.max(0, i - 1));
    else if (e.key === 'Home') setHi(0);
    else if (e.key === 'End') setHi(last);
    else if (e.key === 'Enter' || (e.key === ' ' && !searchable)) pick(shown[hi]);
    else if (!searchable && e.key.length === 1) {
      const now = Date.now();
      typed.current.text =
        (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase();
      typed.current.at = now;
      const i = shown.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) setHi(i);
      return;
    } else return;
    e.preventDefault();
  }

  const shownValue = renderValue ? renderValue(current) : (current?.label ?? placeholder);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={cx(
          'hb-select',
          `hb-select-${variant}`,
          active && 'is-active',
          !current && 'is-empty',
          className,
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={
          variant === 'chip' && !hideLabel
            ? undefined
            : `${label}: ${current?.label ?? placeholder}`
        }
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (['Enter', ' ', 'ArrowDown', 'ArrowUp', 'F4'].includes(e.key)) {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        {variant === 'chip' && !hideLabel && <span className="hb-select-label">{label}</span>}
        {variant !== 'chip' && current?.lead}
        {variant !== 'chip' && !current?.lead && current?.dot && variant !== 'pill' && (
          <span className="hb-dot" style={{ background: current.dot }} aria-hidden="true" />
        )}
        <span className="hb-select-value">{shownValue}</span>
        <ChevronDown className="hb-select-caret" size={14} strokeWidth={2.4} aria-hidden="true" />
      </button>
      <Popover
        anchorRef={btnRef}
        open={open}
        onClose={(why) => close(why === 'escape')}
        label={label}
      >
        {searchable && (
          <label className="hb-menu-search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              placeholder={searchPlaceholder}
              aria-label={`Search ${label}`}
              aria-controls={listId}
              onChange={(e) => {
                setQuery(e.target.value);
                setHi(0);
              }}
              onKeyDown={onListKey}
            />
          </label>
        )}
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          className="hb-menu"
          aria-activedescendant={shown[hi] ? `${listId}-${hi}` : undefined}
          onKeyDown={onListKey}
        >
          {shown.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              data-i={i}
              role="option"
              aria-selected={o.value === value}
              className={cx('hb-menu-row', i === hi && 'hi', o.value === value && 'current')}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
            >
              {o.lead ??
                (o.dot && (
                  <span className="hb-dot" style={{ background: o.dot }} aria-hidden="true" />
                ))}
              <span className="hb-menu-label">{o.label}</span>
              {o.hint && <span className="hb-menu-hint">{o.hint}</span>}
              {o.value === value && (
                <Check size={16} className="hb-menu-check" aria-hidden="true" />
              )}
            </li>
          ))}
          {shown.length === 0 && <li className="hb-menu-none">No matches</li>}
        </ul>
      </Popover>
    </>
  );
}
