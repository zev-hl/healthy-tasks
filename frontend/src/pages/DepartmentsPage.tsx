import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  DEPARTMENT_COLORS,
  catalogNameKey,
  normalizeCatalogName,
  type DepartmentDto,
  type DutyDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Toast, useToast } from '../components/exclusives/Toast';
import { Swatch } from '../components/duties/DutyTag';
import { CaretIcon, SearchIcon } from '../components/duties/icons';

/**
 * Departments & Duties (Admin). Every duty belongs to exactly one department and
 * is unique within it (ignoring case and extra spaces). Alphabetical tree with
 * duty counts, search, a status filter, Expand/Collapse all (remembered per
 * user) and "+ Duty" on each department. Archive, don't delete, once anything
 * has used a row; never-used rows show Delete instead.
 */

type StatusFilter = 'active' | 'archived' | 'all';
type ShowFilter = 'all' | 'nopeople' | 'tasks';

type Editing =
  | { kind: 'newDept'; name: string; color: string }
  | { kind: 'dept'; id: string; name: string; color: string }
  | { kind: 'addDuty'; deptId: string; name: string; desc: string }
  | { kind: 'duty'; id: string; deptId: string; name: string; desc: string };

type Confirm =
  | { kind: 'deleteDept'; dept: DepartmentDto }
  | { kind: 'archiveDept'; dept: DepartmentDto }
  | { kind: 'deleteDuty'; duty: DutyDto };

