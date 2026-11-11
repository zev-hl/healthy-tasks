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
import {
  AlertTriangle,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  GitBranch,
  GripVertical,
  Network,
} from 'lucide-react';
import { Avatar } from '../components/ui/Avatar';
import { Swatch } from '../components/duties/DutyTag';
import { highlight } from './DepartmentsPage';
import { isStaleWriteError } from '../lib/useStaleWriteGuard';
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning';
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { SectionTabs } from '../components/SectionTabs';
import { Select, type SelectOption } from '../components/harbor/Select';
import { useToast as useHbToast } from '../components/harbor/Toast';
import {
  Btn,
  Card,
  CardHead,
  Empty,
  Pill,
  Segmented,
  cx,
  type Tone,
} from '../components/harbor/ui';

/** A small shim so the logic below keeps its `showToast(message, tone)` calls. */
function useShowToast() {
  const toast = useHbToast();
  return {
    showToast: (message: string, tone: 'success' | 'error' | 'info' = 'info', undo?: () => void) =>
      toast({
        message,
        undo,
        tone: tone === 'success' ? 'success' : tone === 'error' ? 'error' : 'dark',
      }),
  };
}

const ROLE_TONE: Record<string, Tone> = { Admin: 'blue', Manager: 'review', Member: 'grey' };

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
  const { showToast } = useShowToast();
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
      <button type="button" className="hb-org-name" onClick={() => setSelId(p.id)}>
        {highlight(pname(p), query)}
      </button>
      {p.title && <span className="hb-org-title">{p.title}</span>}
      {extra}
    </>
  );
  const dRow = (d: DepartmentDto, extra: ReactNode = null) => (
    <>
      <Swatch color={d.color} />
      <span className="hb-org-label is-dept">{highlight(d.name, query)}</span>
      {extra}
    </>
  );
  const uRow = (uId: string, extra: ReactNode = null) => {
    const u = dutyIndex.get(uId)!;
    return (
      <>
        <span className="hb-org-bullet" style={{ background: deptById.get(u.deptId)?.color }} />
        <span className="hb-org-label">{highlight(u.name, query)}</span>
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
                <span className="hb-org-chg mv">Moved</span>
              )}
              <span className="hb-grow" />
              {kids.length > 0 && <span className="hb-count">{kids.length} direct</span>}
              <span className="hb-org-chips">
                {ds.slice(0, 3).map((d) => (
                  <span key={d.id} className="hb-org-chip">
                    <Swatch color={d.color} size={7} />
                    {d.name}
                  </span>
                ))}
                {ds.length > 3 && <span className="hb-org-chip">+{ds.length - 3}</span>}
                {activeDutiesOf(p.id).length === 0 && (
                  <span className="hb-org-warn">No duties</span>
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
                <span className="hb-count">
                  {ppl.length} {ppl.length === 1 ? 'person' : 'people'}
                </span>
                {unstaffed > 0 && (
                  <span className="hb-org-warn">
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
                    <span className="hb-grow" />
                    <span className="hb-count">
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
                <span className="hb-grow" />
                {ds.length ? (
                  <span className="hb-count">
                    {ds.length} {ds.length === 1 ? 'dept' : 'depts'} · {n}{' '}
                    {n === 1 ? 'duty' : 'duties'}
                  </span>
                ) : (
                  <span className="hb-org-warn">No duties</span>
                )}
              </>,
            ),
            kids: ds.map((d) => {
              const us = activeDutiesOf(p.id)
                .filter((u) => dutyIndex.get(u)!.deptId === d.id)
                .sort((a, b) => dutyIndex.get(a)!.name.localeCompare(dutyIndex.get(b)!.name));
              return {
                key: `P${p.id}${d.id}`,
                html: dRow(d, <span className="hb-count">{us.length}</span>),
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
                  <span className="hb-grow" />
                  {ppl.length ? (
                    <span className="hb-count">
                      {ppl.length} {ppl.length === 1 ? 'person' : 'people'}
                    </span>
                  ) : (
                    <span className="hb-org-warn">No one assigned</span>
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
            <span className="hb-count">{d.duties.filter((u) => !u.archived).length} duties</span>,
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
      setError(null);
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
      } else setError(err instanceof ApiError ? err.message : 'Failed to save changes');
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
            className={cx(
              'hb-org-row',
              n.sel && 'is-sel',
              isDropTarget && (dropTarget!.ok ? 'drop-ok' : 'drop-bad'),
              dragId && dragId === n.pid && 'is-dragging',
            )}
            style={{ paddingLeft: 12 + lvl * 24 }}
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
                className={cx('hb-org-caret', open && 'is-open')}
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
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            ) : (
              <span className="hb-org-caret is-blank" aria-hidden="true" />
            )}
            {view === 'lines' &&
              (n.drag ? (
                <span className="hb-org-grip" title="Drag onto a new supervisor" aria-hidden="true">
                  <GripVertical size={15} />
                </span>
              ) : (
                <span className="hb-org-grip is-blank" aria-hidden="true" />
              ))}
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
        ? 'Supervisor › Subordinates. Drag a person by the handle onto their new supervisor, or into the box at the bottom to give them no supervisor.'
        : 'Supervisor › Subordinates. Drag a person by the handle onto their new supervisor within your team.',
    dept: 'Department › Person › the duties that person holds in that department',
    person: 'Person › Department › Duties',
    duty: 'Department › Duty › People who hold it',
  };

  const sel = selId ? P.get(selId) : null;
  const deptOptions: SelectOption<string>[] = [
    { value: '', label: 'All departments' },
    ...activeDepts.map((d) => ({ value: d.id, label: d.name, dot: d.color })),
  ];
  const changeText = [
    dirty.sup ? `${dirty.sup} supervisor ${dirty.sup === 1 ? 'change' : 'changes'}` : '',
    dirty.dut ? `${dirty.dut} duty ${dirty.dut === 1 ? 'change' : 'changes'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <PageHeader
        title="Organization"
        subtitle={
          <>
            {people.length} {people.length === 1 ? 'person' : 'people'}
            {org?.scope === 'all'
              ? ` · ${people.filter((p) => !draft.sup[p.id]).length} without a supervisor`
              : ' · you and your team'}
          </>
        }
        searchPlaceholder="Search people, departments, duties"
        searchLabel="Search"
        searchValue={q}
        onSearchChange={setQ}
        onSearch={() => undefined}
        newTask={false}
        tabs={
          <>
            <SectionTabs />
            <span className="hb-grow" />
            <Segmented
              small
              label="View"
              value={view}
              options={VIEWS.map(([value, label]) => ({ value, label }))}
              onChange={(k) => {
                setView(k);
                setExpanded(null);
              }}
            />
          </>
        }
      />
      <PageBody className={cx(dirty.any && 'hb-has-savebar')}>
        {error && (
          <div className="hb-alert" role="alert">
            {error}
          </div>
        )}

        <div className="hb-cols hb-org-cols">
          <div className="hb-col">
            <Card className="hb-org-tree">
              <CardHead
                icon={view === 'lines' ? <Network size={16} /> : <GitBranch size={16} />}
                title={VIEWS.find(([k]) => k === view)![1]}
                right={
                  <span className="hb-org-tools">
                    {view !== 'lines' && (
                      <Select
                        variant="chip"
                        label="Department"
                        value={deptFilter}
                        options={deptOptions}
                        active={deptFilter !== ''}
                        onChange={setDeptFilter}
                      />
                    )}
                    <Btn
                      kind="ghost"
                      className="hb-btn-sm"
                      onClick={() => setExpanded(new Set(allKeys(nodes)))}
                    >
                      <ChevronsUpDown size={15} aria-hidden="true" /> Expand all
                    </Btn>
                    <Btn kind="ghost" className="hb-btn-sm" onClick={() => setExpanded(new Set())}>
                      <ChevronsDownUp size={15} aria-hidden="true" /> Collapse all
                    </Btn>
                  </span>
                }
              />
              <p className="hb-org-hint">{HINT[view]}</p>
              <div className="hb-org-rows">
                {!org ? (
                  <Empty>Loading…</Empty>
                ) : nodes.length ? (
                  renderNodes(nodes, 0)
                ) : (
                  <Empty>{query ? `Nothing matches “${q}”.` : 'Nothing to show yet.'}</Empty>
                )}
              </div>
              {view === 'lines' && org?.scope === 'all' && (
                <div
                  className={cx(
                    'hb-org-dropzone',
                    dropTarget?.id === '__root' && dropTarget.ok && 'drop-ok',
                  )}
                  {...dropHandlers('__root')}
                >
                  Drop here to remove the supervisor (top level)
                </div>
              )}
            </Card>
          </div>

          <aside className="hb-col hb-org-side">
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
              <Card>
                <Empty>Select a person to see their supervisor and duties.</Empty>
              </Card>
            )}
          </aside>
        </div>
      </PageBody>

      {/* The one Save bar: changes are staged and saved together. */}
      {dirty.any && (
        <div className="hb-savebar" role="region" aria-label="Unsaved changes">
          <span className="hb-savebar-dot" aria-hidden="true" />
          <strong>Unsaved changes</strong>
          <span className="hb-savebar-what">{changeText}</span>
          {saveBlockedBy && (
            <span className="hb-savebar-err">
              Can’t save: a duty Alert Task Setup needs is being removed
            </span>
          )}
          <span className="hb-grow" />
          <button
            type="button"
            className="hb-savebar-discard"
            disabled={saving}
            onClick={() => {
              if (!org) return;
              const before = draft;
              setDraft(draftFrom(org));
              showToast('Changes discarded', 'info', () => setDraft(before));
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className="hb-savebar-save"
            disabled={saving || saveBlockedBy !== undefined}
            title={saveBlockedBy}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </>
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

  const supSelectOptions: SelectOption<string>[] = [
    ...(scope === 'all' || !sup ? [{ value: '', label: 'None (top level)' }] : []),
    ...(supOutside ? [{ value: sup!, label: '(outside your team)' }] : []),
    ...supOptions.map((x) => ({
      value: x.id,
      label: pname(x),
      hint: x.title ?? undefined,
      lead: <Avatar user={x} size="xs" decorative />,
    })),
  ];

  return (
    <Card className="hb-org-person">
      <section aria-label="Person details">
        <div className="hb-org-pp-head">
          <Avatar user={p} px={44} decorative />
          <div className="hb-stack">
            <span className="hb-org-pp-name">{pname(p)}</span>
            <span className="hb-org-pp-meta">
              <Pill tone={ROLE_TONE[p.role] ?? 'grey'}>{p.role}</Pill>
              {p.title && <span className="hb-sub">{p.title}</span>}
            </span>
          </div>
        </div>

        <div className="hb-org-sec">
          <span className="hb-org-sec-title">
            Supervisor {sup !== p.supervisorId && <span className="hb-org-chg mv">Changed</span>}
          </span>
          <Select
            label="Supervisor"
            value={sup ?? ''}
            disabled={!p.canChangeSupervisor}
            options={supSelectOptions}
            searchPlaceholder="Search people…"
            onChange={(v) => onSupervisor(v || null)}
          />
          <span className="hb-org-note">
            {p.canChangeSupervisor
              ? `Only Managers and Admins can supervise. ${p.firstName || 'This person'} and their ${below.size} subordinate(s) aren’t offered, to prevent loops.`
              : 'You can’t change this person’s supervisor.'}
          </span>
        </div>

        <div className="hb-org-sec">
          <span className="hb-org-sec-title">
            Direct reports <span className="hb-count">{reports.length}</span>
          </span>
          {reports.length ? (
            <div className="hb-org-reports">
              {reports.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="hb-org-report"
                  onClick={() => onSelect(r.id)}
                >
                  <Avatar user={r} px={20} decorative /> {pname(r)}
                </button>
              ))}
            </div>
          ) : (
            <span className="hb-small">None</span>
          )}
        </div>

        <div className="hb-org-sec">
          <span className="hb-org-sec-title">
            Departments &amp; duties{' '}
            <span className="hb-count is-accent">
              {nActive} {nActive === 1 ? 'duty' : 'duties'}
            </span>
          </span>
          {!p.canEditDuties && (
            <span className="hb-org-note">
              Only an Admin or someone above {p.firstName || 'this person'} can change these.
            </span>
          )}
          {depts.length === 0 && <span className="hb-small">No departments with duties yet.</span>}
          <div className="hb-org-depts">
            {depts.map((d) => {
              const us = d.duties.filter((u) => !u.archived).sort(byName);
              const n = us.filter((u) => mine.has(u.id)).length;
              const key = `${p.id}:${d.id}`;
              // Open by default when they held a duty here as SAVED — not the unsaved
              // draft, or ticking/unticking a box would open/collapse the section
              // under the cursor. Once clicked, the stored state wins.
              const open = pdOpen.get(key) ?? us.some((u) => had.has(u.id));
              return (
                <div key={d.id} className={cx('hb-org-dept', open && 'is-open')}>
                  <div className="hb-org-dept-head">
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
                      className="hb-org-dept-name"
                      onClick={() => onToggleDept(key, open)}
                    >
                      {d.name}
                    </button>
                    <span className="hb-count">
                      {n} / {us.length}
                    </span>
                    <button
                      type="button"
                      className={cx('hb-org-caret', open && 'is-open')}
                      onClick={() => onToggleDept(key, open)}
                      aria-label={`${open ? 'Collapse' : 'Expand'} ${d.name}`}
                      aria-expanded={open}
                    >
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                  {open && (
                    <div className="hb-org-duties">
                      {us.map((u) => {
                        const has = mine.has(u.id);
                        const was = had.has(u.id);
                        const openTasks = p.openTaskCountByDuty[u.id] ?? 0;
                        return (
                          <Fragment key={u.id}>
                            <div className="hb-org-duty">
                              <label>
                                <input
                                  type="checkbox"
                                  checked={has}
                                  disabled={!p.canEditDuties}
                                  onChange={(e) => setDuty(u.id, e.target.checked)}
                                />{' '}
                                {u.name}
                              </label>
                              {has && !was && <span className="hb-org-chg add">Added</span>}
                              {!has && was && <span className="hb-org-chg rem">Removed</span>}
                            </div>
                            {!has && openTasks > 0 && (
                              <div className="hb-org-dwarn">
                                <AlertTriangle size={14} aria-hidden="true" />
                                <span>
                                  {openTasks} open {openTasks === 1 ? 'task' : 'tasks'} assigned to{' '}
                                  {p.firstName || 'this person'} use
                                  {openTasks === 1 ? 's' : ''} this duty.{' '}
                                  {openTasks === 1 ? 'It' : 'They'} will be flagged.
                                </span>
                              </div>
                            )}
                            {!has &&
                              was &&
                              picksNeeding(p, u.id).map((k) => {
                                const type = EXCLUSIVES_ALERT_TYPE_LABELS[k.alertType];
                                return (
                                  <div
                                    key={`${k.alertType}:${k.role}`}
                                    className="hb-org-dwarn is-block"
                                  >
                                    <AlertTriangle size={14} aria-hidden="true" />
                                    <span>
                                      Alert Task Setup would show a warning on {pname(p)} as{' '}
                                      {k.role} for {type}. Set that role to “Leave unassigned” there
                                      first
                                      {scope === 'all' ? '' : ' (an Admin has to)'}, then remove the
                                      duty.
                                    </span>
                                  </div>
                                );
                              })}
                          </Fragment>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </Card>
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
