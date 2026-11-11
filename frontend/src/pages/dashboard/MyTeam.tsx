import { ActivitySoon } from './ActivitySoon';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Building2, Target } from 'lucide-react';
import type {
  DepartmentDto,
  DueDateBucketTotals,
  DueDateReportRow,
  OrgPersonDto,
  TaskRowDto,
  TaskSearchFilters,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { effectiveFilters, nowContext } from '../../lib/taskSearch';
import { Avatar, userLabel } from '../../components/ui/Avatar';
import {
  Bar,
  Btn,
  Card,
  CardHead,
  Empty,
  Pill,
  Section,
  Tile,
  cx,
} from '../../components/harbor/ui';
import { Select, type SelectOption } from '../../components/harbor/Select';
import { ACTIVE_STATUSES, periodRange, type Period } from '../../components/harbor/taskHelpers';
import { PerformanceBody } from './MyDashboard';

const ALL = '__all';
type PeopleFilter = 'overdue' | 'onTrack' | null;

interface PersonStats {
  person: OrgPersonDto;
  open: number;
  overdue: number;
  oldestLateDays: number;
  done: number;
  onTime: number;
  late: number;
}

const DAY = 86_400_000;

/** Every page of a query, for counting (the API returns at most 200 a page). */
async function allRows(filters: TaskSearchFilters, cap = 1000): Promise<TaskRowDto[]> {
  const out: TaskRowDto[] = [];
  for (let page = 1; out.length < cap; page++) {
    const res = await api.queryTasks({ filters, page, pageSize: 200, ...nowContext() });
    out.push(...res.rows);
    if (out.length >= res.total || res.rows.length === 0) break;
  }
  return out;
}

const emptyTotals = (): DueDateBucketTotals => ({
  OnTime: 0,
  Late: 0,
  Overdue: 0,
  NotStarted: 0,
  NotCompleted: 0,
  Cancelled: 0,
  NoDueDate: 0,
});

/**
 * My team (§6.1): everyone in my departments (the departments of the duties I
 * hold; Admins see every department), drilled down Department › Duty › Person.
 */
export function MyTeam({
  period,
  onCounts,
}: {
  period: Period;
  onCounts: (attention: number) => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const range = useMemo(() => periodRange(period), [period]);

  const [departments, setDepartments] = useState<DepartmentDto[] | null>(null);
  const [people, setPeople] = useState<OrgPersonDto[]>([]);
  const [dept, setDept] = useState<string>(ALL);
  const [duty, setDuty] = useState<string>(ALL);
  const [person, setPerson] = useState<string>(ALL);
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>(null);
  const [active, setActive] = useState<TaskRowDto[] | null>(null);
  const [report, setReport] = useState<DueDateReportRow[]>([]);
  const [doneCount, setDoneCount] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);

  // Departments in scope, and the people in them.
  useEffect(() => {
    if (!user) return;
    Promise.all([api.listDepartments(), api.getOrg()])
      .then(([deps, org]) => {
        const me = org.people.find((p) => p.id === user.id);
        const mine = new Set(me?.dutyIds ?? []);
        const scope = deps.filter(
          (d) => !d.archived && (user.role === 'Admin' || d.duties.some((x) => mine.has(x.id))),
        );
        setDepartments(scope);
        setPeople(org.people);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load your team.'));
  }, [user]);

  const scopeDeps = useMemo(
    () => (departments ?? []).filter((d) => dept === ALL || d.id === dept),
    [departments, dept],
  );
  const scopeDutyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of scopeDeps)
      for (const x of d.duties) if (duty === ALL || x.id === duty) ids.add(x.id);
    return ids;
  }, [scopeDeps, duty]);

  const team = useMemo(
    () =>
      people
        .filter((p) => p.id !== user?.id && p.dutyIds.some((id) => scopeDutyIds.has(id)))
        .filter((p) => person === ALL || p.id === person)
        .sort((a, b) => userLabel(a).localeCompare(userLabel(b))),
    [people, scopeDutyIds, person, user],
  );
  const teamIds = useMemo(() => team.map((p) => p.id), [team]);

  const load = useCallback(async () => {
    if (departments === null) return;
    if (teamIds.length === 0) {
      setActive([]);
      setReport([]);
      setDoneCount(new Map());
      return;
    }
    setActive(null);
    const [act, done, rep] = await Promise.all([
      allRows({ assigneeIds: teamIds, statuses: ACTIVE_STATUSES }),
      allRows(
        effectiveFilters({
          assigneeIds: teamIds,
          statuses: ['Completed'],
          statusChangedFrom: range.from,
          statusChangedTo: range.to,
        }),
      ),
      api.getDueDateReport({
        filters: effectiveFilters({
          assigneeIds: teamIds,
          dueFrom: range.from,
          dueTo: range.to,
          includeNoDue: false,
        }),
        ...nowContext(),
      }),
    ]);
    const dc = new Map<string, number>();
    for (const t of done) if (t.assignee) dc.set(t.assignee.id, (dc.get(t.assignee.id) ?? 0) + 1);
    setActive(act);
    setDoneCount(dc);
    setReport(rep.rows);
  }, [departments, teamIds, range]);

  useEffect(() => {
    load().catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load your team.'));
  }, [load]);

  const now = Date.now();
  const stats: PersonStats[] = useMemo(() => {
    return team.map((p) => {
      const theirs = (active ?? []).filter((t) => t.assignee?.id === p.id);
      const late = theirs.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now);
      const oldest = late.reduce(
        (m, t) => Math.max(m, Math.floor((now - new Date(t.dueAt!).getTime()) / DAY)),
        0,
      );
      const rep = report.filter((r) => r.assignee?.id === p.id);
      return {
        person: p,
        open: theirs.length,
        overdue: late.length,
        oldestLateDays: oldest,
        done: doneCount.get(p.id) ?? 0,
        onTime: rep.filter((r) => r.bucket === 'OnTime').length,
        late: rep.filter((r) => r.bucket === 'Late').length,
      };
    });
  }, [team, active, report, doneCount, now]);

  const overdueTasks = useMemo(
    () => (active ?? []).filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now),
    [active, now],
  );
  const totals = useMemo(() => {
    const t = emptyTotals();
    for (const r of report) t[r.bucket] += 1;
    return t;
  }, [report]);

  const overdueCount = overdueTasks.length;
  const onTrack = stats.filter((s) => s.overdue === 0).length;
  const doneTotal = [...doneCount.values()].reduce((a, b) => a + b, 0);
  useEffect(() => {
    onCounts(stats.filter((s) => s.overdue > 0).length);
  }, [stats, onCounts]);

  const byDept = useMemo(() => {
    const m = new Map<string, { id: string | null; name: string; n: number }>();
    for (const t of overdueTasks) {
      const key = t.duty?.departmentId ?? 'none';
      const cur = m.get(key) ?? {
        id: t.duty?.departmentId ?? null,
        name: t.duty?.departmentName ?? 'No duty',
        n: 0,
      };
      cur.n += 1;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [overdueTasks]);
  const worst = byDept[0]?.n ?? 0;

  const shownStats = stats.filter((s) =>
    peopleFilter === 'overdue'
      ? s.overdue > 0
      : peopleFilter === 'onTrack'
        ? s.overdue === 0
        : true,
  );
  const lateOwners = stats.filter((s) => s.overdue > 0).sort((a, b) => b.overdue - a.overdue);

  const deptOptions: SelectOption<string>[] = [
    { value: ALL, label: user?.role === 'Admin' ? 'All departments' : 'All my departments' },
    ...(departments ?? []).map((d) => ({ value: d.id, label: d.name, dot: d.color })),
  ];
  const dutyOptions: SelectOption<string>[] = [
    { value: ALL, label: 'All duties' },
    ...scopeDeps.flatMap((d) =>
      d.duties
        .filter((x) => !x.archived)
        .map((x) => ({ value: x.id, label: dept === ALL ? `${d.name} › ${x.name}` : x.name })),
    ),
  ];
  const personOptions: SelectOption<string>[] = [
    { value: ALL, label: 'Everyone' },
    ...people
      .filter((p) => p.id !== user?.id && p.dutyIds.some((id) => scopeDutyIds.has(id)))
      .sort((a, b) => userLabel(a).localeCompare(userLabel(b)))
      .map((p) => ({
        value: p.id,
        label: userLabel(p),
        lead: <Avatar user={p} px={24} decorative />,
      })),
  ];
  const filtered = dept !== ALL || duty !== ALL || person !== ALL;
  const scopeName =
    person !== ALL
      ? userLabel(team[0] ?? { id: person })
      : duty !== ALL
        ? dutyOptions.find((o) => o.value === duty)?.label
        : dept !== ALL
          ? departments?.find((d) => d.id === dept)?.name
          : user?.role === 'Admin'
            ? 'Everyone'
            : 'Your departments';

  function openTasks(filters: TaskSearchFilters) {
    navigate('/tasks', { state: { filters } });
  }

  if (departments !== null && departments.length === 0) {
    return (
      <Card>
        <Empty>
          You don’t hold a duty in any department yet, so there is no team to show. An Admin can
          give you duties on People › Organization.
        </Empty>
      </Card>
    );
  }

  return (
    <>
      {error && (
        <div className="hb-alert" role="alert">
          {error}
        </div>
      )}
      <div className="hb-filterbar">
        <Select
          variant="chip"
          label="Department"
          value={dept}
          options={deptOptions}
          active={dept !== ALL}
          onChange={(v) => {
            setDept(v);
            setDuty(ALL);
            setPerson(ALL);
          }}
        />
        <Select
          variant="chip"
          label="Duty"
          value={duty}
          options={dutyOptions}
          active={duty !== ALL}
          onChange={(v) => {
            setDuty(v);
            setPerson(ALL);
          }}
        />
        <Select
          variant="chip"
          label="Person"
          value={person}
          options={personOptions}
          active={person !== ALL}
          onChange={setPerson}
        />
        <span className="hb-filter-note">
          Showing <strong>{scopeName}</strong> · {team.length}{' '}
          {team.length === 1 ? 'person' : 'people'}
        </span>
        <Btn
          kind="ghost"
          disabled={!filtered && !peopleFilter}
          onClick={() => {
            setDept(ALL);
            setDuty(ALL);
            setPerson(ALL);
            setPeopleFilter(null);
          }}
        >
          Reset
        </Btn>
      </div>

      <div className="hb-tiles">
        <Tile label="People" value={team.length} hint="In this view" />
        <Tile
          label="Open tasks"
          value={active ? active.length : '–'}
          hint="Not finished"
          onClick={() => openTasks({ assigneeIds: teamIds, statuses: ACTIVE_STATUSES })}
        />
        <Tile
          label="Overdue tasks"
          value={active ? overdueCount : '–'}
          hint="Past due, still open"
          tone={overdueCount > 0 ? 'red' : undefined}
          pressed={peopleFilter === 'overdue'}
          onClick={() => setPeopleFilter((f) => (f === 'overdue' ? null : 'overdue'))}
        />
        <Tile
          label="On track"
          value={active ? onTrack : '–'}
          hint="People with nothing overdue"
          tone="green"
          pressed={peopleFilter === 'onTrack'}
          onClick={() => setPeopleFilter((f) => (f === 'onTrack' ? null : 'onTrack'))}
        />
        <Tile
          label={`Done ${period === 'today' ? 'today' : period === 'week' ? 'this week' : 'this month'}`}
          value={doneTotal}
          hint="Completed"
          tone="green"
        />
      </div>

      <div className="hb-cols">
        <div className="hb-col">
          <Section
            title="Needs your attention"
            note={
              lateOwners.length > 0
                ? `${lateOwners.length} ${lateOwners.length === 1 ? 'person has' : 'people have'} overdue work`
                : undefined
            }
          >
            <Card>
              <CardHead
                icon={<AlertTriangle size={16} />}
                tone="red"
                title="Overdue tasks, by owner"
                right={
                  <span className={cx('hb-big', overdueCount > 0 && 'hb-late')}>
                    {active ? overdueCount : ''}
                  </span>
                }
              />
              {active === null && <Empty>Loading…</Empty>}
              {active && lateOwners.length === 0 && (
                <Empty good>Nothing overdue in this view.</Empty>
              )}
              {lateOwners.map((s) => (
                <button
                  key={s.person.id}
                  type="button"
                  className="hb-row hb-row-btn hov"
                  onClick={() => openTasks({ assigneeIds: [s.person.id], overdue: true })}
                >
                  <Avatar user={s.person} px={32} decorative />
                  <span className="hb-stack">
                    <span className="hb-name">{userLabel(s.person)}</span>
                    <span className="hb-sub late">
                      {s.oldestLateDays === 0
                        ? 'due earlier today'
                        : `oldest ${s.oldestLateDays}d late`}
                    </span>
                  </span>
                  <Pill tone="red">{s.overdue} overdue</Pill>
                </button>
              ))}
            </Card>
          </Section>

          <Section title="People and load" note={`${shownStats.length} shown`}>
            {shownStats.length === 0 ? (
              <Card>
                <Empty>No one matches this view.</Empty>
              </Card>
            ) : (
              <div className="hb-people">
                {shownStats.map((s) => {
                  const finished = s.onTime + s.late;
                  return (
                    <button
                      key={s.person.id}
                      type="button"
                      className={cx('hb-pcard', s.overdue > 0 && 'late')}
                      aria-pressed={person === s.person.id}
                      onClick={() => setPerson((p) => (p === s.person.id ? ALL : s.person.id))}
                    >
                      <span className="hb-pcard-top">
                        <Avatar user={s.person} px={36} decorative />
                        <span className="hb-stack">
                          <span className="hb-name">{userLabel(s.person)}</span>
                          <span className="hb-small">{s.person.title ?? s.person.role}</span>
                        </span>
                      </span>
                      <span className="hb-stats">
                        <span className="hb-stat">
                          <b>{s.open}</b>
                          <span>open</span>
                        </span>
                        <span className={cx('hb-stat', s.overdue > 0 && 'hb-late')}>
                          <b>{s.overdue}</b>
                          <span>overdue</span>
                        </span>
                        <span className="hb-stat">
                          <b>{s.done}</b>
                          <span>done</span>
                        </span>
                        <span className="hb-stat">
                          <b>
                            {finished > 0 ? `${Math.round((s.onTime / finished) * 100)}%` : '–'}
                          </b>
                          <span>on time</span>
                        </span>
                      </span>
                      {s.overdue > 0 ? (
                        <Pill tone="red">
                          {s.overdue} overdue, oldest {s.oldestLateDays}{' '}
                          {s.oldestLateDays === 1 ? 'day' : 'days'}
                        </Pill>
                      ) : (
                        <Pill tone="green">On track</Pill>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Section>
        </div>

        <aside className="hb-col">
          <Card>
            <CardHead icon={<Building2 size={16} />} tone="red" title="Overdue by department" />
            {byDept.length === 0 ? (
              <Empty good>Nothing overdue.</Empty>
            ) : (
              byDept.map((d) => (
                <button
                  key={d.name}
                  type="button"
                  className="hb-teamrow"
                  aria-pressed={d.id !== null && dept === d.id}
                  disabled={d.id === null}
                  onClick={() => {
                    if (!d.id) return;
                    setDept((cur) => (cur === d.id ? ALL : d.id!));
                    setDuty(ALL);
                    setPerson(ALL);
                  }}
                >
                  <span className="nm">{d.name}</span>
                  <Bar value={d.n} max={worst} tone="red" />
                  <span className="v">{d.n}</span>
                </button>
              ))
            )}
          </Card>
          <Card>
            <CardHead
              icon={<Target size={16} />}
              title="Due-date performance"
              right={<span className="hb-small">{range.heading}</span>}
            />
            <PerformanceBody totals={active ? totals : null} />
          </Card>
          <ActivitySoon team />
        </aside>
      </div>
    </>
  );
}
