import { TASK_CREATED_EVENT } from '../../components/harbor/QuickTask';
import { PeekRow } from '../../components/harbor/TaskPeek';
import { ActivitySoon } from './ActivitySoon';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Target,
} from 'lucide-react';
import type {
  DueDateBucketTotals,
  TaskRowDto,
  TaskSearchFilters,
  TaskStatus,
} from '@healthy-tasks/shared';
import { TASK_STATUS_LABELS } from '@healthy-tasks/shared';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotifications } from '../../notifications/NotificationContext';
import { effectiveFilters, nowContext } from '../../lib/taskSearch';
import { Avatar } from '../../components/ui/Avatar';
import {
  Bar,
  Btn,
  Card,
  CardHead,
  Empty,
  Section,
  StatusPill,
  Tile,
  cx,
  STATUS_TONE,
} from '../../components/harbor/ui';
import { Select } from '../../components/harbor/Select';
import { toYmd } from '../../components/harbor/DatePicker';
import { useToast } from '../../components/harbor/Toast';
import {
  markRead,
  toFeed,
  whenLabel,
  type FeedItem,
} from '../../components/harbor/notificationFeed';
import {
  ACTIVE_STATUSES,
  dueInfo,
  periodRange,
  statusOptions,
  taskSub,
  type Period,
} from '../../components/harbor/taskHelpers';
import { TimeTrackerCard } from './TimeTrackerCard';

type TileKey = 'open' | 'overdue' | 'due' | 'inProgress' | 'onHold' | 'review' | 'done';

interface Counts {
  open: number;
  overdue: number;
  due: number;
  inProgress: number;
  onHold: number;
  review: number;
  done: number;
}

const DUE_LABEL: Record<Period, string> = {
  today: 'Due today',
  week: 'Due this week',
  month: 'Due this month',
};
const DONE_LABEL: Record<Period, string> = {
  today: 'Done today',
  week: 'Done this week',
  month: 'Done this month',
};

function errorText(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong.';
}

