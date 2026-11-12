import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Eye, GitFork, Repeat } from 'lucide-react';
import {
  TASK_STATUS_LABELS,
  type GhostOccurrenceDto,
  type TaskRowDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { Avatar, userLabel } from './ui/Avatar';
import { Dot, STATUS_DOT, Segmented, StatusPill, cx } from './harbor/ui';
import { Select } from './harbor/Select';

export type CalendarScale = 'month' | 'week' | 'day';

interface Props {
  rows: TaskRowDto[];
  loading: boolean;
  scale: CalendarScale;
  onScaleChange: (s: CalendarScale) => void;
  /** Phase 11: computed future occurrences, shown as dashed ghost chips. */
  ghosts?: GhostOccurrenceDto[];
  onChanged?: () => void;
  /** Where the page wants the calendar's controls (its filter row); inline when absent. */
  toolbarSlot?: HTMLElement | null;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LANE_H = 24;
const NUM_H = 32;
const HEAD_H = 34; // the weekday row
const LEGEND_H = 30; // the key under the grid
const MORE_H = 22; // room for "N more" at the foot of a day
const MIN_WEEK_H = 60;

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
const dayDiff = (a: Date, b: Date) =>
  Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY_MS);
/** "3:30 PM" when the date carries a time of day; nothing at midnight. */
function timeOf(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (d.getHours() === 0 && d.getMinutes() === 0) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * The one day a task shows on: its due day, or its start day when it has no
 * due date. A task with neither isn't on the calendar.
 */
function taskDay(task: { startAt: string | null; dueAt: string | null }): Date | null {
  const iso = task.dueAt ?? task.startAt;
  return iso ? dateOnly(iso) : null;
}

type Item =
  | { kind: 'task'; key: string; task: TaskRowDto; start: Date; end: Date }
  | { kind: 'ghost'; key: string; ghost: GhostOccurrenceDto; start: Date; end: Date };

interface Placed {
  item: Item;
  lane: number;
  from: number; // column in the week, 0..6
  to: number;
  clipStart: boolean; // continues from the previous week
  clipEnd: boolean; // continues into the next week
}

/** Lay one week's items into lanes, longest and earliest first (as Google Calendar does). */
function layoutWeek(weekStart: Date, items: Item[]): Placed[] {
  const weekEnd = addDays(weekStart, 6);
  const inWeek = items
    .filter((it) => it.end >= weekStart && it.start <= weekEnd)
    .map((it) => ({
      item: it,
      from: Math.max(0, dayDiff(it.start, weekStart)),
      to: Math.min(6, dayDiff(it.end, weekStart)),
      clipStart: it.start < weekStart,
      clipEnd: it.end > weekEnd,
    }))
    .sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from));
  const laneEnds: number[] = [];
  return inWeek.map((p) => {
    let lane = laneEnds.findIndex((end) => end < p.from);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(p.to);
    } else laneEnds[lane] = p.to;
    return { ...p, lane };
  });
}

/**
 * Calendar view, Harbor redesign after Google Calendar: one clean grid and
 * today as a blue circle. Every task shows on ONE day — its due day, or its
 * start day when it has no due date — as a dot in its status color, its time
 * if it has one, and its name (red when late). Month view fits the window and
 * shows as many a day as fit, then "N more", which opens the Day view, as does a day's number. Dashed
 * items are upcoming repeats: click one to create it now.
 */
