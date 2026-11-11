import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover } from './Popover';
import { cx } from './ui';

/** A calendar day as `YYYY-MM-DD`, in the viewer's own time zone. */
export type Ymd = string;

export function toYmd(d: Date): Ymd {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
export function fromYmd(s: Ymd): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function formatShortDay(s: Ymd | null): string {
  if (!s) return '';
  const d = fromYmd(s);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** Quick picks under the grid: Today · Tomorrow · Friday · Next week. */
function quickPicks(today: Date): { label: string; day: Date }[] {
  const friday = addDays(today, (5 - today.getDay() + 7) % 7 || 7);
  const nextMonday = addDays(today, (1 - today.getDay() + 7) % 7 || 7);
  return [
    { label: 'Today', day: today },
    { label: 'Tomorrow', day: addDays(today, 1) },
    { label: 'Friday', day: friday },
    { label: 'Next week', day: nextMonday },
  ];
}

/**
 * Every due-date field opens this calendar (§5), never a date list or the
 * browser's own picker. Today has an accent ring, the chosen day is filled,
 * past days are muted, and arrows move by day/week, PageUp/PageDown by month.
 */
export function DatePicker({
  value,
  onChange,
  label,
  placeholder = 'No date',
  variant = 'field',
  overdueNote,
  allowClear = true,
  className,
  renderValue,
  disabled,
  time,
  onTimeChange,
}: {
  value: Ymd | null;
  onChange: (v: Ymd | null) => void;
  label: string;
  placeholder?: string;
  variant?: 'field' | 'chip' | 'plain';
  /** e.g. "Currently Oct 27, 9 days overdue". */
  overdueNote?: string;
  allowClear?: boolean;
  className?: string;
  renderValue?: (v: Ymd | null) => ReactNode;
  disabled?: boolean;
  /** `HH:mm`; given with onTimeChange, a time field shows under the calendar once a day is set. */
  time?: string;
  onTimeChange?: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const shown = renderValue ? renderValue(value) : value ? formatShortDay(value) : placeholder;

  function close(refocus = true) {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={cx(
          'hb-select',
          `hb-select-${variant}`,
          'hb-date',
          !value && 'is-empty',
          className,
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${value ? formatShortDay(value) : placeholder}`}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {variant !== 'plain' && <CalendarDays size={16} aria-hidden="true" />}
        <span className="hb-select-value">{shown}</span>
        {variant !== 'field' && (
          <ChevronDown className="hb-select-caret" size={14} strokeWidth={2.4} aria-hidden="true" />
        )}
      </button>
      <CalendarPopover
        anchorRef={btnRef}
        open={open}
        value={value}
        label={label}
        allowClear={allowClear}
        overdueNote={overdueNote}
        onClose={(why) => close(why === 'escape' || why === 'pick')}
        onPick={(v) => onChange(v)}
      >
        {onTimeChange && value && (
          <label className="hb-cal-time">
            <span>Time</span>
            <input
              type="time"
              value={time ?? ''}
              onChange={(e) => onTimeChange(e.target.value)}
              aria-label={`${label} time`}
            />
            {time && (
              <button type="button" className="hb-btn hb-btn-link" onClick={() => onTimeChange('')}>
                Clear time
              </button>
            )}
          </label>
        )}
      </CalendarPopover>
    </>
  );
}

/**
 * The calendar itself, in a popover under `anchorRef`: today has an accent
 * ring, the chosen day is filled, past days are muted, quick picks below.
 * Arrows move by day/week, PageUp/PageDown by month, Enter picks, Esc closes.
 * Used by DatePicker and by the page-wide date-field enhancer.
 */
export function CalendarPopover({
  anchorRef,
  open,
  value,
  label,
  onPick,
  onClose,
  allowClear = true,
  overdueNote,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement>;
  open: boolean;
  value: Ymd | null;
  label: string;
  onPick: (v: Ymd | null) => void;
  onClose: (why: 'escape' | 'outside' | 'tab' | 'pick') => void;
  allowClear?: boolean;
  overdueNote?: string;
  children?: ReactNode;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [focus, setFocus] = useState<Date>(value ? fromYmd(value) : today);
  const [month, setMonth] = useState<Date>(new Date(focus.getFullYear(), focus.getMonth(), 1));

  useEffect(() => {
    if (!open) return;
    const f = value ? fromYmd(value) : today;
    setFocus(f);
    setMonth(new Date(f.getFullYear(), f.getMonth(), 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${toYmd(focus)}"]`)?.focus();
  }, [open, focus, month]);

  function pick(d: Date | null) {
    onClose('pick');
    onPick(d ? toYmd(d) : null);
  }
  function moveFocus(d: Date) {
    setFocus(d);
    if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear()) {
      setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  }
  function onGridKey(e: React.KeyboardEvent) {
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (e.key in steps) moveFocus(addDays(focus, steps[e.key]!));
    else if (e.key === 'PageUp' || e.key === 'PageDown') {
      const d = new Date(focus);
      d.setMonth(d.getMonth() + (e.key === 'PageUp' ? -1 : 1));
      moveFocus(d);
    } else return;
    e.preventDefault();
  }

  // Six weeks starting on the Sunday on or before the 1st.
  const start = addDays(month, -month.getDay());
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const selected = value ?? '';
  const monthName = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <Popover
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      minWidth={292}
      matchWidth={false}
      className="hb-cal"
      label={label}
    >
      <div className="hb-cal-head">
        <button
          type="button"
          className="hb-cal-nav"
          aria-label="Previous month"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <span className="hb-cal-month" aria-live="polite">
          {monthName}
        </span>
        <button
          type="button"
          className="hb-cal-nav"
          aria-label="Next month"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="hb-cal-grid" role="grid" ref={gridRef} onKeyDown={onGridKey}>
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="hb-cal-wd" aria-hidden="true">
            {w}
          </span>
        ))}
        {days.map((d) => {
          const ymd = toYmd(d);
          const inMonth = d.getMonth() === month.getMonth();
          const isToday = ymd === toYmd(today);
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          return (
            <button
              key={ymd}
              type="button"
              data-day={ymd}
              tabIndex={ymd === toYmd(focus) ? 0 : -1}
              className={cx(
                'hb-cal-day',
                !inMonth && 'out',
                d < today && 'past',
                weekend && 'weekend',
                isToday && 'today',
                ymd === selected && 'selected',
              )}
              aria-pressed={ymd === selected}
              aria-label={d.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
              onClick={() => pick(d)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="hb-cal-quick">
        {quickPicks(today).map((q) => (
          <button key={q.label} type="button" onClick={() => pick(q.day)}>
            {q.label}
          </button>
        ))}
        {allowClear && value && (
          <button type="button" className="clear" onClick={() => pick(null)}>
            Clear
          </button>
        )}
      </div>
      {children}
      {overdueNote && <p className="hb-cal-note">{overdueNote}</p>}
    </Popover>
  );
}
