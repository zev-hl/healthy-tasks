import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  formatHM,
  type DutyRef,
  type TaskUserRef,
  type TimeReviewDto,
  type TimeReviewPeopleDto,
  type TimeReviewScope,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { Avatar, UserChip } from '../components/ui/Avatar';
import { StatusPill } from '../components/ui/indicators';
import { Toast, useToast } from '../components/exclusives/Toast';
import { DutyTag, Swatch } from '../components/duties/DutyTag';
import { CaretIcon } from '../components/duties/icons';
import { DayEditorModal } from '../components/time/DayEditorModal';
import { useDutyCatalog } from '../lib/duties';
import {
  DOW_SHORT,
  MONTH_LONG,
  addDays,
  addMonths,
  dayOfWeek,
  daysBetween,
  daysInRange,
  formatDay,
  formatRange,
  isWeekend,
  monthEnd,
  monthStart,
  monthWeekColumns,
  parseDate,
  todayISO,
  weekStart,
} from '../lib/calendar';
import {
  PIVOT_VIEWS,
  buildPivot,
  expandablePaths,
  flattenPivot,
  hoursCell,
  parsePath,
  toCsv,
  type PivotNode,
  type PivotView,
} from '../lib/timePivot';

/**
 * Time Review (Department Duties) — for supervisors. Who you can see follows the
 * Phase 13 hierarchy: Managers see the people below them, Admins everyone.
 * "Day review" is one row per person and one column per day (time + whether the
 * day is completed); the three roll-ups pivot the same time by person,
 * department and duty, by week (a column per day) or month (a column per
 * Sun–Sat week, cut at the month's edges). Related tasks on the right are tasks
 * with a duty, assigned to people in scope, whose start–due range falls inside
 * or across the period; click a grid row to narrow them.
 */

type View = 'day' | PivotView;
type Period = 'week' | 'month';

const personName = (p: TaskUserRef) => `${p.firstName} ${p.lastName}`.trim() || p.email;

