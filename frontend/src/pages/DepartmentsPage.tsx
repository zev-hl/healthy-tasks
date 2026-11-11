import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Building2,
  Check,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  DEPARTMENT_COLORS,
  EXCLUSIVES_ALERT_TYPE_LABELS,
  catalogNameKey,
  normalizeCatalogName,
  type DepartmentDto,
  type DutyDto,
  type OrgDto,
  type OrgPersonDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Avatar } from '../components/ui/Avatar';
import { isStaleWriteError } from '../lib/useStaleWriteGuard';
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning';
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { Select, type SelectOption } from '../components/harbor/Select';
import { useToast } from '../components/harbor/Toast';
import { Btn, Card, Empty, Pill, cx } from '../components/harbor/ui';

/**
 * Departments & duties (Admin), Harbor redesign: two panes. The departments
 * are listed on the left; the one picked fills the right with its duties.
 *
 * - Structure saves at once: type a duty and press Enter (the field stays
 *   ready for the next), rename with the pencil, Archive once anything has
 *   used a row, Delete while nothing has. Every duty is unique within its
 *   department (ignoring case and extra spaces), checked as you type.
 * - People are staged: each duty shows who holds it, × takes it away and
 *   "Give to…" adds someone; the one Save bar saves them together (the same
 *   save as Organization, with its open-task and Alert Task Setup warnings).
 *
 * The picked department is remembered per user.
 */

type ShowFilter = 'all' | 'nopeople' | 'tasks';

