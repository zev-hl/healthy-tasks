import { WEEKDAYS } from '@healthy-tasks/shared';

/** Google-style "Repeat on" weekday selector (0=Sun … 6=Sat). */
export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const toggle = (d: number) =>
    onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => a - b));
  return (
    <div className="weekday-picker" role="group" aria-label="Repeat on">
      {WEEKDAYS.map((w) => (
        <button
          key={w.value}
          type="button"
          className={`weekday-chip${value.includes(w.value) ? ' active' : ''}`}
          aria-pressed={value.includes(w.value)}
          title={w.label}
          onClick={() => toggle(w.value)}
        >
          {w.short}
        </button>
      ))}
    </div>
  );
}
