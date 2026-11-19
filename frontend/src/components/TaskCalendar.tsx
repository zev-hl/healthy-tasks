import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Bell, ChevronLeft, ChevronRight, Eye, GitFork, Lock, Plus, Repeat } from 'lucide-react';
import {
  EVENT_KIND_LABELS,
  TASK_STATUS_LABELS,
  type CalendarReminderDto,
  type EventDto,
  type GhostOccurrenceDto,
  type GoogleEventDto,
  type TaskRowDto,
} from '@healthy-tasks/shared';
import { EVENT_COLORS, GOOGLE_COLOR, REMINDER_COLOR } from '../lib/calendarKinds';
import { api, ApiError } from '../api/client';
import { Avatar, userLabel } from './ui/Avatar';
import { STATUS_DOT, Segmented, StatusPill, cx } from './harbor/ui';

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
  /** Stage 3 (H3, H4): events, the reader's reminders and their Google events. */
  events?: EventDto[];
  reminders?: CalendarReminderDto[];
  google?: GoogleEventDto[];
  onOpenEvent?: (e: EventDto) => void;
  /** Clicking an empty spot of a day (or "New event" in Day view). */
  onNewEvent?: (day: Date) => void;
  /** The days shown changed: [from, to) — the page loads what falls in them. */
  onRangeChange?: (range: { from: Date; to: Date }) => void;
  /** Extra controls after the scale (e.g. Me / Team). */
  extraControls?: React.ReactNode;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LANE_H = 24;
const NUM_H = 32;
const HEAD_H = 34; // the weekday row
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
  | { kind: 'ghost'; key: string; ghost: GhostOccurrenceDto; start: Date; end: Date }
  | { kind: 'event'; key: string; event: EventDto; start: Date; end: Date }
  | { kind: 'reminder'; key: string; reminder: CalendarReminderDto; start: Date; end: Date }
  | { kind: 'google'; key: string; google: GoogleEventDto; start: Date; end: Date };

/**
 * The days a timed or all-day item covers. All-day ones are stored at UTC
 * midnight of each day (read back as that calendar date); a timed one ending
 * exactly at midnight doesn't spill into the next day.
 */