export function TaskCalendar({
  rows,
  loading,
  scale,
  onScaleChange,
  ghosts = [],
  onChanged,
  toolbarSlot,
}: Props) {
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [materializing, setMaterializing] = useState<string | null>(null);
  const [ghostError, setGhostError] = useState<string | null>(null);
  // Month view fills the window down to its bottom edge: measure what's left
  // below the grid's top and share it between the six weeks.
  const gridRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = gridRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setAvail(Math.max(6 * MIN_WEEK_H + HEAD_H, window.innerHeight - top - 24 - LEGEND_H));
    };
    measure();
    // Again once the page above has settled (filters, chips and rows load in).
    const raf = window.requestAnimationFrame(measure);
    const late = window.setTimeout(measure, 300);
    window.addEventListener('resize', measure);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(late);
      window.removeEventListener('resize', measure);
    };
  }, [scale, loading, ghostError, rows.length, ghosts.length, toolbarSlot]);

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

  // Everything that can be plotted, as items with a day span.
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const task of rows) {
      const day = taskDay(task);
      if (day) out.push({ kind: 'task', key: `t${task.id}`, task, start: day, end: day });
    }
    // An upcoming repeat shows on its own due (or start) day too.
    for (const ghost of ghosts) {
      const day = taskDay(ghost);
      if (day)
        out.push({
          kind: 'ghost',
          key: `g${ghost.sourceType}:${ghost.sourceId}:${ghost.seq}`,
          ghost,
          start: day,
          end: day,
        });
    }
    return out;
  }, [rows, ghosts]);

  // The weeks shown: one for Week view, six for Month view.
  const weeks = useMemo(() => {
    if (scale === 'week') return [addDays(anchor, -anchor.getDay())];
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = addDays(first, -first.getDay());
    return Array.from({ length: 6 }, (_, i) => addDays(gridStart, i * 7));
  }, [anchor, scale]);

  function shiftPeriod(dir: -1 | 1) {
    if (scale === 'day') setAnchor((a) => addDays(a, dir));
    else if (scale === 'week') setAnchor((a) => addDays(a, dir * 7));
    else setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + dir, 1));
  }
  const openDay = (day: Date) => {
    setAnchor(startOfDay(day));
    onScaleChange('day');
  };

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
    // In the filter row space is tight: "Nov 2026".
    return anchor.toLocaleDateString(undefined, {
      month: toolbarSlot ? 'short' : 'long',
      year: 'numeric',
    });
  }, [anchor, scale, toolbarSlot]);

  const today = startOfDay(new Date());
  const isMonth = scale === 'month';
  const openTask = (id: number) => navigate(`/tasks/${id}`);
  const isLate = (t: TaskRowDto) =>
    !!t.dueAt && dateOnly(t.dueAt) < today && t.status !== 'Completed' && t.status !== 'Canceled';

  /** One item drawn on its day: a dot, the time if it has one, and the name. */
  function renderPlaced(p: Placed, top: number) {
    const left = `calc(${(p.from / 7) * 100}% + 4px)`;
    const width = `calc(${((p.to - p.from + 1) / 7) * 100}% - 8px)`;
    if (p.item.kind === 'ghost') {
      const g = p.item.ghost;
      const key = `${g.sourceType}:${g.sourceId}:${g.seq}`;
      return (
        <button
          key={p.item.key}
          type="button"
          className="hb-tcal-ev is-ghost"
          style={{ top, left, width }}
          title={`Coming repeat of “${g.name}” (number ${g.seq}): click to create it now`}
          onClick={() => void materializeGhost(g)}
          disabled={materializing === key}
        >
          <Repeat size={11} aria-hidden="true" />
          <span className="hb-tcal-ev-name">{materializing === key ? '…' : g.name}</span>
        </button>
      );
    }
    const t = p.item.task;
    const readOnly = t.mentionOnly || t.treeOnly;
    const treeCue = t.treeOnly && !t.mentionOnly;
    const time = timeOf(t.dueAt ?? t.startAt);
    return (
      <button
        key={p.item.key}
        type="button"
        className={cx(
          'hb-tcal-ev',
          // Each kind of item has its own look (Nov 11): due dates, start-only, repeats.
          t.dueAt ? 'kind-due' : 'kind-start',
          isLate(t) && 'is-late',
          readOnly && 'is-readonly',
        )}
        style={{ top, left, width }}
        title={`#${t.id} ${t.name} · ${TASK_STATUS_LABELS[t.status]}${
          readOnly
            ? ` (read-only — ${treeCue ? 'via parent/child tree position' : "you're mentioned"})`
            : ''
        }`}
        onClick={() => openTask(t.id)}
      >
        <i style={{ background: STATUS_DOT[t.status] }} aria-hidden="true" />
        {readOnly &&
          (treeCue ? (
            <GitFork size={11} aria-hidden="true" />
          ) : (
            <Eye size={11} aria-hidden="true" />
          ))}
        {!t.dueAt && <span className="hb-tcal-ev-kind">Starts</span>}
        {time && <span className="hb-tcal-ev-time">{time}</span>}
        <span className="hb-tcal-ev-name">{t.name}</span>
      </button>
    );
  }

  // Today, ‹ ›, the period and the scale: in the page's filter row when it
  // offers a place (toolbarSlot), above the grid otherwise.
  const controls = (
    <>
      <button
        type="button"
        className="hb-btn hb-btn-secondary hb-btn-sm"
        onClick={() => setAnchor(startOfDay(new Date()))}
      >
        Today
      </button>
      <span className="hb-tcal-nav">
        <button
          type="button"
          className="hb-icon-btn hb-icon-btn-sm"
          onClick={() => shiftPeriod(-1)}
          aria-label="Previous"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="hb-icon-btn hb-icon-btn-sm"
          onClick={() => shiftPeriod(1)}
          aria-label="Next"
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </span>
      <h2 className="hb-tcal-label">{label}</h2>
      {loading && <span className="hb-small">Loading…</span>}
      {toolbarSlot ? (
        // In the page's filter row, a compact chip keeps everything on one line.
        <Select
          variant="chip"
          label="Show"
          value={scale}
          options={[
            { value: 'month', label: 'Month' },
            { value: 'week', label: 'Week' },
            { value: 'day', label: 'Day' },
          ]}
          onChange={onScaleChange}
        />
      ) : (
        <Segmented
          small
          label="Calendar scale"
          value={scale}
          options={[
            { value: 'month', label: 'Month' },
            { value: 'week', label: 'Week' },
            { value: 'day', label: 'Day' },
          ]}
          onChange={onScaleChange}
        />
      )}
    </>
  );

  return (
    <div className="hb-tcal-wrap">
      {toolbarSlot ? (
        createPortal(controls, toolbarSlot)
      ) : (
        <div className="hb-tcal-bar">{controls}</div>
      )}

      {ghostError && (
        <div className="hb-alert" role="alert">
          {ghostError}
        </div>
      )}

      {scale === 'day' ? (
        <DayList
          items={items.filter((it) => sameDay(it.start, anchor))}
          isLate={isLate}
          materializing={materializing}
          onGhost={(g) => void materializeGhost(g)}
          onOpen={openTask}
        />
      ) : (
        <div ref={gridRef} className={cx('hb-tcal', isMonth ? 'is-month' : 'is-week')}>
          <div className="hb-tcal-head">
            {weeks[0] &&
              Array.from({ length: 7 }, (_, i) => addDays(weeks[0]!, i)).map((d, i) => (
                <span key={i} className={cx(!isMonth && sameDay(d, today) && 'is-today')}>
                  {WEEKDAYS[i]}
                  {!isMonth && <b>{d.getDate()}</b>}
                </span>
              ))}
          </div>
          {weeks.map((ws) => {
            const placed = layoutWeek(ws, items);
            const lanes = placed.reduce((m, p) => Math.max(m, p.lane + 1), 0);
            const weekH = isMonth
              ? Math.max(MIN_WEEK_H, Math.floor(((avail ?? 6 * 130 + HEAD_H) - HEAD_H - 2) / 6))
              : 0;
            // As many tasks a day as fit; keep a line for "N more" when some don't.
            const fit = Math.max(1, Math.floor((weekH - NUM_H - 6) / LANE_H));
            const shownLanes = isMonth
              ? lanes <= fit
                ? lanes
                : Math.max(1, Math.floor((weekH - NUM_H - MORE_H) / LANE_H))
              : lanes;
            // What doesn't fit in Month view, counted per day.
            const hidden = Array.from(
              { length: 7 },
              (_, d) =>
                placed.filter((p) => p.lane >= shownLanes && p.from <= d && p.to >= d).length,
            );
            const height = isMonth ? weekH : Math.max(360, NUM_H + lanes * LANE_H + 24);
            return (
              <div key={ws.toISOString()} className="hb-tcal-week" style={{ height }}>
                {Array.from({ length: 7 }, (_, d) => {
                  const day = addDays(ws, d);
                  const outside = isMonth && day.getMonth() !== anchor.getMonth();
                  const isToday = sameDay(day, today);
                  return (
                    <div
                      key={d}
                      className={cx(
                        'hb-tcal-cell',
                        outside && 'is-outside',
                        (d === 0 || d === 6) && 'is-weekend',
                      )}
                    >
                      {isMonth && (
                        <button
                          type="button"
                          className={cx('hb-tcal-num', isToday && 'is-today')}
                          title="Open this day"
                          aria-label={`Open ${day.toDateString()}`}
                          onClick={() => openDay(day)}
                        >
                          {day.getDate() === 1
                            ? day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                            : day.getDate()}
                        </button>
                      )}
                      {hidden[d]! > 0 && (
                        <button type="button" className="hb-tcal-more" onClick={() => openDay(day)}>
                          {hidden[d]} more
                        </button>
                      )}
                    </div>
                  );
                })}
                {/* Today's column in Week view */}
                {!isMonth &&
                  Array.from({ length: 7 }, (_, d) =>
                    sameDay(addDays(ws, d), today) ? (
                      <span
                        key="today"
                        className="hb-tcal-todaycol"
                        style={{ left: `${(d / 7) * 100}%`, width: `${100 / 7}%` }}
                      />
                    ) : null,
                  )}
                {placed
                  .filter((p) => p.lane < shownLanes)
                  .map((p) => renderPlaced(p, (isMonth ? NUM_H : 10) + p.lane * LANE_H))}
              </div>
            );
          })}
        </div>
      )}
      {scale !== 'day' && (
        <div className="hb-tcal-legend" aria-label="What the colors mean">
          <span>
            <i className="kind-due" aria-hidden="true" /> Due
          </span>
          <span>
            <i className="kind-start" aria-hidden="true" /> Starts (no due date)
          </span>
          <span>
            <i className="kind-ghost" aria-hidden="true" /> Coming repeat
          </span>
          <span className="hb-tcal-legend-dot">
            <Dot color={STATUS_DOT.InProgress} size={8} /> The dot is the status
          </span>
        </div>
      )}
    </div>
  );
}

