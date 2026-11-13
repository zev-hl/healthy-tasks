/**
 * Harbor (redesign D1) building blocks: cards, tiles, pills, segmented
 * controls, buttons and empty states (docs/redesign-brief.md §5). Classes are
 * `hb-` prefixed so they never collide with the older styles.css.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { TASK_STATUS_LABELS, type TaskPriority, type TaskStatus } from '@healthy-tasks/shared';

export type Tone = 'red' | 'amber' | 'green' | 'blue' | 'grey' | 'review';

/** Status → its meaning color (all six real statuses; see redesign-decisions.md). */
export const STATUS_TONE: Record<TaskStatus, Tone> = {
  Open: 'grey',
  InProgress: 'blue',
  OnHold: 'amber',
  Review: 'review',
  Completed: 'green',
  Canceled: 'grey',
};

export const STATUS_DOT: Record<TaskStatus, string> = {
  Open: '#8a9ab0',
  InProgress: '#1f5fbf',
  OnHold: '#b86e00',
  Review: '#6e95d3',
  Completed: '#1b6b2e',
  Canceled: '#c9d0da',
};

export const PRIORITY_DOT: Record<TaskPriority, string> = {
  Urgent: '#b42318',
  High: '#b42318',
  Medium: '#8a9ab0',
  Low: '#c9d0da',
};

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Card({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cx('hb-card', className)}>
      {children}
    </section>
  );
}

export function CardHead({
  icon,
  tone = 'blue',
  title,
  right,
  titleId,
}: {
  icon?: ReactNode;
  tone?: Tone;
  title: ReactNode;
  right?: ReactNode;
  titleId?: string;
}) {
  return (
    <div className="hb-card-head">
      {icon && <span className={cx('hb-ic', `tone-${tone}`)}>{icon}</span>}
      <h3 id={titleId}>{title}</h3>
      {right}
    </div>
  );
}

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cx('hb-pill', `tone-${tone}`)}>{children}</span>;
}

export function StatusPill({ status }: { status: TaskStatus }) {
  return <Pill tone={STATUS_TONE[status]}>{TASK_STATUS_LABELS[status]}</Pill>;
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <span
      className="hb-dot"
      style={{ background: color, width: size, height: size }}
      aria-hidden="true"
    />
  );
}

export function PriorityMark({ priority }: { priority: TaskPriority }) {
  return (
    <span className={cx('hb-prio', `prio-${priority.toLowerCase()}`)}>
      <Dot color={PRIORITY_DOT[priority]} size={8} />
      {priority}
    </span>
  );
}

type BtnKind = 'primary' | 'secondary' | 'ok' | 'ghost' | 'danger' | 'link';

export const Btn = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind }
>(function Btn({ kind = 'secondary', className, children, ...rest }, ref) {
  return (
    <button ref={ref} type="button" className={cx('hb-btn', `hb-btn-${kind}`, className)} {...rest}>
      {children}
    </button>
  );
});

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  small,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  small?: boolean;
}) {
  return (
    <div className={cx('hb-seg', small && 'small')} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CountBadge({ n, red }: { n: number; red?: boolean }) {
  return <span className={cx('hb-count', red && n > 0 && 'red')}>{n}</span>;
}

/** A clickable stat tile: clicking filters what is below it (§6.1). */
export function Tile({
  label,
  value,
  hint,
  tone,
  pressed,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: Tone;
  pressed?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={cx('hb-tile', tone && `tile-${tone}`)}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      <span className="h">{pressed ? 'Showing · click to clear' : hint}</span>
    </button>
  );
}

/** Words, never a blank area. `good` shows the green check ("all clear"). */
export function Empty({ children, good }: { children: ReactNode; good?: boolean }) {
  return (
    <div className={cx('hb-empty', good && 'good')}>
      {good && <Check size={18} aria-hidden="true" />}
      <span>{children}</span>
    </div>
  );
}

export function Section({
  title,
  note,
  right,
  children,
}: {
  title: string;
  note?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="hb-sec">
      <div className="hb-sec-head">
        <h2>{title}</h2>
        {note && <span>{note}</span>}
        {right}
      </div>
      {children}
    </section>
  );
}

/** The near-black progress bar (and optional marker) used by cards and people. */
export function Bar({ value, max, tone = 'blue' }: { value: number; max: number; tone?: Tone }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <span className={cx('hb-bar', `tone-${tone}`)} aria-hidden="true">
      <i style={{ width: `${pct}%` }} />
    </span>
  );
}
