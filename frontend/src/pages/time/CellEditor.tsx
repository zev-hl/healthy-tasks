import { useEffect, useRef, useState, type RefObject } from 'react';
import { formatDuration } from '@healthy-tasks/shared';
import { Popover } from '../../components/harbor/Popover';

/**
 * Type a duty's time for one day right in the timesheet: hours and minutes,
 * or +15m / +30m / +1h, then Save (Enter). Clear sets it to nothing.
 */
export function CellEditor({
  anchorRef,
  title,
  minutes,
  onSave,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement>;
  title: string;
  minutes: number;
  onSave: (minutes: number) => void;
  onClose: () => void;
}) {
  const [h, setH] = useState(minutes ? String(Math.floor(minutes / 60)) : '');
  const [m, setM] = useState(minutes ? String(minutes % 60) : '');
  const hRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    hRef.current?.focus();
    hRef.current?.select();
  }, []);

  const total = (Number(h) || 0) * 60 + Math.min(59, Number(m) || 0);
  const add = (n: number) => {
    const t = total + n;
    setH(String(Math.floor(t / 60)));
    setM(String(t % 60));
  };

  return (
    <Popover
      anchorRef={anchorRef}
      open
      onClose={onClose}
      minWidth={280}
      matchWidth={false}
      label={title}
      closeOnTab={false}
    >
      <form
        className="hb-cell-editor"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(total);
        }}
      >
        <div className="hb-cell-title">{title}</div>
        <div className="hb-cell-hm">
          <label>
            <input
              ref={hRef}
              type="number"
              min={0}
              max={24}
              inputMode="numeric"
              value={h}
              placeholder="0"
              aria-label="Hours"
              onChange={(e) => setH(e.target.value)}
            />
            <span>h</span>
          </label>
          <label>
            <input
              type="number"
              min={0}
              max={59}
              step={5}
              inputMode="numeric"
              value={m}
              placeholder="00"
              aria-label="Minutes"
              onChange={(e) => setM(e.target.value)}
            />
            <span>m</span>
          </label>
          <span className="hb-cell-total">{total ? formatDuration(total) : 'Nothing'}</span>
        </div>
        <div className="hb-cell-quick">
          {[15, 30, 60].map((n) => (
            <button key={n} type="button" onClick={() => add(n)}>
              +{n === 60 ? '1h' : `${n}m`}
            </button>
          ))}
          {minutes > 0 && (
            <button type="button" className="clear" onClick={() => onSave(0)}>
              Clear
            </button>
          )}
        </div>
        <div className="hb-cell-actions">
          <button type="button" className="hb-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="hb-btn hb-btn-primary hb-btn-sm"
            disabled={total === minutes}
          >
            Save
          </button>
        </div>
      </form>
    </Popover>
  );
}
