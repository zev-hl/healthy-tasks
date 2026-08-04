import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DUE_DATE_BUCKETS,
  DUE_DATE_BUCKET_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  formatDueDateResult,
  type ActiveUserDto,
  type DueDateBucket,
  type DueDateBucketTotals,
  type DueDateReportRow,
  type OrgHierarchyNode,
  type TaskPriority,
  type TaskSearchFilters,
  type TaskSort,
  type TaskSortField,
  type TaskStatus,
} from '@healthy-tasks/shared';
import { api, ApiError, exportDueDateReportToExcel } from '../api/client';
import { effectiveFilters, nowContext } from '../lib/taskSearch';
import { cycleSort, sortState } from '../lib/multiSort';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { FilterPopover } from '../components/FilterPopover';
import { MultiSelect } from '../components/MultiSelect';
import { HierarchyTree, toggleSubtree } from '../components/HierarchyTree';
import { SortHeader } from '../components/SortHeader';
import { UserChip, UnassignedAvatar, userLabel } from '../components/ui/Avatar';
import { StatusPill } from '../components/ui/indicators';
import { AgoDate, DueDate } from '../components/ui/dates';
import { TableEmptyRow } from '../components/ui/EmptyState';

const defaultFilters: TaskSearchFilters = { includeNoStart: true, includeNoDue: true };

interface PersistedState {
  searchText: string;
  filters: TaskSearchFilters;
  sort: TaskSort[];
  includeReadOnly: boolean;
  groupByAssignee: boolean;
  hierarchyUserIds: string[];
}

const BUCKET_CLASS: Record<DueDateBucket, string> = {
  OnTime: 'ontime',
  Late: 'late',
  Overdue: 'overdue',
  NotStarted: 'notstarted',
  NotCompleted: 'notcompleted',
  Cancelled: 'cancelled',
  NoDueDate: 'nodue',
};

// Small descriptor shown in smaller text above each tile's title.
const BUCKET_SUBLABEL: Record<DueDateBucket, string> = {
  OnTime: 'Completed',
  Late: 'Completed',
  Overdue: 'Past Due',
  NotStarted: 'Future Due',
  NotCompleted: 'Future Due',
  Cancelled: 'Due or not',
  NoDueDate: 'Not Completed',
};

