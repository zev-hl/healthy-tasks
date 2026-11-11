import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarCheck2,
  Check,
  ChevronLeft,
  ChevronRight,
  Layers,
  Lock,
  Pencil,
} from 'lucide-react';
import {
  TIME_DAY_MAX_MINUTES,
  formatDuration,
  formatHM,
  type TimeDayDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { DayPanel } from '../components/time/DayPanel';
import { useDutyCatalog, type CatalogDuty } from '../lib/duties';
import { isStaleWriteError } from '../lib/useStaleWriteGuard';
import {
  DOW_LONG,
  DOW_SHORT,
  MONTH_LONG,
  MONTH_SHORT,
  addDays,
  addMonths,
  dayOfWeek,
  daysInRange,
  formatDay,
  formatRange,
  isWeekend,
  monthEnd,
  monthGrid,
  monthStart,
  parseDate,
  todayISO,
  weekStart,
} from '../lib/calendar';
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { Bar, Btn, Card, CardHead, Empty, Segmented, Tile, cx } from '../components/harbor/ui';
import { useToast } from '../components/harbor/Toast';
import { TimeTrackerCard } from './dashboard/TimeTrackerCard';
import { CellEditor } from './time/CellEditor';

/**
 * My Time (Department Duties), Harbor redesign. Each person logs hours and
 * minutes against the duties they hold, per day, and marks each day
 * Completed. The week is a timesheet — a row per duty, a column per day —
 * where a cell is typed into directly; the month is a calendar of day totals.
 * "Hide Sat & Sun" is remembered per user and weekend time still counts.
 * Future days are locked; a Completed day is read-only until reopened.
 */

type View = 'week' | 'month';
type DayState = 'none' | 'done' | 'late' | 'open';

const DAY_MINUTES = 8 * 60;

/** Completed / Not completed / Mark complete, for a day. */
export function dayStatus(
  date: string,
  day: Pick<TimeDayDto, 'entries' | 'completed'> | undefined,
  today: string,
): DayState {
  const has = !!day && day.entries.length > 0;
  if (date > today) return 'none';
  if (isWeekend(date) && !has && !day?.completed) return 'none';
  if (day?.completed) return 'done';
  if (date < today) return 'late';
  return 'open';
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

export function MyTimePage() {
  const { user } = useAuth();
  const { duties, holdings, departments, loading: catalogLoading } = useDutyCatalog();
  const toast = useToast();
  const today = todayISO();
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(today);
  const [hideWe, setHideWe] = useState(false);
  const [days, setDays] = useState<Map<string, TimeDayDto>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [openDate, setOpenDate] = useState<string | null>(null);
  // The day opens in the side panel; on narrow screens that sits below the
  // timesheet, so bring it into view.
  const dayRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (openDate && window.matchMedia?.('(max-width: 1359px)').matches)
      dayRef.current?.scrollIntoView({ block: 'start' });
  }, [openDate]);
  const [editing, setEditing] = useState<{ date: string; dutyId: string } | null>(null);
  const cellRef = useRef<HTMLElement | null>(null);
  const needsRef = useRef<HTMLDivElement>(null);
  const prefsLoaded = useRef(false);

  // Remembered per user: the view and "Hide Sat & Sun".
  useEffect(() => {
    void api
      .getPreference('my-time')
      .then((p) => {
        const s = p.state as { view?: View; hideWeekends?: boolean } | null;
        if (s?.view === 'week' || s?.view === 'month') setView(s.view);
        if (typeof s?.hideWeekends === 'boolean') setHideWe(s.hideWeekends);
      })
      .catch(() => {})
      .finally(() => {
        prefsLoaded.current = true;
      });
  }, []);
  useEffect(() => {
    if (prefsLoaded.current)
      void api.savePreference('my-time', { view, hideWeekends: hideWe }).catch(() => {});
  }, [view, hideWe]);

  const range = useMemo(() => {
    if (view === 'week') {
      const s = weekStart(anchor);
      return { from: s, to: addDays(s, 6) };
    }
    const g = monthGrid(anchor);
    return { from: g.start, to: g.end };
  }, [view, anchor]);

  const load = useCallback(async () => {
    try {
      const list = await api.listTimeDays(range.from, range.to);
      setDays(new Map(list.map((d) => [d.date, d])));
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Failed to load your time'));
    }
  }, [range.from, range.to]);
  useEffect(() => {
    void load();
  }, [load]);

  const myDutyIds = useMemo(() => (user ? (holdings[user.id] ?? []) : []), [holdings, user]);
  const held = useMemo(
    () => new Set(myDutyIds.filter((id) => duties.get(id) && !duties.get(id)!.archived)),
    [myDutyIds, duties],
  );

  const minutesOf = (d: string) => (days.get(d)?.entries ?? []).reduce((s, e) => s + e.minutes, 0);
  const cellMinutes = (d: string, dutyId: string) =>
    days.get(d)?.entries.find((e) => e.dutyId === dutyId)?.minutes ?? 0;

  // The days shown and the days the period's numbers count.
  const periodDays =
    view === 'week'
      ? daysInRange(range.from, range.to)
      : daysInRange(monthStart(anchor), monthEnd(anchor));
  const shownDays = daysInRange(range.from, range.to).filter((d) => !(hideWe && isWeekend(d)));

  // Rows: the duties I hold, plus any that carry time in this period.
  const rows = useMemo(() => {
    const ids = new Set<string>(held);
    for (const d of periodDays) for (const e of days.get(d)?.entries ?? []) ids.add(e.dutyId);
    const byDept = new Map<string, { name: string; color: string; duties: CatalogDuty[] }>();
    for (const id of ids) {
      const duty = duties.get(id);
      if (!duty) continue;
      const g = byDept.get(duty.departmentId) ?? {
        name: duty.departmentName,
        color: duty.color,
        duties: [],
      };
      g.duties.push(duty);
      byDept.set(duty.departmentId, g);
    }
    return [...byDept.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => ({ ...g, duties: g.duties.sort((a, b) => a.name.localeCompare(b.name)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, duties, days, range.from, range.to]);

  // --- Numbers for the tiles ---------------------------------------------------
  const total = periodDays.reduce((s, d) => s + minutesOf(d), 0);
  const pastWeekdays = periodDays.filter((d) => !isWeekend(d) && d <= today);
  const completed = periodDays.filter((d) => days.get(d)?.completed).length;
  const loggedDays = periodDays.filter((d) => minutesOf(d) > 0).length;
  const needsCompleting = periodDays.filter((d) => dayStatus(d, days.get(d), today) === 'late');
  const hiddenWeekend = hideWe
    ? periodDays.filter(isWeekend).reduce((s, d) => s + minutesOf(d), 0)
    : 0;

  const rangeLabel =
    view === 'week'
      ? `Week of ${formatRange(range.from, range.to)}`
      : `${MONTH_LONG[parseDate(anchor).getMonth()]} ${parseDate(anchor).getFullYear()}`;

  // --- Changes ------------------------------------------------------------------
  async function saveCell(date: string, dutyId: string, minutes: number, undoable = true) {
    const day = days.get(date);
    const before = cellMinutes(date, dutyId);
    const entries = (day?.entries ?? []).filter((e) => e.dutyId !== dutyId);
    if (minutes > 0) entries.push({ dutyId, minutes });
    const dayTotal = entries.reduce((s, e) => s + e.minutes, 0);
    if (dayTotal > TIME_DAY_MAX_MINUTES) {
      toast({ message: 'That would make the day more than 24 hours.', tone: 'error' });
      return;
    }
    setEditing(null);
    try {
      const saved = await api.saveTimeDay(date, {
        entries,
        note: day?.note ?? null,
        expectedUpdatedAt: day?.updatedAt ?? null,
      });
      setDays((m) => new Map(m).set(date, saved));
      const duty = duties.get(dutyId);
      if (undoable) {
        toast({
          message: `${DOW_LONG[dayOfWeek(date)]}, ${formatDay(date)}: ${duty?.name ?? 'duty'} set to ${
            minutes ? formatDuration(minutes) : 'nothing'
          }`,
          undo: async () => {
            // Undo from the day as it stands now, not as it was before.
            await saveCellAfter(date, dutyId, before);
          },
        });
      }
    } catch (err) {
      if (isStaleWriteError(err)) {
        toast({
          message: 'This day was changed in another window. It has been reloaded.',
          tone: 'error',
        });
        void load();
      } else toast({ message: errorText(err, 'Could not save the time'), tone: 'error' });
    }
  }
  // Undo needs the freshest copy of the day (its new version), so read it first.
  async function saveCellAfter(date: string, dutyId: string, minutes: number) {
    const [fresh] = await api.listTimeDays(date, date);
    const entries = (fresh?.entries ?? []).filter((e) => e.dutyId !== dutyId);
    if (minutes > 0) entries.push({ dutyId, minutes });
    try {
      const saved = await api.saveTimeDay(date, {
        entries,
        note: fresh?.note ?? null,
        expectedUpdatedAt: fresh?.updatedAt ?? null,
      });
      setDays((m) => new Map(m).set(date, saved));
    } catch (err) {
      toast({ message: errorText(err, 'Could not undo'), tone: 'error' });
    }
  }

  async function setCompleted(date: string, done: boolean) {
    try {
      const updated = await api.setTimeDayCompleted(date, done);
      setDays((m) => new Map(m).set(date, updated));
      toast({
        message: `${DOW_LONG[dayOfWeek(date)]}, ${formatDay(date)} ${done ? 'marked as completed' : 'reopened'}`,
        tone: done ? 'success' : 'dark',
        undo: async () => {
          try {
            const back = await api.setTimeDayCompleted(date, !done);
            setDays((m) => new Map(m).set(date, back));
          } catch (err) {
            toast({ message: errorText(err, 'Could not undo'), tone: 'error' });
          }
        },
      });
    } catch (err) {
      toast({ message: errorText(err, 'Failed to update the day'), tone: 'error' });
    }
  }

  function step(n: number) {
    setAnchor((a) => (view === 'week' ? addDays(a, 7 * n) : addMonths(a, n)));
  }

  const editingDuty = editing ? duties.get(editing.dutyId) : null;

  return (
    <>
      <PageHeader
        title="My Time"
        subtitle={`${rangeLabel} · ${total ? formatDuration(total) : 'nothing'} logged`}
        search={false}
        newTask={false}
        switcher={
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
            ]}
          />
        }
      />
      <PageBody>
        {error && (
          <div className="hb-alert" role="alert">
            {error}
          </div>
        )}

        <div className="hb-periodline">
          <span className="hb-stepper">
            <button
              type="button"
              aria-label={view === 'week' ? 'Previous week' : 'Previous month'}
              onClick={() => step(-1)}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button type="button" className="hb-stepper-today" onClick={() => setAnchor(today)}>
              Today
            </button>
            <button
              type="button"
              aria-label={view === 'week' ? 'Next week' : 'Next month'}
              onClick={() => step(1)}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </span>
          <h2>{rangeLabel}</h2>
          <span className="hb-grow" />
          <label className="hb-switch">
            <input type="checkbox" checked={hideWe} onChange={(e) => setHideWe(e.target.checked)} />
            <span className="hb-switch-track" aria-hidden="true" />
            Hide Sat &amp; Sun
          </label>
        </div>

        <div className="hb-tiles">
          <Tile
            label={
              view === 'week'
                ? 'Logged this week'
                : `Logged in ${MONTH_LONG[parseDate(anchor).getMonth()]}`
            }
            value={total ? formatHM(total) : '0:00'}
            hint={`of ${formatDuration(pastWeekdays.length * DAY_MINUTES)} expected so far (8h a weekday)`}
            tone="blue"
          />
          <Tile
            label="Weekdays completed"
            value={`${pastWeekdays.filter((d) => days.get(d)?.completed).length} / ${pastWeekdays.length}`}
            hint="So far this period"
            tone={pastWeekdays.every((d) => days.get(d)?.completed) ? 'green' : 'amber'}
          />
          <Tile
            label="Average per logged day"
            value={loggedDays ? formatHM(Math.round(total / loggedDays)) : '—'}
            hint={`${loggedDays} ${loggedDays === 1 ? 'day' : 'days'} with time`}
          />
          <Tile
            label="Not completed"
            value={needsCompleting.length}
            hint={needsCompleting.length ? 'Past days to complete' : 'All caught up'}
            tone={needsCompleting.length ? 'red' : 'green'}
            onClick={() =>
              needsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
          />
          {view === 'month' && (
            <Tile label="Days completed" value={completed} hint="This month" tone="green" />
          )}
        </div>

        <div className="hb-cols">
          <div className="hb-col">
            {view === 'week' ? (
              <Card className="hb-sheet-card">
                {rows.length === 0 ? (
                  <Empty>
                    {catalogLoading
                      ? 'Loading your duties…'
                      : departments.length
                        ? 'You don’t hold any duties yet, so there is nothing to log time against. Ask your supervisor or an Admin to assign some.'
                        : 'No departments or duties exist yet.'}
                  </Empty>
                ) : (
                  <div className="hb-table-wrap">
                    <table className="hb-sheet">
                      <thead>
                        <tr>
                          <th className="hb-sheet-duty">Duty</th>
                          {shownDays.map((d) => {
                            const st = dayStatus(d, days.get(d), today);
                            return (
                              <th
                                key={d}
                                className={cx(
                                  'hb-sheet-day',
                                  d === today && 'today',
                                  d > today && 'future',
                                  isWeekend(d) && 'weekend',
                                )}
                              >
                                <button
                                  type="button"
                                  className="hb-sheet-dayhead"
                                  disabled={d > today}
                                  onClick={() => setOpenDate(d)}
                                  title={
                                    d > today
                                      ? 'A future day'
                                      : 'Open the whole day: note and related tasks'
                                  }
                                >
                                  <span className="dow">
                                    {DOW_SHORT[dayOfWeek(d)]}
                                    {d === today && <span className="hb-today-tag">Today</span>}
                                  </span>
                                  <span className="num">
                                    {parseDate(d).getDate()} {MONTH_SHORT[parseDate(d).getMonth()]}
                                    {st === 'done' && (
                                      <Lock size={11} aria-label="Completed, locked" />
                                    )}
                                  </span>
                                </button>
                              </th>
                            );
                          })}
                          <th className="hb-sheet-total">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((g) => (
                          <DeptRows
                            key={g.name}
                            group={g}
                            shownDays={shownDays}
                            periodDays={periodDays}
                            today={today}
                            held={held}
                            days={days}
                            cellMinutes={cellMinutes}
                            onCell={(date, dutyId, el) => {
                              cellRef.current = el;
                              setEditing({ date, dutyId });
                            }}
                            editing={editing}
                          />
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="hb-sheet-sum">
                          <th>Day total</th>
                          {shownDays.map((d) => {
                            const m = minutesOf(d);
                            return (
                              <td
                                key={d}
                                className={cx(d === today && 'today', d > today && 'future')}
                              >
                                {d > today ? '' : m ? formatHM(m) : '—'}
                                {d <= today && m > 0 && (
                                  <Bar
                                    value={m}
                                    max={DAY_MINUTES}
                                    tone={m >= DAY_MINUTES ? 'green' : 'blue'}
                                  />
                                )}
                              </td>
                            );
                          })}
                          <td className="hb-sheet-total">{total ? formatHM(total) : '—'}</td>
                        </tr>
                        <tr className="hb-sheet-status">
                          <th>Day</th>
                          {shownDays.map((d) => (
                            <td
                              key={d}
                              className={cx(d === today && 'today', d > today && 'future')}
                            >
                              <DayButton
                                state={dayStatus(d, days.get(d), today)}
                                onToggle={(done) => void setCompleted(d, done)}
                              />
                            </td>
                          ))}
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
                {hiddenWeekend > 0 && (
                  <p className="hb-sheet-note">
                    Weekends are hidden. {formatHM(hiddenWeekend)} logged on Sat/Sun still counts in
                    the total.
                  </p>
                )}
              </Card>
            ) : (
              <MonthGrid
                anchor={anchor}
                range={range}
                hideWe={hideWe}
                today={today}
                days={days}
                minutesOf={minutesOf}
                openDate={openDate}
                onOpen={setOpenDate}
              />
            )}
          </div>

          <aside className="hb-col hb-gside" ref={dayRef}>
            {openDate && user ? (
              <DayPanel
                date={openDate}
                readOnly={false}
                person={null}
                duties={duties}
                heldDutyIds={myDutyIds}
                onClose={() => setOpenDate(null)}
                onNavigate={setOpenDate}
                onChanged={(d, how) => {
                  setDays((m) => new Map(m).set(d.date, d));
                  const when = `${DOW_LONG[dayOfWeek(d.date)]}, ${formatDay(d.date)}`;
                  if (how === 'reopened') {
                    toast({ message: `${when} reopened — you can edit it now` });
                  } else {
                    const t = d.entries.reduce((s, e) => s + e.minutes, 0);
                    toast({
                      message: `Saved ${formatDuration(t)} for ${when}${d.completed ? ' · completed' : ''}`,
                      tone: 'success',
                    });
                  }
                }}
              />
            ) : (
              <>
                <TimeTrackerCard period="today" />

                <div ref={needsRef}>
                  <Card>
                    <CardHead
                      icon={<CalendarCheck2 size={16} />}
                      tone={needsCompleting.length ? 'red' : 'green'}
                      title="Needs completing"
                      right={
                        <span className={cx('hb-big', needsCompleting.length > 0 && 'hb-late')}>
                          {needsCompleting.length}
                        </span>
                      }
                    />
                    {needsCompleting.length === 0 ? (
                      <Empty good>Every past day in this period is completed.</Empty>
                    ) : (
                      needsCompleting.map((d) => (
                        <div key={d} className="hb-row">
                          <div className="hb-stack">
                            <button
                              type="button"
                              className="hb-linklike hb-name"
                              onClick={() => setOpenDate(d)}
                            >
                              {DOW_LONG[dayOfWeek(d)]}, {formatDay(d)}
                            </button>
                            <span className={cx('hb-sub', !minutesOf(d) && 'late')}>
                              {minutesOf(d)
                                ? `${formatDuration(minutesOf(d))} logged`
                                : 'Nothing logged'}
                            </span>
                          </div>
                          <Btn kind="ok" onClick={() => void setCompleted(d, true)}>
                            <Check size={15} aria-hidden="true" /> Complete
                          </Btn>
                        </div>
                      ))
                    )}
                  </Card>
                </div>

                <Card>
                  <CardHead
                    icon={<Layers size={16} />}
                    title="Your duties"
                    right={<span className="hb-small">{rangeLabel}</span>}
                  />
                  {rows.length === 0 ? (
                    <Empty>{catalogLoading ? 'Loading…' : 'None yet'}</Empty>
                  ) : (
                    (() => {
                      const perDuty = rows.flatMap((g) =>
                        g.duties.map((duty) => ({
                          duty,
                          minutes: periodDays.reduce((s, d) => s + cellMinutes(d, duty.id), 0),
                        })),
                      );
                      const max = Math.max(...perDuty.map((p) => p.minutes), 1);
                      return perDuty.map(({ duty, minutes }) => (
                        <div key={duty.id} className="hb-duty-row">
                          <span
                            className="hb-dot"
                            style={{ background: duty.color }}
                            aria-hidden="true"
                          />
                          <span className="hb-duty-name">
                            <span className="hb-sub">{duty.departmentName}</span>
                            <span className="hb-name">{duty.name}</span>
                          </span>
                          <Bar value={minutes} max={max} />
                          <span className="hb-duty-min">{minutes ? formatHM(minutes) : '—'}</span>
                        </div>
                      ));
                    })()
                  )}
                </Card>
              </>
            )}
          </aside>
        </div>

        {editing && editingDuty && (
          <CellEditor
            anchorRef={cellRef}
            title={`${editingDuty.name} · ${DOW_LONG[dayOfWeek(editing.date)]}, ${formatDay(editing.date)}`}
            minutes={cellMinutes(editing.date, editing.dutyId)}
            onClose={() => setEditing(null)}
            onSave={(m) => void saveCell(editing.date, editing.dutyId, m)}
          />
        )}
      </PageBody>
    </>
  );
}

/** A department's heading row and its duty rows in the timesheet. */
function DeptRows({
  group,
  shownDays,
  periodDays,
  today,
  held,
  days,
  cellMinutes,
  onCell,
  editing,
}: {
  group: { name: string; color: string; duties: CatalogDuty[] };
  shownDays: string[];
  periodDays: string[];
  today: string;
  held: Set<string>;
  days: Map<string, TimeDayDto>;
  cellMinutes: (d: string, dutyId: string) => number;
  onCell: (date: string, dutyId: string, el: HTMLElement) => void;
  editing: { date: string; dutyId: string } | null;
}) {
  return (
    <>
      <tr className="hb-sheet-dept">
        <th colSpan={shownDays.length + 2}>
          <span className="hb-dot" style={{ background: group.color }} aria-hidden="true" />
          {group.name}
        </th>
      </tr>
      {group.duties.map((duty) => {
        const gone = !held.has(duty.id);
        const rowTotal = periodDays.reduce((s, d) => s + cellMinutes(d, duty.id), 0);
        return (
          <tr key={duty.id}>
            <th className="hb-sheet-duty" scope="row">
              <span className="hb-name">{duty.name}</span>
              {gone && <span className="hb-small">No longer assigned: can be cleared only</span>}
            </th>
            {shownDays.map((d) => {
              const m = cellMinutes(d, duty.id);
              const locked = !!days.get(d)?.completed;
              const future = d > today;
              const canEdit = !future && !locked && (!gone || m > 0);
              const label = `${duty.name}, ${DOW_LONG[dayOfWeek(d)]} ${formatDay(d)}: ${m ? formatDuration(m) : 'nothing'}`;
              return (
                <td
                  key={d}
                  className={cx(
                    'hb-sheet-cell',
                    d === today && 'today',
                    future && 'future',
                    isWeekend(d) && 'weekend',
                  )}
                >
                  {canEdit ? (
                    <button
                      type="button"
                      className={cx(
                        'hb-cell',
                        m > 0 && 'has',
                        editing?.date === d && editing.dutyId === duty.id && 'editing',
                      )}
                      aria-label={`${label}. Change`}
                      onClick={(e) => onCell(d, duty.id, e.currentTarget)}
                    >
                      {m ? formatHM(m) : <Pencil size={13} aria-hidden="true" />}
                    </button>
                  ) : (
                    <span
                      className={cx('hb-cell', 'static', m > 0 && 'has')}
                      aria-label={label}
                      title={locked ? 'Completed: reopen the day to change it' : undefined}
                    >
                      {future ? '' : m ? formatHM(m) : '—'}
                    </span>
                  )}
                </td>
              );
            })}
            <td className="hb-sheet-total">{rowTotal ? formatHM(rowTotal) : '—'}</td>
          </tr>
        );
      })}
    </>
  );
}

/** Completed (click to reopen), Mark complete, or Not completed (red). */
function DayButton({ state, onToggle }: { state: DayState; onToggle: (done: boolean) => void }) {
  if (state === 'none') return null;
  if (state === 'done')
    return (
      <button
        type="button"
        className="hb-daybtn done"
        title="Completed. Click to reopen."
        onClick={() => onToggle(false)}
      >
        <Check size={13} aria-hidden="true" /> Done
      </button>
    );
  return (
    <button
      type="button"
      className={cx('hb-daybtn', state === 'late' && 'late')}
      title={
        state === 'late'
          ? 'A past day not marked completed. Click to complete it.'
          : 'Mark this day as completed'
      }
      onClick={() => onToggle(true)}
    >
      {state === 'late' ? 'Late' : 'Complete'}
    </button>
  );
}

function MonthGrid({
  anchor,
  range,
  hideWe,
  today,
  days,
  minutesOf,
  openDate,
  onOpen,
}: {
  /** The day open in the side panel, outlined. */
  openDate: string | null;
  anchor: string;
  range: { from: string; to: string };
  hideWe: boolean;
  today: string;
  days: Map<string, TimeDayDto>;
  minutesOf: (d: string) => number;
  onOpen: (d: string) => void;
}) {
  const ms = monthStart(anchor);
  const me = monthEnd(anchor);
  const cells = daysInRange(range.from, range.to).filter((d) => !(hideWe && isWeekend(d)));
  const dows = hideWe ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6];
  return (
    <Card className="hb-month-card">
      <div className={cx('hb-month', hideWe && 'five')}>
        {dows.map((i) => (
          <div key={i} className="hb-month-dow">
            {DOW_SHORT[i]}
          </div>
        ))}
        {cells.map((d) => {
          const m = minutesOf(d);
          const st = dayStatus(d, days.get(d), today);
          const fut = d > today;
          return (
            <button
              key={d}
              type="button"
              className={cx(
                'hb-mday',
                (d < ms || d > me) && 'out',
                d === today && 'today',
                fut && 'future',
                d === openDate && 'is-open',
                st,
              )}
              disabled={fut}
              onClick={() => onOpen(d)}
              aria-label={`${formatDay(d)}: ${formatDuration(m)}${st === 'done' ? ', completed' : st === 'late' ? ', not completed' : ''}`}
            >
              <span className="hb-mday-top">
                <span className="hb-mday-num">{parseDate(d).getDate()}</span>
                {st === 'done' && <Check size={14} className="hb-mday-ok" aria-hidden="true" />}
                {st === 'late' && <span className="hb-mday-late" aria-hidden="true" />}
              </span>
              <span className="hb-mday-total">{fut ? '' : m ? formatHM(m) : '—'}</span>
              {!fut && <Bar value={m} max={DAY_MINUTES} tone={st === 'done' ? 'green' : 'blue'} />}
            </button>
          );
        })}
      </div>
      <div className="hb-month-legend">
        <span>
          <Check size={13} className="hb-mday-ok" aria-hidden="true" /> Completed
        </span>
        <span>
          <span className="hb-mday-late" aria-hidden="true" /> Past weekday not completed
        </span>
        <span>Bar: hours against an 8h day</span>
      </div>
    </Card>
  );
}
