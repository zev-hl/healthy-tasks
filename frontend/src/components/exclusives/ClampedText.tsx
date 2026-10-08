/**
 * Text clamped to a couple of lines, with a toggle when there is more to see.
 *
 * Alert messages vary wildly in length — "Offer count went from 3 to 4." next
 * to a title change quoting two full product names. Letting the long ones run
 * pushes every other row out of shape; cutting them off without a way to read
 * the rest hides information the person came for. So: clamp, and offer to open.
 *
 * The toggle only appears when the text is ACTUALLY cut off, measured after
 * layout rather than guessed from character count — the same sentence wraps
 * differently at different widths, and a "Show more" that reveals nothing is
 * worse than no button at all.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export function ClampedText({
  text,
  lines = 3,
  className,
}: {
  text: string;
  /** How many lines before it is cut off. */
  lines?: number;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Compare only while collapsed: expanded, the two heights always match.
    if (!expanded) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [expanded]);

  useLayoutEffect(measure, [measure, text, lines]);

  // The drawer can be resized, and the same text clamps at one width and not
  // another, so the answer is re-checked rather than decided once.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return (
    // Relative, so the chevron can sit at the end of the last line rather than
    // on a line of its own. The paragraph reserves a right gutter for it, so
    // the two never overlap and no background masking is needed.
    <span className="exc-clamp">
      <p
        ref={ref}
        className={className}
        style={
          expanded
            ? undefined
            : {
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: lines,
                overflow: 'hidden',
              }
        }
      >
        {text}
      </p>
      {(clamped || expanded) && (
        <button
          type="button"
          className="btn-plain exc-clamp-toggle"
          aria-expanded={expanded}
          // The chevron is the whole control, so the label lives here — a
          // button with only an icon is unreadable to a screen reader and
          // gives no tooltip on hover.
          aria-label={expanded ? 'Show less' : 'Show more'}
          title={expanded ? 'Show less' : 'Show more'}
          onClick={() => setExpanded((v) => !v)}
        >
          <Chevron up={expanded} />
        </button>
      )}
    </span>
  );
}

/** A single chevron that flips, so expanded and collapsed read as one control. */
function Chevron({ up }: { up: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <polyline points={up ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
    </svg>
  );
}