export function MyDashboard({
  period,
  onCounts,
}: {
  period: Period;
  onCounts: (attention: number) => void;
}) {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh: refreshUnread } = useNotifications();
  const range = useMemo(() => periodRange(period), [period]);

  const [counts, setCounts] = useState<Counts | null>(null);
  const [overdue, setOverdue] = useState<TaskRowDto[]>([]);
  const [review, setReview] = useState<TaskRowDto[]>([]);
  const [mine, setMine] = useState<TaskRowDto[] | null>(null);
  const [mineTotal, setMineTotal] = useState(0);
  const [next7, setNext7] = useState<TaskRowDto[]>([]);
  const [feed, setFeed] = useState<FeedItem[] | null>(null);
  const [perf, setPerf] = useState<DueDateBucketTotals | null>(null);
  const [tile, setTile] = useState<TileKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flashReview, setFlashReview] = useState(false);
  const reviewRef = useRef<HTMLDivElement>(null);

  const base: TaskSearchFilters = useMemo(() => ({ assigneeIds: [me] }), [me]);

  const tileFilters = useCallback(
    (k: TileKey | null): TaskSearchFilters => {
      switch (k) {
        case 'overdue':
          return { ...base, overdue: true };
        case 'due':
          return effectiveFilters({
            ...base,
            statuses: ACTIVE_STATUSES,
            dueFrom: range.from,
            dueTo: range.to,
            includeNoDue: false,
          });
        case 'inProgress':
          return { ...base, statuses: ['InProgress'] };
        case 'onHold':
          return { ...base, statuses: ['OnHold'] };
        case 'review':
          return { ...base, statuses: ['Review'] };
        case 'done':
          return effectiveFilters({
            ...base,
            statuses: ['Completed'],
            statusChangedFrom: range.from,
            statusChangedTo: range.to,
          });
        default:
          return { ...base, statuses: ACTIVE_STATUSES };
      }
    },
    [base, range],
  );

  const loadCounts = useCallback(async () => {
    const ctx = nowContext();
    const [all, due, done] = await Promise.all([
      api.getTaskDashboard({ filters: base, ...ctx }),
      api.getTaskDashboard({ filters: tileFilters('due'), ...ctx }),
      api.getTaskDashboard({ filters: tileFilters('done'), ...ctx }),
    ]);
    const c: Counts = {
      open: ACTIVE_STATUSES.reduce((n, s) => n + (all.byStatus[s] ?? 0), 0),
      overdue: all.overdue,
      due: due.total,
      inProgress: all.byStatus.InProgress ?? 0,
      onHold: all.byStatus.OnHold ?? 0,
      review: all.byStatus.Review ?? 0,
      done: done.total,
    };
    setCounts(c);
    onCounts(c.overdue + c.review);
  }, [base, tileFilters, onCounts]);

  const loadLists = useCallback(async () => {
    const ctx = nowContext();
    const t = new Date();
    const tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
    const in7 = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 7);
    const [od, rv, nx] = await Promise.all([
      api.queryTasks({
        filters: { ...base, overdue: true },
        sort: [{ field: 'dueAt', dir: 'asc' }],
        page: 1,
        pageSize: 8,
        ...ctx,
      }),
      api.queryTasks({
        filters: { ...base, statuses: ['Review'] },
        sort: [{ field: 'dueAt', dir: 'asc' }],
        page: 1,
        pageSize: 8,
        ...ctx,
      }),
      api.queryTasks({
        filters: effectiveFilters({
          ...base,
          statuses: ACTIVE_STATUSES,
          dueFrom: toYmd(tomorrow),
          dueTo: toYmd(in7),
          includeNoDue: false,
        }),
        sort: [{ field: 'dueAt', dir: 'asc' }],
        page: 1,
        pageSize: 30,
        ...ctx,
      }),
    ]);
    setOverdue(od.rows);
    setReview(rv.rows);
    setNext7(nx.rows);
  }, [base]);

  const loadMine = useCallback(async () => {
    const res = await api.queryTasks({
      filters: tileFilters(tile),
      sort: [{ field: 'dueAt', dir: 'asc' }],
      page: 1,
      pageSize: 50,
      ...nowContext(),
    });
    setMine(res.rows);
    setMineTotal(res.total);
  }, [tile, tileFilters]);

  const loadSide = useCallback(async () => {
    const [n, report] = await Promise.all([
      api.getNotifications('all'),
      api.getDueDateReport({
        filters: effectiveFilters({
          assigneeIds: [me],
          dueFrom: range.from,
          dueTo: range.to,
          includeNoDue: false,
        }),
        ...nowContext(),
      }),
    ]);
    setFeed(toFeed(n).slice(0, 6));
    setPerf(report.bucketTotals);
  }, [me, range]);

  const reloadAll = useCallback(() => {
    setError(null);
    Promise.all([loadCounts(), loadLists(), loadMine()]).catch((e) => setError(errorText(e)));
  }, [loadCounts, loadLists, loadMine]);

  // A task made from the header's quick "New task" panel shows up straight away.
  useEffect(() => {
    window.addEventListener(TASK_CREATED_EVENT, reloadAll);
    return () => window.removeEventListener(TASK_CREATED_EVENT, reloadAll);
  }, [reloadAll]);

  useEffect(() => {
    if (!me) return;
    Promise.all([loadCounts(), loadLists(), loadSide()]).catch((e) => setError(errorText(e)));
  }, [me, loadCounts, loadLists, loadSide]);

  useEffect(() => {
    if (!me) return;
    loadMine().catch((e) => setError(errorText(e)));
  }, [me, loadMine]);

  async function setStatus(t: TaskRowDto, status: TaskStatus) {
    const before = t.status;
    try {
      await api.updateTask(t.id, { status });
      reloadAll();
      toast({
        message: `“${t.name}”: status set to ${TASK_STATUS_LABELS[status]}`,
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

  function pickTile(k: TileKey) {
    if (k === 'review') {
      reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFlashReview(true);
      window.setTimeout(() => setFlashReview(false), 1300);
      return;
    }
    setTile((cur) => (cur === k ? null : k));
  }

  const tiles: {
    key: TileKey;
    label: string;
    value: number | undefined;
    hint: string;
    tone?: 'red' | 'amber' | 'green' | 'blue' | 'review';
  }[] = [
    { key: 'open', label: 'Open', value: counts?.open, hint: 'Not finished yet' },
    {
      key: 'overdue',
      label: 'Overdue',
      value: counts?.overdue,
      hint: 'Past due, still open',
      tone: counts && counts.overdue > 0 ? 'red' : undefined,
    },
    { key: 'due', label: DUE_LABEL[period], value: counts?.due, hint: 'Still open' },
    {
      key: 'inProgress',
      label: 'In progress',
      value: counts?.inProgress,
      hint: 'Being worked on',
      tone: 'blue',
    },
    {
      key: 'onHold',
      label: 'On hold',
      value: counts?.onHold,
      hint: 'Waiting on something',
      tone: counts && counts.onHold > 0 ? 'amber' : undefined,
    },
    {
      key: 'review',
      label: 'To review',
      value: counts?.review,
      hint: 'Sent to you',
      tone: counts && counts.review > 0 ? 'review' : undefined,
    },
    {
      key: 'done',
      label: DONE_LABEL[period],
      value: counts?.done,
      hint: 'Completed',
      tone: 'green',
    },
  ];

  const tileLabel = tiles.find((x) => x.key === tile)?.label;

  return (
    <>
      {error && (
        <div className="hb-alert" role="alert">
          {error}
        </div>
      )}
      <div className="hb-tiles">
        {tiles.map((x) => (
          <Tile
            key={x.key}
            label={x.label}
            value={x.value ?? '–'}
            hint={x.hint}
            tone={x.tone}
            pressed={tile === x.key}
            onClick={() => pickTile(x.key)}
          />
        ))}
      </div>

      <div className="hb-cols">
        <div className="hb-col">
          <div className="hb-grid2">
            <Card>
              <CardHead
                icon={<AlertTriangle size={16} />}
                tone="red"
                title="Overdue, mine"
                right={
                  <span className={cx('hb-big', overdue.length > 0 && 'hb-late')}>
                    {counts?.overdue ?? ''}
                  </span>
                }
              />
              {overdue.length === 0 ? (
                <Empty good>Nothing overdue. Nice.</Empty>
              ) : (
                overdue.map((t) => (
                  <PeekRow key={t.id} id={t.id} name={t.name}>
                    <div className="hb-stack">
                      <Link className="hb-name" to={`/tasks/${t.id}`}>
                        {t.name}
                      </Link>
                      <span className="hb-sub late">{dueInfo(t.dueAt, t.status)?.text}</span>
                    </div>
                    <Btn kind="ok" onClick={() => setStatus(t, 'Completed')}>
                      <CheckCircle2 size={16} aria-hidden="true" /> Done
                    </Btn>
                  </PeekRow>
                ))
              )}
            </Card>

            <div ref={reviewRef} className={cx('hb-card-wrap', flashReview && 'hb-flash')}>
              <Card>
                <CardHead
                  icon={<ClipboardCheck size={16} />}
                  tone="review"
                  title="Waiting on your review"
                  right={<span className="hb-big">{counts?.review ?? ''}</span>}
                />
                {review.length === 0 ? (
                  <Empty>Nothing is waiting on your review.</Empty>
                ) : (
                  review.map((t) => (
                    <PeekRow key={t.id} id={t.id} name={t.name}>
                      <div className="hb-stack">
                        <Link className="hb-name" to={`/tasks/${t.id}`}>
                          {t.name}
                        </Link>
                        <span className="hb-sub">{taskSub(t)}</span>
                      </div>
                      <Link className="hb-btn" to={`/tasks/${t.id}`}>
                        Open
                      </Link>
                      <Btn kind="ok" onClick={() => markReviewed(t)}>
                        Reviewed
                      </Btn>
                    </PeekRow>
                  ))
                )}
              </Card>
            </div>
          </div>

          <Section
            title="My tasks"
            note={
              tile ? (
                <span className="hb-filter-note">
                  Showing <strong>{tileLabel}</strong> · {mine?.length ?? 0} of {mineTotal}
                  <button
                    type="button"
                    className="hb-btn hb-btn-link"
                    onClick={() => setTile(null)}
                  >
                    Show all open
                  </button>
                </span>
              ) : (
                `${mineTotal} open`
              )
            }
            right={
              <Link className="hb-sec-link" to="/tasks" state={{ filters: tileFilters(tile) }}>
                Open full list
              </Link>
            }
          >
            <Card>
              {mine === null && <Empty>Loading…</Empty>}
              {mine?.length === 0 && (
                <Empty good={!tile}>
                  {tile ? 'No tasks match this filter.' : 'You are all caught up.'}
                </Empty>
              )}
              {mine?.map((t) => {
                const due = dueInfo(t.dueAt, t.status);
                return (
                  <PeekRow key={t.id} id={t.id} name={t.name}>
                    <div className="hb-stack">
                      <Link className="hb-name" to={`/tasks/${t.id}`}>
                        {t.name}
                      </Link>
                      <span className="hb-sub">{taskSub(t)}</span>
                    </div>
                    <span className={cx('hb-due', due?.late && 'late', due?.today && 'today')}>
                      {due?.text ?? 'No due date'}
                    </span>
                    {t.status === 'Review' || t.mentionOnly || t.treeOnly ? (
                      <StatusPill status={t.status} />
                    ) : (
                      <Select
                        variant="pill"
                        className={`tone-${STATUS_TONE[t.status]}`}
                        label={`Status of ${t.name}`}
                        value={t.status}
                        options={statusOptions(t.status)}
                        onChange={(s) => setStatus(t, s)}
                      />
                    )}
                  </PeekRow>
                );
              })}
            </Card>
          </Section>
        </div>

        <aside className="hb-col">
          <TimeTrackerCard period={period} />
          <Card>
            <CardHead
              icon={<Bell size={16} />}
              title="Notifications"
              right={
                feed && feed.some((f) => !f.read) ? (
                  <span className="hb-small">{feed.filter((f) => !f.read).length} unread</span>
                ) : undefined
              }
            />
            {feed === null && <Empty>Loading…</Empty>}
            {feed?.length === 0 && <Empty>You are all caught up.</Empty>}
            {feed?.map((it) => (
              <button
                key={it.key}
                type="button"
                className={cx('hb-row', 'hb-row-btn', 'hov', !it.read && 'unread')}
                onClick={async () => {
                  if (!it.read) {
                    await markRead(it).catch(() => {});
                    refreshUnread();
                  }
                  navigate(`/tasks/${it.taskId}`);
                }}
              >
                {it.who ? (
                  <Avatar user={it.who} px={28} decorative />
                ) : (
                  <span className="hb-av-ph">
                    <Bell size={14} />
                  </span>
                )}
                <span className="hb-stack">
                  <span className="hb-sub">{it.text}</span>
                  <span className="hb-name">{it.taskName}</span>
                </span>
                <span className="hb-small">{whenLabel(it.at)}</span>
              </button>
            ))}
          </Card>

          <Card>
            <CardHead
              icon={<CalendarClock size={16} />}
              title="Due in the next 7 days"
              right={<span className="hb-small">{next7.length}</span>}
            />
            {next7.length === 0 ? (
              <Empty>Nothing due in the next 7 days.</Empty>
            ) : (
              groupByDay(next7).map(([day, rows]) => (
                <div key={day}>
                  <div className="hb-day">{day}</div>
                  {rows.map((t) => (
                    <Link key={t.id} to={`/tasks/${t.id}`} className="hb-mini">
                      <span
                        className="hb-dot"
                        style={{ background: dotFor(t.status) }}
                        aria-hidden="true"
                      />
                      <span className="t">{t.name}</span>
                    </Link>
                  ))}
                </div>
              ))
            )}
          </Card>

          <Card>
            <CardHead
              icon={<Target size={16} />}
              title="Due-date performance"
              right={<span className="hb-small">{range.heading}</span>}
            />
            <PerformanceBody totals={perf} />
          </Card>
          <ActivitySoon />
        </aside>
      </div>
    </>
  );
}

function dotFor(s: TaskStatus): string {
  return {
    Open: '#8a9ab0',
    InProgress: '#1f5fbf',
    OnHold: '#b86e00',
    Review: '#6e95d3',
    Completed: '#1b6b2e',
    Canceled: '#c9d0da',
  }[s];
}

function groupByDay(rows: TaskRowDto[]): [string, TaskRowDto[]][] {
  const map = new Map<string, TaskRowDto[]>();
  for (const r of rows) {
    if (!r.dueAt) continue;
    const label = new Date(r.dueAt).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    map.set(label, [...(map.get(label) ?? []), r]);
  }
  return [...map.entries()];
}

/** On time vs late for tasks due in the period, plus what is still open. */
export function PerformanceBody({ totals }: { totals: DueDateBucketTotals | null }) {
  if (!totals) return <Empty>Loading…</Empty>;
  const finished = totals.OnTime + totals.Late;
  const rate = finished > 0 ? Math.round((totals.OnTime / finished) * 100) : null;
  return (
    <div className="hb-pad">
      <div className="hb-perf">
        <span className={cx('hb-perf-rate', rate !== null && rate < 70 && 'hb-late')}>
          {rate === null ? '–' : `${rate}%`}
        </span>
        <span className="hb-small">
          {rate === null ? 'Nothing finished yet in this period' : 'finished on time'}
        </span>
      </div>
      <Bar value={totals.OnTime} max={finished} tone="green" />
      <div className="hb-perf-legend">
        <span>
          <strong>{totals.OnTime}</strong> on time
        </span>
        <span className={totals.Late > 0 ? 'hb-late' : undefined}>
          <strong>{totals.Late}</strong> late
        </span>
        <span className={totals.Overdue > 0 ? 'hb-late' : undefined}>
          <strong>{totals.Overdue}</strong> overdue
        </span>
        <span>
          <strong>{totals.NotStarted + totals.NotCompleted}</strong> still open
        </span>
      </div>
    </div>
  );
}
