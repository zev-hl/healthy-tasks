import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileStack,
  MoreHorizontal,
  X,
} from 'lucide-react';
import {
  MAX_PAGE_SIZE,
  type ActiveUserDto,
  TASK_STATUS_LABELS,
  type DepartmentDto,
  type ExclusivesGroupOptionDto,
  type GhostOccurrenceDto,
  type TaskPriority,
  type TaskRowDto,
  type TaskSearchFilters,
  type TaskSortField,
  type TaskStatus,
  type UpdateTaskRequest,
} from '@healthy-tasks/shared';
import { api, ApiError, exportTasksToExcel } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { nowContext } from '../lib/taskSearch';
import { loadTeamScope } from '../lib/teamScope';
import { Avatar, userLabel } from '../components/ui/Avatar';
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { Select, type SelectOption } from '../components/harbor/Select';
import { DatePicker } from '../components/harbor/DatePicker';
import { Popover } from '../components/harbor/Popover';
import { useToast } from '../components/harbor/Toast';
import { Btn, Card, CountBadge, Empty, Segmented, cx } from '../components/harbor/ui';
import { PRIORITY_OPTIONS, dueIsoFromYmd, statusOptions } from '../components/harbor/taskHelpers';
import { TaskKanban } from '../components/TaskKanban';
import { TaskCalendar, type CalendarScale } from '../components/TaskCalendar';
import { TaskGantt } from '../components/TaskGantt';
import { TaskTable, OPTIONAL_COLUMNS, type OptionalColumn, type RowEdit } from './tasks/TaskTable';
import { MoreFilters } from './tasks/MoreFilters';
import {
  ALL,
  SORT_OPTIONS,
  STATUS_PRESETS,
  UNASSIGNED,
  buildFilters,
  defaultState,
  dirLabel,
  extraChips,
  fromRawFilters,
  isFiltered,
  readViewState,
  sameState,
  sortOf,
  type SavedView,
  type Scope,
  type TaskView,
  type ViewState,
} from './tasks/viewState';

const PAGE_SIZE = 50;
const VIEWS: { value: TaskView; label: string }[] = [
  { value: 'list', label: 'List' },
  { value: 'kanban', label: 'Board' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'gantt', label: 'Gantt' },
];
const SCOPE_LABEL: Record<Scope, string> = { mine: 'My tasks', all: 'All tasks', team: 'My team' };

/** The keys this page keeps inside the shared `task-search` screen setting. */
interface Stored {
  hbState?: unknown;
  hbTab?: string;
  hbViews?: SavedView[];
  hbView?: TaskView;
  hbColumns?: OptionalColumn[];
  hbNest?: boolean;
  hbReadOnly?: boolean;
  hbCalScale?: CalendarScale;
}

function errorText(e: unknown, fallback = 'Something went wrong.'): string {
  return e instanceof ApiError ? e.message : fallback;
}

