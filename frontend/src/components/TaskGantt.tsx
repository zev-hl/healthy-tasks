import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type GhostOccurrenceDto, type TaskRowDto } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { statusPill } from './ui/indicators';

interface Props {
  rows: TaskRowDto[];
  loading: boolean;
  onChanged: () => void;
  /** Phase 11: computed future occurrences, overlaid as dashed ghost bars on
   * their source task's row (task-sourced ghosts whose source is visible). */
  ghosts?: GhostOccurrenceDto[];
}

const DAY_MS = 86_400_000;
const PX_PER_DAY = 30;
const ROW_H = 44;
const HEADER_H = 34;
const LABEL_W = 340;
const MAX_DAYS = 800; // guard against pathological multi-year spans

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
 * Gantt view (Phase 10). One row per task, indented for Parent/Child; each bar
 * spans Start→Due; SVG arrows connect Is-Blocked-By predecessors to their
 * dependents. Bars are draggable — the whole bar shifts both dates by the same
 * offset, each edge resizes one date — and commit on release through the same
 * PATCH a manual edit uses (so Start<Due validation applies), with
 * `coalesceHistory` so repeated nudges collapse into a single History entry.
 */
export function TaskGantt({ rows, loading, onChanged, ghosts = [] }: Props) {
  const navigate = useNavigate();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [materializing, setMaterializing] = useState<string | null>(null);
  const committing = useRef(false);

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

  // Timeline range: min/max of every plotted date, padded a couple of days.
  const range = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const { task } of ordered) {
      for (const iso of [task.startAt, task.dueAt]) {
        if (iso) {
          const t = dateOnly(iso);
          if (t < min) min = t;
          if (t > max) max = t;
        }
      }
    }
    // Extend the timeline to cover ghost previews of any visible recurring task.
    const visibleIds = new Set(ordered.map((o) => o.task.id));
    for (const g of ghosts) {
      if (g.sourceType !== 'task' || !visibleIds.has(g.sourceId)) continue;
      for (const iso of [g.startAt, g.dueAt]) {
        if (iso) {
          const t = dateOnly(iso);
          if (t < min) min = t;
          if (t > max) max = t;
        }
      }
    }
    const today = (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    if (min === Infinity) {
      min = today - 3 * DAY_MS;
      max = today + 14 * DAY_MS;
    }
    const start = min - 2 * DAY_MS;
    let days = Math.round((max - min) / DAY_MS) + 5;
    if (days > MAX_DAYS) days = MAX_DAYS;
    return { start, days };
  }, [ordered, ghosts]);

  const dayIndex = (iso: string): number => Math.round((dateOnly(iso) - range.start) / DAY_MS);

  function barGeom(startAt: string | null, dueAt: string | null): { x: number; w: number } | null {
    const sIso = startAt ?? dueAt;
    const eIso = dueAt ?? startAt;
    if (!sIso || !eIso) return null;
    const startIdx = dayIndex(sIso);
    const endIdx = dayIndex(eIso);
    const x = startIdx * PX_PER_DAY;
    const w = Math.max(PX_PER_DAY, (endIdx - startIdx + 1) * PX_PER_DAY);
    return { x, w };
  }

  const timelineWidth = range.days * PX_PER_DAY;
  const rowCenterY = (index: number): number => HEADER_H + index * ROW_H + ROW_H / 2;
  const indexById = useMemo(() => {
    const m = new Map<number, number>();
    ordered.forEach(({ task }, i) => m.set(task.id, i));
    return m;
  }, [ordered]);

  // --- Drag handling (pointer capture; commit on release) ------------------
  function onPointerDown(e: React.PointerEvent, task: TaskRowDto, mode: DragMode) {
    e.stopPropagation();
    // Phase 13: mention-only tasks are read-only for dates — no drag-to-reschedule.
    if (task.mentionOnly) return;
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
    const deltaDays = Math.round((e.clientX - drag.startX) / PX_PER_DAY);
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

  // Day-tick header cells (mark month starts + today).
  const todayIdx = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - range.start) / DAY_MS);
  }, [range.start]);

  const dayCells = useMemo(
    () =>
      Array.from({ length: range.days }, (_, i) => {
        const d = new Date(range.start + i * DAY_MS);
        return {
          i,
          day: d.getDate(),
          monthStart: d.getDate() === 1,
          isToday: i === todayIdx,
          weekend: d.getDay() === 0 || d.getDay() === 6,
          label: d.toLocaleDateString(undefined, { month: 'short' }),
        };
      }),
    [range.start, range.days, todayIdx],
  );

  return (
    <div className="gantt-wrap">
      {error && <div className="alert error">{error}</div>}
      <div className="gantt-scroll">
        <div className="gantt-inner" style={{ width: LABEL_W + timelineWidth }}>
          {/* Left label column */}
          <div className="gantt-labels" style={{ width: LABEL_W }}>
            <div className="gantt-labels-head" style={{ height: HEADER_H }}>
              <span className="mono muted">{loading ? 'Loading…' : `${ordered.length} tasks`}</span>
            </div>
            {ordered.map(({ task, depth }) => (
              <button
                key={task.id}
                type="button"
                className="gantt-label"
                style={{ height: ROW_H, paddingLeft: 10 + depth * 20 }}
                onClick={() => navigate(`/tasks/${task.id}`)}
                title={task.name}
              >
                <span className="mono gantt-label-id">#{task.id}</span>
                <span className="gantt-label-name">{task.name}</span>
              </button>
            ))}
          </div>

          {/* Timeline */}
          <div className="gantt-timeline" style={{ width: timelineWidth }}>
            <div className="gantt-timeline-head" style={{ height: HEADER_H, width: timelineWidth }}>
              {dayCells.map((c) => (
                <div
                  key={c.i}
                  className={`gantt-daytick${c.isToday ? ' today' : ''}${c.weekend ? ' weekend' : ''}${c.monthStart ? ' month-start' : ''}`}
                  style={{ left: c.i * PX_PER_DAY, width: PX_PER_DAY }}
                >
                  {c.monthStart && <span className="gantt-month mono">{c.label}</span>}
                  <span className="gantt-daynum mono">{c.day}</span>
                </div>
              ))}
            </div>

            <div
              className="gantt-rows"
              style={{
                height: ordered.length * ROW_H,
                width: timelineWidth,
                // Subtle per-day vertical gridlines behind the rows.
                backgroundImage: `repeating-linear-gradient(to right, var(--border-soft) 0, var(--border-soft) 1px, transparent 1px, transparent ${PX_PER_DAY}px)`,
              }}
            >
              {/* Weekend column shading */}
              {dayCells.map((c) =>
                c.weekend ? (
                  <div
                    key={c.i}
                    className="gantt-col-bg weekend"
                    style={{ left: c.i * PX_PER_DAY, width: PX_PER_DAY }}
                  />
                ) : null,
              )}
              {/* Vertical "today" guide line */}
              {todayIdx >= 0 && todayIdx < range.days && (
                <div
                  className="gantt-today-line"
                  style={{ left: todayIdx * PX_PER_DAY + PX_PER_DAY / 2, height: ordered.length * ROW_H }}
                />
              )}

              {/* Dependency arrows (predecessor → dependent) */}
              <svg
                className="gantt-arrows"
                width={timelineWidth}
                height={ordered.length * ROW_H}
                style={{ top: 0, left: 0 }}
              >
                <defs>
                  <marker
                    id="gantt-arrowhead"
                    markerWidth="7"
                    markerHeight="7"
                    refX="6"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0,0 L6,3 L0,6 Z" fill="var(--faint)" />
                  </marker>
                </defs>
                {ordered.flatMap(({ task }) => {
                  const toIdx = indexById.get(task.id);
                  if (toIdx == null) return [];
                  const toGeom = barGeom(effDates(task).startAt, effDates(task).dueAt);
                  if (!toGeom) return [];
                  return task.blockedByIds.flatMap((predId) => {
                    const fromIdx = indexById.get(predId);
                    if (fromIdx == null) return [];
                    const pred = ordered[fromIdx]!.task;
                    const fromGeom = barGeom(effDates(pred).startAt, effDates(pred).dueAt);
                    if (!fromGeom) return [];
                    const x1 = fromGeom.x + fromGeom.w;
                    const y1 = rowCenterY(fromIdx) - HEADER_H;
                    const x2 = toGeom.x;
                    const y2 = rowCenterY(toIdx) - HEADER_H;
                    const midX = Math.max(x1 + 10, x2 - 10);
                    const d = `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
                    return [
                      <path
                        key={`${predId}-${task.id}`}
                        d={d}
                        className="gantt-arrow"
                        markerEnd="url(#gantt-arrowhead)"
                      />,
                    ];
                  });
                })}
              </svg>

              {/* Bars */}
              {ordered.map(({ task }, i) => {
                const { startAt, dueAt } = effDates(task);
                const geom = barGeom(startAt, dueAt);
                const top = i * ROW_H + (ROW_H - 20) / 2;
                if (!geom) {
                  return (
                    <div
                      key={task.id}
                      className="gantt-nobar mono"
                      style={{ top: top + 3, left: 6 }}
                    >
                      no dates
                    </div>
                  );
                }
                const bothDates = !!task.startAt && !!task.dueAt;
                const isDragging = drag?.id === task.id;
                const pill = statusPill(task.status);
                return (
                  <div
                    key={task.id}
                    className={`gantt-bar${isDragging ? ' dragging' : ''}${task.status === 'Completed' ? ' done' : ''}${task.mentionOnly ? ' mention-only' : ''}`}
                    style={{
                      top,
                      left: geom.x,
                      width: geom.w,
                      background: pill.bg,
                      border: `1px solid ${pill.dot}`,
                      color: pill.fg,
                    }}
                    onPointerDown={(e) => onPointerDown(e, task, 'move')}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onDoubleClick={() => navigate(`/tasks/${task.id}`)}
                    title={
                      task.mentionOnly
                        ? `${task.name} (read-only — you're mentioned)`
                        : `${task.name}${bothDates ? '' : ' (drag to move)'}`
                    }
                  >
                    {task.mentionOnly && <span className="gantt-bar-cue" aria-hidden="true">👁</span>}
                    {bothDates && !task.mentionOnly && (
                      <span
                        className="gantt-handle start"
                        onPointerDown={(e) => onPointerDown(e, task, 'start')}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                      />
                    )}
                    <span className="gantt-bar-label">{task.name}</span>
                    {bothDates && !task.mentionOnly && (
                      <span
                        className="gantt-handle end"
                        onPointerDown={(e) => onPointerDown(e, task, 'end')}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                      />
                    )}
                  </div>
                );
              })}

              {/* Ghost bars: future occurrences of a recurring task, on its row.
                  Dashed/translucent, non-draggable; click to materialize now. */}
              {ordered.flatMap(({ task }, i) => {
                const gs = ghostsBySource.get(task.id);
                if (!gs) return [];
                const top = i * ROW_H + (ROW_H - 20) / 2;
                return gs.flatMap((g) => {
                  const geom = barGeom(g.startAt, g.dueAt);
                  if (!geom) return [];
                  const key = `${g.sourceId}:${g.seq}`;
                  return [
                    <button
                      key={`ghost-${key}`}
                      type="button"
                      className="gantt-bar ghost"
                      style={{ top, left: geom.x, width: geom.w }}
                      onClick={() => void materializeGhost(g)}
                      disabled={materializing === key}
                      title={`Upcoming occurrence #${g.seq} of “${g.name}” — click to create it now`}
                    >
                      <span className="gantt-bar-label">
                        {materializing === key ? '…' : `↻ ${g.name}`}
                      </span>
                    </button>,
                  ];
                });
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
