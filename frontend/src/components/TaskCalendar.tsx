import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TASK_STATUS_LABELS, type GhostOccurrenceDto, type TaskRowDto } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { statusPill } from './ui/indicators';

export type CalendarScale = 'month' | 'week' | 'day';
export type CalendarMode = 'range' | 'marker';

interface Props {
  rows: TaskRowDto[];
  loading: boolean;
  scale: CalendarScale;
  mode: CalendarMode;
  onScaleChange: (s: CalendarScale) => void;
  onModeChange: (m: CalendarMode) => void;
  /** Phase 11: computed future occurrences, shown as dashed ghost chips. */
  ghosts?: GhostOccurrenceDto[];
  onChanged?: () => void;
}

/** A dashed ghost chip for a future recurring occurrence; click to materialize. */
function CalGhostChip({
  ghost,
  busy,
  onClick,
}: {
  ghost: GhostOccurrenceDto;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="cal-chip ghost"
      title={`Upcoming occurrence #${ghost.seq} of “${ghost.name}” — click to create it now`}
      onClick={onClick}
      disabled={busy}
    >
      <span className="cal-chip-name">{busy ? '…' : `↻ ${ghost.name}`}</span>
    </button>
  );
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Display labels for the display-mode toggle. Stored values stay 'range'/'marker'
// (persisted prefs + hydration depend on them); only the "Marker" label reads "Due"
// — it plots a single point on the Due Date.
const CALENDAR_MODE_LABELS: Record<CalendarMode, string> = { range: 'Range', marker: 'Due' };

function dateOnly(iso: string): Date {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  return new Date(startOfDay(d).getTime() + n * DAY_MS);
}
function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}
function inRange(day: Date, start: Date, end: Date): boolean {
  const t = startOfDay(day).getTime();
  return t >= startOfDay(start).getTime() && t <= startOfDay(end).getTime();
}

function CalTaskChip({
  task,
  isStart,
  isEnd,
  single,
  mode,
  onOpen,
}: {
  task: TaskRowDto;
  isStart: boolean;
  isEnd: boolean;
  single: boolean;
  mode: CalendarMode;
  onOpen: (id: number) => void;
}) {
  const posClass =
    mode === 'marker' || single
      ? ' single'
      : isStart
        ? ' range-start'
        : isEnd
          ? ' range-end'
          : ' range-mid';
  const pill = statusPill(task.status);
  return (
    <button
      type="button"
      className={`cal-chip${posClass}`}
      style={{ background: pill.bg, color: pill.fg }}
      title={`#${task.id} ${task.name} · ${TASK_STATUS_LABELS[task.status]}`}
      onClick={() => onOpen(task.id)}
    >
      {mode === 'marker' && <span className="cal-chip-dot" style={{ background: pill.dot }} />}
      <span className="cal-chip-name">
        {mode === 'range' && !single && !isStart ? '▸ ' : ''}
        {task.name}
      </span>
    </button>
  );
}

/** The [start,end] date span a task occupies for the current mode, or null if it can't be plotted. */
function taskSpan(task: TaskRowDto, mode: CalendarMode): { start: Date; end: Date } | null {
  const s = task.startAt ? dateOnly(task.startAt) : null;
  const d = task.dueAt ? dateOnly(task.dueAt) : null;
  if (mode === 'marker') return d ? { start: d, end: d } : null;
  if (s && d) return { start: s <= d ? s : d, end: s <= d ? d : s };
  if (d) return { start: d, end: d };
  if (s) return { start: s, end: s };
  return null;
}

