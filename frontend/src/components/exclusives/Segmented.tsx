/**
 * Small segmented toggle (HLAI-71) — used for the Individual/Group switch and
 * the per-alert Off/Daily/Immediate control in the group editor. Purely
 * presentational; the parent owns the value.
 */
export interface SegOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  tone = 'ink',
  ariaLabel,
}: {
  options: readonly SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  /**
   * Selected-segment colour: 'ink' (dark), 'accent' (teal), 'neutral' (grey),
   * 'ok' (green) or 'danger' (red). The Active/Inactive switch passes a tone
   * that follows the value, so the chosen side is green or red.
   */
  tone?: 'ink' | 'accent' | 'neutral' | 'ok' | 'danger';
  ariaLabel?: string;
}) {
  return (
    <div className={`exc-seg exc-seg-${size}`} role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            className={`exc-seg-btn${active ? ` active tone-${tone}` : ''}`}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