function spanOf(e: { startAt: string; endAt: string; allDay: boolean }): {
  start: Date;
  end: Date;
} {
  if (e.allDay) {
    const day = (iso: string) => {
      const d = new Date(iso);
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    };
    return { start: day(e.startAt), end: day(e.endAt) };
  }
  const start = dateOnly(e.startAt);
  const endMs = Math.max(new Date(e.startAt).getTime(), new Date(e.endAt).getTime() - 1);
  return { start, end: startOfDay(new Date(endMs)) };
}

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
  events = [],
  reminders = [],
  google = [],
  onOpenEvent,
  onNewEvent,
  onRangeChange,
  extraControls,
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
      setAvail(Math.max(6 * MIN_WEEK_H + HEAD_H, window.innerHeight - top - 24));
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
    for (const event of events) {
      out.push({ kind: 'event', key: `e${event.id}`, event, ...spanOf(event) });
    }
    for (const reminder of reminders) {
      const day = dateOnly(reminder.remindAt);
      out.push({ kind: 'reminder', key: `r${reminder.id}`, reminder, start: day, end: day });
    }
    for (const g of google) {
      out.push({ kind: 'google', key: `G${g.id}`, google: g, ...spanOf(g) });
    }
    return out;
  }, [rows, ghosts, events, reminders, google]);

  // The weeks shown: one for Week view, six for Month view.
  const weeks = useMemo(() => {
    if (scale === 'week') return [addDays(anchor, -anchor.getDay())];
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = addDays(first, -first.getDay());
    return Array.from({ length: 6 }, (_, i) => addDays(gridStart, i * 7));
  }, [anchor, scale]);

  // Tell the page which days are on screen, so it loads what falls in them.
  const rangeFrom = scale === 'day' ? anchor : weeks[0]!;
  const rangeTo = scale === 'day' ? addDays(anchor, 1) : addDays(weeks[weeks.length - 1]!, 7);
  const rangeKey = `${rangeFrom.getTime()}-${rangeTo.getTime()}`;
  useEffect(() => {
    onRangeChange?.({ from: rangeFrom, to: rangeTo });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

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
    if (p.item.kind !== 'task') {
      const it = p.item;
      const color =
        it.kind === 'event'
          ? EVENT_COLORS[it.event.kind]
          : it.kind === 'reminder'
            ? REMINDER_COLOR
            : GOOGLE_COLOR;
      const name =
        it.kind === 'event'
          ? it.event.title
          : it.kind === 'reminder'
            ? it.reminder.taskName
            : it.google.title;
      const timed =
        it.kind === 'event'
          ? !it.event.allDay && sameDay(it.start, it.end)
            ? timeOf(it.event.startAt)
            : ''
          : it.kind === 'reminder'
            ? timeOf(it.reminder.remindAt)
            : !it.google.allDay && sameDay(it.start, it.end)
              ? timeOf(it.google.startAt)
              : '';
      const title =
        it.kind === 'event'
          ? `${EVENT_KIND_LABELS[it.event.kind]}: ${it.event.title}`
          : it.kind === 'reminder'
            ? `Reminder: ${it.reminder.taskName}${it.reminder.note ? ` — ${it.reminder.note}` : ''}`
            : `Google Calendar: ${it.google.title} (read-only)`;
      const open = () => {
        if (it.kind === 'event') onOpenEvent?.(it.event);
        else if (it.kind === 'reminder') openTask(it.reminder.taskId);
        else if (it.google.link) window.open(it.google.link, '_blank', 'noopener');
      };
      return (
        <button
          key={it.key}
          type="button"
          className={cx(
            'hb-tcal-ev',
            'is-kind',
            `k-${it.kind}`,
            p.clipStart && 'clip-s',
            p.clipEnd && 'clip-e',
          )}
          style={{ top, left, width, ['--k' as string]: color }}
          title={title}
          onClick={open}
        >
          {it.kind === 'reminder' && <Bell size={11} aria-hidden="true" />}
          {it.kind === 'event' && it.event.isPrivate && <Lock size={11} aria-hidden="true" />}
          {it.kind === 'google' && (
            <span className="hb-tcal-g" aria-hidden="true">
              G
            </span>
          )}
          {timed && <span className="hb-tcal-ev-time">{timed}</span>}
          <span className="hb-tcal-ev-name">{name}</span>
        </button>
      );
    }
    const t = p.item.task;
    const readOnly = t.mentionOnly || t.treeOnly || t.viewOnly;
    const treeCue = t.treeOnly && !t.mentionOnly;
    const time = timeOf(t.dueAt ?? t.startAt);
    return (
      <button
        key={p.item.key}
        type="button"
        className={cx('hb-tcal-ev', isLate(t) && 'is-late', readOnly && 'is-readonly')}
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
      {extraControls}
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
          items={items
            .filter((it) => it.start <= anchor && it.end >= anchor)
            .sort((a, b) => sortTime(a) - sortTime(b))}
          isLate={isLate}
          materializing={materializing}
          onGhost={(g) => void materializeGhost(g)}
          onOpen={openTask}
          onOpenEvent={onOpenEvent}
          onNewEvent={onNewEvent ? () => onNewEvent(anchor) : undefined}
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
                        onNewEvent && 'can-add',
                      )}
                      title={onNewEvent ? 'Click an empty spot to add an event' : undefined}
                      onClick={(e: MouseEvent) => {
                        if (onNewEvent && e.target === e.currentTarget) onNewEvent(day);
                      }}
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
    </div>
  );
}

