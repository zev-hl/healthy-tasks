import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Popover } from './Popover';
import { CalendarPopover } from './DatePicker';
import { cx } from './ui';

/**
 * The brief's rule, app-wide: never the browser's own dropdown or date picker
 * (§5). Screens built before the redesign still render plain <select> and
 * <input type="date">; this layer opens the Harbor menu or calendar in their
 * place. The native element keeps the value and fires its usual events, so
 * the page code is unchanged. Opt out with `data-native` on an element.
 */

interface Row {
  value: string;
  label: string;
  disabled: boolean;
  group: string | null;
}

/** Set a value the way the user would, so React's onChange sees it. */
function setNativeValue(el: HTMLSelectElement | HTMLInputElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

const isEnhanced = (el: Element | null): el is HTMLSelectElement =>
  el instanceof HTMLSelectElement &&
  !el.multiple &&
  !el.disabled &&
  (el.size ?? 0) <= 1 &&
  !el.closest('[data-native]');

const isDateInput = (el: Element | null): el is HTMLInputElement =>
  el instanceof HTMLInputElement &&
  el.type === 'date' &&
  !el.disabled &&
  !el.readOnly &&
  !el.closest('[data-native]');

export function NativeEnhancer() {
  const [select, setSelect] = useState<HTMLSelectElement | null>(null);
  const [dateInput, setDateInput] = useState<HTMLInputElement | null>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (e.button !== 0) return;
      const t = e.target as Element;
      if (isEnhanced(t)) {
        e.preventDefault();
        t.focus();
        setSelect((cur) => (cur === t ? null : t));
      } else if (isDateInput(t)) {
        e.preventDefault();
        t.focus();
        setDateInput((cur) => (cur === t ? null : t));
      }
    }
    function onKey(e: KeyboardEvent) {
      const t = e.target as Element;
      const opens =
        ['Enter', ' ', 'ArrowDown', 'ArrowUp', 'F4'].includes(e.key) ||
        (e.altKey && e.key === 'ArrowDown');
      if (isEnhanced(t) && opens) {
        e.preventDefault();
        setSelect(t);
      } else if (isDateInput(t) && (e.key === 'Enter' || e.key === ' ' || e.key === 'F4')) {
        e.preventDefault();
        setDateInput(t);
      }
    }
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  return (
    <>
      {select && (
        <SelectMenu key={select.id || 'select'} el={select} onClose={() => setSelect(null)} />
      )}
      {dateInput && <DateMenu el={dateInput} onClose={() => setDateInput(null)} />}
    </>
  );
}

function SelectMenu({ el, onClose }: { el: HTMLSelectElement; onClose: () => void }) {
  const anchorRef = useRef<HTMLElement>(el);
  anchorRef.current = el;
  const rows: Row[] = useMemo(
    () =>
      Array.from(el.options).map((o) => ({
        value: o.value,
        label: o.label || o.text,
        disabled: o.disabled,
        group: o.parentElement instanceof HTMLOptGroupElement ? o.parentElement.label : null,
      })),
    [el],
  );
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.label.toLowerCase().includes(q)) : rows;
  }, [rows, query]);
  const current = el.value;
  const [hi, setHi] = useState(() =>
    Math.max(
      0,
      rows.findIndex((r) => r.value === current),
    ),
  );
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchable = rows.length > 8;
  const listId = useId();
  const typed = useRef({ text: '', at: 0 });

  useEffect(() => {
    if (searchable) searchRef.current?.focus();
    else listRef.current?.focus();
  }, [searchable]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-i="${hi}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  const close = useCallback(
    (refocus: boolean) => {
      onClose();
      if (refocus) el.focus();
    },
    [el, onClose],
  );

  function pick(r: Row | undefined) {
    if (!r || r.disabled) return;
    close(true);
    if (r.value !== el.value) setNativeValue(el, r.value);
  }

  function step(from: number, dir: 1 | -1): number {
    for (let i = from + dir; i >= 0 && i < shown.length; i += dir)
      if (!shown[i]!.disabled) return i;
    return from;
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') setHi((i) => step(i, 1));
    else if (e.key === 'ArrowUp') setHi((i) => step(i, -1));
    else if (e.key === 'Home') setHi(step(-1, 1));
    else if (e.key === 'End') setHi(step(shown.length, -1));
    else if (e.key === 'Enter' || (e.key === ' ' && !searchable)) pick(shown[hi]);
    else if (!searchable && e.key.length === 1) {
      const now = Date.now();
      typed.current.text =
        (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase();
      typed.current.at = now;
      const i = shown.findIndex(
        (r) => !r.disabled && r.label.toLowerCase().startsWith(typed.current.text),
      );
      if (i >= 0) setHi(i);
      return;
    } else return;
    e.preventDefault();
  }

  let lastGroup: string | null = null;
  return (
    <Popover
      anchorRef={anchorRef}
      open
      onClose={(why) => close(why === 'escape')}
      label={el.getAttribute('aria-label') ?? 'Choose'}
    >
      {searchable && (
        <label className="hb-menu-search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchRef}
            value={query}
            placeholder="Search…"
            aria-label="Search the options"
            aria-controls={listId}
            onChange={(e) => {
              setQuery(e.target.value);
              setHi(0);
            }}
            onKeyDown={onKey}
          />
        </label>
      )}
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        tabIndex={-1}
        className="hb-menu"
        onKeyDown={onKey}
      >
        {shown.map((r, i) => {
          const heading = r.group && r.group !== lastGroup ? r.group : null;
          lastGroup = r.group;
          return (
            <li key={`${r.group ?? ''}-${r.value}-${i}`} role="presentation">
              {heading && <div className="hb-menu-group-label">{heading}</div>}
              <div
                role="option"
                data-i={i}
                aria-selected={r.value === current}
                aria-disabled={r.disabled}
                className={cx(
                  'hb-menu-row',
                  i === hi && 'hi',
                  r.value === current && 'current',
                  r.disabled && 'disabled',
                )}
                onMouseEnter={() => !r.disabled && setHi(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r)}
              >
                <span className="hb-menu-label">{r.label || ' '}</span>
                {r.value === current && (
                  <Check size={16} className="hb-menu-check" aria-hidden="true" />
                )}
              </div>
            </li>
          );
        })}
        {shown.length === 0 && <li className="hb-menu-none">No matches</li>}
      </ul>
    </Popover>
  );
}

function DateMenu({ el, onClose }: { el: HTMLInputElement; onClose: () => void }) {
  const anchorRef = useRef<HTMLElement>(el);
  anchorRef.current = el;
  return (
    <CalendarPopover
      anchorRef={anchorRef}
      open
      value={el.value || null}
      label={el.getAttribute('aria-label') ?? 'Date'}
      allowClear={!el.required}
      onClose={(why) => {
        onClose();
        if (why === 'escape' || why === 'pick') el.focus();
      }}
      onPick={(v) => setNativeValue(el, v ?? '')}
    />
  );
}
