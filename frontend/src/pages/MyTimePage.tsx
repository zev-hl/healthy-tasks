import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { formatDuration, formatHM, type TimeDayDto } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Toast, useToast } from '../components/exclusives/Toast';
import { Swatch } from '../components/duties/DutyTag';
import { DayEditorModal } from '../components/time/DayEditorModal';
import { useDutyCatalog, type CatalogDuty } from '../lib/duties';
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

/**
 * My Time (Department Duties). Each person logs hours and minutes against the
 * duties they hold, per day, and marks each day Completed. Week (Sun–Sat) and
 * Month views; "Hide Sat & Sun" is remembered per user and weekend time still
 * counts. Future days are locked; a Completed day is read-only until reopened.
 */

type View = 'week' | 'month';

/** Completed / Not completed / Mark complete, for a day card or the review grid. */
export function dayStatus(
  date: string,
  day: Pick<TimeDayDto, 'entries' | 'completed'> | undefined,
  today: string,
): 'none' | 'done' | 'late' | 'open' {
  const has = !!day && day.entries.length > 0;
  if (date > today) return 'none';
  if (isWeekend(date) && !has && !day?.completed) return 'none';
  if (day?.completed) return 'done';
  if (date < today) return 'late';
  return 'open';
}

export function MyTimePage() {
  const { user } = useAuth();
  const { duties, holdings, departments, loading: catalogLoading } = useDutyCatalog();
  const today = todayISO();
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(today);
  const [hideWe, setHideWe] = useState(false);
  const [days, setDays] = useState<Map<string, TimeDayDto>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const { toast, showToast, clearToast } = useToast();
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
      setError(err instanceof ApiError ? err.message : 'Failed to load your time');
    }
  }, [range.from, range.to]);
  useEffect(() => {
    void load();
  }, [load]);

  const myDutyIds = useMemo(() => (user ? (holdings[user.id] ?? []) : []), [holdings, user]);
  const myDepts = useMemo(() => {
    const active = myDutyIds
      .map((id) => duties.get(id))
      .filter((d): d is CatalogDuty => !!d && !d.archived);
    const by = new Map<string, { name: string; color: string; n: number }>();
    for (const d of active) {
      const g = by.get(d.departmentId) ?? { name: d.departmentName, color: d.color, n: 0 };
      g.n += 1;
      by.set(d.departmentId, g);
    }
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [myDutyIds, duties]);

  const minutesOf = (d: string) => (days.get(d)?.entries ?? []).reduce((s, e) => s + e.minutes, 0);

  async function toggleDone(date: string, e: MouseEvent) {
    e.stopPropagation();
    const was = !!days.get(date)?.completed;
    try {
      const updated = await api.setTimeDayCompleted(date, !was);
      setDays((m) => new Map(m).set(date, updated));
      const dow = DOW_LONG[dayOfWeek(date)];
      showToast(was ? `${dow} reopened` : `${dow} marked as completed`, 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to update the day', 'error');
    }
  }

  function navigate(n: number) {
    setAnchor((a) => (view === 'week' ? addDays(a, 7 * n) : addMonths(a, n)));
  }

  // --- KPIs + body -------------------------------------------------------------
  let rangeLabel: string;
  let kpis: { v: string; l: string; tone?: 'warn' | 'ok' | 'acc' }[];
  let body: JSX.Element;

  if (view === 'week') {
    const wd = daysInRange(range.from, range.to);
    const visible = wd.filter((d) => !(hideWe && isWeekend(d)));
    rangeLabel = `${formatRange(range.from, range.to)}, ${parseDate(range.from).getFullYear()}`;
    const tot = wd.reduce((s, d) => s + minutesOf(d), 0);
    const workdays = wd.filter((d) => !isWeekend(d) && d <= today);
    const comp = wd.filter((d) => days.get(d)?.completed).length;
    const logged = wd.filter((d) => minutesOf(d) > 0).length;
    const hiddenMin = hideWe ? wd.filter(isWeekend).reduce((s, d) => s + minutesOf(d), 0) : 0;
    kpis = [
      { v: tot ? formatHM(tot) : '0:00', l: 'Logged this week', tone: 'acc' },
      {
        v: `${comp} / ${workdays.length}`,
        l: 'Weekdays completed so far',
        tone: comp < workdays.length ? 'warn' : 'ok',
      },
      { v: logged ? formatHM(Math.round(tot / logged)) : '—', l: 'Average per day logged' },
    ];
    body = (
      <>
        <div className={`dd-week${visible.length === 5 ? ' five' : ''}`}>
          {visible.map((d) => (
            <DayCard
              key={d}
              date={d}
              today={today}
              day={days.get(d)}
              duties={duties}
              onOpen={() => setOpenDate(d)}
              onToggleDone={(e) => void toggleDone(d, e)}
            />
          ))}
        </div>
        {hiddenMin > 0 && (
          <div className="dd-hidden-we">
            Weekends are hidden. <b className="mono">{formatHM(hiddenMin)}</b> logged on Sat/Sun is
            still counted in the week total.
          </div>
        )}
      </>
    );
  } else {
    const ms = monthStart(anchor);
    const me = monthEnd(anchor);
    const a = parseDate(anchor);
    rangeLabel = `${MONTH_LONG[a.getMonth()]} ${a.getFullYear()}`;
    const inMonth = daysInRange(ms, me);
    const tot = inMonth.reduce((s, d) => s + minutesOf(d), 0);
    const comp = inMonth.filter((d) => days.get(d)?.completed).length;
    const miss = inMonth.filter(
      (d) => !isWeekend(d) && d < today && !days.get(d)?.completed,
    ).length;
    kpis = [
      { v: tot ? formatHM(tot) : '0:00', l: `Logged in ${MONTH_LONG[a.getMonth()]}`, tone: 'acc' },
      { v: String(comp), l: 'Days completed', tone: 'ok' },
      { v: String(miss), l: 'Past weekdays not completed', tone: miss ? 'warn' : undefined },
    ];
    const cells = daysInRange(range.from, range.to).filter((d) => !(hideWe && isWeekend(d)));
    const dows = hideWe ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6];
    body = (
      <>
        <div className={`dd-month${hideWe ? ' five' : ''}`}>
          {dows.map((i) => (
            <div key={i} className="dd-m-dow">
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
                className={`dd-mcell btn-plain${d < ms || d > me ? ' out' : ''}${d === today ? ' today' : ''}${fut ? ' future' : ''}`}
                disabled={fut}
                onClick={() => setOpenDate(d)}
                aria-label={`${formatDay(d)}: ${formatDuration(m)}`}
              >
                <div className="dd-m-top">
                  <span className="dd-m-day">{parseDate(d).getDate()}</span>
                  {st === 'done' ? (
                    <span className="dd-st ok" title="Completed">
                      ✓
                    </span>
                  ) : st === 'late' && !isWeekend(d) ? (
                    m ? (
                      <span className="dd-st late" title="Not completed">
                        ●
                      </span>
                    ) : (
                      <span className="dd-st miss" title="Nothing logged">
                        ○
                      </span>
                    )
                  ) : null}
                </div>
                <span className="dd-m-total">
                  {fut ? '' : m ? formatHM(m) : <span style={{ color: 'var(--faint-2)' }}>—</span>}
                </span>
                <div className="dd-m-bar">
                  <i style={{ width: `${Math.min(100, (m / 480) * 100)}%` }} />
                </div>
              </button>
            );
          })}
        </div>
        <div className="dd-legend">
          <span>
            <span className="dd-st ok">✓</span> Completed
          </span>
          <span>
            <span className="dd-st late">●</span> Time logged, not completed
          </span>
          <span>
            <span className="dd-st miss">○</span> Past weekday, nothing logged
          </span>
          <span>Bar = hours against an 8h day</span>
        </div>
      </>
    );
  }

  return (
    <div className="dd-page">
      <div className="dd-page-head">
        <div>
          <h1>My Time</h1>
          <div className="dd-page-sub">Log the time you spend on your duties each day.</div>
        </div>
        <span className="spacer" />
        <div className="seg" role="group" aria-label="View">
          {(
            [
              ['week', 'Week'],
              ['month', 'Month'],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              className={`seg-btn${view === k ? ' active' : ''}`}
              aria-pressed={view === k}
              onClick={() => setView(k)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="dd-toolbar">
        <div className="dd-navgrp">
          <button
            type="button"
            className="secondary btn-sm"
            aria-label="Previous"
            onClick={() => navigate(-1)}
          >
            ‹
          </button>
          <button type="button" className="secondary btn-sm" onClick={() => setAnchor(today)}>
            Today
          </button>
          <button
            type="button"
            className="secondary btn-sm"
            aria-label="Next"
            onClick={() => navigate(1)}
          >
            ›
          </button>
        </div>
        <span className="dd-range-label">{rangeLabel}</span>
        <span className="spacer" />
        <label className="dd-check">
          <input type="checkbox" checked={hideWe} onChange={(e) => setHideWe(e.target.checked)} />{' '}
          Hide Sat &amp; Sun
        </label>
      </div>

      <div className="dd-my-duties">
        <span className="u-label" style={{ marginRight: 4 }}>
          Your duties
        </span>
        {myDepts.length ? (
          myDepts.map((d) => (
            <span key={d.name} className="dd-chip">
              <Swatch color={d.color} size={7} />
              {d.name} · {d.n}
            </span>
          ))
        ) : (
          <span className="dd-tag warn">
            {catalogLoading
              ? 'Loading…'
              : departments.length
                ? 'None yet — ask your supervisor or an Admin to assign some'
                : 'None yet'}
          </span>
        )}
      </div>

      <div className="dd-kpis">
        {kpis.map((k) => (
          <div key={k.l} className={`dd-kpi${k.tone ? ` ${k.tone}` : ''}`}>
            <span className="dd-kpi-v mono">{k.v}</span>
            <span className="dd-kpi-l">{k.l}</span>
          </div>
        ))}
      </div>

      {body}

      {openDate && user && (
        <DayEditorModal
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
              showToast(`${when} reopened — you can edit it now`, 'info');
            } else {
              const total = d.entries.reduce((s, e) => s + e.minutes, 0);
              showToast(
                `Saved ${formatDuration(total)} for ${when}${d.completed ? ' · completed' : ''}`,
                'success',
              );
            }
          }}
        />
      )}
      <Toast toast={toast} onClose={clearToast} />
    </div>
  );
}

