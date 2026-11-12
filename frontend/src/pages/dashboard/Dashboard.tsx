import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AtSign, Bell, BellRing, CheckCircle2, ClipboardCheck, UserPlus, X } from 'lucide-react';
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type DepartmentDto,
  type OrgPersonDto,
  type TaskRowDto,
  type TaskSearchFilters,
  type TaskStatus,
  type UnreadCountDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotifications } from '../../notifications/NotificationContext';
import { effectiveFilters, nowContext } from '../../lib/taskSearch';
import { loadTeamScope } from '../../lib/teamScope';
import { Avatar, userLabel } from '../../components/ui/Avatar';
import {
  Btn,
  Card,
  CardHead,
  Empty,
  StatusPill,
  cx,
  STATUS_DOT,
  STATUS_TONE,
} from '../../components/harbor/ui';
import { Select, type SelectOption } from '../../components/harbor/Select';
import { toYmd } from '../../components/harbor/DatePicker';
import { useToast } from '../../components/harbor/Toast';
import { PeekRow } from '../../components/harbor/TaskPeek';
import { TASK_CREATED_EVENT } from '../../components/harbor/QuickTask';
import {
  markRead,
  toFeed,
  whenLabel,
  type FeedItem,
} from '../../components/harbor/notificationFeed';
import {
  ACTIVE_STATUSES,
  PERIOD_OPTIONS,
  dueInfo,
  periodRange,
  statusOptions,
  taskSub,
  type Period,
} from '../../components/harbor/taskHelpers';

/** Whose tasks the numbers cover: me, my team, everyone I can see, or one person. */
export const ME = '__me';
export const TEAM = '__team';
export const EVERYONE = '__all';
const ALL_DEPTS = '__all';

type TaskTile = 'notDone' | 'inProgress' | 'overdue' | 'done';
type NeedTile = 'review' | 'mentions' | 'reminders' | 'assigned';
type Panel = TaskTile | NeedTile;

const DONE_LABEL: Record<Period, string> = {
  today: 'Done today',
  week: 'Done this week',
  month: 'Done this month',
};

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');

/** Every page of a search, up to a cap (the team's workload counts every open task). */
async function allRows(filters: TaskSearchFilters, cap = 1000): Promise<TaskRowDto[]> {
  const out: TaskRowDto[] = [];
  for (let page = 1; out.length < cap; page += 1) {
    const res = await api.queryTasks({ filters, page, pageSize: 200, ...nowContext() });
    out.push(...res.rows);
    if (out.length >= res.total || res.rows.length === 0) break;
  }
  return out;
}

/**
 * The Dashboard, laid out the way Lipa's system does it (Nov 12): numbers first,
 * lists on demand. Four task numbers and a "Needs you" row of four more; clicking
 * one opens its list right there under the row, and clicking again (or ✕) closes
 * it. Below, where things stand by status and what is due next; when the numbers
 * cover more than one person, each person's load. Period, Department and Person
 * in the header decide what the numbers cover; "Needs you" is always yours.
 */