export function DueDatePerformancePage() {
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState<TaskSearchFilters>(defaultFilters);
  const [sort, setSort] = useState<TaskSort[]>([]);
  const [includeReadOnly, setIncludeReadOnly] = useState(true);
  const [groupByAssignee, setGroupByAssignee] = useState(false);
  const [selectedHierarchy, setSelectedHierarchy] = useState<Set<string>>(new Set());

  const [rows, setRows] = useState<DueDateReportRow[]>([]);
  const [totals, setTotals] = useState<DueDateBucketTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const [users, setUsers] = useState<ActiveUserDto[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [hierarchy, setHierarchy] = useState<OrgHierarchyNode[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [showTree, setShowTree] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const debouncedText = useDebouncedValue(searchText, 350);

  // --- Reference data + persisted state (once) ----------------------------
  const hydratedOnce = useRef(false);
  useEffect(() => {
    if (hydratedOnce.current) return;
    hydratedOnce.current = true;
    void api.listActiveUsers().then(setUsers).catch(() => setUsers([]));
    void api.listTaskTags().then(setAllTags).catch(() => setAllTags([]));
    void api.getUserHierarchy().then(setHierarchy).catch(() => setHierarchy([]));
    void api
      .getPreference('due-date-report')
      .then(({ state }) => {
        const s = state as Partial<PersistedState> | null;
        if (s && typeof s === 'object') {
          if (typeof s.searchText === 'string') setSearchText(s.searchText);
          if (s.filters && typeof s.filters === 'object') setFilters({ ...defaultFilters, ...s.filters });
          if (Array.isArray(s.sort)) setSort(s.sort);
          if (typeof s.includeReadOnly === 'boolean') setIncludeReadOnly(s.includeReadOnly);
          if (typeof s.groupByAssignee === 'boolean') setGroupByAssignee(s.groupByAssignee);
          if (Array.isArray(s.hierarchyUserIds)) setSelectedHierarchy(new Set(s.hierarchyUserIds));
        }
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  // --- Persist state (debounced) ------------------------------------------
  const snapshot = useMemo<PersistedState>(
    () => ({
      searchText,
      filters,
      sort,
      includeReadOnly,
      groupByAssignee,
      hierarchyUserIds: [...selectedHierarchy],
    }),
    [searchText, filters, sort, includeReadOnly, groupByAssignee, selectedHierarchy],
  );
  const debouncedSnapshot = useDebouncedValue(snapshot, 600);
  useEffect(() => {
    if (hydrated) void api.savePreference('due-date-report', debouncedSnapshot).catch(() => {});
  }, [debouncedSnapshot, hydrated]);

  // --- Run the report -----------------------------------------------------
  const runReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getDueDateReport({
        text: debouncedText.trim() || undefined,
        filters: effectiveFilters(filters),
        sort,
        includeReadOnly,
        hierarchyUserIds: selectedHierarchy.size > 0 ? [...selectedHierarchy] : undefined,
        ...nowContext(),
      });
      setRows(res.rows);
      setTotals(res.bucketTotals);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Report failed');
    } finally {
      setLoading(false);
    }
  }, [debouncedText, filters, sort, includeReadOnly, selectedHierarchy]);

  useEffect(() => {
    if (hydrated) void runReport();
  }, [hydrated, runReport]);

  // --- Filter helpers -----------------------------------------------------
  const patchFilters = (patch: Partial<TaskSearchFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const onSort = (key: TaskSortField, additive: boolean) => setSort((s) => cycleSort(s, key, additive));
  const sortForKey = (key: TaskSortField) => sortState(sort, key);

  // Team Hierarchy tree: toggling a node toggles it + its whole subtree; nested
  // people stay individually toggleable within a selected supervisor. Selecting
  // any hierarchy member clears the Assignee filter (the two are mutually
  // exclusive — the report's backend ANDs both, so keeping both would silently
  // intersect them).
  function toggleNode(node: OrgHierarchyNode) {
    const next = toggleSubtree(selectedHierarchy, node);
    setSelectedHierarchy(next);
    if (next.size > 0 && (filters.assigneeIds?.length ?? 0) > 0) {
      patchFilters({ assigneeIds: [] });
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      await exportDueDateReportToExcel({
        text: debouncedText.trim() || undefined,
        filters: effectiveFilters(filters),
        sort,
        includeReadOnly,
        groupByAssignee,
        hierarchyUserIds: selectedHierarchy.size > 0 ? [...selectedHierarchy] : undefined,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...nowContext(),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  // --- Active-filter chips -------------------------------------------------
  const chips: { id: string; label: string; clear: () => void }[] = [];
  for (const s of filters.statuses ?? [])
    chips.push({ id: `st-${s}`, label: `Status · ${TASK_STATUS_LABELS[s]}`, clear: () => patchFilters({ statuses: (filters.statuses ?? []).filter((x) => x !== s) }) });
  for (const p of filters.priorities ?? [])
    chips.push({ id: `pr-${p}`, label: `Priority · ${p}`, clear: () => patchFilters({ priorities: (filters.priorities ?? []).filter((x) => x !== p) }) });
  for (const a of filters.assigneeIds ?? []) {
    const u = users.find((x) => x.id === a);
    chips.push({ id: `as-${a}`, label: `Assignee · ${u ? userLabel(u) : a}`, clear: () => patchFilters({ assigneeIds: (filters.assigneeIds ?? []).filter((x) => x !== a) }) });
  }
  for (const t of filters.tags ?? [])
    chips.push({ id: `tg-${t}`, label: `Tag · ${t}`, clear: () => patchFilters({ tags: (filters.tags ?? []).filter((x) => x !== t) }) });
  if (filters.statusChangedFrom || filters.statusChangedTo)
    chips.push({ id: 'sc', label: 'Status changed', clear: () => patchFilters({ statusChangedFrom: null, statusChangedTo: null }) });
  if (filters.startFrom || filters.startTo)
    chips.push({ id: 'sd', label: 'Start date', clear: () => patchFilters({ startFrom: null, startTo: null }) });
  if (filters.dueFrom || filters.dueTo)
    chips.push({ id: 'dd', label: 'Due date', clear: () => patchFilters({ dueFrom: null, dueTo: null }) });
  if (selectedHierarchy.size > 0)
    chips.push({ id: 'tree', label: `Team · ${selectedHierarchy.size} selected`, clear: () => setSelectedHierarchy(new Set()) });

  const groups = useMemo(() => groupByAssigneeRows(rows), [rows]);

  return (
    <div className="tasks-page report-page">
      <div className="tasks-toolbar">
        <h1>Due Date Performance</h1>
        <span className="tasks-total">{rows.length}</span>
        <span className="spacer" />
        <input
          className="tasks-search"
          type="search"
          placeholder="Search tasks…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          aria-label="Search"
        />
        <button type="button" className="secondary" disabled={exporting || rows.length === 0} onClick={() => void handleExport()}>
          {exporting ? 'Exporting…' : 'Export'}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      {/* Bucket summary bar */}
      {totals && (
        <div className="bucket-summary" role="list">
          {DUE_DATE_BUCKETS.map((b) => (
            <span key={b} className={`bucket-tile bucket-${BUCKET_CLASS[b]}`} role="listitem">
              <span className="bucket-count">{totals[b]}</span>
              <span className="bucket-text">
                {BUCKET_SUBLABEL[b] && <span className="bucket-sublabel">{BUCKET_SUBLABEL[b]}</span>}
                <span className="bucket-label">{DUE_DATE_BUCKET_LABELS[b]}</span>
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Filter chip row */}
      <div className="tasks-chiprow">
        {chips.map((c) => (
          <button key={c.id} type="button" className="filter-chip" onClick={c.clear}>
            {c.label}
            <span className="chip-x" aria-hidden="true">×</span>
          </button>
        ))}
        <button type="button" className={`add-filter${showFilters ? ' open' : ''}`} onClick={() => setShowFilters((v) => !v)}>
          + Filter
        </button>
        <button type="button" className={`add-filter${showTree ? ' open' : ''}`} onClick={() => setShowTree((v) => !v)}>
          Team hierarchy
        </button>
        {(chips.length > 0 || searchText) && (
          <button type="button" className="link-button" onClick={() => { setFilters(defaultFilters); setSearchText(''); setSelectedHierarchy(new Set()); }}>
            Clear all
          </button>
        )}
        <div className="spacer" />
        <label className="nest-toggle" title="Show tasks you can only see read-only — via an @mention or parent/child tree position">
          <input type="checkbox" checked={includeReadOnly} onChange={(e) => setIncludeReadOnly(e.target.checked)} />
          Read-only
        </label>
        <label className="nest-toggle" title="Group results under each assignee with per-bucket subtotals">
          <input type="checkbox" checked={groupByAssignee} onChange={(e) => setGroupByAssignee(e.target.checked)} />
          Group by assignee
        </label>
      </div>

      {/* + Filter panel */}
      {showFilters && (
        <div className="card panel tasks-filter-panel report-filter-panel">
          <FilterPopover label="Status" active={(filters.statuses ?? []).length > 0}>
            <MultiSelect
              options={TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] }))}
              selected={filters.statuses ?? []}
              onChange={(next) => patchFilters({ statuses: next as TaskStatus[] })}
            />
          </FilterPopover>
          <FilterPopover label="Priority" active={(filters.priorities ?? []).length > 0}>
            <MultiSelect
              options={TASK_PRIORITIES.map((p) => ({ value: p, label: p }))}
              selected={filters.priorities ?? []}
              onChange={(next) => patchFilters({ priorities: next as TaskPriority[] })}
            />
          </FilterPopover>
          <FilterPopover label="Assignee" active={(filters.assigneeIds ?? []).length > 0}>
            <MultiSelect
              options={users.map((u) => ({ value: u.id, label: userLabel(u) }))}
              selected={filters.assigneeIds ?? []}
              onChange={(next) => {
                patchFilters({ assigneeIds: next });
                // Assignee and Team hierarchy are mutually exclusive.
                if (next.length > 0 && selectedHierarchy.size > 0) setSelectedHierarchy(new Set());
              }}
            />
          </FilterPopover>
          <FilterPopover label="Tags" active={(filters.tags ?? []).length > 0}>
            <MultiSelect
              options={allTags.map((t) => ({ value: t, label: t }))}
              selected={filters.tags ?? []}
              onChange={(next) => patchFilters({ tags: next })}
            />
          </FilterPopover>
          <FilterPopover label="Status changed" active={!!(filters.statusChangedFrom || filters.statusChangedTo)}>
            <div className="range-filter">
              <label>From<input type="datetime-local" value={toLocalInput(filters.statusChangedFrom)} onChange={(e) => patchFilters({ statusChangedFrom: fromLocalInput(e.target.value) })} /></label>
              <label>To<input type="datetime-local" value={toLocalInput(filters.statusChangedTo)} onChange={(e) => patchFilters({ statusChangedTo: fromLocalInput(e.target.value) })} /></label>
            </div>
          </FilterPopover>
          <FilterPopover label="Start date" active={!!(filters.startFrom || filters.startTo)}>
            <div className="range-filter">
              <label>From<input type="date" value={(filters.startFrom ?? '').slice(0, 10)} onChange={(e) => patchFilters({ startFrom: e.target.value || null })} /></label>
              <label>To<input type="date" value={(filters.startTo ?? '').slice(0, 10)} onChange={(e) => patchFilters({ startTo: e.target.value || null })} /></label>
            </div>
          </FilterPopover>
          <FilterPopover label="Due date" active={!!(filters.dueFrom || filters.dueTo)}>
            <div className="range-filter">
              <label>From<input type="date" value={(filters.dueFrom ?? '').slice(0, 10)} onChange={(e) => patchFilters({ dueFrom: e.target.value || null })} /></label>
              <label>To<input type="date" value={(filters.dueTo ?? '').slice(0, 10)} onChange={(e) => patchFilters({ dueTo: e.target.value || null })} /></label>
            </div>
          </FilterPopover>
        </div>
      )}

      {/* Team Hierarchy tree */}
      {showTree && (
        <div className="card panel hierarchy-panel">
          <p className="muted" style={{ margin: '0 0 0.5rem' }}>
            Select a supervisor to include their whole downline; toggle individuals within.
          </p>
          <HierarchyTree nodes={hierarchy} selected={selectedHierarchy} onToggle={toggleNode} />
        </div>
      )}

      {/* Results */}
      <div className="table-scroll tasks-table-wrap">
        <table className="results-table tasks-table">
          <thead>
            <tr>
              <SortHeader label="Id" state={sortForKey('id')} onSort={(m) => onSort('id', m)} multi />
              <SortHeader label="Task" state={sortForKey('name')} onSort={(m) => onSort('name', m)} multi />
              <SortHeader label="Status" state={sortForKey('status')} onSort={(m) => onSort('status', m)} multi />
              <SortHeader label="Assignee" state={sortForKey('assignee')} onSort={(m) => onSort('assignee', m)} multi />
              <SortHeader label="Start" state={sortForKey('startAt')} onSort={(m) => onSort('startAt', m)} multi />
              <SortHeader label="Due" state={sortForKey('dueAt')} onSort={(m) => onSort('dueAt', m)} multi />
              <SortHeader label="Status changed" state={sortForKey('statusChangedAt')} onSort={(m) => onSort('statusChangedAt', m)} multi />
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={8} className="muted" style={{ padding: '1rem' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <TableEmptyRow colSpan={8} title="No tasks">
                No tasks match the current filters.
              </TableEmptyRow>
            ) : groupByAssignee ? (
              groups.map((g) => {
                const isCollapsed = collapsed.has(g.key);
                return (
                  <GroupBlock
                    key={g.key}
                    group={g}
                    collapsed={isCollapsed}
                    onToggle={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.key)) next.delete(g.key);
                        else next.add(g.key);
                        return next;
                      })
                    }
                  />
                );
              })
            ) : (
              rows.map((r) => <ReportRow key={r.id} row={r} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Row + group rendering -------------------------------------------------

function ReportRow({ row }: { row: DueDateReportRow }) {
  return (
    <tr>
      <td>
        <span className="task-id-cell">
          {row.mentionOnly && <span className="mention-only-cue" title="Read-only (mention)">👁</span>}
          {row.treeOnly && <span className="tree-only-cue" title="Read-only (parent/child tree position)">🌳</span>}
          <Link to={`/tasks/${row.id}`} className="mono task-id-link">#{row.id}</Link>
        </span>
      </td>
      <td><Link to={`/tasks/${row.id}`} className="task-name-link">{row.name}</Link></td>
      <td><StatusPill status={row.status} /></td>
      <td>
        {row.assignee ? (
          <UserChip user={row.assignee} />
        ) : (
          <span className="user-chip muted"><UnassignedAvatar px={22} /><span className="user-name">Unassigned</span></span>
        )}
      </td>
      <td><DueDate iso={row.startAt} status={row.status} completedAt={row.statusChangedAt} /></td>
      <td><DueDate iso={row.dueAt} status={row.status} completedAt={row.statusChangedAt} isDue /></td>
      <td><AgoDate iso={row.statusChangedAt} /></td>
      <td>
        <span className={`result-pill bucket-${BUCKET_CLASS[row.bucket]}`}>
          {formatDueDateResult(row.bucket, row.daysDelta)}
        </span>
      </td>
    </tr>
  );
}

interface AssigneeGroup {
  key: string;
  label: string;
  rows: DueDateReportRow[];
  totals: DueDateBucketTotals;
}

function GroupBlock({ group, collapsed, onToggle }: { group: AssigneeGroup; collapsed: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="group-subtotal" onClick={onToggle}>
        <td colSpan={8}>
          <button type="button" className="group-toggle" aria-expanded={!collapsed}>
            <span className="group-caret" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
            <span className="group-name">{group.label}</span>
            <span className="group-count">{group.rows.length}</span>
            <span className="group-buckets">
              {DUE_DATE_BUCKETS.filter((b) => group.totals[b] > 0).map((b) => (
                <span key={b} className={`bucket-mini bucket-${BUCKET_CLASS[b]}`}>
                  {DUE_DATE_BUCKET_LABELS[b]}: {group.totals[b]}
                </span>
              ))}
            </span>
          </button>
        </td>
      </tr>
      {!collapsed && group.rows.map((r) => <ReportRow key={r.id} row={r} />)}
    </>
  );
}

// --- helpers ---------------------------------------------------------------

function groupByAssigneeRows(rows: DueDateReportRow[]): AssigneeGroup[] {
  const map = new Map<string, AssigneeGroup>();
  for (const r of rows) {
    const key = r.assignee?.id ?? '__unassigned__';
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        label: r.assignee ? userLabel(r.assignee) : 'Unassigned',
        rows: [],
        totals: emptyTotals(),
      };
      map.set(key, g);
    }
    g.rows.push(r);
    g.totals[r.bucket] += 1;
  }
  return [...map.values()].sort((a, b) => {
    if (a.key === '__unassigned__') return 1;
    if (b.key === '__unassigned__') return -1;
    return a.label.localeCompare(b.label);
  });
}

function emptyTotals(): DueDateBucketTotals {
  return Object.fromEntries(DUE_DATE_BUCKETS.map((b) => [b, 0])) as DueDateBucketTotals;
}

/** ISO string → value for a datetime-local input (local time, minutes). */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  return new Date(v).toISOString();
}
