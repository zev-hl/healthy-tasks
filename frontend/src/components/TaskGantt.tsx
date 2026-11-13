import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Eye, GitFork, Repeat } from 'lucide-react';
import {
  TASK_STATUS_LABELS,
  type GhostOccurrenceDto,
  type TaskRowDto,
  type TaskStatus,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { Avatar, userLabel } from './ui/Avatar';
import { STATUS_DOT, Segmented, cx } from './harbor/ui';

interface Props {
  rows: TaskRowDto[];
  loading: boolean;
  onChanged: () => void;
  /** Phase 11: computed future occurrences, overlaid as dashed ghost bars on
   * their source task's row (task-sourced ghosts whose source is visible). */
  ghosts?: GhostOccurrenceDto[];
}

type Zoom = 'day' | 'week' | 'month';
const DAY_W: Record<Zoom, number> = { day: 40, week: 18, month: 6 };
const ZOOM_KEY = 'hb-gantt-zoom';

const DAY_MS = 86_400_000;
const ROW_H = 48;
const HEAD_H = 56;
const MAX_DAYS = 800; // guard against pathological multi-year spans
const STATUSES: TaskStatus[] = ['Open', 'InProgress', 'OnHold', 'Review', 'Completed', 'Canceled'];

type DragMode = 'move' | 'start' | 'end';
interface DragState {
  id: number;
  mode: DragMode;
  startX: number;
  origStart: string | null;
  origDue: string | null;
  startAt: string | null;
  dueAt: string | null;
}

function dateOnly(iso: string): number {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function shiftIsoDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
function todayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Flatten rows into parent→child DFS order with a depth for indentation. */
function buildTree(rows: TaskRowDto[]): { task: TaskRowDto; depth: number }[] {
  const visible = new Set(rows.map((r) => r.id));
  const childrenByParent = new Map<number, TaskRowDto[]>();
  const roots: TaskRowDto[] = [];
  for (const r of rows) {
    if (r.parentId != null && visible.has(r.parentId)) {
      const list = childrenByParent.get(r.parentId) ?? [];
      list.push(r);
      childrenByParent.set(r.parentId, list);
    } else {
      roots.push(r);
    }
  }
  const out: { task: TaskRowDto; depth: number }[] = [];
  const emit = (t: TaskRowDto, depth: number): void => {
    out.push({ task: t, depth });
    for (const c of childrenByParent.get(t.id) ?? []) emit(c, depth + 1);
  };
  for (const r of roots) emit(r, 0);
  return out;
}

/**
 * Gantt view, Harbor redesign. One row per task (indented for Parent/Child):
 * the task column shows its status, owner and due date; the timeline shows a
 * bar from Start to Due in the status color, or a diamond for a task with only
 * a due date. A bar too short for its name carries the name beside it. Late
 * work is marked red. Arrows connect Is-Blocked-By predecessors to their
 * dependents. Bars drag — the whole bar shifts both dates, each edge resizes
 * one — and commit on release through the same PATCH a manual edit uses (so
 * Start<Due validation applies), with `coalesceHistory` so repeated nudges
 * collapse into one History entry. Zoom (days / weeks / months) is remembered;
 * the view opens on today.
 */
export function TaskGantt({ rows, loading, onChanged, ghosts = [] }: Props) {
  const navigate = useNavigate();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [materializing, setMaterializing] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [zoom, setZoomState] = useState<Zoom>(() => {
    try {
      const z = localStorage.getItem(ZOOM_KEY);
      return z === 'day' || z === 'week' || z === 'month' ? z : 'day';
    } catch {
      return 'day';
    }
  });
  const setZoom = (z: Zoom) => {
    setZoomState(z);
    try {
      localStorage.setItem(ZOOM_KEY, z);
    } catch {
      /* per-viewer convenience only */
    }
  };
  const committing = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dayW = DAY_W[zoom];

  const ordered = useMemo(() => buildTree(rows), [rows]);

  // Ghosts overlaid on their source task's row (task-sourced only; a recurring
  // task appears as a normal row and its future occurrences trail to the right).
  const ghostsBySource = useMemo(() => {
    const m = new Map<number, GhostOccurrenceDto[]>();
    for (const g of ghosts) {
      if (g.sourceType !== 'task') continue;
      const list = m.get(g.sourceId) ?? [];
      list.push(g);
      m.set(g.sourceId, list);
    }
    return m;
  }, [ghosts]);

  async function materializeGhost(g: GhostOccurrenceDto) {
    const key = `${g.sourceId}:${g.seq}`;
    if (materializing) return;
    setMaterializing(key);
    setError(null);
    try {
      if (g.sourceType === 'task') await api.materializeTaskOccurrence(g.sourceId, g.seq);
      else await api.materializeTemplateGhost(g.sourceId, g.seq);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the occurrence');
    } finally {
      setMaterializing(null);
    }
  }

  const effDates = (task: TaskRowDto): { startAt: string | null; dueAt: string | null } =>
    drag && drag.id === task.id
      ? { startAt: drag.startAt, dueAt: drag.dueAt }
      : { startAt: task.startAt, dueAt: task.dueAt };

  // Timeline range: every plotted date plus today, padded on both sides.
  const range = useMemo(() => {
    const today = todayMs();
    let min = today;
    let max = today;
    const take = (iso: string | null) => {
      if (!iso) return;
      const t = dateOnly(iso);
      if (t < min) min = t;
      if (t > max) max = t;
    };
    for (const { task } of ordered) {
      take(task.startAt);
      take(task.dueAt);
    }
    // Extend the timeline to cover ghost previews of any visible recurring task.
    const visibleIds = new Set(ordered.map((o) => o.task.id));
    for (const g of ghosts) {
      if (g.sourceType !== 'task' || !visibleIds.has(g.sourceId)) continue;
      take(g.startAt);
      take(g.dueAt);
    }
    const pad = zoom === 'month' ? 21 : zoom === 'week' ? 10 : 4;
    const start = min - pad * DAY_MS;
    let days = Math.round((max - min) / DAY_MS) + 2 * pad + 1;
    if (days > MAX_DAYS) days = MAX_DAYS;
    return { start, days };
  }, [ordered, ghosts, zoom]);

  const dayIndex = (iso: string): number => Math.round((dateOnly(iso) - range.start) / DAY_MS);
  const todayIdx = Math.round((todayMs() - range.start) / DAY_MS);

  /** A bar from start to due; null when the task has only one date (a marker). */
  function barGeom(startAt: string | null, dueAt: string | null): { x: number; w: number } | null {
    if (!startAt || !dueAt) return null;
    const s = dayIndex(startAt);
    const e = dayIndex(dueAt);
    return { x: s * dayW, w: Math.max(dayW, (e - s + 1) * dayW) };
  }
  /** Where an arrow attaches: a bar's ends, or a marker's centre. */
  function anchor(task: TaskRowDto): { x1: number; x2: number } | null {
    const { startAt, dueAt } = effDates(task);
    const g = barGeom(startAt, dueAt);
    if (g) return { x1: g.x, x2: g.x + g.w };
    const one = dueAt ?? startAt;
    if (!one) return null;
    const c = dayIndex(one) * dayW + dayW / 2;
    return { x1: c - 7, x2: c + 7 };
  }

  const timelineWidth = range.days * dayW;
  const indexById = useMemo(() => {
    const m = new Map<number, number>();
    ordered.forEach(({ task }, i) => m.set(task.id, i));
    return m;
  }, [ordered]);

  // Open on today (and again when the zoom changes).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, todayIdx * dayW - el.clientWidth * 0.3);
  }, [todayIdx, dayW, loading]);
  const scrollToToday = () => {
    const el = scrollRef.current;
    if (el)
      el.scrollTo({
        left: Math.max(0, todayIdx * dayW - el.clientWidth * 0.3),
        behavior: 'smooth',
      });
  };

  // --- Drag handling (pointer capture; commit on release) ------------------
  function onPointerDown(e: React.PointerEvent, task: TaskRowDto, mode: DragMode) {
    e.stopPropagation();
    // Read-only tasks (mention-only OR tree-inherited) can't be dragged to reschedule.
    if (task.mentionOnly || task.treeOnly) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      id: task.id,
      mode,
      startX: e.clientX,
      origStart: task.startAt,
      origDue: task.dueAt,
      startAt: task.startAt,
      dueAt: task.dueAt,
    });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const deltaDays = Math.round((e.clientX - drag.startX) / dayW);
    let startAt = drag.origStart;
    let dueAt = drag.origDue;
    if (drag.mode === 'move') {
      if (drag.origStart) startAt = shiftIsoDays(drag.origStart, deltaDays);
      if (drag.origDue) dueAt = shiftIsoDays(drag.origDue, deltaDays);
    } else if (drag.mode === 'start' && drag.origStart) {
      const next = shiftIsoDays(drag.origStart, deltaDays);
      // Keep Start strictly before Due (leave at least a day).
      startAt =
        drag.origDue && dateOnly(next) >= dateOnly(drag.origDue)
          ? shiftIsoDays(drag.origDue, -1)
          : next;
    } else if (drag.mode === 'end' && drag.origDue) {
      const next = shiftIsoDays(drag.origDue, deltaDays);
      dueAt =
        drag.origStart && dateOnly(next) <= dateOnly(drag.origStart)
          ? shiftIsoDays(drag.origStart, 1)
          : next;
    }
    setDrag((d) => (d ? { ...d, startAt, dueAt } : d));
  }

  async function onPointerUp() {
    if (!drag) return;
    const changed = drag.startAt !== drag.origStart || drag.dueAt !== drag.origDue;
    const snapshot = drag;
    setDrag(null);
    if (!changed || committing.current) return;
    committing.current = true;
    setError(null);
    try {
      await api.updateTask(snapshot.id, {
        startAt: snapshot.startAt,
        dueAt: snapshot.dueAt,
        coalesceHistory: true,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update dates');
      onChanged(); // resync to the server truth
    } finally {
      committing.current = false;
    }
  }

  // --- Header: months on top, days (or week starts) below ---------------------
  const dayCells = useMemo(
    () =>
      Array.from({ length: range.days }, (_, i) => {
        const d = new Date(range.start + i * DAY_MS);
        return {
          i,
          day: d.getDate(),
          dow: d.getDay(),
          weekend: d.getDay() === 0 || d.getDay() === 6,
        };
      }),
    [range.start, range.days],
  );
  const months = useMemo(() => {
    const out: { i: number; span: number; label: string }[] = [];
    for (const c of dayCells) {
      if (c.i === 0 || c.day === 1) {
        const d = new Date(range.start + c.i * DAY_MS);
        out.push({
          i: c.i,
          span: 0,
          label: d.toLocaleDateString(undefined, {
            month: zoom === 'day' ? 'long' : 'short',
            year: 'numeric',
          }),
        });
      }
      out[out.length - 1]!.span += 1;
    }
    return out;
  }, [dayCells, range.start, zoom]);
  const showDay = (c: { dow: number; day: number }) =>
    zoom === 'day' ? true : zoom === 'week' ? c.dow === 1 : false;

  const nDated = ordered.filter(({ task }) => task.startAt || task.dueAt).length;
  const today = todayMs();

  return (
    <div className="hb-gantt-wrap">
      {error && (
        <div className="hb-alert" role="alert">
          {error}
        </div>
      )}
      <div className="hb-gantt-bar">
        <Segmented
          small
          label="Zoom"
          value={zoom}
          options={[
            { value: 'day', label: 'Days' },
            { value: 'week', label: 'Weeks' },
            { value: 'month', label: 'Months' },
          ]}
          onChange={setZoom}
        />
        <button type="button" className="hb-btn hb-btn-secondary hb-btn-sm" onClick={scrollToToday}>
          <CalendarClock size={15} aria-hidden="true" /> Today
        </button>
        <span className="hb-grow" />
        <span className="hb-gantt-legend" aria-label="Status colors">
          {STATUSES.map((s) => (
            <span key={s}>
              <i style={{ background: STATUS_DOT[s] }} aria-hidden="true" />
              {TASK_STATUS_LABELS[s]}
            </span>
          ))}
          <span>
            <i className="is-late" aria-hidden="true" />
            Late
          </span>
        </span>
      </div>

      <div className="hb-gantt" ref={scrollRef}>
        <div
          className="hb-gantt-inner"
          style={{ width: `calc(var(--gantt-label-w) + ${timelineWidth}px)` }}
        >
          {/* The task column: sticks to the left while the timeline scrolls. */}
          <div className="hb-gantt-labels">
            <div className="hb-gantt-labels-head" style={{ height: HEAD_H }}>
              <span>{loading ? 'Loading…' : `${ordered.length} tasks`}</span>
              <span className="hb-sub">
                {nDated === ordered.length
                  ? 'all dated'
                  : `${ordered.length - nDated} without dates`}
              </span>
            </div>
            {ordered.map(({ task, depth }) => {
              const late =
                !!task.dueAt &&
                dateOnly(task.dueAt) < today &&
                task.status !== 'Completed' &&
                task.status !== 'Canceled';
              return (
                <button
                  key={task.id}
                  type="button"
                  className={cx('hb-gantt-label', hoverId === task.id && 'is-hover')}
                  style={{ height: ROW_H, paddingLeft: 14 + depth * 18 }}
                  onClick={() => navigate(`/tasks/${task.id}`)}
                  onMouseEnter={() => setHoverId(task.id)}
                  onMouseLeave={() => setHoverId(null)}
                  title={task.name}
                >
                  <i
                    className="hb-gantt-dot"
                    style={{ background: STATUS_DOT[task.status] }}
                    aria-label={TASK_STATUS_LABELS[task.status]}
                  />
                  <span className="hb-gantt-label-txt">
                    <span className="hb-gantt-label-name">{task.name}</span>
                    <span className={cx('hb-sub', late && 'late')}>
                      #{task.id}
                      {task.dueAt ? ` · due ${shortDay(task.dueAt)}` : ' · no due date'}
                    </span>
                  </span>
                  {task.assignee ? (
                    <span title={userLabel(task.assignee)}>
                      <Avatar user={task.assignee} size="xs" decorative />
                    </span>
                  ) : (
                    <span className="hb-gantt-noone" title="Unassigned" />
                  )}
                </button>
              );
            })}
          </div>

          {/* The timeline */}
          <div className="hb-gantt-time" style={{ width: timelineWidth }}>
            <div className="hb-gantt-head" style={{ height: HEAD_H }}>
              <div className="hb-gantt-months">
                {months.map((m) => (
                  <span
                    key={m.i}
                    style={{ left: m.i * dayW, width: m.span * dayW }}
                    title={m.label}
                  >
                    {m.span * dayW > 60 ? m.label : ''}
                  </span>
                ))}
              </div>
              <div className="hb-gantt-days">
                {dayCells.map((c) =>
                  showDay(c) || c.i === todayIdx ? (
                    <span
                      key={c.i}
                      className={cx(c.i === todayIdx && 'is-today', c.weekend && 'is-weekend')}
                      style={
                        zoom === 'day'
                          ? { left: c.i * dayW, width: dayW }
                          : { left: c.i * dayW, width: 40, textAlign: 'left' }
                      }
                    >
                      {c.i === todayIdx && zoom !== 'day' ? 'Today' : c.day}
                    </span>
                  ) : null,
                )}
              </div>
            </div>

            <div
              className="hb-gantt-rows"
              style={{
                height: ordered.length * ROW_H,
                width: timelineWidth,
                backgroundSize: `${zoom === 'day' ? dayW : dayW * 7}px ${ROW_H}px`,
              }}
            >
              {/* Weekend shading (when days are wide enough to see) */}
              {zoom !== 'month' &&
                dayCells.map((c) =>
                  c.weekend ? (
                    <div
                      key={c.i}
                      className="hb-gantt-weekend"
                      style={{ left: c.i * dayW, width: dayW }}
                    />
                  ) : null,
                )}
              {/* Row hover band, linked with the task column */}
              {hoverId != null && indexById.has(hoverId) && (
                <div
                  className="hb-gantt-hoverband"
                  style={{ top: indexById.get(hoverId)! * ROW_H, height: ROW_H }}
                />
              )}
              {/* Today */}
              {todayIdx >= 0 && todayIdx < range.days && (
                <div
                  className="hb-gantt-today"
                  style={{ left: todayIdx * dayW + dayW / 2, height: ordered.length * ROW_H }}
                />
              )}

              {/* Dependency arrows (predecessor → dependent) */}
              <svg
                className="hb-gantt-arrows"
                width={timelineWidth}
                height={ordered.length * ROW_H}
              >
                <defs>
                  <marker
                    id="hb-gantt-head"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M0,0 L7,4 L0,8 Z" fill="#8a9ab0" />
                  </marker>
                </defs>
                {ordered.flatMap(({ task }) => {
                  const toIdx = indexById.get(task.id);
                  const to = anchor(task);
                  if (toIdx == null || !to) return [];
                  return task.blockedByIds.flatMap((predId) => {
                    const fromIdx = indexById.get(predId);
                    if (fromIdx == null) return [];
                    const from = anchor(ordered[fromIdx]!.task);
                    if (!from) return [];
                    const x1 = from.x2;
                    const y1 = fromIdx * ROW_H + ROW_H / 2;
                    const x2 = to.x1;
                    const y2 = toIdx * ROW_H + ROW_H / 2;
                    const midX = Math.max(x1 + 10, x2 - 12);
                    return [
                      <path
                        key={`${predId}-${task.id}`}
                        d={`M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`}
                        className="hb-gantt-arrow"
                        markerEnd="url(#hb-gantt-head)"
                      />,
                    ];
                  });
                })}
              </svg>

              {/* Bars and markers */}
              {ordered.map(({ task }, i) => {
                const { startAt, dueAt } = effDates(task);
                const rowTop = i * ROW_H;
                const readOnly = task.mentionOnly || task.treeOnly;
                const treeCue = task.treeOnly && !task.mentionOnly;
                const late =
                  !!dueAt &&
                  dateOnly(dueAt) < today &&
                  task.status !== 'Completed' &&
                  task.status !== 'Canceled';
                const hover = {
                  onMouseEnter: () => setHoverId(task.id),
                  onMouseLeave: () => setHoverId(null),
                };
                const cue = readOnly ? (
                  treeCue ? (
                    <GitFork size={12} aria-hidden="true" />
                  ) : (
                    <Eye size={12} aria-hidden="true" />
                  )
                ) : null;
                const readOnlyNote = readOnly
                  ? ` (read-only — ${treeCue ? 'via parent/child tree position' : "you're mentioned"})`
                  : '';

                if (!startAt && !dueAt) {
                  return (
                    <span
                      key={task.id}
                      className="hb-gantt-nodate"
                      style={{
                        top: rowTop + ROW_H / 2 - 11,
                        left: Math.max(0, todayIdx * dayW + 12),
                      }}
                      {...hover}
                    >
                      No dates · open the task to plan it
                    </span>
                  );
                }

                const geom = barGeom(startAt, dueAt);
                if (!geom) {
                  // Only one date: a diamond milestone, name beside it. Drag moves it.
                  const one = (dueAt ?? startAt)!;
                  const cx0 = dayIndex(one) * dayW + dayW / 2;
                  return (
                    <div
                      key={task.id}
                      className={cx(
                        'hb-gantt-ms',
                        `st-${task.status}`,
                        late && 'is-late',
                        drag?.id === task.id && 'is-dragging',
                        readOnly && 'is-readonly',
                      )}
                      style={{ top: rowTop + ROW_H / 2 - 9, left: cx0 - 9 }}
                      onPointerDown={(e) => onPointerDown(e, task, 'move')}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onDoubleClick={() => navigate(`/tasks/${task.id}`)}
                      title={`${task.name} — ${dueAt ? 'due' : 'starts'} ${shortDay(one)}${readOnlyNote}${readOnly ? '' : ' (drag to move)'}`}
                      {...hover}
                    >
                      <i style={{ background: STATUS_DOT[task.status] }} aria-hidden="true" />
                      <span className="hb-gantt-out">
                        {cue}
                        {task.name}
                      </span>
                    </div>
                  );
                }

                const bothDates = !!task.startAt && !!task.dueAt;
                const inside = geom.w >= 96;
                return (
                  <div
                    key={task.id}
                    className={cx(
                      'hb-gantt-barx',
                      `st-${task.status}`,
                      late && 'is-late',
                      drag?.id === task.id && 'is-dragging',
                      readOnly && 'is-readonly',
                    )}
                    style={{ top: rowTop + (ROW_H - 26) / 2, left: geom.x, width: geom.w }}
                    onPointerDown={(e) => onPointerDown(e, task, 'move')}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onDoubleClick={() => navigate(`/tasks/${task.id}`)}
                    title={`${task.name} — ${shortDay(task.startAt!)} → ${shortDay(task.dueAt!)}${readOnlyNote}`}
                    {...hover}
                  >
                    {bothDates && !readOnly && (
                      <span
                        className="hb-gantt-handle start"
                        onPointerDown={(e) => onPointerDown(e, task, 'start')}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                      />
                    )}
                    {inside && (
                      <span className="hb-gantt-in">
                        {cue}
                        {task.name}
                      </span>
                    )}
                    {bothDates && !readOnly && (
                      <span
                        className="hb-gantt-handle end"
                        onPointerDown={(e) => onPointerDown(e, task, 'end')}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                      />
                    )}
                    {!inside && (
                      <span className="hb-gantt-out" style={{ left: geom.w + 8 }}>
                        {cue}
                        {task.name}
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Ghost bars: future occurrences of a recurring task, on its row.
                  Dashed/translucent, non-draggable; click to materialize now. */}
              {ordered.flatMap(({ task }, i) => {
                const gs = ghostsBySource.get(task.id);
                if (!gs) return [];
                const top = i * ROW_H + (ROW_H - 26) / 2;
                return gs.flatMap((g) => {
                  const one = g.dueAt ?? g.startAt;
                  const geom =
                    barGeom(g.startAt, g.dueAt) ??
                    (one ? { x: dayIndex(one) * dayW, w: Math.max(dayW, 26) } : null);
                  if (!geom) return [];
                  const key = `${g.sourceId}:${g.seq}`;
                  return [
                    <button
                      key={`ghost-${key}`}
                      type="button"
                      className="hb-gantt-ghost"
                      style={{ top, left: geom.x, width: geom.w }}
                      onClick={() => void materializeGhost(g)}
                      disabled={materializing === key}
                      title={`Upcoming occurrence #${g.seq} of “${g.name}” — click to create it now`}
                      aria-label={`Create upcoming occurrence #${g.seq} of ${g.name} now`}
                    >
                      {materializing === key ? '…' : <Repeat size={12} aria-hidden="true" />}
                    </button>,
                  ];
                });
              })}
            </div>
          </div>
        </div>
      </div>
      <p className="hb-gantt-tip">
        Drag a bar to move its dates, or its ends to change start or due. Double-click to open a
        task. Dashed boxes are upcoming repeats: click one to create it now.
      </p>
    </div>
  );
}