/** Day view: the day's tasks as rows — what, when, who and where it stands. */
/** When an item happens that day, for sorting Day view (whole-day ones first). */
function sortTime(it: Item): number {
  switch (it.kind) {
    case 'task':
      return new Date(it.task.dueAt ?? it.task.startAt ?? 0).getTime();
    case 'ghost':
      return new Date(it.ghost.dueAt ?? it.ghost.startAt ?? 0).getTime();
    case 'event':
      return it.event.allDay ? 0 : new Date(it.event.startAt).getTime();
    case 'reminder':
      return new Date(it.reminder.remindAt).getTime();
    case 'google':
      return it.google.allDay ? 0 : new Date(it.google.startAt).getTime();
  }
}

function spanText(e: { startAt: string; endAt: string; allDay: boolean }): string {
  if (e.allDay) return 'All day';
  const t = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${t(e.startAt)} – ${t(e.endAt)}`;
}

function DayList({
  items,
  isLate,
  materializing,
  onGhost,
  onOpen,
  onOpenEvent,
  onNewEvent,
}: {
  items: Item[];
  isLate: (t: TaskRowDto) => boolean;
  materializing: string | null;
  onGhost: (g: GhostOccurrenceDto) => void;
  onOpen: (id: number) => void;
  onOpenEvent?: (e: EventDto) => void;
  onNewEvent?: () => void;
}) {
  const add = onNewEvent && (
    <button type="button" className="hb-btn hb-btn-sm hb-tcal-dayadd" onClick={onNewEvent}>
      <Plus size={14} aria-hidden="true" /> New event on this day
    </button>
  );
  if (items.length === 0)
    return (
      <div className="hb-tcal-dayempty">
        Nothing scheduled on this day.
        {add}
      </div>
    );
  return (
    <div className="hb-tcal-day">
      {add}
      {items.map((it) => {
        if (it.kind === 'event' || it.kind === 'reminder' || it.kind === 'google') {
          const color =
            it.kind === 'event'
              ? EVENT_COLORS[it.event.kind]
              : it.kind === 'reminder'
                ? REMINDER_COLOR
                : GOOGLE_COLOR;
          const what =
            it.kind === 'event'
              ? EVENT_KIND_LABELS[it.event.kind]
              : it.kind === 'reminder'
                ? it.reminder.kind === 'snooze'
                  ? 'Back from snooze'
                  : 'Reminder'
                : 'Google Calendar';
          const name =
            it.kind === 'event'
              ? it.event.title
              : it.kind === 'reminder'
                ? it.reminder.taskName
                : it.google.title;
          const when =
            it.kind === 'event'
              ? spanText(it.event)
              : it.kind === 'reminder'
                ? new Date(it.reminder.remindAt).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                : spanText(it.google);
          const extra =
            it.kind === 'event'
              ? it.event.location
              : it.kind === 'reminder'
                ? it.reminder.note
                : it.google.location;
          return (
            <button
              key={it.key}
              type="button"
              className={cx('hb-tcal-dayrow', 'is-kind')}
              style={{ ['--k' as string]: color }}
              onClick={() => {
                if (it.kind === 'event') onOpenEvent?.(it.event);
                else if (it.kind === 'reminder') onOpen(it.reminder.taskId);
                else if (it.google.link) window.open(it.google.link, '_blank', 'noopener');
              }}
            >
              <i style={{ background: color }} aria-hidden="true" />
              <span className="hb-stack">
                <b>{name}</b>
                <span className="hb-sub">
                  {what} · {when}
                  {extra ? ` · ${extra}` : ''}
                </span>
              </span>
              {it.kind === 'event' && it.event.attendees.length > 0 && (
                <span className="hb-small">
                  {it.event.attendees.length}{' '}
                  {it.event.attendees.length === 1 ? 'person' : 'people'}
                </span>
              )}
            </button>
          );
        }
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
              title="Upcoming repeat — click to create it now"
            >
              <Repeat size={15} aria-hidden="true" />
              <span className="hb-stack">
                <b>{materializing === key ? 'Creating…' : g.name}</b>
                <span className="hb-sub">Upcoming repeat · click to create it now</span>
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
