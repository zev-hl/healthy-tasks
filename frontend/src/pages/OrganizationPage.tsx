import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  EXCLUSIVES_ALERT_TYPE_LABELS,
  isSupervisorRole,
  type DepartmentDto,
  type OrgAlertTaskPickDto,
  type OrgDto,
  type OrgPersonDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { Avatar } from '../components/ui/Avatar';
import { Toast, useToast } from '../components/exclusives/Toast';
import { Swatch } from '../components/duties/DutyTag';
import { CaretIcon, SearchIcon } from '../components/duties/icons';
import { highlight } from './DepartmentsPage';
import { isStaleWriteError } from '../lib/useStaleWriteGuard';
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning';

/**
 * Organization (Department Duties): who reports to whom, and which duties each
 * person holds. Four views of the same data — Reporting lines (drag a person
 * onto their new supervisor), By department, By person, By duty — plus a
 * person panel. Changes are STAGED and saved together, because one wrong drop
 * moves a whole team and task access (Phase 13) follows the hierarchy. Admins
 * manage everyone; a Manager manages the people below them.
 */

type View = 'lines' | 'dept' | 'person' | 'duty';

interface TreeNode {
  key: string;
  html: ReactNode;
  pid?: string;
  drag?: boolean;
  sel?: boolean;
  kids: TreeNode[];
}

interface Draft {
  sup: Record<string, string | null>;
  duties: Record<string, Set<string>>;
}

const pname = (p: OrgPersonDto) => `${p.firstName} ${p.lastName}`.trim() || p.email;
const byP = (a: OrgPersonDto, b: OrgPersonDto) => pname(a).localeCompare(pname(b));
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

function draftFrom(org: OrgDto): Draft {
  return {
    sup: Object.fromEntries(org.people.map((p) => [p.id, p.supervisorId])),
    duties: Object.fromEntries(org.people.map((p) => [p.id, new Set(p.dutyIds)])),
  };
}

/** Everyone below `pid` under the given supervisor map. */
export function subtreeOf(pid: string, sup: Record<string, string | null>): Set<string> {
  const kids = new Map<string, string[]>();
  for (const [id, s] of Object.entries(sup)) if (s) kids.set(s, [...(kids.get(s) ?? []), id]);
  const out = new Set<string>();
  const stack = [...(kids.get(pid) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(kids.get(id) ?? []));
  }
  return out;
}

