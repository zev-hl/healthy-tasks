import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Copy,
  GitMerge,
  KeyRound,
  Pencil,
  Plus,
  X,
} from 'lucide-react';
import type {
  Role,
  UserCountsDto,
  UserDto,
  UserFilterOptions,
  UserSearchFilters,
  UserSort,
  UserSortField,
} from '@healthy-tasks/shared';
import { DEFAULT_PAGE_SIZE, ROLES } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { MergeUsersPanel, UserCreatePanel, UserEditPanel } from '../components/users/UserPanels';
import { Avatar, userLabel } from '../components/ui/Avatar';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { cycleSort, sortState } from '../lib/multiSort';
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { Select, type SelectOption } from '../components/harbor/Select';
import { Popover } from '../components/harbor/Popover';
import { useToast } from '../components/harbor/Toast';
import { Btn, Card, Pill, cx, type Tone } from '../components/harbor/ui';

/**
 * Users (Admins), Harbor redesign: the people list as the Tasks list shows
 * tasks. Filter chips (Role, Status, Supervisor, Title, and "+ Filter" for
 * first/last name and email) over a full-width table; click a column to sort,
 * Shift-click to add a second sort. Each row edits the person, and password
 * accounts get a reset link. Filters, sort and paging are remembered per user.
 */

