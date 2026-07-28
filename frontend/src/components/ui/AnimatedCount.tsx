/**
 * AnimatedCount — Phase 9. Eases a number from its previous value to the next
 * (e.g. dashboard counts updating on a filter change) instead of snapping.
 * Respects prefers-reduced-motion (jumps straight to the value).
 */
import { useEffect, useRef, useState } from 'react';

const DURATION = 480;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function AnimatedCount({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);
  const rafRef = useRef<number | null>(null);
  const [bumping, setBumping] = useState(false);

  useEffect(() => {
    const from = displayRef.current;
    const to = value;
    if (from === to) return;

    if (prefersReducedMotion()) {
      displayRef.current = to;
      setDisplay(to);
      return;
    }

    setBumping(true);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const current = Math.round(from + (to - from) * eased);
      displayRef.current = current;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        displayRef.current = to;
        setDisplay(to);
        setBumping(false);
      }
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      // Snap to target if interrupted so the next diff starts from truth.
      displayRef.current = to;
    };
  }, [value]);

  return <span className={`count-anim${bumping ? ' bumping' : ''}`}>{display}</span>;
}
