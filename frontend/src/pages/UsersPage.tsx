import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Role,
  UserCountsDto,
  UserDto,
  UserFilterOptions,
  UserSearchFilters,
  UserSort,
  UserSortField,
  UserStatusFilter,
} from '@healthy-tasks/shared';
import { DEFAULT_PAGE_SIZE, ROLES } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { UserFormModal } from '../components/UserFormModal';
import { UserEditModal } from '../components/UserEditModal';
import { MergeUsersModal } from '../components/MergeUsersModal';
import { SortHeader } from '../components/SortHeader';
import { MultiSelect } from '../components/MultiSelect';
import { FilterPopover } from '../components/FilterPopover';
import { Avatar, UserChip, userLabel } from '../components/ui/Avatar';
import { TableEmptyRow } from '../components/ui/EmptyState';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { cycleSort, sortState } from '../lib/multiSort';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const DEFAULT_SORT: UserSort[] = [{ field: 'lastName', dir: 'asc' }];

const SORT_LABELS: Record<UserSortField, string> = {
  email: 'email',
  firstName: 'first name',
  lastName: 'name',
  role: 'role',
  title: 'title',
  supervisor: 'supervisor',
  status: 'status',
};

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

interface PersistedUsersState {
  filters: UserSearchFilters;
  sort: UserSort[];
  page: number;
  pageSize: number;
}