const ALL = '__all';
const ROLE_TONE: Record<Role, Tone> = { Admin: 'blue', Manager: 'review', Member: 'grey' };

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const DEFAULT_SORT: UserSort[] = [{ field: 'lastName', dir: 'asc' }];

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
  const toast = useToast();
  const setNotice = (message: string) => toast({ message, tone: 'success' });
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const debouncedFilters = useDebouncedValue(filters, 350);

  const loadOptions = useCallback(() => {
    void api
      .userFilterOptions()
      .then(setOptions)
      .catch(() => setOptions(null));
  }, []);
  const loadCounts = useCallback(() => {
    void api
      .userCounts()
      .then(setCounts)
      .catch(() => {});
  }, []);
  // Eligible-supervisor list for the edit dropdown. Kept in a callback so it can
  // be refreshed after any user mutation (create/edit/merge) — otherwise a newly
  // added Manager won't appear until a full page reload.
  const loadSupervisors = useCallback(() => {
    void api
      .listSupervisors()
      .then(setSupervisors)
      .catch(() => setSupervisors([]));
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

  /**
   * Google users have no password, so a reset would only fail. Say what they
   * use instead of offering a button that cannot work.
   */
  async function handleReset(user: UserDto) {
    try {
      const res = await api.adminResetPassword(user.id);
      setNotice(`Reset link made for ${user.email}. It was also emailed to them.`);
      setResetLink(res.resetLink ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate reset link');
    }
  }

  // One side panel at a time: add, edit or merge.
  function openCreate() {
    setEditing(null);
    setShowMerge(false);
    setShowCreate(true);
  }
  function openEdit(u: UserDto) {
    setShowCreate(false);
    setShowMerge(false);
    setEditing(u);
  }
  async function openMerge() {
    setEditing(null);
    setShowCreate(false);
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
  const panelOpen = !!editing || showCreate || showMerge;
  // On narrow screens the panel sits below the table: bring it into view.
  useEffect(() => {
    if (panelOpen && window.matchMedia?.('(max-width: 1359px)').matches)
      panelRef.current?.scrollIntoView({ block: 'start' });
  }, [panelOpen, editing?.id]);

  // --- Filter chips (as on Tasks) --------------------------------------------
  type ListKey = 'roles' | 'supervisorIds' | 'title' | 'firstName' | 'lastName' | 'email';
  const one = (key: ListKey) => {
    const v = filters[key] as string[] | undefined;
    return v?.length === 1 ? v[0]! : ALL;
  };
  const pick = (key: ListKey) => (v: string) => patchFilters({ [key]: v === ALL ? [] : [v] });
  const many = (key: ListKey) => ((filters[key] as string[] | undefined)?.length ?? 0) > 1;

  const roleOptions: SelectOption<string>[] = [
    { value: ALL, label: 'Any role' },
    ...ROLES.map((r) => ({ value: r, label: r })),
  ];
  const statusOptions: SelectOption<string>[] = [
    { value: 'all', label: 'Everyone' },
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Deactivated' },
  ];
  const supervisorOptions: SelectOption<string>[] = [
    { value: ALL, label: 'Anyone' },
    ...(options?.supervisors ?? [])
      .map((s) => ({
        value: s.id,
        label: userLabel(s),
        lead: <Avatar user={s} size="xs" decorative />,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  const listOptions = (values: string[], any: string): SelectOption<string>[] => [
    { value: ALL, label: any },
    ...values.map((v) => ({ value: v, label: v })),
  ];

  // Name and email filters live behind "+ Filter"; each one in use is a chip.
  const MORE: { key: 'firstName' | 'lastName' | 'email'; label: string }[] = [
    { key: 'firstName', label: 'First name' },
    { key: 'lastName', label: 'Last name' },
    { key: 'email', label: 'Email' },
  ];
  const moreChips = MORE.filter((m) => (filters[m.key]?.length ?? 0) > 0);
  const filtersActive =
    !!filters.query ||
    (!!filters.status && filters.status !== 'all') ||
    (['roles', 'supervisorIds', 'title', 'firstName', 'lastName', 'email'] as ListKey[]).some(
      (k) => ((filters[k] as string[] | undefined)?.length ?? 0) > 0,
    );

  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(total, page * pageSize);

  const th = (field: UserSortField, label: string) => {
    const st = sortState(sort, field);
    return (
      <th aria-sort={st ? (st.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
        <button
          type="button"
          className={cx('hb-th', st && 'on')}
          title="Click to sort; Shift-click to add a second sort"
          onClick={(e) => onSort(field, e.shiftKey)}
        >
          {label}
          {st &&
            (st.dir === 'asc' ? (
              <ArrowUp size={13} aria-hidden="true" />
            ) : (
              <ArrowDown size={13} aria-hidden="true" />
            ))}
          {st && sort.length > 1 && <sup>{st.index + 1}</sup>}
        </button>
      </th>
    );
  };

  const statusPill = (u: UserDto) =>
    u.mergedIntoId !== null ? (
      <span title={`Merged into ${usersById.get(u.mergedIntoId)?.email ?? 'another account'}`}>
        <Pill tone="grey">Merged</Pill>
      </span>
    ) : u.isActive ? (
      <Pill tone="green">Active</Pill>
    ) : (
      <Pill tone="grey">Deactivated</Pill>
    );

  return (
    <>
      <PageHeader
        title="Users"
        subtitle={
          counts
            ? `${counts.active} active · ${counts.inactive} deactivated`
            : loading
              ? 'Loading…'
              : `${total} people`
        }
        searchPlaceholder="Search name or email"
        searchLabel="Search users"
        searchValue={filters.query ?? ''}
        onSearchChange={(t) => patchFilters({ query: t })}
        onSearch={() => undefined}
        newTask={false}
        actions={
          <>
            <Btn onClick={() => void openMerge()}>
              <GitMerge size={16} aria-hidden="true" /> Merge users
            </Btn>
            <Btn kind="primary" onClick={openCreate}>
              <Plus size={16} aria-hidden="true" /> Add user
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
        {resetLink && (
          <div className="hb-reset-link" role="status">
            <KeyRound size={16} aria-hidden="true" />
            <span className="hb-reset-text">
              <strong>Reset link</strong>
              <code>{resetLink}</code>
            </span>
            <Btn
              className="hb-btn-sm"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(resetLink)
                  .then(() => toast({ message: 'Link copied', tone: 'success' }))
                  .catch(() => {});
              }}
            >
              <Copy size={14} aria-hidden="true" /> Copy
            </Btn>
            <button
              type="button"
              className="hb-icon-btn hb-icon-btn-sm"
              aria-label="Hide the reset link"
              onClick={() => setResetLink(null)}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="hb-toolbar">
          <span className="hb-count-label">
            {loading ? 'Loading…' : `${total} ${total === 1 ? 'person' : 'people'}`}
          </span>
          {many('roles') ? (
            <span className="hb-chip-on">
              Role · {filters.roles!.length}
              <button
                type="button"
                aria-label="Remove filter: Role"
                onClick={() => patchFilters({ roles: [] })}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ) : (
            <Select
              variant="chip"
              label="Role"
              value={one('roles')}
              options={roleOptions}
              active={one('roles') !== ALL}
              onChange={(v) => patchFilters({ roles: v === ALL ? [] : [v as Role] })}
            />
          )}
          <Select
            variant="chip"
            label="Status"
            value={filters.status ?? 'all'}
            options={statusOptions}
            active={!!filters.status && filters.status !== 'all'}
            onChange={(v) => patchFilters({ status: v as UserSearchFilters['status'] })}
          />
          {many('supervisorIds') ? (
            <span className="hb-chip-on">
              Supervisor · {filters.supervisorIds!.length}
              <button
                type="button"
                aria-label="Remove filter: Supervisor"
                onClick={() => patchFilters({ supervisorIds: [] })}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ) : (
            <Select
              variant="chip"
              label="Supervisor"
              value={one('supervisorIds')}
              options={supervisorOptions}
              active={one('supervisorIds') !== ALL}
              searchPlaceholder="Search people…"
              onChange={pick('supervisorIds')}
            />
          )}
          {many('title') ? (
            <span className="hb-chip-on">
              Title · {filters.title!.length}
              <button
                type="button"
                aria-label="Remove filter: Title"
                onClick={() => patchFilters({ title: [] })}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ) : (
            <Select
              variant="chip"
              label="Title"
              value={one('title')}
              options={listOptions(options?.title ?? [], 'Any title')}
              active={one('title') !== ALL}
              searchPlaceholder="Search titles…"
              onChange={pick('title')}
            />
          )}
          {moreChips.map((m) => (
            <span key={m.key} className="hb-chip-on">
              {m.label}:{' '}
              {filters[m.key]!.length === 1
                ? filters[m.key]![0]
                : `${filters[m.key]!.length} chosen`}
              <button
                type="button"
                aria-label={`Remove filter: ${m.label}`}
                onClick={() => patchFilters({ [m.key]: [] })}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
          <button
            ref={moreRef}
            type="button"
            className="hb-select hb-select-chip hb-add-filter"
            aria-expanded={showFilters}
            aria-haspopup="dialog"
            onClick={() => setShowFilters((o) => !o)}
          >
            <Plus size={14} aria-hidden="true" /> Filter
          </button>
          <Popover
            anchorRef={moreRef}
            open={showFilters}
            onClose={() => setShowFilters(false)}
            minWidth={320}
            matchWidth={false}
            className="hb-filters-pop"
            label="More filters"
            closeOnTab={false}
          >
            <div className="hb-fp-grid">
              {MORE.map((m) => (
                <Fragment key={m.key}>
                  <span className="hb-label">{m.label}</span>
                  <Select
                    label={m.label}
                    value={one(m.key)}
                    options={listOptions(options?.[m.key] ?? [], 'Any')}
                    searchPlaceholder="Search…"
                    onChange={pick(m.key)}
                  />
                </Fragment>
              ))}
            </div>
          </Popover>
          {filtersActive && (
            <Btn
              kind="link"
              onClick={() => {
                setFilters({});
                setPage(1);
              }}
            >
              Clear
            </Btn>
          )}
        </div>

        <div className={cx(panelOpen && 'hb-cols hb-users-cols')}>
          <div className="hb-col">
            <Card className="hb-table-card">
              <div className="hb-table-wrap">
                <table className="hb-table hb-users-table">
                  <thead>
                    <tr>
                      {th('lastName', 'Person')}
                      {th('role', 'Role')}
                      {th('title', 'Title')}
                      {th('supervisor', 'Supervisor')}
                      {th('status', 'Status')}
                      <th className="hb-users-act">
                        <span className="hb-sr">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((u) => {
                      const merged = u.mergedIntoId !== null;
                      const supervisor = u.supervisorId ? usersById.get(u.supervisorId) : null;
                      const hasName = !!(u.firstName || u.lastName);
                      return (
                        <tr
                          key={u.id}
                          className={cx(!u.isActive && 'is-off', editing?.id === u.id && 'is-sel')}
                        >
                          <td>
                            <div className="hb-user">
                              <Avatar user={u} px={32} decorative />
                              <div className="hb-stack">
                                <span className="hb-name">
                                  {hasName ? (
                                    userLabel(u)
                                  ) : merged ? (
                                    <span className="hb-small">—</span>
                                  ) : (
                                    <button
                                      type="button"
                                      className="hb-tpl-crumb"
                                      onClick={() => openEdit(u)}
                                    >
                                      + Add name
                                    </button>
                                  )}
                                  {me?.id === u.id && <span className="hb-you">You</span>}
                                </span>
                                <span className="hb-sub">{u.email}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <Pill tone={ROLE_TONE[u.role]}>{u.role}</Pill>
                          </td>
                          <td>{u.title ?? <span className="hb-small">—</span>}</td>
                          <td>
                            {supervisor ? (
                              <span className="hb-user-mini">
                                <Avatar user={supervisor} size="xs" decorative />
                                {userLabel(supervisor)}
                              </span>
                            ) : (
                              <span className="hb-small">—</span>
                            )}
                          </td>
                          <td>{statusPill(u)}</td>
                          <td className="hb-users-act">
                            {merged ? (
                              <span className="hb-small">
                                → {usersById.get(u.mergedIntoId!)?.email ?? 'merged'}
                              </span>
                            ) : (
                              <span className="hb-users-btns">
                                {/* A company account has no password, so a reset link
                              would lead nowhere. The server refuses it too; this
                              just stops an admin reaching for a dead button. */}
                                {u.signInMethod === 'password' && (
                                  <Btn
                                    kind="ghost"
                                    className="hb-btn-sm"
                                    onClick={() => void handleReset(u)}
                                    title="Send this user a link to set a password"
                                  >
                                    <KeyRound size={14} aria-hidden="true" /> Reset password
                                  </Btn>
                                )}
                                <button
                                  type="button"
                                  className="hb-icon-btn hb-icon-btn-sm"
                                  title={`Edit ${u.email}`}
                                  aria-label={`Edit ${u.email}`}
                                  onClick={() => openEdit(u)}
                                >
                                  <Pencil size={15} aria-hidden="true" />
                                </button>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {!loading && rows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="hb-table-empty">
                          No users match. Try other filters, or add a new user.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="hb-pager">
                <span className="hb-small">
                  {loading ? 'Loading…' : `${firstRow}–${lastRow} of ${total}`}
                </span>
                <span className="hb-grow" />
                <Select
                  variant="chip"
                  label="Rows"
                  value={String(pageSize)}
                  options={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
                  onChange={(v) => {
                    setPageSize(Number(v));
                    setPage(1);
                  }}
                />
                <span className="hb-small">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  className="hb-icon-btn hb-icon-btn-sm"
                  aria-label="Previous page"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="hb-icon-btn hb-icon-btn-sm"
                  aria-label="Next page"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </Card>
          </div>
          {panelOpen && (
            <aside className="hb-col hb-gside" ref={panelRef}>
              {editing && (
                <UserEditPanel
                  key={editing.id}
                  user={editing}
                  supervisors={supervisors}
                  onClose={() => setEditing(null)}
                  onSaved={(message, link) => {
                    setEditing(null);
                    setNotice(message);
                    // A set-password link when the new address needs one; otherwise
                    // clear any link left from an earlier reset.
                    setResetLink(link ?? null);
                    void load();
                    loadSupervisors();
                    loadOptions();
                    loadCounts();
                  }}
                />
              )}

              {showCreate && (
                <UserCreatePanel
                  onClose={() => setShowCreate(false)}
                  onCreated={(signInMethod) => {
                    setShowCreate(false);
                    setNotice(
                      signInMethod === 'google'
                        ? 'User created. They were sent a welcome message and sign in with Google — ' +
                            'there is no password to hand over.'
                        : 'User created. A welcome email with a link to set their password is on its way.',
                    );
                    void load();
                    loadSupervisors();
                    loadOptions();
                    loadCounts();
                  }}
                />
              )}

              {showMerge && (
                <MergeUsersPanel
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
            </aside>
          )}
        </div>
      </PageBody>
    </>
  );
}
