import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ListChecks,
  PanelRightClose,
  PanelRightOpen,
  X,
} from 'lucide-react';
import {
  formatDuration,
  formatHM,
  type DutyRef,
  type TaskUserRef,
  type TimeReviewDto,
  type TimeReviewPeopleDto,
  type TimeReviewScope,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { Avatar } from '../components/ui/Avatar';
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
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { Select, type SelectOption } from '../components/harbor/Select';
import { useToast as useHbToast } from '../components/harbor/Toast';
import {
  Btn,
  Card,
  CardHead,
  Empty,
  Pill,
  Segmented,
  StatusPill,
  Tile,
  cx,
} from '../components/harbor/ui';

/**
 * Time Review (Department Duties) — for supervisors, Harbor redesign. Who you
 * can see follows the Phase 13 hierarchy: Managers see the people below them,
 * Admins everyone. "Day review" is a timesheet of people by day (time, and
 * whether each day is completed); the three roll-ups pivot the same time by
 * person, department and duty, by week (a column per day) or month (a column
 * per Sun–Sat week, cut at the month's edges). The side panel shows who has
 * days left to complete, and the related tasks: tasks with a duty, assigned to
 * people in scope, whose start–due range falls inside or across the period.
 * Click a row to narrow them.
 */

type View = 'day' | PivotView;
type Period = 'week' | 'month';

const DAY_MINUTES = 8 * 60;
const personName = (p: TaskUserRef) => `${p.firstName} ${p.lastName}`.trim() || p.email;

/** A small shim so the logic below keeps its `showToast(message, tone)` calls. */
function useShowToast() {
  const toast = useHbToast();
  return {
    showToast: (message: string, tone: 'success' | 'error' | 'info' = 'info') =>
      toast({
        message,
        tone: tone === 'success' ? 'success' : tone === 'error' ? 'error' : 'dark',
      }),
  };
}

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
  const { showToast } = useShowToast();
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

  // --- Who still has days to complete ---------------------------------------------
  const behind = people
    .map((p) => {
      const late = pastWd.filter((d) => !dayMap.get(`${p.id}|${d}`)?.completed);
      return {
        person: p,
        late,
        empty: late.filter((d) => !dayMap.get(`${p.id}|${d}`)?.minutes).length,
      };
    })
    .filter((b) => b.late.length > 0)
    .sort((a, b) => b.late.length - a.late.length);
  const notCompleted = expected - completed;

  const team = peopleInfo?.team ?? [];
  const deptOptions = departments.filter((d) => d.duties.length > 0);

  const scopeOptions: SelectOption<string>[] = [
    ...(peopleInfo?.isAdmin
      ? [{ value: 'all', label: 'Everyone', hint: String(team.length + 1) }]
      : []),
    {
      value: 'team',
      label: 'My team, all levels',
      hint: peopleInfo?.isAdmin ? 'below me' : String(team.length),
    },
    {
      value: 'direct',
      label: 'Direct reports only',
      hint: String(peopleInfo?.directIds.length ?? 0),
    },
    { value: 'withme', label: 'My team and me' },
    ...(peopleInfo
      ? [peopleInfo.me, ...team].map((p) => ({
          value: `user:${p.id}`,
          label: personName(p),
          lead: <Avatar user={p} px={24} decorative />,
        }))
      : []),
  ];
  const deptChoices: SelectOption<string>[] = [
    { value: '', label: 'All' },
    ...deptOptions.map((d) => ({
      value: d.id,
      label: d.name,
      dot: d.color,
      hint: d.archived ? 'archived' : undefined,
    })),
  ];
  const dutyChoices: SelectOption<string>[] = [
    { value: '', label: 'All' },
    ...deptOptions
      .filter((d) => !deptId || d.id === deptId)
      .flatMap((d) =>
        d.duties.map((u) => ({
          value: u.id,
          label: deptId ? u.name : `${d.name} › ${u.name}`,
          dot: d.color,
          hint: u.archived ? 'archived' : undefined,
        })),
      ),
  ];

  const step = (n: number) =>
    setAnchor((a) => (effPeriod === 'week' ? addDays(a, 7 * n) : addMonths(a, n)));

  // --- Render: the grid ------------------------------------------------------------------
  let grid: JSX.Element;
  if (isDay) {
    grid = people.length ? (
      <div className="hb-table-wrap">
        <table className="hb-sheet hb-review-sheet">
          <thead>
            <tr>
              <th className="hb-sheet-duty">Person</th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={cx(
                    'hb-sheet-day',
                    c.today && 'today',
                    c.key > today && 'future',
                    isWeekend(c.key) && 'weekend',
                  )}
                >
                  <span className="hb-sheet-dayhead static">
                    <span className="dow">
                      {c.label}
                      {c.today && <span className="hb-today-tag">Today</span>}
                    </span>
                    <span className="num">{c.sub}</span>
                  </span>
                </th>
              ))}
              <th className="hb-sheet-total">Week</th>
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
                <tr key={p.id} className={cx(sel === path && 'sel')}>
                  <th className="hb-sheet-duty" scope="row">
                    <button
                      type="button"
                      className="hb-person-btn"
                      title="Show this person’s related tasks"
                      onClick={() => {
                        setSel(sel === path ? '' : path);
                        setShowTasks(true);
                      }}
                    >
                      <Avatar user={p} px={28} decorative />
                      <span className="hb-stack">
                        <span className="hb-name">{personName(p)}</span>
                        {p.title && <span className="hb-small">{p.title}</span>}
                      </span>
                    </button>
                  </th>
                  {cols.map((c) => {
                    const d = c.key;
                    const day = dayMap.get(`${p.id}|${d}`);
                    const m = day?.minutes ?? 0;
                    const fut = d > today;
                    const state = fut
                      ? 'future'
                      : day?.completed
                        ? 'done'
                        : d === today
                          ? 'today'
                          : m
                            ? 'late'
                            : isWeekend(d)
                              ? 'weekend'
                              : 'missing';
                    const words = {
                      future: '',
                      done: 'completed',
                      today: 'today',
                      late: 'not completed',
                      weekend: '',
                      missing: 'nothing logged, not completed',
                    }[state];
                    return (
                      <td
                        key={d}
                        className={cx(
                          'hb-sheet-cell',
                          d === today && 'today',
                          fut && 'future',
                          isWeekend(d) && 'weekend',
                        )}
                      >
                        {fut ? null : (
                          <button
                            type="button"
                            className={cx('hb-rcell', state)}
                            aria-label={`${personName(p)}, ${formatDay(d)}: ${m ? formatDuration(m) : 'no time'}${words ? `, ${words}` : ''}. Open the day`}
                            onClick={() => setOpenDay({ person: p, date: d })}
                          >
                            <span className="t">{m ? formatHM(m) : '—'}</span>
                            {state === 'done' && (
                              <Check size={13} className="ok" aria-hidden="true" />
                            )}
                            {(state === 'late' || state === 'missing') && (
                              <span className="dot" aria-hidden="true" />
                            )}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="hb-sheet-total">{wk ? formatHM(wk) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="hb-sheet-sum">
              <th>Total</th>
              {cols.map((c) => (
                <td key={c.key} className={cx(c.today && 'today', c.key > today && 'future')}>
                  {formatHM(
                    people.reduce((s, p) => s + (dayMap.get(`${p.id}|${c.key}`)?.minutes ?? 0), 0),
                  )}
                </td>
              ))}
              <td className="hb-sheet-total">{formatHM(totalMin)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    ) : (
      <Empty>{data ? 'Nobody in this selection.' : 'Loading…'}</Empty>
    );
  } else if (pivot && records.length) {
    const rows = flattenPivot(pivot, labelOf, exp);
    grid = (
      <div className="hb-table-wrap">
        <table className="hb-sheet hb-review-sheet">
          <thead>
            <tr>
              <th className="hb-sheet-duty">{PIVOT_VIEWS[view as PivotView].label}</th>
              {cols.map((c) => (
                <th key={c.key} className={cx('hb-sheet-day', c.today && 'today')}>
                  <span className="hb-sheet-dayhead static">
                    <span className="dow">
                      {c.label}
                      {c.today && effPeriod === 'week' && (
                        <span className="hb-today-tag">Today</span>
                      )}
                    </span>
                    <span className="num">{c.sub}</span>
                  </span>
                </th>
              ))}
              <th className="hb-sheet-total">
                Total
                {effPeriod === 'week' && hideWe && <span className="hb-small"> incl. weekend</span>}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ node: n, level }) => {
              const has = n.children.size > 0;
              const open = has && exp.has(n.path);
              return (
                <tr key={n.path} className={cx(`lvl${level}`, sel === n.path && 'sel')}>
                  <th className="hb-sheet-duty" scope="row">
                    <span className="hb-pv" style={{ paddingLeft: level * 22 }}>
                      {has ? (
                        <button
                          type="button"
                          className={cx('hb-caret', open && 'open')}
                          aria-expanded={open}
                          aria-label={open ? `Collapse ${labelOf(n)}` : `Expand ${labelOf(n)}`}
                          onClick={() => {
                            const next = new Set(exp);
                            if (next.has(n.path)) next.delete(n.path);
                            else next.add(n.path);
                            setExpanded((e) => ({ ...e, [viewKey]: next }));
                          }}
                        >
                          <ChevronDown size={15} aria-hidden="true" />
                        </button>
                      ) : (
                        <span className="hb-caret-sp" />
                      )}
                      <button
                        type="button"
                        className="hb-person-btn"
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
                    </span>
                  </th>
                  {cols.map((c) => {
                    const v = n.cells[c.key] ?? 0;
                    return (
                      <td
                        key={c.key}
                        className={cx('hb-pv-cell', c.today && 'today', !v && 'zero')}
                      >
                        {formatHM(v)}
                      </td>
                    );
                  })}
                  <td className="hb-sheet-total">{formatHM(n.total)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="hb-sheet-sum">
              <th>
                Total · {withTime} {withTime === 1 ? 'person' : 'people'}
              </th>
              {cols.map((c) => (
                <td key={c.key} className={cx(c.today && 'today')}>
                  {formatHM(pivot.cells[c.key] ?? 0)}
                </td>
              ))}
              <td className="hb-sheet-total">{formatHM(pivot.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  } else {
    grid = <Empty>{data ? 'No time logged for this selection.' : 'Loading…'}</Empty>;
  }

  const viewOptions: { value: View; label: string }[] = [
    { value: 'day', label: 'Day review' },
        { value: 'pdd', label: 'By person' },
    { value: 'dpd', label: 'By department' },
    { value: 'ddp', label: 'By duty' },
  ];

  return (
    <>
      <PageHeader
        title="Time Review"
        subtitle={`${rangeLabel} · ${
          peopleInfo?.isAdmin
            ? 'time logged across the organization'
            : 'time logged by the people who report to you'
        }`}
        search={false}
        newTask={false}
        switcher={
          <Segmented
            label="View"
            value={view}
            onChange={(v) => {
              setView(v);
              setSel('');
            }}
            options={viewOptions}
          />
        }
        actions={
          <>
            <Btn className="hb-btn-tall" onClick={exportCsv} disabled={!data}>
              <Download size={16} aria-hidden="true" /> Export CSV
            </Btn>
            <Btn
              className="hb-btn-tall"
              aria-pressed={showTasks}
              onClick={() => setShowTasks((s) => !s)}
              title={
                showTasks ? 'Hide the side panel' : 'Show who needs attention and the related tasks'
              }
            >
              {showTasks ? (
                <PanelRightClose size={16} aria-hidden="true" />
              ) : (
                <PanelRightOpen size={16} aria-hidden="true" />
              )}
              {showTasks ? 'Hide panel' : 'Show panel'}
            </Btn>
          </>
        }
      />
      <PageBody>
        {error && (
          <div className="hb-alert" role="alert">
            {error}
          </div>
        )}

        <div className="hb-filterbar">
          <Select
            variant="chip"
            label="People"
            value={scope}
            options={scopeOptions}
            active={scope !== 'team'}
            searchPlaceholder="Search people…"
            onChange={(v) => {
              setScope(v as TimeReviewScope);
              setSel('');
            }}
          />
          <Select
            variant="chip"
            label="Department"
            value={deptId}
            options={deptChoices}
            active={!!deptId}
            onChange={(v) => {
              setDeptId(v);
              setDutyId('');
              setSel('');
            }}
          />
          <Select
            variant="chip"
            label="Duty"
            value={dutyId}
            options={dutyChoices}
            active={!!dutyId}
            searchPlaceholder="Search duties…"
            onChange={(v) => {
              setDutyId(v);
              setSel('');
            }}
          />
          {(scope !== 'team' || deptId || dutyId) && (
            <Btn
              kind="link"
              onClick={() => {
                setScope(
                  peopleInfo?.isAdmin && team.length > 0 && peopleInfo.directIds.length === 0
                    ? 'all'
                    : 'team',
                );
                setDeptId('');
                setDutyId('');
                setSel('');
              }}
            >
              Clear
            </Btn>
          )}
        </div>

        <div className="hb-periodline">
          <span className="hb-stepper">
            <button
              type="button"
              aria-label={effPeriod === 'week' ? 'Previous week' : 'Previous month'}
              onClick={() => step(-1)}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button type="button" className="hb-stepper-today" onClick={() => setAnchor(today)}>
              Today
            </button>
            <button
              type="button"
              aria-label={effPeriod === 'week' ? 'Next week' : 'Next month'}
              onClick={() => step(1)}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </span>
          <h2>{rangeLabel}</h2>
          {!isDay && (
            <Segmented
              small
              label="Period"
              value={effPeriod}
              onChange={setPeriod}
              options={[
                { value: 'week', label: 'Week' },
                { value: 'month', label: 'Month' },
              ]}
            />
          )}
          <span className="hb-grow" />
          {!isDay && pivot && (
            <>
              <Btn
                kind="link"
                onClick={() =>
                  setExpanded((e) => ({ ...e, [viewKey]: new Set(expandablePaths(pivot)) }))
                }
              >
                Expand all
              </Btn>
              <Btn kind="link" onClick={() => setExpanded((e) => ({ ...e, [viewKey]: new Set() }))}>
                Collapse all
              </Btn>
            </>
          )}
          {effPeriod === 'week' && (
            <label className="hb-switch">
              <input
                type="checkbox"
                checked={hideWe}
                onChange={(e) => setHideWe(e.target.checked)}
              />
              <span className="hb-switch-track" aria-hidden="true" />
              Hide Sat &amp; Sun
            </label>
          )}
        </div>

        <div className="hb-tiles">
          <Tile
            label="Total logged"
            value={totalMin ? formatHM(totalMin) : '0:00'}
            hint={`of ${formatDuration(expected * DAY_MINUTES)} expected (8h a weekday)`}
            tone="blue"
          />
          <Tile
            label="People with time"
            value={`${withTime} / ${people.length}`}
            hint="Logged anything this period"
            tone={people.length && withTime < people.length ? 'amber' : undefined}
          />
          <Tile
            label="Weekdays completed"
            value={`${completed} / ${expected}`}
            hint="Past weekdays, everyone"
            tone={completed < expected ? 'amber' : 'green'}
          />
          <Tile
            label="Days not completed"
            value={notCompleted}
            hint={
              behind.length
                ? `${behind.length} ${behind.length === 1 ? 'person' : 'people'} behind`
                : 'All caught up'
            }
            tone={notCompleted ? 'red' : 'green'}
            onClick={() => {
              setView('day');
              setShowTasks(true);
            }}
          />
          <Tile
            label="Related tasks"
            value={related.length}
            hint={sel ? 'For the selected row' : 'In this period'}
          />
        </div>

        <div className={cx('hb-cols', !showTasks && 'single')}>
          <div className="hb-col">
            <Card className="hb-sheet-card">{grid}</Card>
            {isDay && people.length > 0 && (
              <div className="hb-month-legend hb-legend-plain">
                <span>
                  <Check size={13} className="hb-mday-ok" aria-hidden="true" /> Completed
                </span>
                <span>
                  <span className="hb-mday-late" aria-hidden="true" /> Past day not completed
                </span>
                <span>Click a day to see it (read-only)</span>
              </div>
            )}
          </div>

          {showTasks && (
            <aside className="hb-col">
              <Card>
                <CardHead
                  icon={<AlertTriangle size={16} />}
                  tone={behind.length ? 'red' : 'green'}
                  title="Needs attention"
                  right={
                    <span className={cx('hb-big', behind.length > 0 && 'hb-late')}>
                      {behind.length}
                    </span>
                  }
                />
                {behind.length === 0 ? (
                  <Empty good>Everyone has completed their past weekdays.</Empty>
                ) : (
                  behind.slice(0, 8).map((b) => {
                    const path = `p:${b.person.id}`;
                    return (
                      <button
                        key={b.person.id}
                        type="button"
                        className={cx('hb-row', 'hb-row-btn', 'hov', sel === path && 'is-sel')}
                        onClick={() => {
                          setView('day');
                          setSel(sel === path ? '' : path);
                        }}
                      >
                        <Avatar user={b.person} px={30} decorative />
                        <span className="hb-stack">
                          <span className="hb-name">{personName(b.person)}</span>
                          <span className="hb-sub late">
                            {b.empty > 0
                              ? `${b.empty} with nothing logged`
                              : 'Time logged, not completed'}
                          </span>
                        </span>
                        <Pill tone="red">
                          {b.late.length} {b.late.length === 1 ? 'day' : 'days'}
                        </Pill>
                      </button>
                    );
                  })
                )}
              </Card>

              <Card>
                <CardHead
                  icon={<ListChecks size={16} />}
                  title="Related tasks"
                  right={<span className="hb-small">{related.length}</span>}
                />
                <div className="hb-rel-head">
                  {sel ? (
                    <span className="hb-chip-on">
                      {selLabel}
                      <button
                        type="button"
                        aria-label="Show related tasks for everyone"
                        onClick={() => setSel('')}
                      >
                        <X size={13} aria-hidden="true" />
                      </button>
                    </span>
                  ) : (
                    <span className="hb-small">
                      Start–due range inside or across {rangeLabel}. Click a row to narrow.
                    </span>
                  )}
                </div>
                {related.length === 0 ? (
                  <Empty>No related tasks.</Empty>
                ) : (
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
                      <Link key={t.id} to={`/tasks/${t.id}`} className="hb-row hb-rel-row">
                        <span className="hb-stack">
                          <span className="hb-name">{t.name}</span>
                          <span className="hb-sub">
                            #{t.id} · {personName(t.assignee)} · {t.duty.departmentName} ›{' '}
                            {t.duty.name}
                          </span>
                          <span className="hb-small">
                            {t.startAt ? formatDay(t.startAt.slice(0, 10)) : 'No start'} →{' '}
                            {t.dueAt ? formatDay(t.dueAt.slice(0, 10)) : 'No due'} ·{' '}
                            {inside ? 'within the period' : 'spans the period'}
                          </span>
                        </span>
                        <span className="hb-right">
                          <StatusPill status={t.status} />
                          <span
                            className="hb-small"
                            title="Time the assignee logged on this duty in this period"
                          >
                            {logged ? `${formatHM(logged)} logged` : 'none logged'}
                          </span>
                        </span>
                      </Link>
                    );
                  })
                )}
              </Card>
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
      </PageBody>
    </>
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
        <Avatar user={person} px={24} decorative />
        <span className="hb-name">{label}</span>
      </>
    );
  }
  return (
    <>
      <span
        className="hb-dot"
        style={{
          background: color,
          width: node.dim === 'd' ? 10 : 8,
          height: node.dim === 'd' ? 10 : 8,
        }}
        aria-hidden="true"
      />
      <span className={node.dim === 'd' ? 'hb-name' : undefined}>{label}</span>
    </>
  );
}