export function OrganizationPage() {
  const [params] = useSearchParams();
  const [org, setOrg] = useState<OrgDto | null>(null);
  const [departments, setDepartments] = useState<DepartmentDto[]>([]);
  const [draft, setDraft] = useState<Draft>({ sup: {}, duties: {} });
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>((params.get('view') as View) || 'lines');
  const [q, setQ] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const [selId, setSelId] = useState<string | null>(params.get('person'));
  const [pdOpen, setPdOpen] = useState<Map<string, boolean>>(new Map());
  const [dragId, setDragId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast, showToast, clearToast } = useToast();
  const deepLinked = useRef(false);

  async function load() {
    try {
      const [o, d] = await Promise.all([api.getOrg(), api.listDepartments()]);
      setOrg(o);
      setDepartments(d);
      setDraft(draftFrom(o));
      setError(null);
      setSelId((s) => s ?? o.people.find((p) => p.canEditDuties)?.id ?? o.people[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load the organization');
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const people = useMemo(() => org?.people ?? [], [org]);
  const P = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const dutyIndex = useMemo(() => {
    const m = new Map<string, { name: string; deptId: string; active: boolean }>();
    for (const d of departments)
      for (const u of d.duties)
        m.set(u.id, { name: u.name, deptId: d.id, active: !u.archived && !d.archived });
    return m;
  }, [departments]);
  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  const activeDepts = useMemo(
    () => departments.filter((d) => !d.archived).sort(byName),
    [departments],
  );

  // --- Dirty state -----------------------------------------------------------
  const dirty = useMemo(() => {
    let sup = 0;
    let dut = 0;
    for (const p of people) {
      if ((draft.sup[p.id] ?? null) !== p.supervisorId) sup++;
      const now = draft.duties[p.id] ?? new Set<string>();
      const was = new Set(p.dutyIds);
      for (const u of now) if (!was.has(u)) dut++;
      for (const u of was) if (!now.has(u)) dut++;
    }
    return { sup, dut, any: sup + dut > 0 };
  }, [people, draft]);
  useUnsavedChangesWarning(dirty.any);

  const activeDutiesOf = (pid: string) =>
    [...(draft.duties[pid] ?? [])].filter((u) => dutyIndex.get(u)?.active);
  const deptsOf = (pid: string) =>
    [...new Set(activeDutiesOf(pid).map((u) => dutyIndex.get(u)!.deptId))]
      .map((id) => deptById.get(id)!)
      .filter(Boolean)
      .sort(byName);
  const kidsOf = (pid: string) => people.filter((p) => draft.sup[p.id] === pid);

  // --- Tree nodes (one builder per view) --------------------------------------
  const query = q.trim().toLowerCase();
  const pm = (p: OrgPersonDto) =>
    !query ||
    pname(p).toLowerCase().includes(query) ||
    (p.title ?? '').toLowerCase().includes(query);
  const deptOk = (d: DepartmentDto) => !deptFilter || d.id === deptFilter;

  const pRow = (p: OrgPersonDto, extra: ReactNode = null) => (
    <>
      <Avatar user={p} size="xs" decorative />
      <button type="button" className="dd-pname btn-plain" onClick={() => setSelId(p.id)}>
        {highlight(pname(p), query)}
      </button>
      {p.title && <span className="dd-ptitle">{p.title}</span>}
      {extra}
    </>
  );
  const dRow = (d: DepartmentDto, extra: ReactNode = null) => (
    <>
      <Swatch color={d.color} />
      <span className="dd-name" style={{ fontWeight: 650 }}>
        {highlight(d.name, query)}
      </span>
      {extra}
    </>
  );
  const uRow = (uId: string, extra: ReactNode = null) => {
    const u = dutyIndex.get(uId)!;
    return (
      <>
        <span className="dd-bullet" style={{ background: deptById.get(u.deptId)?.color }} />
        <span className="dd-name">{highlight(u.name, query)}</span>
        {extra}
      </>
    );
  };

  const nodes: TreeNode[] = useMemo(() => {
    if (!org) return [];
    if (view === 'lines') {
      let keep: Set<string> | null = null;
      if (query) {
        keep = new Set();
        for (const p of people.filter(pm)) {
          let c: string | null = p.id;
          const seen = new Set<string>();
          while (c && !seen.has(c)) {
            seen.add(c);
            keep.add(c);
            c = draft.sup[c] ?? null;
          }
        }
      }
      const build = (p: OrgPersonDto): TreeNode => {
        const kids = kidsOf(p.id);
        const ds = deptsOf(p.id);
        return {
          key: `L${p.id}`,
          pid: p.id,
          drag: p.canChangeSupervisor,
          sel: selId === p.id,
          html: pRow(
            p,
            <>
              {(draft.sup[p.id] ?? null) !== p.supervisorId && (
                <span className="dd-chg mv">moved</span>
              )}
              <span className="spacer" />
              {kids.length > 0 && <span className="count-pill">{kids.length} direct</span>}
              <span className="dd-chips">
                {ds.slice(0, 3).map((d) => (
                  <span key={d.id} className="dd-chip">
                    <Swatch color={d.color} size={7} />
                    {d.name}
                  </span>
                ))}
                {ds.length > 3 && <span className="dd-chip">+{ds.length - 3}</span>}
                {activeDutiesOf(p.id).length === 0 && (
                  <span className="dd-tag warn">No duties</span>
                )}
              </span>
            </>,
          ),
          kids: kids
            .filter((c) => !keep || keep.has(c.id))
            .sort(byP)
            .map(build),
        };
      };
      // Roots: no supervisor, or a supervisor outside what this viewer can see.
      return people
        .filter((p) => (!draft.sup[p.id] || !P.has(draft.sup[p.id]!)) && (!keep || keep.has(p.id)))
        .sort(byP)
        .map(build);
    }
    if (view === 'dept') {
      return activeDepts
        .filter(deptOk)
        .map((d) => {
          const dm = !!query && d.name.toLowerCase().includes(query);
          const inDept = (pid: string) =>
            activeDutiesOf(pid).filter((u) => dutyIndex.get(u)!.deptId === d.id);
          const ppl = people
            .filter((p) => inDept(p.id).length > 0)
            .filter(
              (p) =>
                !query ||
                dm ||
                pm(p) ||
                inDept(p.id).some((u) => dutyIndex.get(u)!.name.toLowerCase().includes(query)),
            )
            .sort(byP);
          if (query && !dm && ppl.length === 0) return null;
          const unstaffed = d.duties.filter(
            (u) => !u.archived && !people.some((p) => draft.duties[p.id]?.has(u.id)),
          ).length;
          return {
            key: `D${d.id}`,
            html: dRow(
              d,
              <>
                <span className="count-pill">
                  {ppl.length} {ppl.length === 1 ? 'person' : 'people'}
                </span>
                {unstaffed > 0 && (
                  <span className="dd-tag warn">
                    {unstaffed} {unstaffed === 1 ? 'duty' : 'duties'} unassigned
                  </span>
                )}
              </>,
            ),
            kids: ppl.map((p) => {
              const us = inDept(p.id).sort((a, b) =>
                dutyIndex.get(a)!.name.localeCompare(dutyIndex.get(b)!.name),
              );
              return {
                key: `D${d.id}${p.id}`,
                pid: p.id,
                sel: selId === p.id,
                html: pRow(
                  p,
                  <>
                    <span className="spacer" />
                    <span className="count-pill">
                      {us.length} {us.length === 1 ? 'duty' : 'duties'}
                    </span>
                  </>,
                ),
                kids: us.map((u) => ({ key: `D${d.id}${p.id}${u}`, html: uRow(u), kids: [] })),
              };
            }),
          } as TreeNode;
        })
        .filter((n): n is TreeNode => n !== null);
    }
    if (view === 'person') {
      return people
        .filter(
          (p) =>
            !query ||
            pm(p) ||
            activeDutiesOf(p.id).some((u) => {
              const x = dutyIndex.get(u)!;
              return (
                x.name.toLowerCase().includes(query) ||
                (deptById.get(x.deptId)?.name ?? '').toLowerCase().includes(query)
              );
            }),
        )
        .filter((p) => !deptFilter || deptsOf(p.id).some((d) => d.id === deptFilter))
        .sort(byP)
        .map((p) => {
          const ds = deptsOf(p.id).filter(deptOk);
          const n = activeDutiesOf(p.id).length;
          return {
            key: `P${p.id}`,
            pid: p.id,
            sel: selId === p.id,
            html: pRow(
              p,
              <>
                <span className="spacer" />
                {ds.length ? (
                  <span className="count-pill">
                    {ds.length} {ds.length === 1 ? 'dept' : 'depts'} · {n}{' '}
                    {n === 1 ? 'duty' : 'duties'}
                  </span>
                ) : (
                  <span className="dd-tag warn">No duties</span>
                )}
              </>,
            ),
            kids: ds.map((d) => {
              const us = activeDutiesOf(p.id)
                .filter((u) => dutyIndex.get(u)!.deptId === d.id)
                .sort((a, b) => dutyIndex.get(a)!.name.localeCompare(dutyIndex.get(b)!.name));
              return {
                key: `P${p.id}${d.id}`,
                html: dRow(d, <span className="count-pill">{us.length}</span>),
                kids: us.map((u) => ({ key: `P${p.id}${u}`, html: uRow(u), kids: [] })),
              };
            }),
          };
        });
    }
    // By duty: Department › Duty › People who hold it.
    return activeDepts
      .filter(deptOk)
      .map((d) => {
        const dm = !!query && d.name.toLowerCase().includes(query);
        const us = d.duties
          .filter((u) => !u.archived)
          .sort(byName)
          .map((u) => {
            const ppl = people.filter((p) => draft.duties[p.id]?.has(u.id)).sort(byP);
            const um = u.name.toLowerCase().includes(query);
            if (query && !dm && !um && !ppl.some(pm)) return null;
            const shown = query && !dm && !um ? ppl.filter(pm) : ppl;
            return {
              key: `U${u.id}`,
              html: uRow(
                u.id,
                <>
                  <span className="spacer" />
                  {ppl.length ? (
                    <span className="count-pill">
                      {ppl.length} {ppl.length === 1 ? 'person' : 'people'}
                    </span>
                  ) : (
                    <span className="dd-tag warn">No one assigned</span>
                  )}
                </>,
              ),
              kids: shown.map((p) => ({
                key: `U${u.id}${p.id}`,
                pid: p.id,
                sel: selId === p.id,
                html: pRow(p),
                kids: [],
              })),
            } as TreeNode;
          })
          .filter((n): n is TreeNode => n !== null);
        if (query && !dm && us.length === 0) return null;
        return {
          key: `UD${d.id}`,
          html: dRow(
            d,
            <span className="count-pill">{d.duties.filter((u) => !u.archived).length} duties</span>,
          ),
          kids: us,
        } as TreeNode;
      })
      .filter((n): n is TreeNode => n !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, view, query, deptFilter, draft, selId, departments]);

  const allKeys = (ns: TreeNode[], out: string[] = []): string[] => {
    for (const n of ns) {
      if (n.kids.length) {
        out.push(n.key);
        allKeys(n.kids, out);
      }
    }
    return out;
  };

  // Default expansion: reporting lines open; other views closed. A deep link
  // (?view=duty&duty=…) opens that duty.
  useEffect(() => {
    if (!org || expanded !== null) return;
    if (!deepLinked.current && params.get('duty')) {
      deepLinked.current = true;
      const dutyId = params.get('duty')!;
      const u = dutyIndex.get(dutyId);
      if (u) {
        setDeptFilter(u.deptId);
        setExpanded(new Set([`UD${u.deptId}`, `U${dutyId}`]));
        return;
      }
    }
    setExpanded(new Set(view === 'lines' ? allKeys(nodes).filter((k) => k.startsWith('L')) : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, nodes, expanded, view]);

  // --- Drag & drop (reporting lines) ------------------------------------------
  const canDropOn = (target: string | '__root', subject: string | null): boolean => {
    if (!subject || !org) return false;
    if (target === '__root') return org.scope === 'all';
    if (target === subject) return false;
    const t = P.get(target);
    if (!t || !isSupervisorRole(t.role)) return false;
    return !subtreeOf(subject, draft.sup).has(target);
  };
  const [dropTarget, setDropTarget] = useState<{ id: string; ok: boolean } | null>(null);
  // Open the new supervisor's node and every manager above it, so a person who
  // was just moved stays visible in Reporting lines. The subject can't be an
  // ancestor of `sup` (cycle check), so the current draft chain is still right.
  function revealUnder(sup: string | null) {
    const keys: string[] = [];
    for (let id = sup, guard = 0; id && guard < 500; id = draft.sup[id] ?? null, guard++) {
      keys.push(`L${id}`);
    }
    if (keys.length) setExpanded((e) => new Set([...(e ?? []), ...keys]));
  }
  function moveTo(subject: string, target: string | '__root') {
    const p = P.get(subject)!;
    if (!canDropOn(target, subject)) {
      const t = target !== '__root' ? P.get(target) : null;
      showToast(
        t && !isSupervisorRole(t.role)
          ? `${t.firstName || 'That person'} is a ${t.role} and can’t supervise anyone`
          : `Can’t move ${p.firstName} under their own subordinate`,
        'error',
      );
      return;
    }
    const sup = target === '__root' ? null : target;
    setDraft((d) => ({ ...d, sup: { ...d.sup, [subject]: sup } }));
    setSelId(subject);
    revealUnder(sup);
    showToast(
      sup
        ? `${p.firstName} now reports to ${pname(P.get(sup)!)} (not saved yet)`
        : `${p.firstName} now has no supervisor (not saved yet)`,
      'info',
    );
  }
  const dropHandlers = (target: string | '__root') => ({
    onDragOver: (e: DragEvent) => {
      if (!dragId) return;
      const ok = canDropOn(target, dragId);
      if (ok) e.preventDefault();
      setDropTarget({ id: target, ok });
    },
    onDragLeave: () => setDropTarget((t) => (t?.id === target ? null : t)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (dragId) moveTo(dragId, target);
      setDragId(null);
      setDropTarget(null);
    },
  });

  // HLAI-112: a duty someone's Alert Task Setup role needs can't be taken away
  // here; that role is first set to "Leave unassigned" there. While one is
  // unticked, Save stays off (the server refuses it too).
  const neededRemoved = people.filter((p) =>
    p.dutyIds.some(
      (d) => !(draft.duties[p.id] ?? new Set()).has(d) && picksNeeding(p, d).length > 0,
    ),
  );
  const saveBlockedBy =
    neededRemoved.length > 0
      ? `${neededRemoved.map(pname).join(', ')} ${neededRemoved.length === 1 ? 'is' : 'are'} ` +
        'needed on Alert Task Setup for a duty being removed: see the ⚠ under it'
      : undefined;

  // --- Save / discard ------------------------------------------------------------
  async function save() {
    if (!org || saveBlockedBy) return;
    setSaving(true);
    try {
      const supervisorChanges = people
        .filter((p) => (draft.sup[p.id] ?? null) !== p.supervisorId)
        .map((p) => ({
          userId: p.id,
          supervisorId: draft.sup[p.id] ?? null,
          expectedSupervisorId: p.supervisorId,
        }));
      const dutyChanges = people
        .map((p) => {
          const now = draft.duties[p.id] ?? new Set<string>();
          const was = new Set(p.dutyIds);
          return {
            userId: p.id,
            add: [...now].filter((u) => !was.has(u)),
            remove: [...was].filter((u) => !now.has(u)),
          };
        })
        .filter((c) => c.add.length + c.remove.length > 0);
      const next = await api.saveOrg({ supervisorChanges, dutyChanges });
      setOrg(next);
      setDraft(draftFrom(next));
      const parts = [
        dirty.sup ? `${dirty.sup} supervisor ${dirty.sup === 1 ? 'change' : 'changes'}` : '',
        dirty.dut ? `${dirty.dut} duty ${dirty.dut === 1 ? 'change' : 'changes'}` : '',
      ].filter(Boolean);
      showToast(`Saved ${parts.join(' and ')}`, 'success');
    } catch (err) {
      if (isStaleWriteError(err)) {
        showToast(
          'Someone changed the organization while you were editing. Reloaded — please redo your changes.',
          'error',
        );
        await load();
      } else showToast(err instanceof ApiError ? err.message : 'Failed to save changes', 'error');
    } finally {
      setSaving(false);
    }
  }

  // --- Render ---------------------------------------------------------------------
  const exp = expanded ?? new Set<string>();
  const forceOpen = !!query;
  const renderNodes = (ns: TreeNode[], lvl: number): ReactNode =>
    ns.map((n) => {
      const has = n.kids.length > 0;
      const open = has && (forceOpen || exp.has(n.key));
      const isDropTarget = dropTarget && n.pid && dropTarget.id === n.pid && view === 'lines';
      return (
        <Fragment key={n.key}>
          <div
            className={`dd-row dd-org-row${n.sel ? ' sel' : ''}${isDropTarget ? (dropTarget!.ok ? ' drop-ok' : ' drop-bad') : ''}${dragId && dragId === n.pid ? ' dragging' : ''}`}
            style={{ paddingLeft: 14 + lvl * 26 }}
            draggable={view === 'lines' && n.drag ? true : undefined}
            onDragStart={
              view === 'lines' && n.drag
                ? (e) => {
                    setDragId(n.pid!);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', n.pid!);
                  }
                : undefined
            }
            onDragEnd={() => {
              setDragId(null);
              setDropTarget(null);
            }}
            {...(view === 'lines' && n.pid ? dropHandlers(n.pid) : {})}
          >
            {has ? (
              <button
                type="button"
                className={`dd-caret${open ? ' open' : ''}`}
                onClick={() =>
                  setExpanded((e) => {
                    const next = new Set(e ?? []);
                    if (next.has(n.key)) next.delete(n.key);
                    else next.add(n.key);
                    return next;
                  })
                }
                aria-expanded={open}
                aria-label={open ? 'Collapse' : 'Expand'}
              >
                <CaretIcon />
              </button>
            ) : (
              <span className="dd-caret-sp" />
            )}
            {view === 'lines' && n.drag && (
              <span className="dd-grip" title="Drag onto a new supervisor" aria-hidden="true">
                ⋮⋮
              </span>
            )}
            {n.html}
          </div>
          {open && renderNodes(n.kids, lvl + 1)}
        </Fragment>
      );
    });

  const VIEWS: [View, string][] = [
    ['lines', 'Reporting lines'],
    ['dept', 'By department'],
    ['person', 'By person'],
    ['duty', 'By duty'],
  ];
  const HINT: Record<View, string> = {
    lines:
      org?.scope === 'all'
        ? 'Supervisor › Subordinates. Drag a person (⋮⋮) onto their new supervisor, or into the box at the bottom to give them no supervisor.'
        : 'Supervisor › Subordinates. Drag a person (⋮⋮) onto their new supervisor within your team.',
    dept: 'Department › Person › the duties that person holds in that department',
    person: 'Person › Department › Duties',
    duty: 'Department › Duty › People who hold it',
  };

  const sel = selId ? P.get(selId) : null;

  return (
    <div className="dd-page">
      <div className="dd-page-head">
        <div>
          <div className="dd-crumbs">Manage</div>
          <h1>Organization</h1>
          <div className="dd-page-sub">
            {people.length} {people.length === 1 ? 'person' : 'people'}
            {org?.scope === 'all'
              ? ` · ${people.filter((p) => !draft.sup[p.id]).length} without a supervisor`
              : ' · you and your team'}
          </div>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="dd-toolbar">
        <div className="seg" role="group" aria-label="View">
          {VIEWS.map(([k, l]) => (
            <button
              key={k}
              type="button"
              className={`seg-btn${view === k ? ' active' : ''}`}
              aria-pressed={view === k}
              onClick={() => {
                setView(k);
                setExpanded(null);
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="dd-search org-search">
          <SearchIcon />
          <input
            placeholder="Search people, departments, duties…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
          />
        </div>
        {view !== 'lines' && (
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            aria-label="Department"
          >
            <option value="">All departments</option>
            {activeDepts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="secondary btn-sm"
          onClick={() => setExpanded(new Set(allKeys(nodes)))}
        >
          Expand all
        </button>
        <button type="button" className="secondary btn-sm" onClick={() => setExpanded(new Set())}>
          Collapse all
        </button>
      </div>

      <div className="dd-org-grid">
        <div className="dd-tree">
          <div className="dd-tree-head">
            <span>{HINT[view]}</span>
          </div>
          {!org ? (
            <div className="dd-empty">Loading…</div>
          ) : nodes.length ? (
            renderNodes(nodes, 0)
          ) : (
            <div className="dd-empty">
              {query ? `Nothing matches “${q}”.` : 'Nothing to show yet.'}
            </div>
          )}
          {view === 'lines' && org?.scope === 'all' && (
            <div
              className={`dd-dropzone${dropTarget?.id === '__root' && dropTarget.ok ? ' drop-ok' : ''}`}
              {...dropHandlers('__root')}
            >
              Drop here to remove the supervisor (top level)
            </div>
          )}
        </div>

        {sel ? (
          <PersonPanel
            person={sel}
            people={people}
            draft={draft}
            activeDepts={activeDepts}
            pdOpen={pdOpen}
            scope={org?.scope ?? 'team'}
            onToggleDept={(key, open) => setPdOpen((m) => new Map(m).set(key, !open))}
            onSelect={setSelId}
            onSupervisor={(sup) => {
              setDraft((d) => ({ ...d, sup: { ...d.sup, [sel.id]: sup } }));
              revealUnder(sup);
            }}
            onDuties={(next) =>
              setDraft((d) => ({ ...d, duties: { ...d.duties, [sel.id]: next } }))
            }
          />
        ) : (
          <div className="dd-panel" style={{ padding: 18 }}>
            <span className="muted">Select a person.</span>
          </div>
        )}
      </div>

      {dirty.any && (
        <div className="dd-savebar" role="status">
          <span className="dot" />
          <b>Unsaved changes</b>
          <span className="muted">
            {[
              dirty.sup ? `${dirty.sup} supervisor ${dirty.sup === 1 ? 'change' : 'changes'}` : '',
              dirty.dut ? `${dirty.dut} duty ${dirty.dut === 1 ? 'change' : 'changes'}` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="secondary btn-sm"
            disabled={saving}
            onClick={() => {
              if (org) setDraft(draftFrom(org));
              showToast('Changes discarded', 'info');
            }}
          >
            Discard
          </button>
          {saveBlockedBy && (
            <span className="dd-savebar-block">
              Can’t save: a duty Alert Task Setup needs is being removed
            </span>
          )}
          <button
            type="button"
            className="btn-sm"
            disabled={saving || saveBlockedBy !== undefined}
            title={saveBlockedBy}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
      <Toast toast={toast} onClose={clearToast} />
    </div>
  );
}

function PersonPanel({
  person: p,
  people,
  draft,
  activeDepts,
  pdOpen,
  scope,
  onToggleDept,
  onSelect,
  onSupervisor,
  onDuties,
}: {
  person: OrgPersonDto;
  people: OrgPersonDto[];
  draft: Draft;
  activeDepts: DepartmentDto[];
  pdOpen: Map<string, boolean>;
  scope: 'all' | 'team';
  onToggleDept: (key: string, open: boolean) => void;
  onSelect: (id: string) => void;
  onSupervisor: (sup: string | null) => void;
  onDuties: (next: Set<string>) => void;
}) {
  const below = subtreeOf(p.id, draft.sup);
  const sup = draft.sup[p.id] ?? null;
  const reports = people.filter((x) => draft.sup[x.id] === p.id).sort(byP);
  const mine = draft.duties[p.id] ?? new Set<string>();
  const had = new Set(p.dutyIds);
  const supOptions = people
    .filter((x) => x.id !== p.id && !below.has(x.id) && isSupervisorRole(x.role))
    .sort(byP);
  const supOutside = sup && !people.some((x) => x.id === sup);
  const depts = activeDepts.filter((d) => d.duties.some((u) => !u.archived));
  const nActive = [...mine].filter((u) =>
    depts.some((d) => d.duties.some((x) => x.id === u && !x.archived)),
  ).length;

  function setDuty(id: string, on: boolean) {
    const next = new Set(mine);
    if (on) next.add(id);
    else next.delete(id);
    onDuties(next);
  }

  return (
    <aside className="dd-panel" aria-label="Person details">
      <div className="dd-pp-head">
        <Avatar user={p} size="lg" decorative />
        <div>
          <div className="dd-pp-name">{pname(p)}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {[p.title, p.role].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>

      <div className="dd-pp-sec">
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="pp-sup">
            Supervisor {sup !== p.supervisorId && <span className="dd-chg mv">changed</span>}
          </label>
          <select
            id="pp-sup"
            value={sup ?? ''}
            disabled={!p.canChangeSupervisor}
            onChange={(e) => onSupervisor(e.target.value || null)}
          >
            {(scope === 'all' || !sup) && <option value="">— None (top level) —</option>}
            {supOutside && <option value={sup!}>(outside your team)</option>}
            {supOptions.map((x) => (
              <option key={x.id} value={x.id}>
                {pname(x)}
                {x.title ? ` — ${x.title}` : ''}
              </option>
            ))}
          </select>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
            {p.canChangeSupervisor
              ? `Only Managers and Admins can supervise. ${p.firstName || 'This person'} and their ${below.size} subordinate(s) aren’t offered, to prevent loops.`
              : 'You can’t change this person’s supervisor.'}
          </div>
        </div>
      </div>

      <div className="dd-pp-sec">
        <div className="dd-pp-title">
          <span className="u-label">Direct reports</span>
          <span className="count-pill">{reports.length}</span>
        </div>
        {reports.length ? (
          <div className="dd-chips">
            {reports.map((r) => (
              <button
                key={r.id}
                type="button"
                className="dd-chip btn-plain"
                onClick={() => onSelect(r.id)}
              >
                <Avatar user={r} px={18} decorative /> {pname(r)}
              </button>
            ))}
          </div>
        ) : (
          <span className="muted" style={{ fontSize: 12.5 }}>
            None
          </span>
        )}
      </div>

      <div className="dd-pp-sec">
        <div className="dd-pp-title">
          <span className="u-label">Departments &amp; duties</span>
          <span className="count-pill accent">
            {nActive} {nActive === 1 ? 'duty' : 'duties'}
          </span>
        </div>
        {!p.canEditDuties && (
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Only an Admin or someone above {p.firstName || 'this person'} can change these.
          </div>
        )}
        {depts.length === 0 && <div className="muted">No departments with duties yet.</div>}
        {depts.map((d) => {
          const us = d.duties.filter((u) => !u.archived).sort(byName);
          const n = us.filter((u) => mine.has(u.id)).length;
          const key = `${p.id}:${d.id}`;
          // Open by default when they held a duty here as SAVED — not the unsaved
          // draft, or ticking/unticking a box would open/collapse the section
          // under the cursor. Once clicked, the stored state wins.
          const open = pdOpen.get(key) ?? us.some((u) => had.has(u.id));
          return (
            <div key={d.id} className="dd-pd-dept">
              <div className="dd-pd-head">
                <TriCheckbox
                  checked={n === us.length}
                  indeterminate={n > 0 && n < us.length}
                  disabled={!p.canEditDuties}
                  label={`All ${d.name} duties`}
                  onChange={(on) => {
                    const next = new Set(mine);
                    for (const u of us) {
                      if (on) next.add(u.id);
                      else next.delete(u.id);
                    }
                    onDuties(next);
                  }}
                />
                <Swatch color={d.color} />
                <button
                  type="button"
                  className="dd-pd-name btn-plain"
                  onClick={() => onToggleDept(key, open)}
                >
                  {d.name}
                </button>
                <span className="count-pill">
                  {n} / {us.length}
                </span>
                <button
                  type="button"
                  className={`dd-caret${open ? ' open' : ''}`}
                  onClick={() => onToggleDept(key, open)}
                  aria-label={`${open ? 'Collapse' : 'Expand'} ${d.name}`}
                  aria-expanded={open}
                >
                  <CaretIcon />
                </button>
              </div>
              {open &&
                us.map((u) => {
                  const has = mine.has(u.id);
                  const was = had.has(u.id);
                  const open = p.openTaskCountByDuty[u.id] ?? 0;
                  return (
                    <Fragment key={u.id}>
                      <div className="dd-pd-duty">
                        <label>
                          <input
                            type="checkbox"
                            checked={has}
                            disabled={!p.canEditDuties}
                            onChange={(e) => setDuty(u.id, e.target.checked)}
                          />{' '}
                          {u.name}
                        </label>
                        {has && !was && <span className="dd-chg add">added</span>}
                        {!has && was && <span className="dd-chg rem">removed</span>}
                      </div>
                      {!has && open > 0 && (
                        <div className="dd-pd-warn">
                          ⚠ {open} open {open === 1 ? 'task' : 'tasks'} assigned to{' '}
                          {p.firstName || 'this person'} use
                          {open === 1 ? 's' : ''} this duty. {open === 1 ? 'It' : 'They'} will be
                          flagged.
                        </div>
                      )}
                      {!has &&
                        was &&
                        picksNeeding(p, u.id).map((k) => {
                          const type = EXCLUSIVES_ALERT_TYPE_LABELS[k.alertType];
                          return (
                            <div key={`${k.alertType}:${k.role}`} className="dd-pd-warn is-block">
                              ⚠ Alert Task Setup would show a warning on {pname(p)} as {k.role} for{' '}
                              {type}. Set that role to “Leave unassigned” there first
                              {scope === 'all' ? '' : ' (an Admin has to)'}, then remove the duty.
                            </div>
                          );
                        })}
                    </Fragment>
                  );
                })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function TriCheckbox({
  checked,
  indeterminate,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

/** The roles this person fills on Alert Task Setup that need this duty. */
function picksNeeding(p: OrgPersonDto, dutyId: string): OrgAlertTaskPickDto[] {
  return (p.alertTaskPicks ?? []).filter((k) => k.dutyIds.includes(dutyId));
}
