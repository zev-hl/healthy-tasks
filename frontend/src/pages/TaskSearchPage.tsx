import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_TASK_COLUMN_ORDER,
  TASK_COLUMN_KEYS,
  TASK_COLUMN_LABELS,
  TASK_PRIORITIES,
  TASK_SORT_FIELDS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type TaskColumnKey,
  type TaskRowDto,
  type TaskSearchFilters,
  type TaskSearchRequest,
  type TaskSort,
  type TaskSortField,
  type TaskUserRef,
} from '@healthy-tasks/shared';
import { api, ApiError, exportTasksToExcel } from '../api/client';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { cycleSort, sortState } from '../lib/multiSort';
import { SortHeader } from '../components/SortHeader';
import { MultiSelect } from '../components/MultiSelect';
import { FilterPopover } from '../components/FilterPopover';

interface ColumnState {
  key: TaskColumnKey;
  visible: boolean;
}

interface PersistedState {
  searchText: string;
  filters: TaskSearchFilters;
  sort: TaskSort[];
  columns: ColumnState[];
  page: number;
  pageSize: number;
  nestGlobal: boolean;
}

const UNASSIGNED = '__unassigned__';
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

const defaultFilters: TaskSearchFilters = { includeNoStart: true, includeNoDue: true };
const defaultColumns = (): ColumnState[] =>
  DEFAULT_TASK_COLUMN_ORDER.map((key) => ({ key, visible: true }));

