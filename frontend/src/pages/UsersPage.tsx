import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Role,
  UserDto,
  UserFilterOptions,
  UserSearchFilters,
  UserSort,
  UserSortField,
  UserStatusFilter,
} from '@healthy-tasks/shared';
import { DEFAULT_PAGE_SIZE, ROLES } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { UserFormModal } from '../components/UserFormModal';
import { UserEditModal } from '../components/UserEditModal';
import { MergeUsersModal } from '../components/MergeUsersModal';
import { SortHeader } from '../components/SortHeader';
import { MultiSelect } from '../components/MultiSelect';
import { FilterPopover } from '../components/FilterPopover';
import { UserChip } from '../components/ui/Avatar';
import { TableEmptyRow } from '../components/ui/EmptyState';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { cycleSort, sortState } from '../lib/multiSort';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const DEFAULT_SORT: UserSort[] = [{ field: 'lastName', dir: 'asc' }];

interface PersistedUsersState {
  filters: UserSearchFilters;
  sort: UserSort[];
  page: number;
  pageSize: number;
}

const COLUMNS: { label: string; field: UserSortField }[] = [
  { label: 'Email (login id)', field: 'email' },
  { label: 'First name', field: 'firstName' },
  { label: 'Last name', field: 'lastName' },
  { label: 'Role', field: 'role' },
  { label: 'Title', field: 'title' },
  { label: 'Supervisor', field: 'supervisor' },
  { label: 'Status', field: 'status' },
];

export function UsersPage() {
  const [rows, setRows] = useState<UserDto[]>([]);
  const [supervisors, setSupervisors] = useState<UserDto[]>([]);
  const [mergeAll, setMergeAll] = useState<UserDto[]>([]);
  const [options, setOptions] = useState<UserFilterOptions | null>(null);

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
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const debouncedFilters = useDebouncedValue(filters, 350);

  const loadOptions = useCallback(() => {
    void api.userFilterOptions().then(setOptions).catch(() => setOptions(null));
  }, []);

  useEffect(() => {
    void api.listSupervisors().then(setSupervisors).catch(() => setSupervisors([]));
    loadOptions();
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
  }, [loadOptions]);

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
  const lookupEmail = (id: string) => usersById.get(id)?.email;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const filtersActive =
    (filters.firstName?.length ?? 0) > 0 ||
    (filters.lastName?.length ?? 0) > 0 ||
    (filters.email?.length ?? 0) > 0 ||
    (filters.title?.length ?? 0) > 0 ||
    (filters.supervisorIds?.length ?? 0) > 0 ||
    (filters.roles?.length ?? 0) > 0 ||
    (filters.status && filters.status !== 'all');

  // A distinct-value checklist filter for a text-like column.
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

  return (
    <div className="container container-wide">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Users</h2>
        <div className="spacer" />
        {filtersActive && (
          <button
            className="secondary"
            onClick={() => {
              setFilters({});
              setPage(1);
            }}
          >
            Clear filters
          </button>
        )}
        <button className="secondary" onClick={openMerge}>
          Merge accounts
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

      <div className="table-scroll">
        <table className="users-table">
          <thead>
            <tr>
              <th />
              {COLUMNS.map((c) => (
                <SortHeader
                  key={c.field}
                  label={c.label}
                  multi={sort.length > 1}
                  state={sortState(sort, c.field)}
                  onSort={(additive) => onSort(c.field, additive)}
                />
              ))}
              <th>Actions</th>
            </tr>
            <tr className="filter-row">
              <th />
              <th>{checklistFilter('Email', 'email', options?.email ?? [])}</th>
              <th>{checklistFilter('First name', 'firstName', options?.firstName ?? [])}</th>
              <th>{checklistFilter('Last name', 'lastName', options?.lastName ?? [])}</th>
              <th>
                <FilterPopover label="Role" active={(filters.roles?.length ?? 0) > 0}>
                  <MultiSelect
                    options={ROLES.map((r) => ({ value: r, label: r }))}
                    selected={filters.roles ?? []}
                    onChange={(v) => patchFilters({ roles: v as Role[] })}
                  />
                </FilterPopover>
              </th>
              <th>{checklistFilter('Title', 'title', options?.title ?? [])}</th>
              <th>
                <FilterPopover
                  label="Supervisor"
                  active={(filters.supervisorIds?.length ?? 0) > 0}
                >
                  <MultiSelect
                    options={(options?.supervisors ?? []).map((s) => ({ value: s.id, label: s.email }))}
                    selected={filters.supervisorIds ?? []}
                    onChange={(v) => patchFilters({ supervisorIds: v })}
                  />
                </FilterPopover>
              </th>
              <th>
                <FilterPopover
                  label="Status"
                  active={!!filters.status && filters.status !== 'all'}
                >
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
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const merged = u.mergedIntoId !== null;
              return (
                <tr key={u.id} className={u.isActive ? '' : 'row-inactive'}>
                  <td style={{ textAlign: 'center' }}>
                    {!merged && (
                      <button
                        className="icon-btn"
                        title={`Edit ${u.email}`}
                        aria-label={`Edit ${u.email}`}
                        onClick={() => setEditing(u)}
                      >
                        ✏️
                      </button>
                    )}
                  </td>
                  <td>
                    <UserChip user={u} label={u.email} />
                  </td>
                  <td>{u.firstName || <span className="muted">—</span>}</td>
                  <td>{u.lastName || <span className="muted">—</span>}</td>
                  <td>
                    <span className={`badge role-${u.role}`}>{u.role}</span>
                  </td>
                  <td>{u.title ?? <span className="muted">—</span>}</td>
                  <td>
                    {u.supervisorId ? (
                      (lookupEmail(u.supervisorId) ?? <span className="muted">—</span>)
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {merged ? (
                      <span
                        className="badge inactive"
                        title={`Merged into ${lookupEmail(u.mergedIntoId!) ?? 'another account'}`}
                      >
                        Merged
                      </span>
                    ) : (
                      <span className={`badge ${u.isActive ? 'active' : 'inactive'}`}>
                        {u.isActive ? 'Active' : 'Deactivated'}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="btn-row">
                      {merged ? (
                        <span className="muted" style={{ fontSize: '0.8rem' }}>
                          → {lookupEmail(u.mergedIntoId!) ?? 'merged'}
                        </span>
                      ) : (
                        <button className="secondary" onClick={() => handleReset(u)}>
                          Reset password
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <TableEmptyRow colSpan={COLUMNS.length + 2} title="No users match">
                Try adjusting your filters, or add a new user.
              </TableEmptyRow>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <span className="muted">
          {loading ? 'Loading…' : `${total} user${total === 1 ? '' : 's'}`}
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

      {editing && (
        <UserEditModal
          user={editing}
          supervisors={supervisors}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice(message);
            void load();
            loadOptions();
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
            loadOptions();
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
            loadOptions();
          }}
        />
      )}
    </div>
  );
}