export function UsersPage() {
  const { user: me } = useAuth();
  const [rows, setRows] = useState<UserDto[]>([]);
  const [supervisors, setSupervisors] = useState<UserDto[]>([]);
  const [mergeAll, setMergeAll] = useState<UserDto[]>([]);
  const [options, setOptions] = useState<UserFilterOptions | null>(null);
  const [counts, setCounts] = useState<UserCountsDto | null>(null);

  const [filters, setFilters] = useState<UserSearchFilters>({});
  const [sort, setSort] = useState<UserSort[]>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const debouncedFilters = useDebouncedValue(filters, 350);

  const loadOptions = useCallback(() => {
    void api.userFilterOptions().then(setOptions).catch(() => setOptions(null));
  }, []);
  const loadCounts = useCallback(() => {
    void api.userCounts().then(setCounts).catch(() => {});
  }, []);
  // Eligible-supervisor list for the edit dropdown. Kept in a callback so it can
  // be refreshed after any user mutation (create/edit/merge) — otherwise a newly
  // added Manager won't appear until a full page reload.
  const loadSupervisors = useCallback(() => {
    void api.listSupervisors().then(setSupervisors).catch(() => setSupervisors([]));
  }, []);

  useEffect(() => {
    loadSupervisors();
    loadOptions();
    loadCounts();
    void api
      .getPreference('users')
      .then(({ state }) => {
        const s = state as Partial<PersistedUsersState> | null;
        if (s && typeof s === 'object') {
          if (s.filters && typeof s.filters === 'object') setFilters(s.filters);
          if (Array.isArray(s.sort)) setSort(s.sort);
          if (typeof s.page === 'number' && s.page >= 1) setPage(s.page);
          if (typeof s.pageSize === 'number') setPageSize(s.pageSize);
        }
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, [loadSupervisors, loadOptions, loadCounts]);

  const snapshot = useMemo<PersistedUsersState>(
    () => ({ filters, sort, page, pageSize }),
    [filters, sort, page, pageSize],
  );
  const debouncedSnapshot = useDebouncedValue(snapshot, 600);
  useEffect(() => {
    if (hydrated) void api.savePreference('users', debouncedSnapshot).catch(() => {});
  }, [debouncedSnapshot, hydrated]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.searchUsers({ filters: debouncedFilters, sort, page, pageSize });
      setRows(res.rows);
      setTotal(res.total);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [debouncedFilters, sort, page, pageSize]);

  useEffect(() => {
    if (hydrated) void load();
  }, [hydrated, load]);

  function patchFilters(patch: Partial<UserSearchFilters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }
  function onSort(field: UserSortField, additive: boolean) {
    setSort((s) => cycleSort(s, field, additive));
    setPage(1);
  }

  async function handleReset(user: UserDto) {
    try {
      const res = await api.adminResetPassword(user.id);
      setNotice(`Reset link generated for ${user.email} (also emailed / logged to the console).`);
      setResetLink(res.resetLink);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate reset link');
    }
  }

  async function openMerge() {
    try {
      setMergeAll(await api.listUsers());
    } catch {
      setMergeAll(rows);
    }
    setShowMerge(true);
  }

  const usersById = useMemo(() => {
    const m = new Map<string, UserDto>();
    for (const u of supervisors) m.set(u.id, u);
    for (const u of rows) m.set(u.id, u);
    for (const u of mergeAll) m.set(u.id, u);
    return m;
  }, [rows, supervisors, mergeAll]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Active-filter chips (removable), mirroring the Tasks screen.
  const chips: { id: string; label: string; clear: Partial<UserSearchFilters> }[] = [];
  if (filters.roles?.length) chips.push({ id: 'roles', label: `Role · ${filters.roles.length}`, clear: { roles: [] } });
  if (filters.status && filters.status !== 'all')
    chips.push({ id: 'status', label: `Status · ${filters.status === 'active' ? 'Active' : 'Deactivated'}`, clear: { status: 'all' } });
  if (filters.supervisorIds?.length) chips.push({ id: 'supervisor', label: `Supervisor · ${filters.supervisorIds.length}`, clear: { supervisorIds: [] } });
  if (filters.title?.length) chips.push({ id: 'title', label: `Title · ${filters.title.length}`, clear: { title: [] } });
  if (filters.firstName?.length) chips.push({ id: 'firstName', label: `First name · ${filters.firstName.length}`, clear: { firstName: [] } });
  if (filters.lastName?.length) chips.push({ id: 'lastName', label: `Last name · ${filters.lastName.length}`, clear: { lastName: [] } });
  if (filters.email?.length) chips.push({ id: 'email', label: `Email · ${filters.email.length}`, clear: { email: [] } });
  const filtersActive = chips.length > 0;

  const sortSummary = sort.length
    ? `${SORT_LABELS[sort[0]!.field]} ${sort[0]!.dir === 'asc' ? '↑' : '↓'}${sort.length > 1 ? ` +${sort.length - 1}` : ''}`
    : null;

  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(total, page * pageSize);

  // Distinct-value checklist filter for a text-like column.
  const checklistFilter = (
    label: string,
    key: 'email' | 'firstName' | 'lastName' | 'title',
    values: string[],
  ) => (
    <FilterPopover label={label} active={(filters[key]?.length ?? 0) > 0}>
      <MultiSelect
        options={values.map((v) => ({ value: v, label: v }))}
        selected={filters[key] ?? []}
        onChange={(v) => patchFilters({ [key]: v })}
      />
    </FilterPopover>
  );

  function personCell(u: UserDto, merged: boolean) {
    const hasName = !!(u.firstName || u.lastName);
    return (
      <div className={`user-person${!u.isActive ? ' is-inactive' : ''}`}>
        <Avatar user={u} px={32} decorative />
        <div className="user-person-txt">
          <span className="user-person-name">
            {hasName ? (
              userLabel(u)
            ) : merged ? (
              <span className="muted">—</span>
            ) : (
              <button type="button" className="incomplete-link" onClick={() => setEditing(u)}>
                + Add name
              </button>
            )}
            {me?.id === u.id && <span className="chip-you">You</span>}
            {!u.isActive && !merged && <span className="chip-inactive">Inactive</span>}
          </span>
          <span className="user-person-email mono">{u.email}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="users-page">
      <div className="tasks-toolbar">
        <h1>Users</h1>
        <span className="mono tasks-total">
          {counts ? `${counts.active} active · ${counts.inactive} inactive` : loading ? '…' : total}
        </span>
        <input
          className="tasks-search"
          value={filters.query ?? ''}
          onChange={(e) => patchFilters({ query: e.target.value })}
          placeholder="Search name or email…"
          aria-label="Search users"
        />
        <div className="spacer" />
        <button className="secondary" onClick={openMerge}>
          Merge users
        </button>
        <button onClick={() => setShowCreate(true)}>Add user</button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}
      {resetLink && (
        <div className="alert info">
          <strong>Reset link:</strong> {resetLink}
        </div>
      )}

      {/* Chip row: active filters + "+ Filter" + sort caption */}
      <div className="tasks-chiprow">
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
          <button type="button" className="link-button" onClick={() => { setFilters({}); setPage(1); }}>
            Clear all
          </button>
        )}
        <div className="spacer" />
        {sortSummary && <span className="mono tasks-sort">Sorted by {sortSummary}</span>}
      </div>

      {showFilters && (
        <div className="card panel tasks-filter-panel">
          <div className="tasks-filter-field">
            <span className="u-label">Role</span>
            <FilterPopover label="Role" active={(filters.roles?.length ?? 0) > 0}>
              <MultiSelect
                options={ROLES.map((r) => ({ value: r, label: r }))}
                selected={filters.roles ?? []}
                onChange={(v) => patchFilters({ roles: v as Role[] })}
              />
            </FilterPopover>
          </div>
          <div className="tasks-filter-field">
            <span className="u-label">Status</span>
            <FilterPopover label="Status" active={!!filters.status && filters.status !== 'all'}>
              <div className="pop-radios">
                {(['all', 'active', 'inactive'] as UserStatusFilter[]).map((s) => (
                  <label key={s}>
                    <input
                      type="radio"
                      name="user-status-filter"
                      checked={(filters.status ?? 'all') === s}
                      onChange={() => patchFilters({ status: s })}
                    />
                    {s === 'all' ? 'All' : s === 'active' ? 'Active' : 'Deactivated'}
                  </label>
                ))}
              </div>
            </FilterPopover>
          </div>
          <div className="tasks-filter-field">
            <span className="u-label">Supervisor</span>
            <FilterPopover label="Supervisor" active={(filters.supervisorIds?.length ?? 0) > 0}>
              <MultiSelect
                options={(options?.supervisors ?? []).map((s) => ({ value: s.id, label: s.email }))}
                selected={filters.supervisorIds ?? []}
                onChange={(v) => patchFilters({ supervisorIds: v })}
              />
            </FilterPopover>
          </div>
          <div className="tasks-filter-field">
            <span className="u-label">Title</span>
            {checklistFilter('Title', 'title', options?.title ?? [])}
          </div>
          <div className="tasks-filter-field">
            <span className="u-label">First name</span>
            {checklistFilter('First name', 'firstName', options?.firstName ?? [])}
          </div>
          <div className="tasks-filter-field">
            <span className="u-label">Last name</span>
            {checklistFilter('Last name', 'lastName', options?.lastName ?? [])}
          </div>
          <div className="tasks-filter-field">
            <span className="u-label">Email</span>
            {checklistFilter('Email', 'email', options?.email ?? [])}
          </div>
        </div>
      )}

      <div className="table-scroll">
        <table className="users-table">
          <thead>
            <tr>
              <SortHeader label="Person" multi={sort.length > 1} state={sortState(sort, 'lastName')} onSort={(a) => onSort('lastName', a)} />
              <SortHeader label="Role" multi={sort.length > 1} state={sortState(sort, 'role')} onSort={(a) => onSort('role', a)} />
              <SortHeader label="Title" multi={sort.length > 1} state={sortState(sort, 'title')} onSort={(a) => onSort('title', a)} />
              <SortHeader label="Supervisor" multi={sort.length > 1} state={sortState(sort, 'supervisor')} onSort={(a) => onSort('supervisor', a)} />
              <SortHeader label="Status" multi={sort.length > 1} state={sortState(sort, 'status')} onSort={(a) => onSort('status', a)} />
              <th className="col-user-actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const merged = u.mergedIntoId !== null;
              const supervisor = u.supervisorId ? usersById.get(u.supervisorId) : null;
              return (
                <tr key={u.id}>
                  <td>{personCell(u, merged)}</td>
                  <td>
                    <span className={`badge role-${u.role}`}>{u.role}</span>
                  </td>
                  <td>{u.title ?? <span className="muted">—</span>}</td>
                  <td>
                    {supervisor ? (
                      <UserChip user={supervisor} />
                    ) : u.supervisorId ? (
                      <span className="muted">{usersById.get(u.supervisorId)?.email ?? '—'}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {merged ? (
                      <span className="badge inactive" title={`Merged into ${usersById.get(u.mergedIntoId!)?.email ?? 'another account'}`}>
                        Merged
                      </span>
                    ) : (
                      <span className={`badge ${u.isActive ? 'active' : 'inactive'}`}>
                        {u.isActive ? 'Active' : 'Deactivated'}
                      </span>
                    )}
                  </td>
                  <td className="col-user-actions">
                    {merged ? (
                      <span className="muted" style={{ fontSize: '0.78rem' }}>
                        → {usersById.get(u.mergedIntoId!)?.email ?? 'merged'}
                      </span>
                    ) : (
                      <div className="user-actions">
                        <button className="icon-btn" title={`Edit ${u.email}`} aria-label={`Edit ${u.email}`} onClick={() => setEditing(u)}>
                          <PencilIcon />
                        </button>
                        <button className="secondary btn-sm" onClick={() => handleReset(u)}>
                          Reset password
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <TableEmptyRow colSpan={6} title="No users match">
                Try adjusting your filters, or add a new user.
              </TableEmptyRow>
            )}
          </tbody>
        </table>
      </div>

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

      {editing && (
        <UserEditModal
          user={editing}
          supervisors={supervisors}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice(message);
            void load();
            loadSupervisors();
            loadOptions();
            loadCounts();
          }}
        />
      )}

      {showCreate && (
        <UserFormModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            setNotice('User created. A password-reset link was emailed / logged to the console.');
            void load();
            loadSupervisors();
            loadOptions();
            loadCounts();
          }}
        />
      )}

      {showMerge && (
        <MergeUsersModal
          users={mergeAll}
          onClose={() => setShowMerge(false)}
          onMerged={(message) => {
            setShowMerge(false);
            setNotice(message);
            void load();
            loadSupervisors();
            loadOptions();
            loadCounts();
          }}
        />
      )}
    </div>
  );
}
