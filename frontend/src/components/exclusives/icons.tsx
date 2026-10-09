/**
 * The handful of icons Exclusives needs, drawn inline.
 *
 * The app has no icon library and adding one for two shapes would not pay for
 * itself. Same conventions as the editor toolbar icons: a 24×24 box, stroked in
 * the current colour, round caps.
 */
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/**
 * A minus in a circle — marks a group that is switched off in the Alert Groups
 * list. A minus rather than a cross: the group still exists and still holds its
 * ASINs, it is only not being checked.
 */
export function InactiveIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

/** A caution — used by the amber banner when ASINs belong to another group. */
export function WarningIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} className="alert-icon" aria-hidden="true">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