function DoneTag({
  status,
  onClick,
}: {
  status: 'none' | 'done' | 'late' | 'open';
  onClick?: (e: MouseEvent) => void;
}) {
  if (status === 'none') return null;
  const label =
    status === 'done' ? 'Completed' : status === 'late' ? 'Not completed' : 'Mark complete';
  const cls = `dd-done${status === 'done' ? ' on' : status === 'late' ? ' late' : ''}`;
  const inner = (
    <>
      <span className="ck">{status === 'done' ? '✓' : ''}</span>
      {label}
    </>
  );
  return onClick ? (
    <button
      type="button"
      className={`${cls} btn-plain`}
      aria-pressed={status === 'done'}
      onClick={onClick}
      title={status === 'done' ? 'Reopen this day' : 'Mark this day as completed'}
    >
      {inner}
    </button>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

function DayCard({
  date,
  today,
  day,
  duties,
  onOpen,
  onToggleDone,
}: {
  date: string;
  today: string;
  day: TimeDayDto | undefined;
  duties: Map<string, CatalogDuty>;
  onOpen: () => void;
  onToggleDone: (e: MouseEvent) => void;
}) {
  const fut = date > today;
  const d = parseDate(date);
  const entries = [...(day?.entries ?? [])].sort((a, b) => {
    const A = duties.get(a.dutyId);
    const B = duties.get(b.dutyId);
    return `${A?.departmentName} ${A?.name}`.localeCompare(`${B?.departmentName} ${B?.name}`);
  });
  const tot = entries.reduce((s, e) => s + e.minutes, 0);
  return (
    <div
      className={`dd-daycard${date === today ? ' today' : ''}${fut ? ' future' : ''}${isWeekend(date) ? ' weekend' : ''}`}
      role={fut ? undefined : 'button'}
      tabIndex={fut ? undefined : 0}
      aria-label={`${DOW_LONG[d.getDay()]} ${formatDay(date)}, ${formatDuration(tot)} logged`}
      onClick={fut ? undefined : onOpen}
      onKeyDown={
        fut
          ? undefined
          : (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen();
              }
            }
      }
    >
      <div className="dd-dc-head">
        <div>
          <div className="dd-dc-dow">
            {DOW_SHORT[d.getDay()]}
            {date === today && <span className="dd-today-tag">Today</span>}
          </div>
          <div className="dd-dc-date">{d.getDate()}</div>
        </div>
        <div className="u-label" style={{ fontSize: 9.5 }}>
          {MONTH_SHORT[d.getMonth()]}
        </div>
      </div>
      <div className="dd-dc-body">
        {fut ? (
          <div className="dd-dc-empty">Future day</div>
        ) : entries.length ? (
          entries.map((e) => {
            const u = duties.get(e.dutyId);
            return (
              <div key={e.dutyId} className="dd-dc-entry">
                <div style={{ minWidth: 0 }}>
                  <div className="dd-dc-dept">
                    {u && <Swatch color={u.color} size={6} />}
                    {u?.departmentName ?? 'Duty'}
                  </div>
                  <div className="dd-dc-duty">{u?.name ?? 'Unknown duty'}</div>
                </div>
                <div className="dd-dc-min">{formatHM(e.minutes)}</div>
              </div>
            );
          })
        ) : (
          <div className="dd-dc-empty">
            No time logged
            <br />
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>+ Log time</span>
          </div>
        )}
      </div>
      <div className="dd-dc-foot">
        <span className="dd-dc-total">{fut ? '' : tot ? formatHM(tot) : '—'}</span>
        <DoneTag status={dayStatus(date, day, today)} onClick={fut ? undefined : onToggleDone} />
      </div>
    </div>
  );
}