export function Dashboard({
  period,
  scope,
  dept,
  onScope,
  filters,
}: {
  period: Period;
  scope: string;
  dept: string;
  onScope: (scope: string) => void;
  /** Period / Department / Person, shown on the first line opposite the note. */
  filters?: ReactNode;
}) {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();
  const toast = useToast();
  const { unread, refresh: refreshUnread } = useNotifications();
  const range = useMemo(() => periodRange(period), [period]);

  const [teamIds, setTeamIds] = useState<string[] | null>(null);
  const [people, setPeople] = useState<OrgPersonDto[]>([]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [counts, setCounts] = useState<{
    byStatus: Record<TaskStatus, number>;
    overdue: number;
    done: number;
    review: number;
  } | null>(null);
  const [panelRows, setPanelRows] = useState<{ rows: TaskRowDto[]; total: number } | null>(null);
  const [dueNext, setDueNext] = useState<TaskRowDto[] | null>(null);
  const [load, setLoad] = useState<TaskRowDto[] | null>(null);
  const [feed, setFeed] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    loadTeamScope(user)
      .then((s) => {
        setTeamIds(s.teamIds);
        setPeople(s.people);
      })
      .catch(() => setTeamIds([]));
  }, [user]);

  const manyPeople = scope === TEAM || scope === EVERYONE;
  /** The tasks the numbers cover, before any status or date. */
  const base: TaskSearchFilters | null = useMemo(() => {
    if (!me || teamIds === null) return null;
    const who: TaskSearchFilters =
      scope === ME
        ? { assigneeIds: [me] }
        : scope === TEAM
          ? { assigneeIds: teamIds.length ? teamIds : ['__nobody__'] }
          : scope === EVERYONE
            ? {}
            : { assigneeIds: [scope] };
    return dept === ALL_DEPTS ? who : { ...who, departmentIds: [dept] };
  }, [me, teamIds, scope, dept]);

  const tileFilters = useCallback(
    (k: TaskTile): TaskSearchFilters => {
      const b = base ?? {};
      switch (k) {
        case 'notDone':
          return { ...b, statuses: ACTIVE_STATUSES };
        case 'inProgress':
          return { ...b, statuses: ['InProgress'] };
        case 'overdue':
          return { ...b, overdue: true };
        case 'done':
          return effectiveFilters({
            ...b,
            statuses: ['Completed'],
            statusChangedFrom: range.from,
            statusChangedTo: range.to,
          });
      }
    },
    [base, range],
  );
  const reviewFilters: TaskSearchFilters = useMemo(
    () => ({ assigneeIds: [me], statuses: ['Review'] }),
    [me],
  );

  const loadNumbers = useCallback(async () => {
    if (!base) return;
    const ctx = nowContext();
    const today = new Date();
    const [all, done, review, next] = await Promise.all([
      api.getTaskDashboard({ filters: base, ...ctx }),
      api.getTaskDashboard({ filters: tileFilters('done'), ...ctx }),
      api.queryTasks({ filters: reviewFilters, page: 1, pageSize: 1, ...ctx }),
      api.queryTasks({
        filters: effectiveFilters({
          ...base,
          statuses: ACTIVE_STATUSES,
          dueFrom: toYmd(today),
          includeNoDue: false,
        }),
        sort: [{ field: 'dueAt', dir: 'asc' }],
        page: 1,
        // Late ones are left out (they are under Overdue), so ask for a few more.
        pageSize: 20,
        ...ctx,
      }),
    ]);
    setCounts({
      byStatus: all.byStatus,
      overdue: all.overdue,
      done: done.total,
      review: review.total,
    });
    setDueNext(next.rows.filter((t) => !dueInfo(t.dueAt, t.status)?.late));
    setLoad(manyPeople ? await allRows({ ...base, statuses: ACTIVE_STATUSES }) : null);
  }, [base, tileFilters, reviewFilters, manyPeople]);

  const loadFeed = useCallback(async () => {
    setFeed(toFeed(await api.getNotifications('all')));
  }, []);

  const loadPanel = useCallback(async () => {
    if (!panel || panel === 'mentions' || panel === 'reminders' || panel === 'assigned') {
      setPanelRows(null);
      return;
    }
    setPanelRows(null);
    const filters = panel === 'review' ? reviewFilters : tileFilters(panel);
    const res = await api.queryTasks({
      filters,
      sort: [{ field: 'dueAt', dir: 'asc' }],
      page: 1,
      pageSize: 10,
      ...nowContext(),
    });
    setPanelRows({ rows: res.rows, total: res.total });
  }, [panel, reviewFilters, tileFilters]);

  const reloadAll = useCallback(() => {
    setError(null);
    Promise.all([loadNumbers(), loadPanel()]).catch((e) => setError(errorText(e)));
  }, [loadNumbers, loadPanel]);

  useEffect(() => {
    loadNumbers().catch((e) => setError(errorText(e)));
  }, [loadNumbers]);
  useEffect(() => {
    loadFeed().catch(() => setFeed([]));
  }, [loadFeed, unread?.total]);
  useEffect(() => {
    loadPanel().catch((e) => setError(errorText(e)));
  }, [loadPanel]);
  // A task made from the header's quick "New task" panel counts straight away.
  useEffect(() => {
    window.addEventListener(TASK_CREATED_EVENT, reloadAll);
    return () => window.removeEventListener(TASK_CREATED_EVENT, reloadAll);
  }, [reloadAll]);

  async function setStatus(t: TaskRowDto, status: TaskStatus) {
    const before = t.status;
    try {
      await api.updateTask(t.id, { status });
      reloadAll();
      toast({
        message: `“${t.name}”: ${TASK_STATUS_LABELS[status]}`,
        undo: async () => {
          await api
            .updateTask(t.id, { status: before })
            .catch((e) => toast({ message: errorText(e), tone: 'error' }));
          reloadAll();
        },
      });
    } catch (e) {
      toast({ message: errorText(e), tone: 'error' });
    }
  }
  async function markReviewed(t: TaskRowDto) {
    try {
      await api.reviewed(t.id);
      reloadAll();
      toast({ message: `“${t.name}” marked reviewed and handed back.`, tone: 'success' });
    } catch (e) {
      toast({ message: errorText(e), tone: 'error' });
    }
  }
  async function openFeed(it: FeedItem) {
    if (!it.read) {
      await markRead(it).catch(() => {});
      refreshUnread();
    }
    navigate(`/tasks/${it.taskId}`);
  }

  const notDone = counts
    ? ACTIVE_STATUSES.reduce((n, s) => n + (counts.byStatus[s] ?? 0), 0)
    : null;
  const whose =
    scope === ME
      ? 'your'
      : scope === TEAM
        ? 'your team’s'
        : scope === EVERYONE
          ? 'everyone’s'
          : `${userLabel(people.find((p) => p.id === scope) ?? { id: scope })}’s`;
  const u: UnreadCountDto | null = unread ?? null;

  const taskTiles: TileDef<TaskTile>[] = [
    { key: 'notDone', label: 'Not done', value: notDone, hint: 'Still to finish' },
    {
      key: 'inProgress',
      label: 'In progress',
      value: counts?.byStatus.InProgress,
      hint: 'Being worked on now',
      tone: 'blue',
    },
    {
      key: 'overdue',
      label: 'Overdue',
      value: counts?.overdue,
      hint: 'Past due, needs attention',
      tone: counts && counts.overdue > 0 ? 'red' : undefined,
    },
    {
      key: 'done',
      label: DONE_LABEL[period],
      value: counts?.done,
      hint: counts?.done ? 'Finished' : 'Nothing finished yet',
      tone: 'green',
    },
  ];
  const needTiles: TileDef<NeedTile>[] = [
    {
      key: 'review',
      label: 'To review',
      value: counts?.review,
      hint: 'Sent to you',
      tone: counts && counts.review > 0 ? 'review' : undefined,
      icon: <ClipboardCheck size={16} aria-hidden="true" />,
    },
    {
      key: 'mentions',
      label: 'Mentions',
      value: u?.mentioned,
      hint: 'Unread',
      icon: <AtSign size={16} aria-hidden="true" />,
    },
    {
      key: 'reminders',
      label: 'Reminders',
      value: u?.reminders,
      hint: 'Unread',
      icon: <BellRing size={16} aria-hidden="true" />,
    },
    {
      key: 'assigned',
      label: 'Assigned to you',
      value: u?.assigned,
      hint: 'Unread',
      icon: <UserPlus size={16} aria-hidden="true" />,
    },
  ];
  const toggle = (k: Panel) => setPanel((p) => (p === k ? null : k));

  const panelTitle = [...taskTiles, ...needTiles].find((t) => t.key === panel)?.label ?? '';
  const panelBody = (() => {
    if (!panel) return null;
    if (panel === 'mentions' || panel === 'reminders' || panel === 'assigned') {
      const list = panel === 'mentions' ? 'mentioned' : panel;
      const items = (feed ?? []).filter((f) => f.list === list).slice(0, 10);
      if (feed === null) return <Empty>Loading…</Empty>;
      if (items.length === 0) return <Empty good>Nothing here. You are all caught up.</Empty>;
      return items.map((it) => (
        <button
          key={it.key}
          type="button"
          className={cx('hb-row', 'hb-row-btn', 'hov', !it.read && 'unread')}
          onClick={() => void openFeed(it)}
        >
          {it.who ? (
            <Avatar user={it.who} px={28} decorative />
          ) : (
            <span className="hb-av-ph">
              {it.list === 'reminders' ? <BellRing size={14} /> : <Bell size={14} />}
            </span>
          )}
          <span className="hb-stack">
            <span className="hb-sub">{it.text}</span>
            <span className="hb-name">{it.taskName}</span>
          </span>
          <span className="hb-small">{whenLabel(it.at)}</span>
        </button>
      ));
    }
    if (!panelRows) return <Empty>Loading…</Empty>;
    if (panelRows.rows.length === 0)
      return (
        <Empty good>{panel === 'review' ? 'Nothing waits on your review.' : 'Nothing here.'}</Empty>
      );
    return panelRows.rows.map((t) => {
      const due = dueInfo(t.dueAt, t.status);
      const ro = t.mentionOnly || t.treeOnly;
      return (
        <PeekRow key={t.id} id={t.id} name={t.name}>
          <div className="hb-stack">
            <Link className="hb-name" to={`/tasks/${t.id}`}>
              {t.name}
            </Link>
            <span className="hb-sub">
              {taskSub(t)}
              {manyPeople && t.assignee && <> · {userLabel(t.assignee)}</>}
            </span>
          </div>
          <span className={cx('hb-due', due?.late && 'late', due?.today && 'today')}>
            {due?.text ?? 'No due date'}
          </span>
          {panel === 'review' ? (
            <Btn kind="ok" onClick={() => void markReviewed(t)}>
              Reviewed
            </Btn>
          ) : t.status === 'Review' || ro ? (
            <StatusPill status={t.status} />
          ) : (
            <Select
              variant="pill"
              className={`tone-${STATUS_TONE[t.status]}`}
              label={`Status of ${t.name}`}
              value={t.status}
              options={statusOptions(t.status)}
              onChange={(s) => void setStatus(t, s)}
            />
          )}
          {panel === 'overdue' && !ro && (
            <Btn kind="ok" onClick={() => void setStatus(t, 'Completed')}>
              <CheckCircle2 size={16} aria-hidden="true" /> Done
            </Btn>
          )}
        </PeekRow>
      );
    });
  })();
  const panelLink =
    panel && panel !== 'mentions' && panel !== 'reminders' && panel !== 'assigned' ? (
      <Link
        className="hb-sec-link"
        to="/tasks"
        state={{ filters: panel === 'review' ? reviewFilters : tileFilters(panel) }}
      >
        {panelRows && panelRows.total > panelRows.rows.length
          ? `See all ${panelRows.total} in Tasks`
          : 'Open in Tasks'}
      </Link>
    ) : null;

  const panelCard = (
    <Card className="hb-dash-panel">
      <div className="hb-dash-panel-head">
        <h3>{panelTitle}</h3>
        {panelRows && <span className="hb-small">{panelRows.total}</span>}
        <span className="hb-grow" />
        {panelLink}
        <button
          type="button"
          className="hb-icon-btn hb-icon-btn-sm"
          aria-label={`Close ${panelTitle}`}
          onClick={() => setPanel(null)}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {panelBody}
    </Card>
  );

  const isTaskPanel = panel && taskTiles.some((t) => t.key === panel);
  const isNeedPanel = panel && needTiles.some((t) => t.key === panel);

  return (
    <>
      {error && (
        <div className="hb-alert" role="alert">
          {error}
        </div>
      )}
      <div className="hb-dash-top">
        <p className="hb-dash-note">
          These numbers cover {whose} tasks. Click one to see them here.
        </p>
        {filters}
      </div>
      <TileRow tiles={taskTiles} open={panel} onToggle={toggle} />
      {isTaskPanel && panelCard}

      <h2 className="hb-dash-k">Needs you</h2>
      <TileRow tiles={needTiles} open={panel} onToggle={toggle} small />
      {isNeedPanel && panelCard}

      <div className="hb-dash-row">
        {/* Status and workload stack on the left, so neither column leaves a gap. */}
        <div className="hb-dash-stack">
          <StatusCard
            byStatus={counts?.byStatus ?? null}
            done={counts?.done ?? 0}
            period={period}
          />
          {manyPeople && <WorkloadCard rows={load} onPick={(id) => onScope(id)} />}
        </div>
        <Card>
          <CardHead
            title="Due next"
            right={
              <Link className="hb-sec-link" to="/tasks" state={{ filters: tileFilters('notDone') }}>
                All {scope === ME ? 'my ' : ''}tasks
              </Link>
            }
          />
          {dueNext === null ? (
            <Empty>Loading…</Empty>
          ) : dueNext.length === 0 ? (
            <Empty good>Nothing coming up.</Empty>
          ) : (
            dueNext.slice(0, 5).map((t) => (
              <Link key={t.id} to={`/tasks/${t.id}`} className="hb-row hov hb-dash-next">
                <span className="hb-stack">
                  <span className="hb-name">{t.name}</span>
                  <span className="hb-sub">
                    {dueInfo(t.dueAt, t.status)?.text}
                    {manyPeople && t.assignee && <> · {userLabel(t.assignee)}</>}
                  </span>
                </span>
                <StatusPill status={t.status} />
              </Link>
            ))
          )}
        </Card>
      </div>
    </>
  );
}

