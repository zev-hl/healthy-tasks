interface Option {
  value: string;
  label: string;
}

interface Props {
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
}

/** A scrollable checkbox group for multi-value filters (used inside a popover). */
export function MultiSelect({ options, selected, onChange }: Props) {
  const selectedSet = new Set(selected);
  function toggle(value: string) {
    const next = new Set(selectedSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    // Preserve option order.
    onChange(options.map((o) => o.value).filter((v) => next.has(v)));
  }
  return (
    <div className="multi-select">
      {options.length === 0 ? (
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          None
        </span>
      ) : (
        options.map((o) => (
          <label key={o.value} className="multi-option">
            <input type="checkbox" checked={selectedSet.has(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))
      )}
    </div>
  );
}