/** Day view: the day's tasks as rows — what, when, who and where it stands. */
function DayList({
  items,
  isLate,
  materializing,
  onGhost,
  onOpen,
}: {
  items: Item[];
  isLate: (t: TaskRowDto) => boolean;
  materializing: string | null;
  onGhost: (g: GhostOccurrenceDto) => void;
  onOpen: (id: number) => void;
}) {
  if (items.length === 0)
    return <div className="hb-tcal-dayempty">Nothing scheduled on this day.</div>;
  return (
    <div className="hb-tcal-day">
      {items.map((it) => {
        if (it.kind === 'ghost') {
          const g = it.ghost;
          const key = `${g.sourceType}:${g.sourceId}:${g.seq}`;
          return (
            <button
              key={it.key}
              type="button"
              className="hb-tcal-dayrow is-ghost"
              disabled={materializing === key}
              onClick={() => onGhost(g)}
              title="Coming repeat: click to create it now"
            >
              <Repeat size={15} aria-hidden="true" />
              <span className="hb-stack">
                <b>{materializing === key ? 'Creating…' : g.name}</b>
                <span className="hb-sub">Coming repeat · click to create it now</span>
              </span>
            </button>
          );
        }
        const t = it.task;
        return (
          <button
            key={it.key}
            type="button"
            className="hb-tcal-dayrow"
            onClick={() => onOpen(t.id)}
          >
            <i style={{ background: STATUS_DOT[t.status] }} aria-hidden="true" />
            <span className="hb-stack">
              <b>{t.name}</b>
              <span className={cx('hb-sub', isLate(t) && 'late')}>
                #{t.id}
                {t.startAt ? ` · Start ${fmtDateTime(t.startAt)}` : ''}
                {t.dueAt ? ` · Due ${fmtDateTime(t.dueAt)}` : ''}
              </span>
            </span>
            {t.assignee && (
              <span className="hb-user-mini">
                <Avatar user={t.assignee} size="xs" decorative />
                {userLabel(t.assignee)}
              </span>
            )}
            <StatusPill status={t.status} />
          </button>
        );
      })}
    </div>
  );
}