interface TileDef<K extends string> {
  key: K;
  label: string;
  value: number | null | undefined;
  hint: string;
  tone?: 'red' | 'green' | 'blue' | 'review';
  icon?: ReactNode;
}

function TileRow<K extends string>({
  tiles,
  open,
  onToggle,
  small,
}: {
  tiles: TileDef<K>[];
  open: string | null;
  onToggle: (k: K) => void;
  small?: boolean;
}) {
  return (
    <div className={cx('hb-dash-tiles', small && 'is-small')}>
      {tiles.map((t) => (
        <button
          key={t.key}
          type="button"
          className={cx('hb-dash-tile', t.tone && `dt-${t.tone}`, open === t.key && 'is-open')}
          aria-expanded={open === t.key}
          onClick={() => onToggle(t.key)}
        >
          <span className="k">
            {t.icon}
            {t.label}
          </span>
          <span className="v">{t.value ?? '–'}</span>
          <span className="h">{open === t.key ? 'Showing below · click to close' : t.hint}</span>
        </button>
      ))}
    </div>
  );
}

/** Where things stand: one bar per status, the period's finished ones last. */
function StatusCard({
  byStatus,
  done,
  period,
}: {
  byStatus: Record<TaskStatus, number> | null;
  done: number;
  period: Period;
}) {
  const rows = TASK_STATUSES.filter((s) => s !== 'Completed' && s !== 'Canceled').map((s) => ({
    key: s,
    label: TASK_STATUS_LABELS[s],
    n: byStatus?.[s] ?? 0,
    color: STATUS_DOT[s],
  }));
  const all = [
    ...rows,
    { key: 'done', label: DONE_LABEL[period], n: done, color: STATUS_DOT.Completed },
  ];
  const max = Math.max(1, ...all.map((r) => r.n));
  return (
    <Card>
      <CardHead title="Where things stand" />
      {byStatus === null ? (
        <Empty>Loading…</Empty>
      ) : (
        <div className="hb-dash-bars">
          {all.map((r) => (
            <div key={r.key} className="hb-dash-bar">
              <span className="hb-dot" style={{ background: r.color }} aria-hidden="true" />
              <span className="l">{r.label}</span>
              <span className="track" aria-hidden="true">
                <span style={{ width: `${(r.n / max) * 100}%`, background: r.color }} />
              </span>
              <span className="n">{r.n}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Each person's open tasks, overdue part in red; heaviest first. Click: their numbers. */
function WorkloadCard({
  rows,
  onPick,
}: {
  rows: TaskRowDto[] | null;
  onPick: (personId: string) => void;
}) {
  const now = Date.now();
  const byPerson = new Map<string, { who: TaskRowDto['assignee']; open: number; late: number }>();
  for (const t of rows ?? []) {
    const k = t.assignee?.id ?? '';
    const cur = byPerson.get(k) ?? { who: t.assignee, open: 0, late: 0 };
    cur.open += 1;
    if (t.dueAt && new Date(t.dueAt).getTime() < now) cur.late += 1;
    byPerson.set(k, cur);
  }
  const list = [...byPerson.entries()].sort((a, b) => b[1].open - a[1].open);
  const max = Math.max(1, ...list.map(([, v]) => v.open));
  return (
    <Card className="hb-dash-load">
      <CardHead
        title="Workload"
        right={
          <span className="hb-small">
            {list.length} {list.length === 1 ? 'person' : 'people'} ·{' '}
            {list.reduce((n, [, v]) => n + v.open, 0)} not done
          </span>
        }
      />
      {rows === null ? (
        <Empty>Loading…</Empty>
      ) : list.length === 0 ? (
        <Empty good>No open tasks.</Empty>
      ) : (
        <div className="hb-dash-bars">
          {list.slice(0, 12).map(([id, v]) => (
            <button
              key={id || 'none'}
              type="button"
              className="hb-dash-bar is-person"
              disabled={!id}
              title={id ? `Show ${userLabel(v.who!)}’s numbers` : undefined}
              onClick={() => id && onPick(id)}
            >
              {v.who ? (
                <Avatar user={v.who} px={24} decorative />
              ) : (
                <span className="hb-av-ph">?</span>
              )}
              <span className="l">{v.who ? userLabel(v.who) : 'Unassigned'}</span>
              <span className="track" aria-hidden="true">
                <span className="late" style={{ width: `${(v.late / max) * 100}%` }} />
                <span style={{ width: `${((v.open - v.late) / max) * 100}%` }} />
              </span>
              <span className="n">
                {v.open}
                {v.late > 0 && <em> · {v.late} late</em>}
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Person choices for the header: me, my team, everyone, then each person in scope. */
export function scopeOptions(
  canTeam: boolean,
  people: OrgPersonDto[],
  teamIds: string[],
  meId: string,
  isAdmin: boolean,
): SelectOption<string>[] {
  if (!canTeam) return [{ value: ME, label: 'Me' }];
  const team = new Set(teamIds);
  return [
    { value: ME, label: 'Me' },
    { value: TEAM, label: 'My team' },
    ...(isAdmin ? [{ value: EVERYONE, label: 'Everyone' }] : []),
    ...people
      .filter((p) => p.id !== meId && (isAdmin || team.has(p.id)))
      .sort((a, b) => userLabel(a).localeCompare(userLabel(b)))
      .map((p) => ({
        value: p.id,
        label: userLabel(p),
        lead: <Avatar user={p} px={22} decorative />,
      })),
  ];
}

export function deptOptions(departments: DepartmentDto[]): SelectOption<string>[] {
  return [
    { value: ALL_DEPTS, label: 'All departments' },
    ...departments
      .filter((d) => !d.archived)
      .map((d) => ({ value: d.id, label: d.name, dot: d.color })),
  ];
}
export { ALL_DEPTS, PERIOD_OPTIONS };
