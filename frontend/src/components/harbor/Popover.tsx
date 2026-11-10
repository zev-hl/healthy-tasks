import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * A floating panel under its control (6px below; flips above when there's no
 * room), drawn in a portal so a card's overflow never clips it. Closes on an
 * outside click, Esc or Tab; Esc returns focus to the control.
 */
export function Popover({
  anchorRef,
  open,
  onClose,
  minWidth = 200,
  matchWidth = true,
  className,
  children,
  label,
}: {
  anchorRef: RefObject<HTMLElement>;
  open: boolean;
  onClose: (reason: 'escape' | 'outside' | 'tab') => void;
  minWidth?: number;
  matchWidth?: boolean;
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    above: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const a = anchorRef.current?.getBoundingClientRect();
      const p = panelRef.current;
      if (!a) return;
      const width = Math.max(minWidth, matchWidth ? a.width : 0);
      const h = p?.offsetHeight ?? 0;
      const roomBelow = window.innerHeight - a.bottom;
      const above = h > 0 && roomBelow < h + 12 && a.top > roomBelow;
      const left = Math.max(8, Math.min(a.left, window.innerWidth - width - 8));
      const top = above ? a.top - h - 6 : a.bottom + 6;
      setPos({ top, left, width, above });
    }
    place();
    // Measure again once the panel has its height.
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, minWidth, matchWidth]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose('outside');
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose('escape');
      } else if (e.key === 'Tab') {
        onClose('tab');
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panelRef}
      className={`hb-pop${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-label={label}
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        minWidth: pos?.width ?? minWidth,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