export function TaskCalendar({
  rows,
  loading,
  scale,
  mode,
  onScaleChange,
  onModeChange,
  ghosts = [],
  onChanged,
}: Props) {
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [materializing, setMaterializing] = useState<string | null>(null);
  const [ghostError, setGhostError] = useState<string | null>(null);

  async function materializeGhost(g: GhostOccurrenceDto) {
    const key = `${g.sourceType}:${g.sourceId}:${g.seq}`;
    if (materializing) return;
    setMaterializing(key);
    setGhostError(null);
    try {
      if (g.sourceType === 'task') await api.materializeTaskOccurrence(g.sourceId, g.seq);
      else await api.materializeTemplateGhost(g.sourceId, g.seq);
      onChanged?.();
    } catch (err) {
      setGhostError(err instanceof ApiError ? err.message : 'Could not create the occurrence');
    } finally {
      setMaterializing(null);
    }
  }

  // The contiguous list of days shown for the current scale.
  const days = useMemo(() => {
    if (scale === 'day') return [startOfDay(anchor)];
    if (scale === 'week') {
      const start = addDays(anchor, -anchor.getDay());
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    // month: 6 weeks starting on the Sunday on/before the 1st.
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = addDays(first, -first.getDay());
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [anchor, scale]);

  const plottable = useMemo(
    () => rows.map((task) => ({ task, span: taskSpan(task, mode) })).filter((x) => x.span),
    [rows, mode],
  );

  // Ghosts reuse taskSpan (it only reads startAt/dueAt) so range/marker match.
  const plottableGhosts = useMemo(
    () =>
      ghosts
        .map((ghost) => ({
          ghost,
          span: taskSpan({ startAt: ghost.startAt, dueAt: ghost.dueAt } as TaskRowDto, mode),
        }))
        .filter((x) => x.span),
    [ghosts, mode],
  );

  function tasksOn(day: Date) {
    return plottable
      .filter((x) => inRange(day, x.span!.start, x.span!.end))
      .map((x) => {
        const isStart = sameDay(day, x.span!.start);
        const isEnd = sameDay(day, x.span!.end);
        return { task: x.task, isStart, isEnd, single: isStart && isEnd };
      });
  }

  // A ghost shows on the start day of its span (marker → the due day) to avoid
  // over-filling multi-day ranges with repeated ghost chips.
  function ghostsOn(day: Date) {
    return plottableGhosts.filter((x) => sameDay(day, x.span!.start)).map((x) => x.ghost);
  }

  function shiftPeriod(dir: -1 | 1) {
    if (scale === 'day') setAnchor((a) => addDays(a, dir));
    else if (scale === 'week') setAnchor((a) => addDays(a, dir * 7));
    else setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + dir, 1));
  }

  const label = useMemo(() => {
    if (scale === 'day')
      return anchor.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    if (scale === 'week') {
      const start = addDays(anchor, -anchor.getDay());
      const end = addDays(start, 6);
      const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
      return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, { ...opts, year: 'numeric' })}`;
    }
    return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }, [anchor, scale]);

  const isMonth = scale === 'month';
  const today = startOfDay(new Date());
  const openTask = (id: number) => navigate(`/tasks/${id}`);

  return (
    <div className="calendar-wrap">
      <div className="calendar-toolbar">
        <div className="seg" role="group" aria-label="Calendar display mode">
          {(['range', 'marker'] as CalendarMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`seg-btn${mode === m ? ' active' : ''}`}
              aria-pressed={mode === m}
              onClick={() => onModeChange(m)}
            >
              {CALENDAR_MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Calendar scale">
          {(['month', 'week', 'day'] as CalendarScale[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`seg-btn${scale === s ? ' active' : ''}`}
              aria-pressed={scale === s}
              onClick={() => onScaleChange(s)}
            >
              {s[0]!.toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="calendar-nav">
          <button
            type="button"
            className="secondary btn-sm"
            onClick={() => shiftPeriod(-1)}
            aria-label="Previous"
          >
            ←
          </button>
          <button
            type="button"
            className="secondary btn-sm"
            onClick={() => setAnchor(startOfDay(new Date()))}
          >
            Today
          </button>
          <button
            type="button"
            className="secondary btn-sm"
            onClick={() => shiftPeriod(1)}
            aria-label="Next"
          >
            →
          </button>
        </div>
        <span className="calendar-label">{label}</span>
        <div className="spacer" />
        {loading && <span className="mono muted">Loading…</span>}
      </div>

      {ghostError && <div className="alert error">{ghostError}</div>}

      {scale === 'day' ? (
        <div className="calendar-day-view">
          {(() => {
            const items = tasksOn(anchor);
            const gitems = ghostsOn(anchor);
            if (items.length === 0 && gitems.length === 0)
              return <div className="calendar-empty">Nothing scheduled this day.</div>;
            return (
              <>
                {items.map(({ task, isStart, isEnd, single }) => (
                  <CalTaskChip
                    key={task.id}
                    task={task}
                    isStart={isStart}
                    isEnd={isEnd}
                    single={single}
                    mode={mode}
                    onOpen={openTask}
                  />
                ))}
                {gitems.map((g) => {
                  const key = `${g.sourceType}:${g.sourceId}:${g.seq}`;
                  return (
                    <CalGhostChip
                      key={`ghost-${key}`}
                      ghost={g}
                      busy={materializing === key}
                      onClick={() => void materializeGhost(g)}
                    />
                  );
                })}
              </>
            );
          })()}
        </div>
      ) : (
        <div className={`calendar-grid${isMonth ? ' month' : ' week'}`}>
          {WEEKDAYS.map((w) => (
            <div key={w} className="calendar-weekday mono">
              {w}
            </div>
          ))}
          {days.map((day) => {
            const items = tasksOn(day);
            const cap = isMonth ? 3 : 20;
            const extra = items.length - cap;
            const outside = isMonth && day.getMonth() !== anchor.getMonth();
            const isToday = sameDay(day, today);
            return (
              <div
                key={day.toISOString()}
                className={`calendar-cell${outside ? ' outside' : ''}${isToday ? ' is-today' : ''}`}
              >
                <span className="calendar-daynum mono">
                  {day.getDate()}
                  {isToday ? ' · Today' : ''}
                </span>
                <div className="calendar-cell-tasks">
                  {items.slice(0, cap).map(({ task, isStart, isEnd, single }) => (
                    <CalTaskChip
                      key={task.id}
                      task={task}
                      isStart={isStart}
                      isEnd={isEnd}
                      single={single}
                      mode={mode}
                      onOpen={openTask}
                    />
                  ))}
                  {extra > 0 && <span className="calendar-more mono">+{extra} more</span>}
                  {ghostsOn(day).map((g) => {
                    const key = `${g.sourceType}:${g.sourceId}:${g.seq}`;
                    return (
                      <CalGhostChip
                        key={`ghost-${key}`}
                        ghost={g}
                        busy={materializing === key}
                        onClick={() => void materializeGhost(g)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
