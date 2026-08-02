import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_TASK_COLUMN_ORDER,
  MAX_PAGE_SIZE,
  TASK_COLUMN_KEYS,
  TASK_COLUMN_LABELS,
  TASK_PRIORITIES,
  TASK_SORT_FIELDS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  isSupervisorRole,
  type ActiveUserDto,
  type GhostOccurrenceDto,
  type TaskColumnKey,
  type TaskDashboardDto,
  type TaskRowDto,
  type TaskSearchFilters,
  type TaskSearchRequest,
  type TaskSort,
  type TaskSortField,
} from '@healthy-tasks/shared';
import { api, ApiError, exportTasksToExcel } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { cycleSort, sortState } from '../lib/multiSort';
import {
  COMPLETED_TODAY_STAT,
  DUE_TODAY_STAT,
  OVERDUE_STAT,
  dashboardActiveStats,
  dashboardStatPatch,
  effectiveFilters,
  nowContext,
  statusStat,
} from '../lib/taskSearch';
import { SortHeader } from '../components/SortHeader';
import { MultiSelect } from '../components/MultiSelect';
import { FilterPopover } from '../components/FilterPopover';
import { UserChip, UnassignedAvatar } from '../components/ui/Avatar';
import { StatusPill, PriorityRamp } from '../components/ui/indicators';
import { AnimatedCount } from '../components/ui/AnimatedCount';
import { TableEmptyRow } from '../components/ui/EmptyState';
import { DueDate, AgoDate } from '../components/ui/dates';
import { TaskKanban } from '../components/TaskKanban';
import { TaskCalendar, type CalendarMode, type CalendarScale } from '../components/TaskCalendar';
import { TaskGantt } from '../components/TaskGantt';

interface ColumnState {
  key: TaskColumnKey;
  visible: boolean;
}

/** The four ways to view the same result set (Phase 10). "list" is the table. */
type TaskView = 'list' | 'kanban' | 'calendar' | 'gantt';
const TASK_VIEWS: { key: TaskView; label: string }[] = [
  { key: 'list', label: 'List' },
  { key: 'kanban', label: 'Kanban' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'gantt', label: 'Gantt' },
];

interface PersistedState {
  searchText: string;
  filters: TaskSearchFilters;
  sort: TaskSort[];
  columns: ColumnState[];
  page: number;
  pageSize: number;
  nestGlobal: boolean;
  view: TaskView;
  calendarScale: CalendarScale;
  calendarMode: CalendarMode;
  includeReadOnly: boolean;
}

const UNASSIGNED = '__unassigned__';
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const FILTERABLE: TaskColumnKey[] = ['status', 'priority', 'assignee', 'tags', 'startAt', 'dueAt', 'statusChangedAt'];

const defaultFilters: TaskSearchFilters = { includeNoStart: true, includeNoDue: true };
const defaultColumns = (): ColumnState[] =>
  DEFAULT_TASK_COLUMN_ORDER.map((key) => ({ key, visible: true }));

function isSortable(key: TaskColumnKey): key is TaskSortField {
  return (TASK_SORT_FIELDS as readonly string[]).includes(key);
}

/** Reconcile persisted columns with the current column set (tolerate additions). */
function reconcileColumns(saved: unknown): ColumnState[] {
  if (!Array.isArray(saved)) return defaultColumns();
  const valid = saved.filter(
    (c): c is ColumnState =>
      !!c &&
      typeof c === 'object' &&
      (TASK_COLUMN_KEYS as readonly string[]).includes((c as ColumnState).key),
  );
  const seen = new Set(valid.map((c) => c.key));
  for (const key of TASK_COLUMN_KEYS) if (!seen.has(key)) valid.push({ key, visible: true });
  return valid;
}

