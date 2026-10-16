import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { alertTone } from './exclusives/AlertBadge';
import { taskAttributeList, type TaskAttributeValues } from '../lib/taskAttributes';

/** Capsules shown in the cell before the rest wait behind the "+". */
const SHOWN = 3;
/** The window's width, to line its right edge up with the "+". */
const POP_WIDTH = 260;

/**
 * The task list's Attributes column (HLAI-118): the attributes that are set,
 * as small capsules (at most three), and a "+" in the corner that opens a
 * window listing every attribute with its value. An Alert Type capsule takes
 * that type's colour from the Exclusives screens.
 *
 * The window is portalled to the page so the table's scrolling cannot clip it,
 * and clicks inside it never open the row's task.
 */
export function TaskAttributesCell({ task }: { task: TaskAttributeValues }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const all = taskAttributeList(task);
  const set = all.filter((a) => a.value !== null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        btnRef.current?.focus();
      }
    };
    // Scrolling moves the row away from the fixed window, so close it.
    const onScroll = (e: Event) => {
      if (popRef.current && e.target instanceof Node && popRef.current.contains(e.target)) return;
      close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [pos]);

  if (set.length === 0) return <span className="muted">—</span>;

  function toggle() {
    if (pos) {
      setPos(null);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, r.right - POP_WIDTH) });
  }

  return (
    <div className="attrs-cell">
      <div className="attrs-capsules">
        {set.slice(0, SHOWN).map((a) => {
          const tone = a.key === 'alertType' && task.alertType ? alertTone(task.alertType) : null;
          return (
            <span
              key={a.key}
              className={`badge attr-capsule is-${a.key}`}
              style={tone ? { background: tone.bg, color: tone.fg } : undefined}
              title={`${a.label}: ${a.value}`}
            >
              {a.value}
            </span>
          );
        })}
      </div>
      <button
        ref={btnRef}
        type="button"
        className="attrs-more"
        aria-label="Show all attributes"
        aria-expanded={pos !== null}
        title="Show all attributes"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        +
      </button>
      {pos &&
        createPortal(
          <div
            ref={popRef}
            className="attrs-pop"
            role="dialog"
            aria-label="Attributes"
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: POP_WIDTH }}
            // A portal still bubbles through the row in React: keep the task closed.
            onClick={(e) => e.stopPropagation()}
          >
            <div className="attrs-pop-title">Attributes</div>
            <dl className="attrs-pop-list">
              {all.map((a) => (
                <div key={a.key} className="attrs-pop-row">
                  <dt>{a.label}</dt>
                  <dd className={a.value ? undefined : 'muted'}>{a.value ?? '—'}</dd>
                </div>
              ))}
            </dl>
          </div>,
          document.body,
        )}
    </div>
  );
}