export function TimeReviewPage() {
  const today = todayISO();
  const { departments, duties: catalogDuties } = useDutyCatalog();
  const [peopleInfo, setPeopleInfo] = useState<TimeReviewPeopleDto | null>(null);
  const [view, setView] = useState<View>('pdd');
  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState(today);
  const [scope, setScope] = useState<TimeReviewScope>('team');
  const [deptId, setDeptId] = useState('');
  const [dutyId, setDutyId] = useState('');
  const [hideWe, setHideWe] = useState(false);
  const [showTasks, setShowTasks] = useState(true);
  const [sel, setSel] = useState('');
  const [expanded, setExpanded] = useState<Record<string, Set<string>>>({});
  const [data, setData] = useState<TimeReviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<{ person: TaskUserRef; date: string } | null>(null);
  const { toast, showToast, clearToast } = useToast();
  const prefsLoaded = useRef(false);

  useEffect(() => {
    void Promise.all([
      api.getTimeReviewPeople(),
      api.getPreference('time-review').catch(() => ({ state: null })),
    ])
      .then(([info, pref]) => {
        setPeopleInfo(info);
        const s = pref.state as {
          view?: View;
          period?: Period;
          hideWeekends?: boolean;
          showTasks?: boolean;
        } | null;
        if (s?.view && (s.view === 'day' || s.view in PIVOT_VIEWS)) setView(s.view);
        if (s?.period === 'week' || s?.period === 'month') setPeriod(s.period);
        if (typeof s?.hideWeekends === 'boolean') setHideWe(s.hideWeekends);
        if (typeof s?.showTasks === 'boolean') setShowTasks(s.showTasks);
        if (info.isAdmin && info.team.length > 0 && info.directIds.length === 0) setScope('all');
        prefsLoaded.current = true;
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load your team'));
  }, []);
  useEffect(() => {
    if (prefsLoaded.current) {
      void api
        .savePreference('time-review', { view, period, hideWeekends: hideWe, showTasks })
        .catch(() => {});
    }
  }, [view, period, hideWe, showTasks]);

  const isDay = view === 'day';
  const effPeriod: Period = isDay ? 'week' : period;
  const range = useMemo(() => {
    if (effPeriod === 'week') {
      const s = weekStart(anchor);
      return { from: s, to: addDays(s, 6) };
    }
    return { from: monthStart(anchor), to: monthEnd(anchor) };
  }, [effPeriod, anchor]);

  const load = useCallback(async () => {
    if (!peopleInfo) return;
    try {
      setData(
        await api.getTimeReview({
          from: range.from,
          to: range.to,
          scope,
          departmentId: deptId || null,
          dutyId: dutyId || null,
        }),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load time');
    }
  }, [peopleInfo, range.from, range.to, scope, deptId, dutyId]);
  useEffect(() => {
    void load();
  }, [load]);

  // --- Columns ------------------------------------------------------------------
  const cols = useMemo(() => {
    if (effPeriod === 'week') {
      return daysInRange(range.from, range.to)
        .filter((d) => !(hideWe && isWeekend(d)))
        .map((d) => ({
          key: d,
          label: DOW_SHORT[dayOfWeek(d)]!,
          sub: formatDay(d),
          today: d === today,
        }));
    }
    return monthWeekColumns(anchor).map((c) => ({
      key: c.key,
      label: c.label,
      sub: formatRange(c.from, c.to),
      today: c.from <= today && today <= c.to,
    }));
  }, [effPeriod, range, hideWe, today, anchor]);
  const colKey = (date: string) =>
    effPeriod === 'week' ? date : `w${Math.floor(daysBetween(weekStart(range.from), date) / 7)}`;

  // --- Lookups ----------------------------------------------------------------------
  const people = useMemo(() => data?.people ?? [], [data]);
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const dutyById = useMemo(() => {
    const m = new Map<string, DutyRef>(catalogDuties);
    for (const d of data?.duties ?? []) m.set(d.id, d);
    return m;
  }, [catalogDuties, data]);
  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);

  const records = useMemo(
    () =>
      (data?.records ?? []).map((r) => ({
        p: r.userId,
        d: dutyById.get(r.dutyId)?.departmentId ?? '?',
        u: r.dutyId,
        c: colKey(r.date),
        min: r.minutes,
        date: r.date,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, dutyById, effPeriod, range.from],
  );
  const dayMap = useMemo(
    () => new Map((data?.days ?? []).map((d) => [`${d.userId}|${d.date}`, d])),
    [data],
  );

  const labelOf = (n: PivotNode): string =>
    n.dim === 'p'
      ? personName(
          personById.get(n.key) ?? {
            id: n.key,
            email: '?',
            firstName: '?',
            lastName: '',
            title: null,
          },
        )
      : n.dim === 'd'
        ? (deptById.get(n.key)?.name ?? '?')
        : (dutyById.get(n.key)?.name ?? '?');

  const viewKey = `${view}:${effPeriod}`;
  const pivot = useMemo(
    () => (isDay ? null : buildPivot(records, PIVOT_VIEWS[view as PivotView].dims)),
    [records, isDay, view],
  );
  const exp =
    expanded[viewKey] ?? new Set(pivot ? [...pivot.children.values()].map((c) => c.path) : []);

  // --- Selection → related tasks ------------------------------------------------------
  const selObj = parsePath(sel);
  const related = (data?.relatedTasks ?? []).filter(
    (t) =>
      (!selObj.p || t.assignee.id === selObj.p) &&
      (!selObj.d || t.duty.departmentId === selObj.d) &&
      (!selObj.u || t.duty.id === selObj.u),
  );
  const selLabel = sel
    ? sel
        .split('|')
        .map((x) => {
          const [k, v] = x.split(':');
          return k === 'p'
            ? personName(personById.get(v!)!)
            : k === 'd'
              ? (deptById.get(v!)?.name ?? '?')
              : (dutyById.get(v!)?.name ?? '?');
        })
        .join(' › ')
    : '';

  // --- KPIs ------------------------------------------------------------------------
  const totalMin = records.reduce((s, r) => s + r.min, 0);
  const pastWd = daysInRange(range.from, range.to).filter((d) => !isWeekend(d) && d < today);
  const expected = people.length * pastWd.length;
  const completed = people.reduce(
    (a, p) => a + pastWd.filter((d) => dayMap.get(`${p.id}|${d}`)?.completed).length,
    0,
  );
  const withTime = new Set(records.map((r) => r.p)).size;
  const rangeLabel =
    effPeriod === 'week'
      ? `${formatRange(range.from, range.to)}, ${parseDate(range.from).getFullYear()}`
      : `${MONTH_LONG[parseDate(range.from).getMonth()]} ${parseDate(range.from).getFullYear()}`;

  function exportCsv() {
    const head = [
      isDay ? 'Person' : PIVOT_VIEWS[view as PivotView].label,
      ...cols.map((c) => `${c.label} (${c.sub})`),
      'Total (h)',
    ];
    const rows: (string | number)[][] = [head];
    if (isDay) {
      for (const p of people) {
        const cells = cols.map((c) => hoursCell(dayMap.get(`${p.id}|${c.key}`)?.minutes ?? 0));
        const wk = daysInRange(range.from, range.to).reduce(
          (s, d) => s + (dayMap.get(`${p.id}|${d}`)?.minutes ?? 0),
          0,
        );
        rows.push([personName(p), ...cells, hoursCell(wk)]);
      }
    } else if (pivot) {
      for (const { node, level } of flattenPivot(pivot, labelOf, 'all')) {
        rows.push([
          `${'  '.repeat(level)}${labelOf(node)}`,
          ...cols.map((c) => hoursCell(node.cells[c.key] ?? 0)),
          hoursCell(node.total),
        ]);
      }
      rows.push([
        'Total',
        ...cols.map((c) => hoursCell(pivot.cells[c.key] ?? 0)),
        hoursCell(pivot.total),
      ]);
    }
    // A byte-order mark so Excel opens the UTF-8 (› and accented names) correctly.
    const blob = new Blob([String.fromCharCode(0xfeff), toCsv(rows)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `time-review-${range.from}-to-${range.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Exported the current grid as CSV (hours)', 'success');
  }

  // --- Render: grid --------------------------------------------------------------------
  let table: JSX.Element;
  if (isDay) {
    table = people.length ? (
      <div className="dd-tbl-wrap">
        <table className="dd-tbl">
          <thead>
            <tr>
              <th>Person</th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={`num${c.today ? ' today-col' : ''}`}
                  style={{ textAlign: 'center' }}
                >
                  {c.label}
                  <span className="sub">{c.sub}</span>
                </th>
              ))}
              <th className="num tot">Week</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const wk = daysInRange(range.from, range.to).reduce(
                (s, d) => s + (dayMap.get(`${p.id}|${d}`)?.minutes ?? 0),
                0,
              );
              const path = `p:${p.id}`;
              return (
                <tr key={p.id} className={`l0${sel === path ? ' sel' : ''}`}>
                  <td className="dd-pv-label">
                    <div>
                      <button
                        type="button"
                        className="dd-pv-name btn-plain"
                        onClick={() => setSel(sel === path ? '' : path)}
                      >
                        <Avatar user={p} size="xs" decorative />
                        {personName(p)}
                      </button>
                      {p.title && <span className="dd-ptitle">{p.title}</span>}
                    </div>
                  </td>
                  {cols.map((c) => {
                    const d = c.key;
                    const day = dayMap.get(`${p.id}|${d}`);
                    const m = day?.minutes ?? 0;
                    const fut = d > today;
                    const st = fut ? (
                      <span className="dd-st none">&nbsp;</span>
                    ) : day?.completed ? (
                      <span className="dd-st ok">✓ Completed</span>
                    ) : d === today ? (
                      <span className="dd-st none">Today</span>
                    ) : m || !isWeekend(d) ? (
                      m ? (
                        <span className="dd-st late">Not completed</span>
                      ) : (
                        <span className="dd-st miss">Nothing logged</span>
                      )
                    ) : (
                      <span className="dd-st none">—</span>
                    );
                    return (
                      <td
                        key={d}
                        className="dd-dr-cell"
                        onClick={fut ? undefined : () => setOpenDay({ person: p, date: d })}
                        title={fut ? undefined : `Open ${p.firstName || personName(p)}’s day`}
                      >
                        <span className="mono">{fut ? '' : formatHM(m)}</span>
                        {st}
                      </td>
                    );
                  })}
                  <td className="num tot">{formatHM(wk)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              {cols.map((c) => (
                <td key={c.key} className="num">
                  {formatHM(
                    people.reduce((s, p) => s + (dayMap.get(`${p.id}|${c.key}`)?.minutes ?? 0), 0),
                  )}
                </td>
              ))}
              <td className="num">
                {formatHM(
                  people.reduce(
                    (s, p) =>
                      s +
                      daysInRange(range.from, range.to).reduce(
                        (x, d) => x + (dayMap.get(`${p.id}|${d}`)?.minutes ?? 0),
                        0,
                      ),
                    0,
                  ),
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    ) : (
      <div className="dd-tbl-wrap dd-empty">Nobody in this selection.</div>
    );
  } else if (pivot && records.length) {
    const rows = flattenPivot(pivot, labelOf, exp);
    table = (
      <div className="dd-tbl-wrap">
        <table className="dd-tbl">
          <thead>
            <tr>
              <th>{PIVOT_VIEWS[view as PivotView].label}</th>
              {cols.map((c) => (
                <th key={c.key} className={`num${c.today ? ' today-col' : ''}`}>
                  {c.label}
                  <span className="sub">{c.sub}</span>
                </th>
              ))}
              <th className="num tot">
                Total
                {effPeriod === 'week' && hideWe && <span className="sub">incl. weekend</span>}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ node: n, level }) => {
              const has = n.children.size > 0;
              const open = has && exp.has(n.path);
              return (
                <tr key={n.path} className={`l${level}${sel === n.path ? ' sel' : ''}`}>
                  <td className="dd-pv-label">
                    <div style={{ paddingLeft: level * 24 }}>
                      {has ? (
                        <button
                          type="button"
                          className={`dd-caret${open ? ' open' : ''}`}
                          aria-expanded={open}
                          aria-label={open ? 'Collapse' : 'Expand'}
                          onClick={() => {
                            const next = new Set(exp);
                            if (next.has(n.path)) next.delete(n.path);
                            else next.add(n.path);
                            setExpanded((e) => ({ ...e, [viewKey]: next }));
                          }}
                        >
                          <CaretIcon />
                        </button>
                      ) : (
                        <span className="dd-caret-sp" />
                      )}
                      <button
                        type="button"
                        className="dd-pv-name btn-plain"
                        title="Show related tasks"
                        onClick={() => {
                          setSel(sel === n.path ? '' : n.path);
                          setShowTasks(true);
                        }}
                      >
                        <PivotLabel
                          node={n}
                          label={labelOf(n)}
                          person={personById.get(n.key)}
                          color={
                            n.dim === 'd'
                              ? deptById.get(n.key)?.color
                              : n.dim === 'u'
                                ? dutyById.get(n.key)?.color
                                : undefined
                          }
                        />
                      </button>
                    </div>
                  </td>
                  {cols.map((c) => {
                    const v = n.cells[c.key] ?? 0;
                    return (
                      <td key={c.key} className={`num${v ? '' : ' zero'}`}>
                        {formatHM(v)}
                      </td>
                    );
                  })}
                  <td className="num tot">{formatHM(n.total)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>
                Total · {withTime} {withTime === 1 ? 'person' : 'people'}
              </td>
              {cols.map((c) => (
                <td key={c.key} className="num">
                  {formatHM(pivot.cells[c.key] ?? 0)}
                </td>
              ))}
              <td className="num">{formatHM(pivot.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  } else {
    table = (
      <div className="dd-tbl-wrap dd-empty">
        {data ? 'No time logged for this selection.' : 'Loading…'}
      </div>
    );
  }

  const team = peopleInfo?.team ?? [];
  const deptOptions = departments.filter((d) => d.duties.length > 0);

  return (
    <div className="dd-page" style={{ maxWidth: 1600 }}>
      <div className="dd-page-head">
        <div>
          <div className="dd-crumbs">Reports</div>
          <h1>Time Review</h1>
          <div className="dd-page-sub">
            {peopleInfo?.isAdmin
              ? 'Time logged across the organization'
              : 'Time logged by the people who report to you'}
          </div>
        </div>
        <span className="spacer" />
        <button type="button" className="secondary btn-sm" onClick={exportCsv} disabled={!data}>
          Export CSV
        </button>
        <button type="button" className="secondary btn-sm" onClick={() => setShowTasks((s) => !s)}>
          {showTasks ? 'Hide' : 'Show'} related tasks
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="dd-filters">
        <span className="dd-fl">People</span>
        <select
          value={scope}
          onChange={(e) => {
            setScope(e.target.value as TimeReviewScope);
            setSel('');
          }}
          aria-label="People"
        >
          {peopleInfo?.isAdmin && <option value="all">Everyone ({team.length + 1})</option>}
          <option value="team">
            My team — all levels ({peopleInfo?.isAdmin ? 'below me' : team.length})
          </option>
          <option value="direct">Direct reports only ({peopleInfo?.directIds.length ?? 0})</option>
          <option value="withme">My team + me</option>
          {peopleInfo && (
            <optgroup label="One person">
              {[peopleInfo.me, ...team].map((p) => (
                <option key={p.id} value={`user:${p.id}`}>
                  {personName(p)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <span className="dd-fl" style={{ marginLeft: 6 }}>
          Department
        </span>
        <select
          value={deptId}
          onChange={(e) => {
            setDeptId(e.target.value);
            setDutyId('');
            setSel('');
          }}
          aria-label="Department"
        >
          <option value="">All</option>
          {deptOptions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.archived ? ' (archived)' : ''}
            </option>
          ))}
        </select>
        <span className="dd-fl" style={{ marginLeft: 6 }}>
          Duty
        </span>
        <select
          value={dutyId}
          onChange={(e) => {
            setDutyId(e.target.value);
            setSel('');
          }}
          aria-label="Duty"
        >
          <option value="">All</option>
          {deptOptions
            .filter((d) => !deptId || d.id === deptId)
            .map((d) => (
              <optgroup key={d.id} label={d.name}>
                {d.duties.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.archived ? ' (archived)' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
        </select>
        <span className="spacer" />
        {effPeriod === 'week' && (
          <label className="dd-check">
            <input type="checkbox" checked={hideWe} onChange={(e) => setHideWe(e.target.checked)} />{' '}
            Hide Sat &amp; Sun
          </label>
        )}
      </div>

      <div className="dd-toolbar">
        <div className="seg" role="group" aria-label="View">
          <button
            type="button"
            className={`seg-btn${isDay ? ' active' : ''}`}
            aria-pressed={isDay}
            onClick={() => {
              setView('day');
              setSel('');
            }}
          >
            Day review
          </button>
          {(Object.keys(PIVOT_VIEWS) as PivotView[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`seg-btn${view === k ? ' active' : ''}`}
              aria-pressed={view === k}
              onClick={() => {
                setView(k);
                setSel('');
              }}
            >
              {PIVOT_VIEWS[k].label}
            </button>
          ))}
        </div>
        <div className="dd-divider" />
        <div className="seg" role="group" aria-label="Period">
          <button
            type="button"
            className={`seg-btn${effPeriod === 'week' ? ' active' : ''}`}
            aria-pressed={effPeriod === 'week'}
            onClick={() => setPeriod('week')}
          >
            Week
          </button>
          <button
            type="button"
            className={`seg-btn${effPeriod === 'month' ? ' active' : ''}`}
            aria-pressed={effPeriod === 'month'}
            disabled={isDay}
            title={isDay ? 'Day review always shows one week' : undefined}
            onClick={() => setPeriod('month')}
          >
            Month
          </button>
        </div>
        <div className="dd-navgrp">
          <button
            type="button"
            className="secondary btn-sm"
            aria-label="Previous"
            onClick={() =>
              setAnchor((a) => (effPeriod === 'week' ? addDays(a, -7) : addMonths(a, -1)))
            }
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
            onClick={() =>
              setAnchor((a) => (effPeriod === 'week' ? addDays(a, 7) : addMonths(a, 1)))
            }
          >
            ›
          </button>
        </div>
        <span className="dd-range-label">{rangeLabel}</span>
        <span className="spacer" />
        {!isDay && pivot && (
          <>
            <button
              type="button"
              className="secondary btn-sm"
              onClick={() =>
                setExpanded((e) => ({ ...e, [viewKey]: new Set(expandablePaths(pivot)) }))
              }
            >
              Expand all
            </button>
            <button
              type="button"
              className="secondary btn-sm"
              onClick={() => setExpanded((e) => ({ ...e, [viewKey]: new Set() }))}
            >
              Collapse all
            </button>
          </>
        )}
      </div>

      <div className="dd-kpis">
        <div className="dd-kpi acc">
          <span className="dd-kpi-v mono">{totalMin ? formatHM(totalMin) : '0:00'}</span>
          <span className="dd-kpi-l">Total logged</span>
        </div>
        <div className="dd-kpi">
          <span className="dd-kpi-v">
            {withTime} / {people.length}
          </span>
          <span className="dd-kpi-l">People with time</span>
        </div>
        <div className={`dd-kpi ${completed < expected ? 'warn' : 'ok'}`}>
          <span className="dd-kpi-v">
            {completed} / {expected}
          </span>
          <span className="dd-kpi-l">Past weekdays completed</span>
        </div>
        <div className="dd-kpi">
          <span className="dd-kpi-v">{related.length}</span>
          <span className="dd-kpi-l">Related tasks</span>
        </div>
      </div>

      <div className={`dd-split${showTasks ? '' : ' closed'}`}>
        <div>{table}</div>
        {showTasks && (
          <aside className="dd-tp" aria-label="Related tasks">
            <div className="dd-tp-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ fontSize: 15 }}>Related tasks</h3>
                <span className="count-pill">{related.length}</span>
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                Start–due range inside or across {rangeLabel}
              </div>
              {sel ? (
                <div style={{ marginTop: 8 }}>
                  <span className="dd-ctx-chip">
                    {selLabel}
                    <button
                      type="button"
                      className="dd-ctx-x"
                      aria-label="Clear filter"
                      onClick={() => setSel('')}
                    >
                      ×
                    </button>
                  </span>
                </div>
              ) : (
                <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                  Click a row in the grid to narrow this list.
                </div>
              )}
            </div>
            <div className="dd-tp-list">
              {related.length ? (
                related.map((t) => {
                  const inside =
                    !!t.startAt &&
                    !!t.dueAt &&
                    t.startAt.slice(0, 10) >= range.from &&
                    t.dueAt.slice(0, 10) <= range.to;
                  const logged = records
                    .filter((r) => r.p === t.assignee.id && r.u === t.duty.id)
                    .reduce((s, r) => s + r.min, 0);
                  return (
                    <Link key={t.id} to={`/tasks/${t.id}`} className="dd-tp-item">
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        <span className="dd-task-id">#{t.id}</span>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</span>
                      </div>
                      <div className="dd-tp-meta">
                        <StatusPill status={t.status} />
                        <UserChip user={t.assignee} />
                      </div>
                      <div className="dd-tp-meta">
                        <DutyTag duty={t.duty} compact />
                      </div>
                      <div className="dd-tp-meta">
                        <span className="mono">
                          {t.startAt ? formatDay(t.startAt.slice(0, 10)) : 'No start'} →{' '}
                          {t.dueAt ? formatDay(t.dueAt.slice(0, 10)) : 'No due'}
                        </span>
                        <span className={`dd-tag ${inside ? 'info' : 'neutral'}`}>
                          {inside ? 'Within period' : 'Spans period'}
                        </span>
                        <span className="spacer" />
                        <span title="Time logged on this duty by the assignee in this period">
                          <span className="mono" style={{ color: 'var(--ink)' }}>
                            {formatHM(logged)}
                          </span>{' '}
                          logged
                        </span>
                      </div>
                    </Link>
                  );
                })
              ) : (
                <div className="dd-empty">No related tasks.</div>
              )}
            </div>
          </aside>
        )}
      </div>

      {openDay && (
        <DayEditorModal
          date={openDay.date}
          readOnly
          person={openDay.person}
          duties={new Map([...dutyById].map(([id, d]) => [id, { ...d, description: null }]))}
          heldDutyIds={[]}
          onClose={() => setOpenDay(null)}
          onNavigate={(date) => setOpenDay({ person: openDay.person, date })}
        />
      )}
      <Toast toast={toast} onClose={clearToast} />
    </div>
  );
}

function PivotLabel({
  node,
  label,
  person,
  color,
}: {
  node: PivotNode;
  label: string;
  person?: TaskUserRef;
  color?: string;
}) {
  if (node.dim === 'p' && person) {
    return (
      <>
        <Avatar user={person} size="xs" decorative />
        {label}
      </>
    );
  }
  if (node.dim === 'd') {
    return (
      <>
        {color && <Swatch color={color} />}
        {label}
      </>
    );
  }
  return (
    <>
      <span className="dd-bullet" style={{ background: color }} />
      {label}
    </>
  );
}