type Editing =
  | { kind: 'newDept'; name: string; color: string }
  | { kind: 'dept'; id: string; name: string; color: string }
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
const pname = (p: OrgPersonDto) => `${p.firstName} ${p.lastName}`.trim() || p.email;

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
  const [showArchived, setShowArchived] = useState(false);
  const [show, setShow] = useState<ShowFilter>('all');
  const [selId, setSelId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  // How the open form started, so its button waits until something changes.
  const [editingFrom, setEditingFrom] = useState<string | null>(null);
  const [inlineErr, setInlineErr] = useState<string | null>(null);
  const [newDuty, setNewDuty] = useState('');
  const [addErr, setAddErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const toast = useToast();
  const showToast = (message: string, tone: 'success' | 'error' = 'success', undo?: () => void) =>
    toast({ message, tone, undo });
  const prefsLoaded = useRef(false);
  const addRef = useRef<HTMLInputElement>(null);

  // People who hold the duties (staged, saved with the Save bar).
  const [org, setOrg] = useState<OrgDto | null>(null);
  const [held, setHeld] = useState<Record<string, Set<string>>>({});
  const [savingPeople, setSavingPeople] = useState(false);

  const loadOrg = () =>
    api
      .getOrg()
      .then((o) => {
        setOrg(o);
        setHeld(Object.fromEntries(o.people.map((p) => [p.id, new Set(p.dutyIds)])));
      })
      .catch(() => setOrg(null));

  useEffect(() => {
    let alive = true;
    void Promise.all([
      api.listDepartments(),
      api.getPreference('departments').catch(() => ({ state: null })),
    ])
      .then(([list, pref]) => {
        if (!alive) return;
        setDepts(list);
        const saved = (pref.state as { selected?: string } | null)?.selected;
        const first = [...list].filter((d) => !d.archived).sort(byName)[0];
        setSelId(saved && list.some((d) => d.id === saved) ? saved : (first?.id ?? null));
        prefsLoaded.current = true;
      })
      .catch(
        (err) =>
          alive && setError(err instanceof ApiError ? err.message : 'Failed to load departments'),
      )
      .finally(() => alive && setLoading(false));
    void loadOrg();
    return () => {
      alive = false;
    };
  }, []);

  /** Pick a department; remembered for this user. */
  function pick(id: string) {
    setSelId(id);
    setEditing((e) => (e?.kind === 'newDept' ? e : null));
    setNewDuty('');
    setAddErr(null);
    if (prefsLoaded.current)
      void api.savePreference('departments', { selected: id }).catch(() => {});
  }

  /** Run a catalog write; returns the fresh catalog, or null on failure. */
  async function run(
    work: () => Promise<DepartmentDto[]>,
    success: string,
    undo?: () => void,
  ): Promise<DepartmentDto[] | null> {
    setBusy(true);
    setInlineErr(null);
    try {
      const list = await work();
      setDepts(list);
      showToast(success, 'success', undo);
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
  const people = useMemo(() => org?.people ?? [], [org]);
  const holdersOf = (dutyId: string) =>
    people.filter((p) => held[p.id]?.has(dutyId)).sort((a, b) => pname(a).localeCompare(pname(b)));
  const holderCount = (u: DutyDto) => (org ? holdersOf(u.id).length : u.peopleCount);

  const dutyMatches = (u: DutyDto) =>
    !query || `${u.name} ${u.description ?? ''}`.toLowerCase().includes(query);
  const dutyShown = (u: DutyDto) =>
    (showArchived || !u.archived) &&
    (show === 'all' ||
      (show === 'nopeople' ? holderCount(u) === 0 && !u.archived : u.openTaskCount > 0));

  // The left list: departments that match the search (by name or a duty).
  const list = depts
    .filter((d) => showArchived || !d.archived)
    .filter(
      (d) =>
        !query ||
        d.name.toLowerCase().includes(query) ||
        d.duties.some((u) => dutyShown(u) && dutyMatches(u)),
    )
    .sort(byName);
  const sel = depts.find((d) => d.id === selId) ?? null;
  const selMatchedByName = !!sel && !!query && sel.name.toLowerCase().includes(query);
  const selDuties = sel
    ? sel.duties.filter(dutyShown).filter((u) => selMatchedByName || dutyMatches(u))
    : [];
  const selActiveCount = sel ? sel.duties.filter((u) => !u.archived).length : 0;
  const selPeople = sel
    ? new Set(
        sel.duties.filter((u) => !u.archived).flatMap((u) => holdersOf(u.id).map((p) => p.id)),
      ).size
    : 0;

  // --- Forms (new department, rename, edit duty) ------------------------------
  function begin(next: Editing) {
    setInlineErr(null);
    setEditing(next);
    setEditingFrom(JSON.stringify(next));
  }
  const changed = editing !== null && JSON.stringify(editing) !== editingFrom;
  const unchangedTitle = changed ? undefined : 'Nothing has changed yet';

  async function saveEditing() {
    if (!editing || busy || !changed) return;
    if (editing.kind === 'newDept') {
      const problem = deptNameProblem(depts, editing.name);
      if (problem) return setInlineErr(problem);
      const name = normalizeCatalogName(editing.name);
      const fresh = await run(
        () => api.createDepartment({ name, color: editing.color }),
        `Department “${name}” created. Type its first duty.`,
      );
      if (fresh) {
        setEditing(null);
        // Straight into adding its first duty.
        const created = fresh.find((d) => catalogNameKey(d.name) === catalogNameKey(name));
        if (created) {
          pick(created.id);
          window.setTimeout(() => addRef.current?.focus(), 0);
        }
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
  const keys = {
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void saveEditing();
      } else if (e.key === 'Escape') cancelEditing();
    },
  };

  // --- Type a duty, press Enter --------------------------------------------------
  async function addDuty() {
    if (!sel || busy || !newDuty.trim()) return;
    const problem = dutyNameProblem(sel, newDuty);
    if (problem) return setAddErr(problem);
    const name = normalizeCatalogName(newDuty);
    setBusy(true);
    try {
      setDepts(await api.createDuty(sel.id, { name, description: null }));
      setNewDuty('');
      setAddErr(null);
      showToast(`Added ${name} to ${sel.name}`);
      addRef.current?.focus();
    } catch (err) {
      setAddErr(err instanceof ApiError ? err.message : 'Could not add the duty');
    } finally {
      setBusy(false);
    }
  }

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

  // --- People: staged, like Organization ----------------------------------------
  const pending = useMemo(() => {
    const out: { userId: string; add: string[]; remove: string[] }[] = [];
    for (const p of people) {
      const now = held[p.id] ?? new Set<string>();
      const was = new Set(p.dutyIds);
      const add = [...now].filter((u) => !was.has(u));
      const remove = [...was].filter((u) => !now.has(u));
      if (add.length + remove.length) out.push({ userId: p.id, add, remove });
    }
    return out;
  }, [people, held]);
  const nChanges = pending.reduce((s, c) => s + c.add.length + c.remove.length, 0);
  useUnsavedChangesWarning(nChanges > 0);
  const neededRemoved = people.filter((p) =>
    p.dutyIds.some((d) => !held[p.id]?.has(d) && picksNeeding(p, d).length > 0),
  );
  const saveBlockedBy =
    neededRemoved.length > 0
      ? `${neededRemoved.map(pname).join(', ')} ${neededRemoved.length === 1 ? 'is' : 'are'} ` +
        'needed on Alert Task Setup for a duty being taken away: see the warning under it'
      : undefined;

  function setHolder(pid: string, dutyId: string, on: boolean) {
    setHeld((h) => {
      const next = new Set(h[pid] ?? []);
      if (on) next.add(dutyId);
      else next.delete(dutyId);
      return { ...h, [pid]: next };
    });
  }
  async function savePeople() {
    if (saveBlockedBy || !nChanges) return;
    setSavingPeople(true);
    try {
      const next = await api.saveOrg({ dutyChanges: pending });
      setOrg(next);
      setHeld(Object.fromEntries(next.people.map((p) => [p.id, new Set(p.dutyIds)])));
      setDepts(await api.listDepartments());
      setError(null);
      showToast(`Saved ${plural(nChanges, 'change', 'changes')} to who holds what`);
    } catch (err) {
      if (isStaleWriteError(err)) {
        showToast(
          'Someone changed these while you were editing. Reloaded — please redo them.',
          'error',
        );
        await loadOrg();
      } else setError(err instanceof ApiError ? err.message : 'Failed to save changes');
    } finally {
      setSavingPeople(false);
    }
  }

  const giveOptions = (dutyId: string): SelectOption<string>[] =>
    people
      .filter((p) => p.canEditDuties && !held[p.id]?.has(dutyId))
      .sort((a, b) => pname(a).localeCompare(pname(b)))
      .map((p) => ({
        value: p.id,
        label: pname(p),
        hint: p.title ?? undefined,
        lead: <Avatar user={p} size="xs" decorative />,
      }));

  const showOptions: SelectOption<ShowFilter>[] = [
    { value: 'all', label: 'All duties' },
    { value: 'nopeople', label: 'No one assigned' },
    { value: 'tasks', label: 'With open tasks' },
  ];
  const err = inlineErr ? <span className="hb-dp-err">{inlineErr}</span> : null;

  // --- Render ---------------------------------------------------------------------
  const newDeptForm = editing?.kind === 'newDept' && (
    <div className="hb-dp-new">
      <input
        autoFocus
        className="hb-tpl-input"
        placeholder="Department name"
        value={editing.name}
        onChange={(e) => {
          setInlineErr(null);
          setEditing({ ...editing, name: e.target.value });
        }}
        aria-label="Department name"
        {...keys}
      />
      <ColorPicker value={editing.color} onChange={(color) => setEditing({ ...editing, color })} />
      <span className="hb-dp-actions">
        <Btn
          kind="primary"
          className="hb-btn-sm"
          disabled={busy || !changed}
          title={unchangedTitle}
          onClick={() => void saveEditing()}
        >
          Create department
        </Btn>
        <Btn kind="ghost" className="hb-btn-sm" onClick={cancelEditing}>
          Cancel
        </Btn>
      </span>
      {err}
    </div>
  );

  const dutyRow = (u: DutyDto) => {
    const editingDuty = editing?.kind === 'duty' && editing.id === u.id ? editing : null;
    const holders = holdersOf(u.id);
    const removed = people.filter((p) => p.dutyIds.includes(u.id) && !held[p.id]?.has(u.id));
    const give = u.archived ? [] : giveOptions(u.id);
    const count = holderCount(u);
    return (
      <div key={u.id} className={cx('hb-dp-duty', u.archived && 'is-archived')}>
        <div className="hb-dp-duty-main">
          {editingDuty ? (
            <div className="hb-dp-edit">
              <input
                autoFocus
                className="hb-tpl-input"
                value={editingDuty.name}
                onChange={(e) => {
                  setInlineErr(null);
                  setEditing({ ...editingDuty, name: e.target.value });
                }}
                aria-label="Duty name"
                {...keys}
              />
              <input
                className="hb-tpl-input"
                placeholder="Description (optional)"
                value={editingDuty.desc}
                onChange={(e) => setEditing({ ...editingDuty, desc: e.target.value })}
                aria-label="Description"
                {...keys}
              />
              <span className="hb-dp-actions">
                <Btn
                  kind="primary"
                  className="hb-btn-sm"
                  disabled={busy || !changed}
                  title={unchangedTitle}
                  onClick={() => void saveEditing()}
                >
                  Save
                </Btn>
                <Btn kind="ghost" className="hb-btn-sm" onClick={cancelEditing}>
                  Cancel
                </Btn>
              </span>
              {err}
            </div>
          ) : (
            <span className="hb-stack">
              <span className="hb-dp-duty-name">
                {highlight(u.name, query)}
                {u.archived && <Pill tone="grey">Archived</Pill>}
              </span>
              {u.description && <span className="hb-sub">{highlight(u.description, query)}</span>}
            </span>
          )}
          {!editingDuty && (
            <span className="hb-dp-meta">
              {u.openTaskCount > 0 && (
                <span className="hb-small">
                  {plural(u.openTaskCount, 'open task', 'open tasks')}
                </span>
              )}
              <span className="hb-dp-icons">
                {u.archived ? (
                  <button
                    type="button"
                    className="hb-icon-btn hb-icon-btn-sm"
                    aria-label="Restore"
                    title={sel?.archived ? 'Restore the department first' : 'Restore'}
                    disabled={sel?.archived}
                    onClick={() => void run(() => api.restoreDuty(u.id), `Restored ${u.name}`)}
                  >
                    <ArchiveRestore size={15} aria-hidden="true" />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="hb-icon-btn hb-icon-btn-sm"
                      aria-label="Edit"
                      title="Rename or describe"
                      onClick={() =>
                        begin({
                          kind: 'duty',
                          id: u.id,
                          deptId: u.departmentId,
                          name: u.name,
                          desc: u.description ?? '',
                        })
                      }
                    >
                      <Pencil size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="hb-icon-btn hb-icon-btn-sm hb-tpl-del"
                      aria-label={u.inUse ? 'Archive' : 'Delete'}
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
                              () => void run(() => api.restoreDuty(u.id), `Restored ${u.name}`),
                            )
                          : setConfirm({ kind: 'deleteDuty', duty: u })
                      }
                    >
                      {u.inUse ? (
                        <Archive size={15} aria-hidden="true" />
                      ) : (
                        <Trash2 size={15} aria-hidden="true" />
                      )}
                    </button>
                  </>
                )}
              </span>
            </span>
          )}
        </div>

        <div className="hb-dp-people">
          {org ? (
            <>
              {holders.map((p) => {
                const added = !p.dutyIds.includes(u.id);
                return (
                  <span key={p.id} className={cx('hb-dp-holder', added && 'is-added')}>
                    <Avatar user={p} px={22} decorative />
                    {pname(p)}
                    {p.canEditDuties && !u.archived && (
                      <button
                        type="button"
                        aria-label={`Take ${u.name} from ${pname(p)}`}
                        onClick={() => setHolder(p.id, u.id, false)}
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                );
              })}
              {removed.map((p) => (
                <span key={p.id} className="hb-dp-holder is-removed">
                  <Avatar user={p} px={22} decorative />
                  {pname(p)}
                  <button
                    type="button"
                    aria-label={`Keep ${u.name} with ${pname(p)}`}
                    title="Undo"
                    onClick={() => setHolder(p.id, u.id, true)}
                  >
                    <Check size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
              {holders.length === 0 && removed.length === 0 && !u.archived && (
                <Pill tone="amber">No one assigned</Pill>
              )}
              {give.length > 0 && (
                <Select
                  variant="plain"
                  className="hb-give"
                  label={`Give ${u.name} to`}
                  value={null}
                  placeholder="+ Give to…"
                  searchPlaceholder="Search people…"
                  options={give}
                  onChange={(pid) => setHolder(pid, u.id, true)}
                />
              )}
            </>
          ) : count > 0 ? (
            <span className="hb-small">{plural(count, 'person', 'people')}</span>
          ) : (
            !u.archived && <Pill tone="amber">No one assigned</Pill>
          )}
        </div>

        {removed.map((p) => {
          const open = p.openTaskCountByDuty[u.id] ?? 0;
          return (
            <div key={p.id}>
              {open > 0 && (
                <div className="hb-org-dwarn">
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span>
                    {plural(open, 'open task', 'open tasks')} assigned to {p.firstName || pname(p)}{' '}
                    use{open === 1 ? 's' : ''} this duty. {open === 1 ? 'It' : 'They'} will be
                    flagged.
                  </span>
                </div>
              )}
              {picksNeeding(p, u.id).map((k) => (
                <div key={`${k.alertType}:${k.role}`} className="hb-org-dwarn is-block">
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span>
                    Alert Task Setup would show a warning on {pname(p)} as {k.role} for{' '}
                    {EXCLUSIVES_ALERT_TYPE_LABELS[k.alertType]}. Set that role to “Leave unassigned”
                    there first, then take the duty away.
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="Departments & duties"
        subtitle={
          <>
            {plural(activeDepts.length, 'department', 'departments')} ·{' '}
            {plural(activeDuties.length, 'duty', 'duties')}
          </>
        }
        searchPlaceholder="Search departments or duties"
        searchLabel="Search departments or duties"
        searchValue={q}
        onSearchChange={setQ}
        onSearch={() => undefined}
        newTask={false}
        actions={
          <Btn
            kind="primary"
            onClick={() =>
              begin({
                kind: 'newDept',
                name: '',
                color:
                  DEPARTMENT_COLORS[depts.length % DEPARTMENT_COLORS.length] ??
                  DEPARTMENT_COLORS[0],
              })
            }
          >
            <Plus size={16} aria-hidden="true" /> New department
          </Btn>
        }
      />
      <PageBody className={cx(nChanges > 0 && 'hb-has-savebar')}>
        {error && (
          <div className="hb-alert" role="alert">
            {error}
          </div>
        )}
        <div className="hb-toolbar">
          <Select
            variant="chip"
            label="Show"
            value={show}
            options={showOptions}
            active={show !== 'all'}
            onChange={setShow}
          />
          <label className="hb-switch">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            <span className="hb-switch-track" aria-hidden="true" />
            Show archived
          </label>
        </div>

        <Card className="hb-dp">
          <nav className="hb-dp-list" aria-label="Departments">
            <div className="hb-dp-list-head">
              <span className="hb-label">Departments</span>
            </div>
            {newDeptForm}
            {loading ? (
              <Empty>Loading…</Empty>
            ) : list.length === 0 ? (
              <Empty>
                {depts.length === 0
                  ? 'No departments yet. Create the first one.'
                  : `No departments or duties match “${q}”.`}
              </Empty>
            ) : (
              list.map((d) => {
                const act = d.duties.filter((u) => !u.archived);
                const gaps = org ? act.filter((u) => holdersOf(u.id).length === 0).length : 0;
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={cx(
                      'hb-dp-item',
                      d.id === selId && 'is-sel',
                      d.archived && 'is-archived',
                    )}
                    aria-current={d.id === selId ? 'true' : undefined}
                    onClick={() => pick(d.id)}
                  >
                    <span className="hb-dp-sw" style={{ background: d.color }} aria-hidden="true" />
                    <span className="hb-stack">
                      <span className="hb-dp-item-name">{highlight(d.name, query)}</span>
                      <span className="hb-sub">
                        {d.archived ? 'Archived' : plural(act.length, 'duty', 'duties')}
                      </span>
                    </span>
                    {gaps > 0 && (
                      <span
                        className="hb-dp-gap"
                        title={`${plural(gaps, 'duty', 'duties')} no one holds`}
                      >
                        {gaps}
                      </span>
                    )}
                  </button>
                );
              })
            )}
            {!editing && (
              <button
                type="button"
                className="hb-dp-item hb-dp-additem"
                onClick={() =>
                  begin({
                    kind: 'newDept',
                    name: '',
                    color:
                      DEPARTMENT_COLORS[depts.length % DEPARTMENT_COLORS.length] ??
                      DEPARTMENT_COLORS[0],
                  })
                }
              >
                <Plus size={15} aria-hidden="true" /> New department
              </button>
            )}
          </nav>

          <section className="hb-dp-main" aria-label={sel ? sel.name : 'Department'}>
            {!sel ? (
              <div className="hb-dp-blank">
                <Building2 size={28} aria-hidden="true" />
                <strong>
                  {depts.length ? 'Pick a department' : 'Start with your first department'}
                </strong>
                <span>
                  {depts.length
                    ? 'Its duties, and who holds each one, show here.'
                    : 'A department groups the duties people hold. Name it, then type its duties one after another.'}
                </span>
              </div>
            ) : (
              <>
                <header className="hb-dp-head">
                  {editing?.kind === 'dept' && editing.id === sel.id ? (
                    <div className="hb-dp-edit">
                      <input
                        autoFocus
                        className="hb-tpl-input"
                        value={editing.name}
                        onChange={(e) => {
                          setInlineErr(null);
                          setEditing({ ...editing, name: e.target.value });
                        }}
                        aria-label="Department name"
                        {...keys}
                      />
                      <ColorPicker
                        value={editing.color}
                        onChange={(color) => setEditing({ ...editing, color })}
                      />
                      <span className="hb-dp-actions">
                        <Btn
                          kind="primary"
                          className="hb-btn-sm"
                          disabled={busy || !changed}
                          title={unchangedTitle}
                          onClick={() => void saveEditing()}
                        >
                          Save
                        </Btn>
                        <Btn kind="ghost" className="hb-btn-sm" onClick={cancelEditing}>
                          Cancel
                        </Btn>
                      </span>
                      {err}
                    </div>
                  ) : (
                    <>
                      <span
                        className="hb-dp-sw is-big"
                        style={{ background: sel.color }}
                        aria-hidden="true"
                      />
                      <div className="hb-stack">
                        <h2>
                          {sel.name} {sel.archived && <Pill tone="grey">Archived</Pill>}
                        </h2>
                        <span className="hb-sub">
                          {query && !selMatchedByName
                            ? `${selDuties.length} of ${plural(selActiveCount, 'duty', 'duties')}`
                            : plural(selActiveCount, 'duty', 'duties')}{' '}
                          · {plural(org ? selPeople : sel.peopleCount, 'person', 'people')}
                        </span>
                      </div>
                      <span className="hb-grow" />
                      {sel.archived ? (
                        <Btn
                          onClick={() =>
                            void run(
                              () => api.restoreDepartment(sel.id),
                              `Restored ${sel.name}. Restore its duties one by one.`,
                            )
                          }
                        >
                          <ArchiveRestore size={15} aria-hidden="true" /> Restore
                        </Btn>
                      ) : (
                        <span className="hb-dp-icons">
                          <button
                            type="button"
                            className="hb-icon-btn"
                            aria-label="Rename"
                            title="Rename or change color"
                            onClick={() =>
                              begin({ kind: 'dept', id: sel.id, name: sel.name, color: sel.color })
                            }
                          >
                            <Pencil size={16} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="hb-icon-btn hb-tpl-del"
                            aria-label={sel.duties.length > 0 ? 'Archive' : 'Delete'}
                            title={
                              sel.duties.length > 0
                                ? 'Archive the department and its duties'
                                : 'Delete (it has no duties)'
                            }
                            onClick={() =>
                              setConfirm(
                                sel.duties.length > 0
                                  ? { kind: 'archiveDept', dept: sel }
                                  : { kind: 'deleteDept', dept: sel },
                              )
                            }
                          >
                            {sel.duties.length > 0 ? (
                              <Archive size={16} aria-hidden="true" />
                            ) : (
                              <Trash2 size={16} aria-hidden="true" />
                            )}
                          </button>
                        </span>
                      )}
                    </>
                  )}
                </header>

                <div className="hb-dp-duties">
                  {selDuties.length === 0 ? (
                    <Empty>
                      {sel.duties.length === 0
                        ? 'No duties yet. Type the first one below and press Enter.'
                        : query
                          ? `No duties in ${sel.name} match “${q}”.`
                          : 'No duties match this filter.'}
                    </Empty>
                  ) : (
                    selDuties.map(dutyRow)
                  )}
                </div>

                {!sel.archived && (
                  <div className="hb-dp-add">
                    <Plus size={16} aria-hidden="true" />
                    <input
                      ref={addRef}
                      value={newDuty}
                      placeholder={`Add a duty to ${sel.name}…`}
                      aria-label="New duty name"
                      onChange={(e) => {
                        setNewDuty(e.target.value);
                        setAddErr(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void addDuty();
                        } else if (e.key === 'Escape') setNewDuty('');
                      }}
                    />
                    <span className="hb-kbd-light">Enter</span>
                    <Btn
                      kind="primary"
                      className="hb-btn-sm"
                      disabled={busy || !newDuty.trim()}
                      onClick={() => void addDuty()}
                    >
                      Add duty
                    </Btn>
                    {addErr && <span className="hb-dp-err">{addErr}</span>}
                  </div>
                )}
              </>
            )}
          </section>
        </Card>
      </PageBody>

      {/* The one Save bar, for who holds what. */}
      {nChanges > 0 && (
        <div className="hb-savebar" role="region" aria-label="Unsaved changes">
          <span className="hb-savebar-dot" aria-hidden="true" />
          <strong>Unsaved changes</strong>
          <span className="hb-savebar-what">
            {plural(nChanges, 'change', 'changes')} to who holds what
          </span>
          {saveBlockedBy && (
            <span className="hb-savebar-err">
              Can’t save: a duty Alert Task Setup needs is being taken away
            </span>
          )}
          <span className="hb-grow" />
          <button
            type="button"
            className="hb-savebar-discard"
            disabled={savingPeople}
            onClick={() => {
              const before = held;
              setHeld(Object.fromEntries(people.map((p) => [p.id, new Set(p.dutyIds)])));
              toast({ message: 'Changes discarded', undo: () => setHeld(before) });
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className="hb-savebar-save"
            disabled={savingPeople || saveBlockedBy !== undefined}
            title={saveBlockedBy}
            onClick={() => void savePeople()}
          >
            {savingPeople ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

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
    </>
  );
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** The roles this person fills on Alert Task Setup that need this duty. */
function picksNeeding(p: OrgPersonDto, dutyId: string) {
  return (p.alertTaskPicks ?? []).filter((k) => k.dutyIds.includes(dutyId));
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <span className="hb-dp-colors" role="radiogroup" aria-label="Color">
      {DEPARTMENT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          className={cx('hb-dp-color', value === c && 'is-on')}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </span>
  );
}