function isSortable(key: TaskColumnKey): key is TaskSortField {
  return (TASK_SORT_FIELDS as readonly string[]).includes(key);
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

/** Append end-of-day to a bare YYYY-MM-DD "to" bound so the range is inclusive. */
function endOfDay(v: string | null | undefined): string | null | undefined {
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T23:59:59.999`;
  return v;
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

// --- Tags chip cell: up to 3 chips + "+N" ----------------------------------
function TagsCell({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <span className="muted">—</span>;
  const shown = tags.slice(0, 3);
  const extra = tags.length - shown.length;
  return (
    <div className="tags-cell">
      {shown.map((t) => (
        <span key={t} className="badge role-Member">
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

  // Per-row collapse in nested mode (client-side hide of a parent's subtree).
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const [rows, setRows] = useState<TaskRowDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [users, setUsers] = useState<TaskUserRef[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [showColumns, setShowColumns] = useState(false);
  const [exporting, setExporting] = useState(false);

  const debouncedText = useDebouncedValue(searchText, 350);

  // --- Load reference data + persisted state (once) ------------------------
  useEffect(() => {
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
        }
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  // --- Persist state (debounced) after hydration ---------------------------
  const snapshot = useMemo<PersistedState>(
    () => ({ searchText, filters, sort, columns, page, pageSize, nestGlobal }),
    [searchText, filters, sort, columns, page, pageSize, nestGlobal],
  );
  const debouncedSnapshot = useDebouncedValue(snapshot, 600);
  useEffect(() => {
    if (hydrated) void api.savePreference('task-search', debouncedSnapshot).catch(() => {});
  }, [debouncedSnapshot, hydrated]);

  // --- Run the query -------------------------------------------------------
  const runQuery = useCallback(async () => {
    setLoading(true);
    const req: TaskSearchRequest = {
      text: debouncedText.trim() || undefined,
      filters: {
        ...filters,
        startTo: endOfDay(filters.startTo),
        dueTo: endOfDay(filters.dueTo),
      },
      sort,
      page,
      pageSize,
      nest: nestGlobal,
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
  }, [debouncedText, filters, sort, page, pageSize, nestGlobal]);

  useEffect(() => {
    if (hydrated) void runQuery();
  }, [hydrated, runQuery]);

  // --- Change handlers (filter/search/sort edits reset to page 1) ----------
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

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // --- Column ordering / visibility ----------------------------------------
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

  // --- Hierarchy display ---------------------------------------------------
  // The server returns rows already in nested (tree) order with a `depth` when
  // nesting is on. Per-row collapse is a client-side hide of a parent's subtree
  // among the loaded rows; a row's caret shows when the next row is one level
  // deeper (i.e. it has children on this page).
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
    // Hide rows sitting under a collapsed ancestor.
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

  const filtersActive =
    (filters.assigneeIds?.length ?? 0) > 0 ||
    filters.includeUnassigned ||
    (filters.statuses?.length ?? 0) > 0 ||
    (filters.priorities?.length ?? 0) > 0 ||
    (filters.tags?.length ?? 0) > 0 ||
    !!filters.statusChangedFrom ||
    !!filters.statusChangedTo ||
    !!filters.startFrom ||
    !!filters.startTo ||
    !!filters.dueFrom ||
    !!filters.dueTo ||
    filters.includeNoStart === false ||
    filters.includeNoDue === false;

  async function handleExport() {
    setExporting(true);
    try {
      await exportTasksToExcel({
        text: debouncedText.trim() || undefined,
        filters: { ...filters, startTo: endOfDay(filters.startTo), dueTo: endOfDay(filters.dueTo) },
        sort,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  /** The collapsible filter control for a column's filter-row cell (null if the column isn't filterable). */
  function columnFilter(key: TaskColumnKey) {
    switch (key) {
      case 'assignee':
        return (
          <FilterPopover
            label="Assignee"
            active={(filters.assigneeIds?.length ?? 0) > 0 || !!filters.includeUnassigned}
          >
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
          <FilterPopover
            label="Status changed"
            active={!!filters.statusChangedFrom || !!filters.statusChangedTo}
          >
            <div className="pop-range">
              <label>
                From
                <input
                  type="datetime-local"
                  value={filters.statusChangedFrom ?? ''}
                  onChange={(e) => patchFilters({ statusChangedFrom: e.target.value || null })}
                />
              </label>
              <label>
                To
                <input
                  type="datetime-local"
                  value={filters.statusChangedTo ?? ''}
                  onChange={(e) => patchFilters({ statusChangedTo: e.target.value || null })}
                />
              </label>
            </div>
          </FilterPopover>
        );
      case 'startAt':
        return (
          <FilterPopover
            label="Start"
            active={!!filters.startFrom || !!filters.startTo || filters.includeNoStart === false}
          >
            <div className="pop-range">
              <label>
                From
                <input
                  type="date"
                  value={filters.startFrom ?? ''}
                  onChange={(e) => patchFilters({ startFrom: e.target.value || null })}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={filters.startTo ?? ''}
                  onChange={(e) => patchFilters({ startTo: e.target.value || null })}
                />
              </label>
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={filters.includeNoStart ?? true}
                  onChange={(e) => patchFilters({ includeNoStart: e.target.checked })}
                />
                <span>Include tasks without a Start Date</span>
              </label>
            </div>
          </FilterPopover>
        );
      case 'dueAt':
        return (
          <FilterPopover
            label="Due"
            active={!!filters.dueFrom || !!filters.dueTo || filters.includeNoDue === false}
          >
            <div className="pop-range">
              <label>
                From
                <input
                  type="date"
                  value={filters.dueFrom ?? ''}
                  onChange={(e) => patchFilters({ dueFrom: e.target.value || null })}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={filters.dueTo ?? ''}
                  onChange={(e) => patchFilters({ dueTo: e.target.value || null })}
                />
              </label>
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={filters.includeNoDue ?? true}
                  onChange={(e) => patchFilters({ includeNoDue: e.target.checked })}
                />
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
          <a href={`/tasks/${row.id}`} target="_blank" rel="noopener noreferrer">
            #{row.id}
          </a>
        );
      case 'name':
        return row.name;
      case 'status':
        return TASK_STATUS_LABELS[row.status];
      case 'statusChangedAt':
        return fmt(row.statusChangedAt);
      case 'priority':
        return row.priority;
      case 'assignee':
        return row.assignee ? row.assignee.email : <span className="muted">—</span>;
      case 'creator':
        return row.creator.email;
      case 'createdAt':
        return fmt(row.createdAt);
      case 'startAt':
        return fmt(row.startAt);
      case 'dueAt':
        return fmt(row.dueAt);
      case 'parentChild':
        if (row.parentId != null)
          return (
            <a href={`/tasks/${row.parentId}`} target="_blank" rel="noopener noreferrer">
              ↑ #{row.parentId}
            </a>
          );
        if (row.childrenCount > 0) return `${row.childrenCount} sub-task${row.childrenCount === 1 ? '' : 's'}`;
        return <span className="muted">—</span>;
      case 'tags':
        return <TagsCell tags={row.tags} />;
    }
  }

  return (
    <div className="container container-wide">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Tasks</h2>
        <div className="spacer" />
        {filtersActive && (
          <button
            className="secondary"
            onClick={() => {
              setFilters(defaultFilters);
              setPage(1);
            }}
          >
            Clear filters
          </button>
        )}
        <button className="secondary" onClick={() => setShowColumns((v) => !v)}>
          Columns
        </button>
        <button className="secondary" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export to Excel'}
        </button>
        <Link to="/tasks/new">
          <button>New task</button>
        </Link>
      </div>

      {/* Search (separate from filters) */}
      <div className="search-row">
        <input
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by Task Id, Name, or Tags…"
          aria-label="Search tasks"
          style={{ flex: 1 }}
        />
        {searchText && (
          <button className="secondary" onClick={() => onSearchChange('')}>
            Clear search
          </button>
        )}
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
          Nest sub-tasks
        </label>
      </div>

      {error && <div className="alert error">{error}</div>}

      {/* Columns panel — horizontal (mirrors the on-screen order), ← → reorder */}
      {showColumns && (
        <div className="card panel">
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong>Columns</strong>
            <div className="spacer" />
            <button className="secondary" onClick={() => setColumns(defaultColumns())}>
              Reset
            </button>
          </div>
          <ul className="columns-list">
            {columns.map((c, i) => (
              <li key={c.key} className="col-chip">
                <button
                  className="col-move"
                  disabled={i === 0}
                  aria-label={`Move ${TASK_COLUMN_LABELS[c.key]} left`}
                  onClick={() => moveColumn(i, -1)}
                >
                  ←
                </button>
                <label>
                  <input type="checkbox" checked={c.visible} onChange={() => toggleColumn(c.key)} />
                  {TASK_COLUMN_LABELS[c.key]}
                </label>
                <button
                  className="col-move"
                  disabled={i === columns.length - 1}
                  aria-label={`Move ${TASK_COLUMN_LABELS[c.key]} right`}
                  onClick={() => moveColumn(i, 1)}
                >
                  →
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Results */}
      <div className="table-scroll">
        <table className="results-table">
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
            <tr className="filter-row">
              <th />
              {visibleColumns.map((c) => (
                <th key={c.key}>{columnFilter(c.key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map(({ row, depth, hasChildrenHere }) => (
              <tr key={row.id}>
                <td style={{ textAlign: 'center' }}>
                  {hasChildrenHere ? (
                    <button
                      className="tree-toggle"
                      onClick={() => toggleCollapse(row.id)}
                      aria-label={collapsed.has(row.id) ? 'Expand sub-tasks' : 'Collapse sub-tasks'}
                    >
                      {collapsed.has(row.id) ? '▸' : '▾'}
                    </button>
                  ) : null}
                </td>
                {visibleColumns.map((c, ci) => (
                  <td key={c.key} style={ci === 0 ? { paddingLeft: `${0.8 + depth * 1.25}rem` } : undefined}>
                    {renderCell(c.key, row)}
                  </td>
                ))}
              </tr>
            ))}
            {!loading && displayRows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + 1} className="muted" style={{ padding: '1rem' }}>
                  No tasks match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="pager">
        <span className="muted">
          {loading ? 'Loading…' : `${total} result${total === 1 ? '' : 's'}`}
        </span>
        <div className="spacer" />
        <label>
          Rows:{' '}
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
        <button className="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          ← Prev
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button
          className="secondary"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