function clean(f: TaskSearchFilters): TaskSearchFilters {
  const out: TaskSearchFilters = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * Tasks (§6.2): My tasks / All tasks / My team tabs and your saved views, one
 * slim toolbar of filter chips with Sort, and a full-width table where Owner,
 * Due, Status and Priority change in the row itself. Ticking rows brings up a
 * bar to change them all at once. The same filters drive Board, Calendar and
 * Gantt.
 */
export function TasksPage() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const canTeam = user?.role === 'Admin' || user?.role === 'Manager';
  const location = useLocation();
  const toast = useToast();

  // --- Reference data --------------------------------------------------------
  const [people, setPeople] = useState<ActiveUserDto[]>([]);
  const [departments, setDepartments] = useState<DepartmentDto[]>([]);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [groups, setGroups] = useState<ExclusivesGroupOptionDto[]>([]);

  // --- Page state --------------------------------------------------------------
  const [hydrated, setHydrated] = useState(false);
  const stored = useRef<Record<string, unknown>>({});
  const [state, setState] = useState<ViewState>(defaultState('mine'));
  const [tab, setTab] = useState<string>('mine'); // a scope or a saved view's id
  const [views, setViews] = useState<SavedView[]>([]);
  const [view, setView] = useState<TaskView>('list');
  const [columns, setColumns] = useState<Set<OptionalColumn>>(new Set());
  const [nest, setNest] = useState(false);
  const [includeReadOnly, setIncludeReadOnly] = useState(true);
  const [calScale, setCalScale] = useState<CalendarScale>('month');
  const [text, setText] = useState('');
  const debouncedText = useDebouncedValue(text, 300);
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<TaskRowDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Partial<Record<Scope, number>>>({});
  const [overdueInScope, setOverdueInScope] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [flash, setFlash] = useState<Set<number>>(new Set());
  const [ghosts, setGhosts] = useState<GhostOccurrenceDto[]>([]);
  const [naming, setNaming] = useState(false);
  const [viewName, setViewName] = useState('');
  const pendingHighlight = useRef<number | null>(null);

  // Reference data and the remembered state, once.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    void Promise.all([
      api.listActiveUsers().catch(() => []),
      api.listDepartments().catch(() => []),
      loadTeamScope(user).catch(() => ({ teamIds: [] as string[] })),
      api.listTaskTags().catch(() => []),
      api.listExclusivesGroupOptions().catch(() => []),
      api.getPreference('task-search').catch(() => ({ state: null })),
    ]).then(([users, deps, scope, tg, gr, pref]) => {
      if (!alive) return;
      setPeople(users);
      setDepartments(deps.filter((d) => !d.archived));
      setTeamIds(scope.teamIds);
      setTags(tg);
      setGroups(gr);
      const s = (pref.state && typeof pref.state === 'object' ? pref.state : {}) as Stored &
        Record<string, unknown>;
      stored.current = s;
      if (Array.isArray(s.hbViews)) setViews(s.hbViews.filter((v) => v && readViewState(v.state)));
      if (s.hbView) setView(s.hbView);
      if (Array.isArray(s.hbColumns)) setColumns(new Set(s.hbColumns));
      if (typeof s.hbNest === 'boolean') setNest(s.hbNest);
      if (typeof s.hbReadOnly === 'boolean') setIncludeReadOnly(s.hbReadOnly);
      if (s.hbCalScale) setCalScale(s.hbCalScale);

      const st = location.state as { filters?: TaskSearchFilters; text?: string } | null;
      const params = new URLSearchParams(location.search);
      if (st?.filters) {
        const v = fromRawFilters(st.filters, user.id);
        setState(v);
        setTab(v.scope);
      } else {
        const last = readViewState(s.hbState);
        const scopeParam = params.get('scope');
        if (scopeParam === 'mine' || scopeParam === 'all' || scopeParam === 'team') {
          setState(defaultState(scopeParam));
          setTab(scopeParam);
        } else if (last && (last.scope !== 'team' || user.role !== 'Member')) {
          setState(last);
          setTab(typeof s.hbTab === 'string' ? s.hbTab : last.scope);
        }
      }
      if (st?.text) setText(st.text);
      const taskParam = Number(params.get('task'));
      if (taskParam) pendingHighlight.current = taskParam;
      if (st) window.history.replaceState({}, '');
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Remember everything (debounced), alongside what the older screen keeps.
  const snapshot = useMemo<Stored>(
    () => ({
      hbState: state,
      hbTab: tab,
      hbViews: views,
      hbView: view,
      hbColumns: [...columns],
      hbNest: nest,
      hbReadOnly: includeReadOnly,
      hbCalScale: calScale,
    }),
    [state, tab, views, view, columns, nest, includeReadOnly, calScale],
  );
  const debouncedSnapshot = useDebouncedValue(snapshot, 600);
  useEffect(() => {
    if (!hydrated) return;
    const next = { ...stored.current, ...debouncedSnapshot };
    stored.current = next;
    void api.savePreference('task-search', next).catch(() => {});
  }, [debouncedSnapshot, hydrated]);

  const filters = useMemo(() => buildFilters(state, me, teamIds), [state, me, teamIds]);

  // --- Rows -----------------------------------------------------------------
  const runQuery = useCallback(async (): Promise<TaskRowDto[]> => {
    setLoading(true);
    const list = view === 'list';
    try {
      const res = await api.queryTasks({
        text: debouncedText.trim() || undefined,
        filters,
        sort: sortOf(state),
        page: list ? page : 1,
        pageSize: list ? PAGE_SIZE : MAX_PAGE_SIZE,
        nest: list ? nest : false,
        includeReadOnly,
        ...nowContext(),
      });
      setRows(res.rows);
      setTotal(res.total);
      setError(null);
      // The task page steps through what this list shows (‹ 2 of 28 ›).
      try {
        sessionStorage.setItem('hb-task-order', JSON.stringify(res.rows.map((r) => r.id)));
      } catch {
        /* not remembered */
      }
      return res.rows;
    } catch (e) {
      setError(errorText(e, 'Could not load tasks.'));
      return [];
    } finally {
      setLoading(false);
    }
  }, [view, debouncedText, filters, state, page, nest, includeReadOnly]);

  useEffect(() => {
    if (!hydrated) return;
    void runQuery().then((r) => {
      const id = pendingHighlight.current;
      if (id && r.some((x) => x.id === id)) {
        pendingHighlight.current = null;
        flashRows([id]);
        window.setTimeout(
          () => document.getElementById(`task-row-${id}`)?.scrollIntoView({ block: 'center' }),
          50,
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, runQuery]);

  const loadGhosts = useCallback(async () => {
    try {
      const [t, tpl] = await Promise.all([
        api.getTaskGhosts(),
        canTeam ? api.getAllTemplateGhosts() : Promise.resolve<GhostOccurrenceDto[]>([]),
      ]);
      setGhosts([...t, ...tpl]);
    } catch {
      setGhosts([]);
    }
  }, [canTeam]);
  useEffect(() => {
    if (hydrated && (view === 'calendar' || view === 'gantt')) void loadGhosts();
  }, [hydrated, view, loadGhosts]);

  // Tab counts (open tasks per built-in tab) and overdue for the subtitle.
  const loadCounts = useCallback(async () => {
    const ctx = nowContext();
    const scopes: Scope[] = canTeam ? ['mine', 'all', 'team'] : ['mine', 'all'];
    const res = await Promise.all(
      scopes.map((s) =>
        api.getTaskDashboard({
          filters: buildFilters(defaultState(s), me, teamIds),
          includeReadOnly,
          ...ctx,
        }),
      ),
    );
    const c: Partial<Record<Scope, number>> = {};
    scopes.forEach((s, i) => (c[s] = res[i]!.total));
    setCounts(c);
    const cur = res[scopes.indexOf(state.scope)];
    setOverdueInScope(cur?.overdue ?? 0);
  }, [canTeam, me, teamIds, includeReadOnly, state.scope]);
  useEffect(() => {
    if (hydrated) void loadCounts().catch(() => {});
  }, [hydrated, loadCounts]);

  // Page and selection reset whenever what is shown changes.
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [filters, debouncedText, view]);

  function flashRows(ids: number[]) {
    setFlash(new Set(ids));
    window.setTimeout(() => setFlash(new Set()), 1600);
  }

  // --- Options ----------------------------------------------------------------
  const ownerOptions: SelectOption<string>[] = useMemo(
    () => [
      { value: UNASSIGNED, label: 'Unassigned', lead: <span className="hb-unassigned">?</span> },
      ...people
        .slice()
        .sort((a, b) => userLabel(a).localeCompare(userLabel(b)))
        .map((p) => ({
          value: p.id,
          label: userLabel(p),
          lead: <Avatar user={p} px={24} decorative />,
        })),
    ],
    [people],
  );
  const ownerFilterOptions: SelectOption<string>[] = [
    { value: ALL, label: 'Anyone' },
    ...ownerOptions,
  ];
  const deptOptions: SelectOption<string>[] = [
    { value: ALL, label: 'All' },
    ...departments.map((d) => ({ value: d.id, label: d.name, dot: d.color })),
  ];
  const dutyOptions: SelectOption<string>[] = [
    { value: ALL, label: 'All' },
    ...departments
      .filter((d) => state.dept === ALL || d.id === state.dept)
      .flatMap((d) =>
        d.duties
          .filter((x) => !x.archived)
          .map((x) => ({
            value: x.id,
            label: state.dept === ALL ? `${d.name} › ${x.name}` : x.name,
          })),
      ),
  ];
  const priorityFilterOptions: SelectOption<string>[] = [
    { value: ALL, label: 'Any' },
    ...PRIORITY_OPTIONS,
  ];

  const nameOf = (id: string) => {
    const p = people.find((x) => x.id === id);
    return p ? userLabel(p) : 'someone';
  };
  const chips = extraChips(state.extra, {
    user: nameOf,
    group: (id) => groups.find((g) => g.id === id)?.name ?? `#${id}`,
  });

  // --- Tabs and saved views ------------------------------------------------------
  const activeView = views.find((v) => v.id === tab) ?? null;
  const tabBase = activeView ? activeView.state : defaultState(state.scope);
  const changed = !sameState(state, tabBase);

  function pickScope(s: Scope) {
    setTab(s);
    setState(defaultState(s));
  }
  function pickView(v: SavedView) {
    setTab(v.id);
    setState(readViewState(v.state) ?? defaultState());
  }
  function saveView() {
    const name = viewName.trim();
    if (!name) return;
    const v: SavedView = { id: `v${Date.now().toString(36)}`, name, state };
    setViews((vs) => [...vs, v]);
    setTab(v.id);
    setNaming(false);
    setViewName('');
    toast({ message: `Saved the view “${name}”.`, tone: 'success' });
  }
  function updateView() {
    if (!activeView) return;
    setViews((vs) => vs.map((v) => (v.id === activeView.id ? { ...v, state } : v)));
    toast({ message: `Updated “${activeView.name}”.`, tone: 'success' });
  }
  function deleteView(v: SavedView) {
    const before = views;
    setViews((vs) => vs.filter((x) => x.id !== v.id));
    if (tab === v.id) pickScope(v.state.scope);
    toast({ message: `Deleted the view “${v.name}”.`, undo: () => setViews(before) });
  }

  const patch = (p: Partial<ViewState>) => setState((s) => ({ ...s, ...p }));

  // --- Editing -------------------------------------------------------------------
  function toRequest(
    row: TaskRowDto,
    edit: RowEdit,
  ): { req: UpdateTaskRequest; undo: UpdateTaskRequest; what: string } {
    const req: UpdateTaskRequest = {};
    const undo: UpdateTaskRequest = {};
    const what: string[] = [];
    if ('assigneeId' in edit) {
      req.assigneeId = edit.assigneeId ?? null;
      undo.assigneeId = row.assignee?.id ?? null;
      what.push(`owner set to ${edit.assigneeId ? nameOf(edit.assigneeId) : 'Unassigned'}`);
    }
    if ('dueYmd' in edit) {
      req.dueAt = dueIsoFromYmd(edit.dueYmd ?? null, row.dueAt);
      undo.dueAt = row.dueAt;
      what.push(
        edit.dueYmd
          ? `due date set to ${new Date(req.dueAt!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
          : 'due date cleared',
      );
    }
    if (edit.status) {
      req.status = edit.status;
      undo.status = row.status;
      what.push(`status set to ${TASK_STATUS_LABELS[edit.status]}`);
    }
    if (edit.priority) {
      req.priority = edit.priority;
      undo.priority = row.priority;
      what.push(`priority set to ${edit.priority}`);
    }
    return { req, undo, what: what.join(', ') };
  }

  async function editRow(row: TaskRowDto, edit: RowEdit) {
    const { req, undo, what } = toRequest(row, edit);
    try {
      await api.updateTask(row.id, req);
    } catch (e) {
      toast({ message: `“${row.name}”: ${errorText(e)}`, tone: 'error' });
      return;
    }
    const after = await runQuery();
    void loadCounts().catch(() => {});
    flashRows([row.id]);
    const gone = !after.some((r) => r.id === row.id);
    toast({
      message: `“${row.name}”: ${what}${gone ? ' · it no longer matches this view' : ''}`,
      undo: async () => {
        await api
          .updateTask(row.id, undo)
          .catch((e) => toast({ message: errorText(e), tone: 'error' }));
        await runQuery();
        void loadCounts().catch(() => {});
        flashRows([row.id]);
      },
    });
  }

  async function editSelected(edit: RowEdit) {
    const targets = rows.filter((r) => selected.has(r.id));
    const plans = targets.map((r) => ({ row: r, ...toRequest(r, edit) }));
    const results = await Promise.allSettled(plans.map((p) => api.updateTask(p.row.id, p.req)));
    const ok = plans.filter((_, i) => results[i]!.status === 'fulfilled');
    const failed = plans.length - ok.length;
    await runQuery();
    void loadCounts().catch(() => {});
    flashRows(ok.map((p) => p.row.id));
    const firstError = results.find((r) => r.status === 'rejected') as
      PromiseRejectedResult | undefined;
    toast({
      message:
        `${ok.length} ${ok.length === 1 ? 'task' : 'tasks'}: ${plans[0]?.what ?? ''}` +
        (failed > 0 ? ` · ${failed} could not be changed (${errorText(firstError?.reason)})` : ''),
      tone: failed > 0 && ok.length === 0 ? 'error' : 'dark',
      undo:
        ok.length > 0
          ? async () => {
              await Promise.allSettled(ok.map((p) => api.updateTask(p.row.id, p.undo)));
              await runQuery();
              void loadCounts().catch(() => {});
              flashRows(ok.map((p) => p.row.id));
            }
          : undefined,
    });
  }

  async function exportExcel() {
    try {
      await exportTasksToExcel({
        text: debouncedText.trim() || undefined,
        filters,
        sort: sortOf(state),
        includeReadOnly,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...nowContext(),
      });
    } catch (e) {
      toast({ message: errorText(e, 'Export failed.'), tone: 'error' });
    }
  }

  const scopeSubtitle =
    state.scope === 'mine'
      ? 'Assigned to you'
      : state.scope === 'team'
        ? 'Everyone in your departments'
        : user?.role === 'Admin'
          ? 'Every task'
          : 'Every task you can see';

  const tabs = (
    <nav className="hb-viewtabs" aria-label="Task views">
      {(['mine', 'all', ...(canTeam ? (['team'] as const) : [])] as Scope[]).map((s) => (
        <button
          key={s}
          type="button"
          className={cx('hb-vtab', tab === s && 'active')}
          aria-current={tab === s ? 'page' : undefined}
          onClick={() => pickScope(s)}
        >
          {SCOPE_LABEL[s]}
          {counts[s] !== undefined && <CountBadge n={counts[s]!} />}
        </button>
      ))}
      {views.map((v) => (
        <span key={v.id} className={cx('hb-vtab', 'saved', tab === v.id && 'active')}>
          <button
            type="button"
            aria-current={tab === v.id ? 'page' : undefined}
            onClick={() => pickView(v)}
          >
            {v.name}
          </button>
          {tab === v.id && (
            <button
              type="button"
              className="hb-vtab-x"
              aria-label={`Delete the view ${v.name}`}
              onClick={() => deleteView(v)}
            >
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      {naming ? (
        <form
          className="hb-vtab-name"
          onSubmit={(e) => {
            e.preventDefault();
            saveView();
          }}
        >
          <input
            autoFocus
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            placeholder="Name this view"
            aria-label="Name for the new view"
            maxLength={40}
            onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
          />
          <button
            type="submit"
            className="hb-btn hb-btn-primary hb-btn-sm"
            disabled={!viewName.trim()}
          >
            Save
          </button>
          <Btn kind="ghost" onClick={() => setNaming(false)}>
            Cancel
          </Btn>
        </form>
      ) : (
        <button type="button" className="hb-vtab add" onClick={() => setNaming(true)}>
          + Add view
        </button>
      )}
    </nav>
  );

  const editableShown = rows.filter((r) => !r.mentionOnly && !r.treeOnly);

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle={
          <>
            {scopeSubtitle}
            {overdueInScope > 0 && <span className="hb-late"> · {overdueInScope} overdue</span>}
          </>
        }
        searchPlaceholder="Search by title or #number"
        searchValue={text}
        onSearchChange={setText}
        onSearch={() => {}}
        actions={
          canTeam ? (
            <Link to="/admin/templates" className="hb-btn hb-btn-tall">
              <FileStack size={16} aria-hidden="true" /> Templates
            </Link>
          ) : undefined
        }
        tabs={
          <>
            {tabs}
            <span className="hb-grow" />
            <Segmented label="Show as" value={view} options={VIEWS} onChange={setView} small />
          </>
        }
      />
      <PageBody>
        <div className="hb-toolbar">
          <span className="hb-count-label">
            {loading ? 'Loading…' : `${total} ${total === 1 ? 'task' : 'tasks'}`}
          </span>
          <Select
            variant="chip"
            label="Status"
            value={state.status}
            options={STATUS_PRESETS}
            active={state.status !== 'open'}
            onChange={(v) => patch({ status: v })}
          />
          <Select
            variant="chip"
            label="Dept"
            value={state.dept}
            options={deptOptions}
            active={state.dept !== ALL}
            onChange={(v) => patch({ dept: v, duty: ALL })}
          />
          <Select
            variant="chip"
            label="Duty"
            value={state.duty}
            options={dutyOptions}
            active={state.duty !== ALL}
            onChange={(v) => patch({ duty: v })}
          />
          {state.scope !== 'mine' && (
            <Select
              variant="chip"
              label="Owner"
              value={state.owner}
              options={ownerFilterOptions}
              active={state.owner !== ALL}
              searchPlaceholder="Search people…"
              onChange={(v) => patch({ owner: v })}
            />
          )}
          <Select
            variant="chip"
            label="Priority"
            value={state.priority}
            options={priorityFilterOptions}
            active={state.priority !== ALL}
            onChange={(v) => patch({ priority: v as TaskPriority | typeof ALL })}
          />
          {chips.map((c) => (
            <span key={c.key} className="hb-chip-on">
              {c.label}
              <button
                type="button"
                aria-label={`Remove filter: ${c.label}`}
                onClick={() => {
                  const extra = { ...state.extra };
                  for (const k of c.clear) delete extra[k];
                  if (c.clear.includes('dueFrom')) delete extra.includeNoDue;
                  if (c.clear.includes('startFrom')) delete extra.includeNoStart;
                  patch({ extra });
                }}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
          <MoreFilters
            extra={state.extra}
            onChange={(extra) => patch({ extra: clean(extra) })}
            tags={tags}
            people={ownerOptions}
            groups={groups}
          />
          {(isFiltered(state) || text) && (
            <Btn
              kind="link"
              onClick={() => {
                setText('');
                setState(
                  activeView
                    ? (readViewState(activeView.state) ?? defaultState(state.scope))
                    : defaultState(state.scope),
                );
              }}
            >
              Clear
            </Btn>
          )}
          {changed &&
            (activeView ? (
              <Btn kind="link" onClick={updateView}>
                <Check size={14} aria-hidden="true" /> Update “{activeView.name}”
              </Btn>
            ) : (
              <Btn kind="link" onClick={() => setNaming(true)}>
                Save as view
              </Btn>
            ))}
          <span className="hb-grow" />
          <Select
            variant="chip"
            label="Sort"
            value={state.sortField}
            options={SORT_OPTIONS}
            onChange={(f) => patch({ sortField: f, sortDir: 'asc' })}
          />
          <button
            type="button"
            className="hb-icon-btn hb-icon-btn-sm"
            onClick={() => patch({ sortDir: state.sortDir === 'asc' ? 'desc' : 'asc' })}
            aria-label={`Sort direction: ${dirLabel(state.sortField, state.sortDir)}. Click to reverse.`}
            title={dirLabel(state.sortField, state.sortDir)}
          >
            {state.sortDir === 'asc' ? (
              <ArrowUpNarrowWide size={17} aria-hidden="true" />
            ) : (
              <ArrowDownWideNarrow size={17} aria-hidden="true" />
            )}
          </button>
          <MoreMenu
            columns={columns}
            onColumns={setColumns}
            nest={nest}
            onNest={setNest}
            includeReadOnly={includeReadOnly}
            onReadOnly={setIncludeReadOnly}
            onExport={exportExcel}
          />
        </div>

        {error && (
          <div className="hb-alert" role="alert">
            {error}
          </div>
        )}

        {view === 'list' && (
          <Card className="hb-table-card">
            {!loading && rows.length === 0 ? (
              <div className="hb-empty-block">
                <Empty>No tasks match these filters.</Empty>
                {(isFiltered(state) || text) && (
                  <Btn
                    onClick={() => {
                      setText('');
                      setState(defaultState(state.scope));
                    }}
                  >
                    Clear search and filters
                  </Btn>
                )}
              </div>
            ) : (
              <TaskTable
                rows={rows}
                owners={ownerOptions}
                selected={selected}
                onSelect={(id, on) =>
                  setSelected((s) => {
                    const n = new Set(s);
                    if (on) n.add(id);
                    else n.delete(id);
                    return n;
                  })
                }
                onSelectAll={(on) =>
                  setSelected(on ? new Set(editableShown.map((r) => r.id)) : new Set())
                }
                onEdit={(r, e) => void editRow(r, e)}
                sortField={state.sortField}
                sortDir={state.sortDir}
                onSort={(f: TaskSortField) =>
                  patch(
                    f === state.sortField
                      ? { sortDir: state.sortDir === 'asc' ? 'desc' : 'asc' }
                      : { sortField: f, sortDir: 'asc' },
                  )
                }
                flash={flash}
                columns={columns}
                showOwner
              />
            )}
            {total > PAGE_SIZE && (
              <div className="hb-pager">
                <span>
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(total, page * PAGE_SIZE)} of {total}
                </span>
                <Btn
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </Btn>
                <Btn
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page * PAGE_SIZE >= total}
                  aria-label="Next page"
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </Btn>
              </div>
            )}
          </Card>
        )}
        {view === 'kanban' && (
          <div className="hb-legacy-view">
            <TaskKanban rows={rows} loading={loading} onChanged={() => void runQuery()} />
          </div>
        )}
        {view === 'calendar' && (
          <div className="hb-legacy-view">
            <TaskCalendar
              rows={rows}
              loading={loading}
              scale={calScale}
              onScaleChange={setCalScale}
              ghosts={ghosts}
              onChanged={() => {
                void runQuery();
                void loadGhosts();
              }}
            />
          </div>
        )}
        {view === 'gantt' && (
          <div className="hb-legacy-view">
            <TaskGantt
              rows={rows}
              loading={loading}
              ghosts={ghosts}
              onChanged={() => {
                void runQuery();
                void loadGhosts();
              }}
            />
          </div>
        )}
        {view !== 'list' && total > MAX_PAGE_SIZE && (
          <p className="hb-small">
            Showing the first {MAX_PAGE_SIZE} of {total}. Narrow the filters to see the rest.
          </p>
        )}
      </PageBody>

      {selected.size > 0 && (
        <BatchBar
          count={selected.size}
          owners={ownerOptions}
          onEdit={(e) => void editSelected(e)}
          onClear={() => setSelected(new Set())}
        />
      )}
    </>
  );
}

/** The sticky bar that appears when rows are ticked (§6.2). */
function BatchBar({
  count,
  owners,
  onEdit,
  onClear,
}: {
  count: number;
  owners: SelectOption<string>[];
  onEdit: (e: RowEdit) => void;
  onClear: () => void;
}) {
  return (
    <div className="hb-batch" role="region" aria-label="Change the selected tasks">
      <strong>{count} selected</strong>
      <Select<TaskStatus>
        label="Status…"
        value={null}
        placeholder="Status…"
        options={statusOptions()}
        onChange={(s) => onEdit({ status: s })}
        className="hb-batch-select"
      />
      <Select
        label="Assign to…"
        value={null}
        placeholder="Assign to…"
        options={owners}
        searchPlaceholder="Search people…"
        onChange={(v) => onEdit({ assigneeId: v === UNASSIGNED ? null : v })}
        className="hb-batch-select"
      />
      <DatePicker
        label="Due date…"
        value={null}
        placeholder="Due date…"
        allowClear={false}
        onChange={(v) => onEdit({ dueYmd: v })}
        className="hb-batch-select"
      />
      <Select<TaskPriority>
        label="Priority…"
        value={null}
        placeholder="Priority…"
        options={PRIORITY_OPTIONS}
        onChange={(p) => onEdit({ priority: p })}
        className="hb-batch-select"
      />
      <span className="hb-grow" />
      <button type="button" className="hb-batch-clear" onClick={onClear}>
        Clear selection
      </button>
    </div>
  );
}

/** ⋯: extra columns, sub-tasks under their parent, read-only tasks, Excel export. */
function MoreMenu({
  columns,
  onColumns,
  nest,
  onNest,
  includeReadOnly,
  onReadOnly,
  onExport,
}: {
  columns: Set<OptionalColumn>;
  onColumns: (c: Set<OptionalColumn>) => void;
  nest: boolean;
  onNest: (v: boolean) => void;
  includeReadOnly: boolean;
  onReadOnly: (v: boolean) => void;
  onExport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="hb-icon-btn hb-icon-btn-sm"
        aria-label="More options"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      <Popover
        anchorRef={btnRef}
        open={open}
        onClose={() => setOpen(false)}
        minWidth={260}
        matchWidth={false}
        label="More options"
        closeOnTab={false}
      >
        <div className="hb-menu-group">
          <span className="hb-label">Extra columns</span>
          {OPTIONAL_COLUMNS.map((c) => (
            <label key={c.key} className="hb-menu-check-row">
              <input
                type="checkbox"
                checked={columns.has(c.key)}
                onChange={(e) => {
                  const n = new Set(columns);
                  if (e.target.checked) n.add(c.key);
                  else n.delete(c.key);
                  onColumns(n);
                }}
              />
              {c.label}
            </label>
          ))}
        </div>
        <div className="hb-menu-group">
          <span className="hb-label">Show</span>
          <label className="hb-menu-check-row">
            <input type="checkbox" checked={nest} onChange={(e) => onNest(e.target.checked)} />
            Sub-tasks under their parent
          </label>
          <label className="hb-menu-check-row">
            <input
              type="checkbox"
              checked={includeReadOnly}
              onChange={(e) => onReadOnly(e.target.checked)}
            />
            Tasks I can only read
          </label>
        </div>
        <button
          type="button"
          className="hb-menu-action"
          onClick={() => {
            setOpen(false);
            onExport();
          }}
        >
          <Download size={16} aria-hidden="true" /> Export to Excel
        </button>
      </Popover>
    </>
  );
}