/** Highlight the first case-insensitive match of `q` in `text`. */
export function highlight(text: string, q: string): ReactNode {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="dd-hl">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Client-side copy of the server's uniqueness messages, so typing gets instant feedback. */
function dutyNameProblem(dept: DepartmentDto, name: string, exceptId?: string): string | null {
  const n = normalizeCatalogName(name);
  if (!n) return 'Enter a name.';
  const clash = dept.duties.find(
    (u) => u.id !== exceptId && catalogNameKey(u.name) === catalogNameKey(n),
  );
  if (!clash) return null;
  return clash.archived
    ? `An archived duty “${clash.name}” exists in ${dept.name} — restore it instead.`
    : `“${clash.name}” already exists in ${dept.name}.`;
}

function deptNameProblem(depts: DepartmentDto[], name: string, exceptId?: string): string | null {
  const n = normalizeCatalogName(name);
  if (!n) return 'Enter a name.';
  const clash = depts.find(
    (d) => d.id !== exceptId && catalogNameKey(d.name) === catalogNameKey(n),
  );
  return clash
    ? `A department named “${clash.name}” already exists${clash.archived ? ' (archived)' : ''}.`
    : null;
}

export function DepartmentsPage() {
  const [depts, setDepts] = useState<DepartmentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [show, setShow] = useState<ShowFilter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Editing | null>(null);
  // How the open form started, so its button waits until something changes.
  const [editingFrom, setEditingFrom] = useState<string | null>(null);
  const [inlineErr, setInlineErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const { toast, showToast, clearToast } = useToast();
  const prefsLoaded = useRef(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      api.listDepartments(),
      api.getPreference('departments').catch(() => ({ state: null })),
    ])
      .then(([list, pref]) => {
        if (!alive) return;
        setDepts(list);
        const saved = (pref.state as { expanded?: string[] } | null)?.expanded;
        if (Array.isArray(saved)) setExpanded(new Set(saved));
        prefsLoaded.current = true;
      })
      .catch(
        (err) =>
          alive && setError(err instanceof ApiError ? err.message : 'Failed to load departments'),
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  // Expand / collapse state is remembered for each user.
  const persistExpanded = useCallback((next: Set<string>) => {
    setExpanded(next);
    if (prefsLoaded.current)
      void api.savePreference('departments', { expanded: [...next] }).catch(() => {});
  }, []);

  /** Run a catalog write; returns the fresh catalog, or null on failure. */
  async function run(
    work: () => Promise<DepartmentDto[]>,
    success: string,
  ): Promise<DepartmentDto[] | null> {
    setBusy(true);
    setInlineErr(null);
    try {
      const list = await work();
      setDepts(list);
      showToast(success, 'success');
      return list;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Something went wrong';
      if (editing) setInlineErr(msg);
      else showToast(msg, 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const query = q.trim().toLowerCase();
  const activeDepts = depts.filter((d) => !d.archived);
  const activeDuties = activeDepts.flatMap((d) => d.duties.filter((u) => !u.archived));

  const rows = useMemo(() => {
    const out: { dept: DepartmentDto; duties: DutyDto[]; open: boolean; matchedDept: boolean }[] =
      [];
    for (const d of depts) {
      let pool = d.duties.filter(
        (u) => status === 'all' || (status === 'active' ? !u.archived : u.archived),
      );
      if (show === 'nopeople') pool = pool.filter((u) => u.peopleCount === 0);
      if (show === 'tasks') pool = pool.filter((u) => u.openTaskCount > 0);
      const deptOk =
        status === 'all' || (status === 'active' ? !d.archived : d.archived || pool.length > 0);
      if (!deptOk) continue;
      if (show !== 'all' && pool.length === 0) continue;
      const matchedDept = !!query && d.name.toLowerCase().includes(query);
      let duties = pool;
      if (query && !matchedDept) {
        duties = pool.filter((u) =>
          `${u.name} ${u.description ?? ''}`.toLowerCase().includes(query),
        );
        if (duties.length === 0) continue;
      }
      const adding = editing?.kind === 'addDuty' && editing.deptId === d.id;
      out.push({ dept: d, duties, matchedDept, open: !!query || expanded.has(d.id) || adding });
    }
    return out;
  }, [depts, status, show, query, expanded, editing]);

  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persistExpanded(next);
  }

  /** Open a form (a new department or duty, or a rename) with nothing changed yet. */
  function begin(next: Editing) {
    setEditing(next);
    setEditingFrom(JSON.stringify(next));
  }
  const changed = editing !== null && JSON.stringify(editing) !== editingFrom;
  const unchangedTitle = changed ? undefined : 'Nothing has changed yet';

  function startAddDuty(deptId: string) {
    setInlineErr(null);
    begin({ kind: 'addDuty', deptId, name: '', desc: '' });
    if (!expanded.has(deptId)) persistExpanded(new Set([...expanded, deptId]));
  }

  async function saveEditing() {
    if (!editing || busy || !changed) return;
    if (editing.kind === 'newDept') {
      const problem = deptNameProblem(depts, editing.name);
      if (problem) return setInlineErr(problem);
      const name = normalizeCatalogName(editing.name);
      const list = await run(
        () => api.createDepartment({ name, color: editing.color }),
        `Department “${name}” created. Add its first duty.`,
      );
      if (list) {
        // Jump straight into adding the first duty.
        const created = list.find((d) => catalogNameKey(d.name) === catalogNameKey(name));
        if (created) {
          begin({ kind: 'addDuty', deptId: created.id, name: '', desc: '' });
          persistExpanded(new Set([...expanded, created.id]));
        } else setEditing(null);
      }
      return;
    }
    if (editing.kind === 'dept') {
      const problem = deptNameProblem(depts, editing.name, editing.id);
      if (problem) return setInlineErr(problem);
      const saved = await run(
        () =>
          api.updateDepartment(editing.id, {
            name: normalizeCatalogName(editing.name),
            color: editing.color,
          }),
        'Saved',
      );
      if (saved) setEditing(null);
      return;
    }
    const dept = depts.find((d) => d.id === editing.deptId)!;
    if (editing.kind === 'addDuty') {
      const problem = dutyNameProblem(dept, editing.name);
      if (problem) return setInlineErr(problem);
      const name = normalizeCatalogName(editing.name);
      const added = await run(
        () => api.createDuty(dept.id, { name, description: editing.desc.trim() || null }),
        `Added ${name} to ${dept.name}`,
      );
      // Stay in "add" mode for the next one.
      if (added) begin({ kind: 'addDuty', deptId: dept.id, name: '', desc: '' });
      return;
    }
    const problem = dutyNameProblem(dept, editing.name, editing.id);
    if (problem) return setInlineErr(problem);
    const ok = await run(
      () =>
        api.updateDuty(editing.id, {
          name: normalizeCatalogName(editing.name),
          description: editing.desc.trim() || null,
        }),
      'Saved',
    );
    if (ok) setEditing(null);
  }

  function cancelEditing() {
    setEditing(null);
    setInlineErr(null);
  }

  const keyHandlers = {
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void saveEditing();
      } else if (e.key === 'Escape') cancelEditing();
    },
  };

  async function doConfirm() {
    if (!confirm) return;
    const c = confirm;
    const done =
      c.kind === 'deleteDept'
        ? await run(
            () => api.deleteDepartment(c.dept.id),
            `Deleted ${c.dept.name} (it was never used)`,
          )
        : c.kind === 'archiveDept'
          ? await run(
              () => api.archiveDepartment(c.dept.id),
              `Archived ${c.dept.name} and its duties. They stay in history and reports.`,
            )
          : await run(
              () => api.deleteDuty(c.duty.id),
              `Deleted ${c.duty.name} (it was never used)`,
            );
    if (done) setConfirm(null);
  }

  const err = inlineErr ? <span className="dd-inline-err">{inlineErr}</span> : null;

  return (
    <div className="dd-page narrow">
      <div className="dd-page-head">
        <div>
          <div className="dd-crumbs">Manage</div>
          <h1>Departments &amp; Duties</h1>
          <div className="dd-page-sub">
            {plural(activeDepts.length, 'department', 'departments')} ·{' '}
            {plural(activeDuties.length, 'duty', 'duties')}
          </div>
        </div>
        <span className="spacer" />
        <button
          type="button"
          onClick={() => {
            setInlineErr(null);
            begin({
              kind: 'newDept',
              name: '',
              color:
                DEPARTMENT_COLORS[depts.length % DEPARTMENT_COLORS.length] ?? DEPARTMENT_COLORS[0],
            });
          }}
        >
          + New department
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="dd-toolbar">
        <div className="dd-search">
          <SearchIcon />
          <input
            placeholder="Search departments or duties…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search departments or duties"
          />
        </div>
        <div className="seg" role="group" aria-label="Status">
          {(
            [
              ['active', 'Active'],
              ['archived', 'Archived'],
              ['all', 'All'],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              className={`seg-btn${status === k ? ' active' : ''}`}
              aria-pressed={status === k}
              onClick={() => setStatus(k)}
            >
              {l}
            </button>
          ))}
        </div>
        <select
          value={show}
          onChange={(e) => setShow(e.target.value as ShowFilter)}
          aria-label="Show"
        >
          <option value="all">All duties</option>
          <option value="nopeople">Duties with no one assigned</option>
          <option value="tasks">Duties with open tasks</option>
        </select>
        <span className="spacer" />
        <button
          type="button"
          className="secondary btn-sm"
          onClick={() => persistExpanded(new Set(depts.map((d) => d.id)))}
        >
          Expand all
        </button>
        <button
          type="button"
          className="secondary btn-sm"
          onClick={() => {
            persistExpanded(new Set());
            if (editing?.kind === 'addDuty') setEditing(null);
          }}
        >
          Collapse all
        </button>
      </div>

      <div className="dd-tree dept-tree">
        <div className="dd-tree-head">
          <span style={{ width: 22 }} />
          <span>Department / Duty</span>
          <span className="spacer" />
          <span className="dd-col-people">People</span>
          <span className="dd-col-open">Open tasks</span>
          <span className="dd-col-actions" />
        </div>

        {editing?.kind === 'newDept' && (
          <div className="dd-row adding">
            <span className="dd-caret-sp" />
            <ColorPicker
              value={editing.color}
              onChange={(color) => setEditing({ ...editing, color })}
            />
            <input
              autoFocus
              style={{ width: 260 }}
              placeholder="Department name"
              value={editing.name}
              onChange={(e) => {
                setInlineErr(null);
                setEditing({ ...editing, name: e.target.value });
              }}
              aria-label="Department name"
              {...keyHandlers}
            />
            <button
              type="button"
              className="btn-sm"
              disabled={busy || !changed}
              title={unchangedTitle}
              onClick={() => void saveEditing()}
            >
              Create department
            </button>
            <button type="button" className="secondary btn-sm" onClick={cancelEditing}>
              Cancel
            </button>
            {err}
          </div>
        )}

        {loading ? (
          <div className="dd-empty">Loading…</div>
        ) : rows.length === 0 && editing?.kind !== 'newDept' ? (
          <div className="dd-empty">
            {depts.length === 0
              ? 'No departments yet. Create the first one to start adding duties.'
              : query
                ? `No departments or duties match “${q}”.`
                : 'Nothing matches these filters.'}
          </div>
        ) : (
          rows.map(({ dept: d, duties, open, matchedDept }) => {
            const nAct = d.duties.filter((u) => !u.archived).length;
            const editingThis = editing?.kind === 'dept' && editing.id === d.id;
            const adding = editing?.kind === 'addDuty' && editing.deptId === d.id ? editing : null;
            return (
              <Fragment key={d.id}>
                <div className={`dd-row dept${d.archived ? ' archived' : ''}`}>
                  <button
                    type="button"
                    className={`dd-caret${open ? ' open' : ''}`}
                    onClick={() => toggle(d.id)}
                    aria-expanded={open}
                    aria-label={`${open ? 'Collapse' : 'Expand'} ${d.name}`}
                  >
                    <CaretIcon />
                  </button>
                  {editingThis ? (
                    <>
                      <ColorPicker
                        value={editing.color}
                        onChange={(color) => setEditing({ ...editing, color })}
                      />
                      <input
                        autoFocus
                        style={{ width: 240 }}
                        value={editing.name}
                        onChange={(e) => {
                          setInlineErr(null);
                          setEditing({ ...editing, name: e.target.value });
                        }}
                        aria-label="Department name"
                        {...keyHandlers}
                      />
                      <button
                        type="button"
                        className="btn-sm"
                        disabled={busy || !changed}
                        title={unchangedTitle}
                        onClick={() => void saveEditing()}
                      >
                        Save
                      </button>
                      <button type="button" className="secondary btn-sm" onClick={cancelEditing}>
                        Cancel
                      </button>
                      {err}
                    </>
                  ) : (
                    <>
                      <Swatch color={d.color} />
                      <span className="dd-name">{highlight(d.name, query)}</span>
                    </>
                  )}
                  <span className="count-pill" title="Active duties">
                    {query && !matchedDept ? `${duties.length} of ${nAct}` : nAct}{' '}
                    {nAct === 1 ? 'duty' : 'duties'}
                  </span>
                  {!d.archived && !editingThis && (
                    <button
                      type="button"
                      className="dd-add-duty"
                      onClick={() => startAddDuty(d.id)}
                      title={`Add a duty to ${d.name}`}
                    >
                      + Duty
                    </button>
                  )}
                  {d.archived && <span className="dd-tag muted-tag">Archived</span>}
                  <span className="spacer" />
                  <span className="dd-meta">{plural(d.peopleCount, 'person', 'people')}</span>
                  {/* Keeps the people count under the People column (duty rows add Open tasks here). */}
                  <span className="dd-col-open" aria-hidden="true" />
                  <span className="dd-actions">
                    {d.archived ? (
                      <button
                        type="button"
                        className="dd-icon-btn"
                        onClick={() =>
                          void run(
                            () => api.restoreDepartment(d.id),
                            `Restored ${d.name}. Restore its duties one by one.`,
                          )
                        }
                      >
                        Restore
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="dd-icon-btn"
                          onClick={() => {
                            setInlineErr(null);
                            begin({ kind: 'dept', id: d.id, name: d.name, color: d.color });
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="dd-icon-btn danger-t"
                          onClick={() =>
                            setConfirm(
                              d.duties.length > 0
                                ? { kind: 'archiveDept', dept: d }
                                : { kind: 'deleteDept', dept: d },
                            )
                          }
                        >
                          {d.duties.length > 0 ? 'Archive' : 'Delete'}
                        </button>
                      </>
                    )}
                  </span>
                </div>

                {open && adding && (
                  <div className="dd-row duty adding">
                    <span className="dd-bullet" style={{ background: 'var(--accent)' }} />
                    <input
                      autoFocus
                      style={{ width: 230 }}
                      placeholder="New duty name"
                      value={adding.name}
                      onChange={(e) => {
                        setInlineErr(null);
                        setEditing({ ...adding, name: e.target.value });
                      }}
                      aria-label="New duty name"
                      {...keyHandlers}
                    />
                    <input
                      style={{ width: 260 }}
                      placeholder="Description (optional)"
                      value={adding.desc}
                      onChange={(e) => setEditing({ ...adding, desc: e.target.value })}
                      aria-label="Description"
                      {...keyHandlers}
                    />
                    <button
                      type="button"
                      className="btn-sm"
                      disabled={busy || !changed}
                      title={unchangedTitle}
                      onClick={() => void saveEditing()}
                    >
                      Add duty
                    </button>
                    <button type="button" className="secondary btn-sm" onClick={cancelEditing}>
                      Cancel
                    </button>
                    {err}
                  </div>
                )}

                {open && duties.length === 0 && !adding && (
                  <div className="dd-row duty">
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      No duties yet —{' '}
                      {d.archived ? (
                        'restore the department to add some'
                      ) : (
                        <button
                          type="button"
                          className="dd-link"
                          onClick={() => startAddDuty(d.id)}
                        >
                          add the first one
                        </button>
                      )}
                    </span>
                  </div>
                )}

                {open &&
                  duties.map((u) => {
                    const editingDuty =
                      editing?.kind === 'duty' && editing.id === u.id ? editing : null;
                    return (
                      <div key={u.id} className={`dd-row duty${u.archived ? ' archived' : ''}`}>
                        <span className="dd-bullet" style={{ background: d.color }} />
                        {editingDuty ? (
                          <>
                            <input
                              autoFocus
                              style={{ width: 240 }}
                              value={editingDuty.name}
                              onChange={(e) => {
                                setInlineErr(null);
                                setEditing({ ...editingDuty, name: e.target.value });
                              }}
                              aria-label="Duty name"
                              {...keyHandlers}
                            />
                            <input
                              style={{ width: 240 }}
                              placeholder="Description"
                              value={editingDuty.desc}
                              onChange={(e) => setEditing({ ...editingDuty, desc: e.target.value })}
                              aria-label="Description"
                              {...keyHandlers}
                            />
                            <button
                              type="button"
                              className="btn-sm"
                              disabled={busy || !changed}
                              title={unchangedTitle}
                              onClick={() => void saveEditing()}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="secondary btn-sm"
                              onClick={cancelEditing}
                            >
                              Cancel
                            </button>
                            {err}
                          </>
                        ) : (
                          <>
                            <span className="dd-name">{highlight(u.name, query)}</span>
                            <span className="dd-desc">{highlight(u.description ?? '', query)}</span>
                          </>
                        )}
                        {u.archived && <span className="dd-tag muted-tag">Archived</span>}
                        <span className="spacer" />
                        {u.peopleCount > 0 ? (
                          <Link
                            className="dd-meta"
                            to={`/admin/organization?view=duty&duty=${u.id}`}
                            title="See who holds this duty"
                          >
                            {plural(u.peopleCount, 'person', 'people')}
                          </Link>
                        ) : (
                          <span className="dd-tag warn" title="Nobody holds this duty yet">
                            No one assigned
                          </span>
                        )}
                        <span className="dd-meta dd-col-open">
                          {plural(u.openTaskCount, 'open task', 'open tasks')}
                        </span>
                        <span className="dd-actions">
                          {u.archived ? (
                            <button
                              type="button"
                              className="dd-icon-btn"
                              disabled={d.archived}
                              title={d.archived ? 'Restore the department first' : undefined}
                              onClick={() =>
                                void run(() => api.restoreDuty(u.id), `Restored ${u.name}`)
                              }
                            >
                              Restore
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="dd-icon-btn"
                                onClick={() => {
                                  setInlineErr(null);
                                  begin({
                                    kind: 'duty',
                                    id: u.id,
                                    deptId: d.id,
                                    name: u.name,
                                    desc: u.description ?? '',
                                  });
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="dd-icon-btn danger-t"
                                title={
                                  u.inUse
                                    ? 'In use — archiving hides it from pickers but keeps history'
                                    : 'Never used — can be deleted'
                                }
                                onClick={() =>
                                  u.inUse
                                    ? void run(
                                        () => api.archiveDuty(u.id),
                                        `Archived ${u.name}. It’s hidden from pickers but kept in history.`,
                                      )
                                    : setConfirm({ kind: 'deleteDuty', duty: u })
                                }
                              >
                                {u.inUse ? 'Archive' : 'Delete'}
                              </button>
                            </>
                          )}
                        </span>
                      </div>
                    );
                  })}
              </Fragment>
            );
          })
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title={
            confirm.kind === 'archiveDept'
              ? `Archive ${confirm.dept.name}?`
              : confirm.kind === 'deleteDept'
                ? `Delete ${confirm.dept.name}?`
                : `Delete ${confirm.duty.name}?`
          }
          message={
            confirm.kind === 'archiveDept'
              ? 'The department and all its duties disappear from pickers. They stay in history, reports and on existing tasks, and can be restored later.'
              : 'It has never been used, so it will be removed for good.'
          }
          confirmLabel={confirm.kind === 'archiveDept' ? 'Archive' : 'Delete'}
          tone={confirm.kind === 'archiveDept' ? 'warn' : 'danger'}
          busy={busy}
          onConfirm={() => void doConfirm()}
          onCancel={() => setConfirm(null)}
        />
      )}
      <Toast toast={toast} onClose={clearToast} />
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <span className="dd-swatches" role="radiogroup" aria-label="Color">
      {DEPARTMENT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          className={`dd-swatch-btn btn-plain${value === c ? ' on' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </span>
  );
}
