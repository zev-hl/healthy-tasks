import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** Short label shown on the collapsed trigger (e.g. the column name). */
  label: string;
  /** True when this filter currently has a value (shows a dot on the trigger). */
  active: boolean;
  children: ReactNode;
}

/**
 * A collapsed filter control: shows a small trigger; clicking opens a dropdown
 * (rendered in a portal with fixed positioning so it escapes the results
 * table's horizontal-scroll clipping). Closes on outside-click, Escape, scroll,
 * or resize.
 */
export function FilterPopover({ label, active, children }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function openMenu() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 2, left: r.left });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onMove = () => setOpen(false); // scroll/resize invalidates the fixed position
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`filter-trigger${active ? ' active' : ''}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        title={active ? `${label} (filtered)` : label}
      >
        {label}
        {active && <span className="filter-dot" aria-label="filtered">●</span>}
        <span className="filter-caret">▾</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="filter-pop-menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