function TagsCell({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <span className="muted">—</span>;
  const shown = tags.slice(0, 3);
  const extra = tags.length - shown.length;
  return (
    <div className="tags-cell">
      {shown.map((t) => (
        <span key={t} className="badge tag">
          {t}
        </span>
      ))}
      {extra > 0 && (
        <span className="badge tag-more" title={tags.slice(3).join(', ')}>
          +{extra}
        </span>
      )}
    </div>
  );
}

export function TaskSearchPage() {
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState<TaskSearchFilters>(defaultFilters);
  const [sort, setSort] = useState<TaskSort[]>([]);
  const [columns, setColumns] = useState<ColumnState[]>(defaultColumns);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [nestGlobal, setNestGlobal] = useState(false);
  const [view, setView] = useState<TaskView>('list');
  const [calendarScale, setCalendarScale] = useState<CalendarScale>('month');
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('range');
  // Phase 13: include tasks the user can see only via an @mention (read-only).
  const [includeReadOnly, setIncludeReadOnly] = useState(true);

  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const [rows, setRows] = useState<TaskRowDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [users, setUsers] = useState<ActiveUserDto[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [dash, setDash] = useState<TaskDashboardDto | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [exporting, setExporting] = useState(false);

  const debouncedText = useDebouncedValue(searchText, 350);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  // Phase 11: ghost previews for the date views. Task ghosts are visible to all;
  // template ghosts only to Admin/Manager. Fetched only for Gantt/Calendar.
  const [ghosts, setGhosts] = useState<GhostOccurrenceDto[]>([]);
  const isManager = user ? isSupervisorRole(user.role) : false;
  const loadGhosts = useCallback(async () => {
    try {
      const [taskG, tplG] = await Promise.all([
        api.getTaskGhosts(),
        isManager ? api.getAllTemplateGhosts() : Promise.resolve<GhostOccurrenceDto[]>([]),
      ]);
      setGhosts([...taskG, ...tplG]);
    } catch {
      setGhosts([]);
    }
  }, [isManager]);

  // --- Load reference data + persisted state (once) ------------------------
  // Guarded so React StrictMode's double-invoke can't fire a second async
  // hydration that resolves after (and clobbers) an incoming My Day merge.
  const hydratedOnce = useRef(false);
  useEffect(() => {
    if (hydratedOnce.current) return;
    hydratedOnce.current = true;
    void api.listActiveUsers().then(setUsers).catch(() => setUsers([]));
    void api.listTaskTags().then(setAllTags).catch(() => setAllTags([]));
    void api
      .getPreference('task-search')
      .then(({ state }) => {
        const s = state as Partial<PersistedState> | null;
        if (s && typeof s === 'object') {
          if (typeof s.searchText === 'string') setSearchText(s.searchText);
          if (s.filters && typeof s.filters === 'object') setFilters({ ...defaultFilters, ...s.filters });
          if (Array.isArray(s.sort)) setSort(s.sort);
          setColumns(reconcileColumns(s.columns));
          if (typeof s.page === 'number' && s.page >= 1) setPage(s.page);
          if (typeof s.pageSize === 'number') setPageSize(s.pageSize);
          if (typeof s.nestGlobal === 'boolean') setNestGlobal(s.nestGlobal);
          if (s.view && TASK_VIEWS.some((v) => v.key === s.view)) setView(s.view);
          if (s.calendarScale === 'month' || s.calendarScale === 'week' || s.calendarScale === 'day')
            setCalendarScale(s.calendarScale);
          if (s.calendarMode === 'range' || s.calendarMode === 'marker') setCalendarMode(s.calendarMode);
          if (typeof s.includeReadOnly === 'boolean') setIncludeReadOnly(s.includeReadOnly);
        }
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  // Navigated here from a saved View / team card (`filters` → replace) or from a
  // My Day dashboard tile (`mergeFilters` → merge onto the current filters, so
  // the tile refines rather than wipes). Applied once hydration is done.
  useEffect(() => {
    if (!hydrated) return;
    const st = location.state as {
      filters?: TaskSearchFilters;
      mergeFilters?: TaskSearchFilters;
    } | null;
    if (st?.filters) {
      setFilters({ ...defaultFilters, ...st.filters });
      setPage(1);
      window.history.replaceState({}, '');
    } else if (st?.mergeFilters) {
      setFilters((f) => ({ ...f, ...st.mergeFilters }));
      setPage(1);
      window.history.replaceState({}, '');
    }
  }, [hydrated, location.state]);

  // --- Persist state (debounced) after hydration ---------------------------
  const snapshot = useMemo<PersistedState>(
    () => ({ searchText, filters, sort, columns, page, pageSize, nestGlobal, view, calendarScale, calendarMode, includeReadOnly }),
    [searchText, filters, sort, columns, page, pageSize, nestGlobal, view, calendarScale, calendarMode, includeReadOnly],
  );
  const debouncedSnapshot = useDebouncedValue(snapshot, 600);
  useEffect(() => {
    if (hydrated) void api.savePreference('task-search', debouncedSnapshot).catch(() => {});
  }, [debouncedSnapshot, hydrated]);

  // --- Run the query -------------------------------------------------------
  const runQuery = useCallback(async () => {
    setLoading(true);
    // The board/calendar/gantt views place every matching task at once, so they
    // fetch the whole result set (a single max-size page) rather than paginating.
    // (Capped at MAX_PAGE_SIZE; the List view keeps its own pagination.)
    const listView = view === 'list';
    const req: TaskSearchRequest = {
      text: debouncedText.trim() || undefined,
      filters: effectiveFilters(filters),
      sort,
      page: listView ? page : 1,
      pageSize: listView ? pageSize : MAX_PAGE_SIZE,
      nest: listView ? nestGlobal : false,
      includeReadOnly,
      ...nowContext(),
    };
    try {
      const res = await api.queryTasks(req);
      setRows(res.rows);
      setTotal(res.total);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [debouncedText, filters, sort, page, pageSize, nestGlobal, view, includeReadOnly]);

  useEffect(() => {
    if (hydrated) void runQuery();
  }, [hydrated, runQuery]);

  // Load ghost previews when a date view is active (and refresh with the query).
  useEffect(() => {
    if (hydrated && (view === 'gantt' || view === 'calendar')) void loadGhosts();
  }, [hydrated, view, loadGhosts]);

  // Re-run the query and refresh ghosts together (e.g. after materializing one).
  const refreshViews = useCallback(() => {
    void runQuery();
    void loadGhosts();
  }, [runQuery, loadGhosts]);

  // --- Dashboard counts for the current view (for the stat strip) ----------
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void api
      .getTaskDashboard({ text: debouncedText.trim() || undefined, filters: effectiveFilters(filters), includeReadOnly, ...nowContext() })
      .then((d) => {
        if (!cancelled) setDash(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hydrated, debouncedText, filters, includeReadOnly]);

  // --- Change handlers -----------------------------------------------------
  const patchFilters = (patch: Partial<TaskSearchFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const onSearchChange = (v: string) => {
    setSearchText(v);
    setPage(1);
  };
  const onSort = (key: TaskColumnKey, additive: boolean) => {
    if (!isSortable(key)) return;
    setSort((s) => cycleSort(s, key, additive));
    setPage(1);
  };
  const onSelectStat = (key: string) => patchFilters(dashboardStatPatch(filters, key));
  const clearAllFilters = () => {
    setFilters(defaultFilters);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const visibleColumns = columns.filter((c) => c.visible);
  const moveColumn = (index: number, delta: number) => {
    setColumns((cols) => {
      const next = [...cols];
      const j = index + delta;
      const a = next[index];
      const b = next[j];
      if (j < 0 || j >= next.length || !a || !b) return cols;
      next[index] = b;
      next[j] = a;
      return next;
    });
  };
  const toggleColumn = (key: TaskColumnKey) =>
    setColumns((cols) => cols.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c)));

  const toggleCollapse = (id: number) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const displayRows = useMemo(() => {
    const items = rows.map((row, i) => {
      const depth = row.depth ?? 0;
      const nextDepth = rows[i + 1]?.depth ?? 0;
      return { row, depth, hasChildrenHere: nestGlobal && nextDepth > depth };
    });
    if (!nestGlobal) return items;
    const visible: typeof items = [];
    let collapseDepth = Infinity;
    for (const it of items) {
      if (it.depth > collapseDepth) continue;
      collapseDepth = Infinity;
      visible.push(it);
      if (collapsed.has(it.row.id)) collapseDepth = it.depth;
    }
    return visible;
  }, [rows, collapsed, nestGlobal]);

  // --- Assignee filter (users + "Unassigned" pseudo-option) ----------------
  const assigneeSelected = [
    ...(filters.includeUnassigned ? [UNASSIGNED] : []),
    ...(filters.assigneeIds ?? []),
  ];
  const assigneeOptions = [
    { value: UNASSIGNED, label: 'Unassigned' },
    ...users.map((u) => ({ value: u.id, label: u.email })),
  ];
  const onAssigneeChange = (next: string[]) =>
    patchFilters({
      includeUnassigned: next.includes(UNASSIGNED),
      assigneeIds: next.filter((v) => v !== UNASSIGNED),
    });

  // --- Active-filter chips (removable) -------------------------------------
  const chips: { id: string; label: string; clear: Partial<TaskSearchFilters> }[] = [];
  {
    const assignN = (filters.assigneeIds?.length ?? 0) + (filters.includeUnassigned ? 1 : 0);
    if (assignN > 0) chips.push({ id: 'assignee', label: `Assignee · ${assignN}`, clear: { assigneeIds: [], includeUnassigned: false } });
    if (filters.statuses?.length) chips.push({ id: 'status', label: `Status · ${filters.statuses.length}`, clear: { statuses: [] } });
    if (filters.priorities?.length) chips.push({ id: 'priority', label: `Priority · ${filters.priorities.length}`, clear: { priorities: [] } });
    if (filters.tags?.length) chips.push({ id: 'tags', label: `Tags · ${filters.tags.length}`, clear: { tags: [] } });
    if (filters.overdue) chips.push({ id: 'overdue', label: 'Overdue', clear: { overdue: undefined } });
    if (filters.completedToday) chips.push({ id: 'completedToday', label: 'Completed today', clear: { completedToday: undefined } });
    if (filters.blocked) chips.push({ id: 'blocked', label: 'Blocked', clear: { blocked: undefined } });
    if (filters.instanceLabel) chips.push({ id: 'instanceLabel', label: `Label · ${filters.instanceLabel}`, clear: { instanceLabel: undefined } });
    if (filters.creatorIds?.length) chips.push({ id: 'creator', label: `Created by · ${filters.creatorIds.length}`, clear: { creatorIds: [] } });
    if (filters.relation) chips.push({ id: 'relation', label: `Relation · ${filters.relation}`, clear: { relation: undefined } });
    if (filters.statusChangedFrom || filters.statusChangedTo) chips.push({ id: 'sc', label: 'Status changed', clear: { statusChangedFrom: null, statusChangedTo: null } });
    if (filters.startFrom || filters.startTo || filters.includeNoStart === false) chips.push({ id: 'start', label: 'Start date', clear: { startFrom: null, startTo: null, includeNoStart: true } });
    if (filters.dueFrom || filters.dueTo || filters.includeNoDue === false) chips.push({ id: 'due', label: 'Due date', clear: { dueFrom: null, dueTo: null, includeNoDue: true } });
  }
  const filtersActive = chips.length > 0;

  async function handleExport() {
    setExporting(true);
    try {
      await exportTasksToExcel({
        text: debouncedText.trim() || undefined,
        filters: effectiveFilters(filters),
        sort,
        includeReadOnly,
        ...nowContext(),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  function columnFilter(key: TaskColumnKey) {
    switch (key) {
      case 'assignee':
        return (
          <FilterPopover label="Assignee" active={(filters.assigneeIds?.length ?? 0) > 0 || !!filters.includeUnassigned}>
            <MultiSelect options={assigneeOptions} selected={assigneeSelected} onChange={onAssigneeChange} />
          </FilterPopover>
        );
      case 'status':
        return (
          <FilterPopover label="Status" active={(filters.statuses?.length ?? 0) > 0}>
            <MultiSelect
              options={TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] }))}
              selected={filters.statuses ?? []}
              onChange={(v) => patchFilters({ statuses: v as typeof filters.statuses })}
            />
          </FilterPopover>
        );
      case 'priority':
        return (
          <FilterPopover label="Priority" active={(filters.priorities?.length ?? 0) > 0}>
            <MultiSelect
              options={TASK_PRIORITIES.map((p) => ({ value: p, label: p }))}
              selected={filters.priorities ?? []}
              onChange={(v) => patchFilters({ priorities: v as typeof filters.priorities })}
            />
          </FilterPopover>
        );
      case 'tags':
        return (
          <FilterPopover label="Tags" active={(filters.tags?.length ?? 0) > 0}>
            <MultiSelect
              options={allTags.map((t) => ({ value: t, label: t }))}
              selected={filters.tags ?? []}
              onChange={(v) => patchFilters({ tags: v })}
            />
          </FilterPopover>
        );
      case 'statusChangedAt':
        return (
          <FilterPopover label="Status changed" active={!!filters.statusChangedFrom || !!filters.statusChangedTo}>
            <div className="pop-range">
              <label>
                From
                <input type="datetime-local" value={filters.statusChangedFrom ?? ''} onChange={(e) => patchFilters({ statusChangedFrom: e.target.value || null })} />
              </label>
              <label>
                To
                <input type="datetime-local" value={filters.statusChangedTo ?? ''} onChange={(e) => patchFilters({ statusChangedTo: e.target.value || null })} />
              </label>
            </div>
          </FilterPopover>
        );
      case 'startAt':
        return (
          <FilterPopover label="Start" active={!!filters.startFrom || !!filters.startTo || filters.includeNoStart === false}>
            <div className="pop-range">
              <label>
                From
                <input type="date" value={filters.startFrom ?? ''} onChange={(e) => patchFilters({ startFrom: e.target.value || null })} />
              </label>
              <label>
                To
                <input type="date" value={filters.startTo ?? ''} onChange={(e) => patchFilters({ startTo: e.target.value || null })} />
              </label>
              <label className="check-inline">
                <input type="checkbox" checked={filters.includeNoStart ?? true} onChange={(e) => patchFilters({ includeNoStart: e.target.checked })} />
                <span>Include tasks without a Start Date</span>
              </label>
            </div>
          </FilterPopover>
        );
      case 'dueAt':
        return (
          <FilterPopover label="Due" active={!!filters.dueFrom || !!filters.dueTo || filters.includeNoDue === false}>
            <div className="pop-range">
              <label>
                From
                <input type="date" value={filters.dueFrom ?? ''} onChange={(e) => patchFilters({ dueFrom: e.target.value || null })} />
              </label>
              <label>
                To
                <input type="date" value={filters.dueTo ?? ''} onChange={(e) => patchFilters({ dueTo: e.target.value || null })} />
              </label>
              <label className="check-inline">
                <input type="checkbox" checked={filters.includeNoDue ?? true} onChange={(e) => patchFilters({ includeNoDue: e.target.checked })} />
                <span>Include tasks without a Due Date</span>
              </label>
            </div>
          </FilterPopover>
        );
      default:
        return null;
    }
  }

  function renderCell(key: TaskColumnKey, row: TaskRowDto) {
    switch (key) {
      case 'id':
        return (
          <span className="task-id-cell">
            {row.mentionOnly && (
              <span
                className="mention-only-cue"
                title="Read-only — you can see this because you're @mentioned"
                aria-label="Read-only (mention)"
              >
                👁
              </span>
            )}
            {row.treeOnly && (
              <span
                className="tree-only-cue"
                title="Read-only — visible via its parent/child tree position"
                aria-label="Read-only (tree)"
              >
                🌳
              </span>
            )}
            <Link to={`/tasks/${row.id}`} className="mono task-id-link" onClick={(e) => e.stopPropagation()}>
              #{row.id}
            </Link>
          </span>
        );
      case 'name':
        return (
          <Link to={`/tasks/${row.id}`} className="task-name-link" onClick={(e) => e.stopPropagation()}>
            {row.name}
          </Link>
        );
      case 'status':
        return <StatusPill status={row.status} />;
      case 'statusChangedAt':
        return <AgoDate iso={row.statusChangedAt} />;
      case 'priority':
        return <PriorityRamp priority={row.priority} />;
      case 'assignee':
        return row.assignee ? (
          <UserChip user={row.assignee} />
        ) : (
          <span className="user-chip muted">
            <UnassignedAvatar px={22} />
            <span className="user-name">Unassigned</span>
          </span>
        );
      case 'creator':
        return <UserChip user={row.creator} />;
      case 'createdAt':
        return <AgoDate iso={row.createdAt} />;
      case 'startAt':
        return <DueDate iso={row.startAt} />;
      case 'dueAt':
        return <DueDate iso={row.dueAt} />;
      case 'parentChild':
        if (row.parentId != null)
          return (
            <Link to={`/tasks/${row.parentId}`} className="mono" onClick={(e) => e.stopPropagation()}>
              ↑ #{row.parentId}
            </Link>
          );
        if (row.childrenCount > 0)
          return <span className="mono muted">{row.childrenCount} sub</span>;
        return <span className="muted">—</span>;
      case 'tags':
        return <TagsCell tags={row.tags} />;
    }
  }

  const statTiles = dash
    ? [
        { key: OVERDUE_STAT, label: 'Overdue', value: dash.overdue, cls: 'ts-danger' },
        { key: DUE_TODAY_STAT, label: 'Due today', value: dash.dueToday, cls: 'ts-warn' },
        { key: statusStat('InProgress'), label: 'In progress', value: dash.byStatus.InProgress ?? 0, cls: 'ts-accent' },
        { key: statusStat('Review'), label: 'In review', value: dash.byStatus.Review ?? 0, cls: 'ts-review' },
        { key: COMPLETED_TODAY_STAT, label: 'Completed today', value: dash.completedToday, cls: 'ts-ok' },
      ]
    : [];
  const activeStats = dashboardActiveStats(filters);

  const sortSummary = sort.length
    ? `${TASK_COLUMN_LABELS[sort[0]!.field]} ${sort[0]!.dir === 'asc' ? '↑' : '↓'}${sort.length > 1 ? ` +${sort.length - 1}` : ''}`
    : null;

  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(total, page * pageSize);

  return (
    <div className="tasks-page">
      {/* Toolbar */}
      <div className="tasks-toolbar">
        <h1>Tasks</h1>
        <span className="mono tasks-total">{loading ? '…' : total}</span>
        <input
          className="tasks-search"
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search Id, name, or tags…"
          aria-label="Search tasks"
        />
        <div className="spacer" />
        {view === 'list' && (
          <button className="secondary" onClick={() => setShowColumns((v) => !v)}>
            Columns
          </button>
        )}
        <button className="secondary" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export'}
        </button>
        <button onClick={() => navigate('/tasks/new')}>New task</button>
      </div>

      {error && <div className="alert error">{error}</div>}

      {/* Stat strip */}
      <div className="tasks-stats">
        {statTiles.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tasks-stat ${t.cls}${activeStats.has(t.key) ? ' active' : ''}`}
            aria-pressed={activeStats.has(t.key)}
            onClick={() => onSelectStat(t.key)}
          >
            <span className="tasks-stat-value">
              <AnimatedCount value={t.value} />
            </span>
            <span className="tasks-stat-label">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Chip row: view segmented + active filters + sort/nest */}
      <div className="tasks-chiprow">
        <div className="seg">
          {TASK_VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              className={`seg-btn${view === v.key ? ' active' : ''}`}
              aria-pressed={view === v.key}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="chip-divider" />
        {chips.map((c) => (
          <button key={c.id} type="button" className="filter-chip" onClick={() => patchFilters(c.clear)}>
            {c.label}
            <span className="chip-x" aria-hidden="true">
              ×
            </span>
          </button>
        ))}
        <button type="button" className={`add-filter${showFilters ? ' open' : ''}`} onClick={() => setShowFilters((v) => !v)}>
          + Filter
        </button>
        {filtersActive && (
          <button type="button" className="link-button" onClick={clearAllFilters}>
            Clear all
          </button>
        )}
        <div className="spacer" />
        <label
          className="nest-toggle mention-toggle"
          title="Show tasks you can only see read-only — via an @mention or via parent/child tree position"
        >
          <input
            type="checkbox"
            checked={includeReadOnly}
            onChange={(e) => {
              setIncludeReadOnly(e.target.checked);
              setPage(1);
            }}
          />
          Read-only
        </label>
        {view === 'list' && (
          <>
            {sortSummary && <span className="mono tasks-sort">Sort: {sortSummary}</span>}
            <label className="nest-toggle">
              <input
                type="checkbox"
                checked={nestGlobal}
                onChange={(e) => {
                  setNestGlobal(e.target.checked);
                  setCollapsed(new Set());
                  setPage(1);
                }}
              />
              Nest
            </label>
          </>
        )}
      </div>

      {/* + Filter panel */}
      {showFilters && (
        <div className="card panel tasks-filter-panel">
          {FILTERABLE.map((k) => (
            <div key={k} className="tasks-filter-field">
              <span className="u-label">{TASK_COLUMN_LABELS[k]}</span>
              {columnFilter(k)}
            </div>
          ))}
          {/* Phase 11: free-text filter on a generated task's PO/batch label. */}
          <div className="tasks-filter-field">
            <span className="u-label">Instance label</span>
            <input
              className="tasks-search"
              style={{ minWidth: 160 }}
              value={filters.instanceLabel ?? ''}
              onChange={(e) => patchFilters({ instanceLabel: e.target.value || undefined })}
              placeholder="PO / batch…"
              aria-label="Filter by instance label"
            />
          </div>
        </div>
      )}

      {/* Columns panel */}
      {showColumns && (
        <div className="card panel">
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong>Columns</strong>
            <div className="spacer" />
            <button className="secondary btn-sm" onClick={() => setColumns(defaultColumns())}>
              Reset
            </button>
          </div>
          <ul className="columns-list">
            {columns.map((c, i) => (
              <li key={c.key} className="col-chip">
                <button className="col-move" disabled={i === 0} aria-label={`Move ${TASK_COLUMN_LABELS[c.key]} left`} onClick={() => moveColumn(i, -1)}>
                  ←
                </button>
                <label>
                  <input type="checkbox" checked={c.visible} onChange={() => toggleColumn(c.key)} />
                  {TASK_COLUMN_LABELS[c.key]}
                </label>
                <button className="col-move" disabled={i === columns.length - 1} aria-label={`Move ${TASK_COLUMN_LABELS[c.key]} right`} onClick={() => moveColumn(i, 1)}>
                  →
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Results — List view */}
      {view === 'list' && (
      <>
      <div className="table-scroll tasks-table-wrap">
        <table className="results-table tasks-table">
          <thead>
            <tr>
              <th style={{ width: 24 }} />
              {visibleColumns.map((c) => (
                <SortHeader
                  key={c.key}
                  label={TASK_COLUMN_LABELS[c.key]}
                  sortable={isSortable(c.key)}
                  multi={sort.length > 1}
                  state={isSortable(c.key) ? sortState(sort, c.key) : null}
                  onSort={(additive) => onSort(c.key, additive)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map(({ row, depth, hasChildrenHere }) => (
              <tr key={row.id} className={`row-clickable${depth > 0 ? ' tree-child-enter' : ''}`} onClick={() => navigate(`/tasks/${row.id}`)}>
                <td style={{ textAlign: 'center' }}>
                  {hasChildrenHere ? (
                    <button
                      className={`tree-toggle${collapsed.has(row.id) ? '' : ' expanded'}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(row.id);
                      }}
                      aria-label={collapsed.has(row.id) ? 'Expand sub-tasks' : 'Collapse sub-tasks'}
                    >
                      <span className="caret" aria-hidden="true">
                        ▸
                      </span>
                    </button>
                  ) : null}
                </td>
                {visibleColumns.map((c, ci) => (
                  <td key={c.key} className={`col-${c.key}${depth > 0 && ci === 0 ? ' is-child' : ''}`} style={ci === 0 ? { paddingLeft: `${10 + depth * 22}px` } : undefined}>
                    {renderCell(c.key, row)}
                  </td>
                ))}
              </tr>
            ))}
            {loading && displayRows.length === 0 && (
              <tr>
                <td className="empty-cell" colSpan={visibleColumns.length + 1}>
                  <div className="empty-state compact">
                    <span className="loading-inline">
                      <span className="mono">Loading…</span>
                    </span>
                  </div>
                </td>
              </tr>
            )}
            {!loading && displayRows.length === 0 && (
              <TableEmptyRow colSpan={visibleColumns.length + 1} title={filtersActive || searchText ? 'No tasks match' : 'No tasks yet'}>
                {filtersActive || searchText
                  ? 'Clear a filter to see the tasks it hid.'
                  : 'Create your first task to get started.'}
              </TableEmptyRow>
            )}
          </tbody>
        </table>
      </div>

      {/* Pager */}
      <div className="pager">
        <span className="mono muted">
          {loading ? 'Loading…' : `${firstRow}–${lastRow} of ${total}`}
        </span>
        <div className="spacer" />
        <label className="mono">
          Rows{' '}
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          ← Prev
        </button>
        <span className="mono">
          Page {page} of {totalPages}
        </span>
        <button className="secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          Next →
        </button>
      </div>
      </>
      )}

      {/* Kanban / Calendar / Gantt views (Phase 10) share the same rows/filters. */}
      {view === 'kanban' && (
        <TaskKanban rows={rows} loading={loading} onChanged={() => void runQuery()} />
      )}
      {view === 'calendar' && (
        <TaskCalendar
          rows={rows}
          loading={loading}
          scale={calendarScale}
          mode={calendarMode}
          onScaleChange={setCalendarScale}
          onModeChange={setCalendarMode}
          ghosts={ghosts}
          onChanged={refreshViews}
        />
      )}
      {view === 'gantt' && (
        <TaskGantt rows={rows} loading={loading} onChanged={refreshViews} ghosts={ghosts} />
      )}
    </div>
  );
}
