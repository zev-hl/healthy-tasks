import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronRight, GripVertical, Network, UserRoundX } from 'lucide-react';
import {
  EXCLUSIVES_ALERT_TYPE_LABELS,
  isSupervisorRole,
  type DepartmentDto,
  type OrgAlertTaskPickDto,
  type OrgDto,
  type OrgPersonDto,
  type Role,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { Avatar } from '../components/ui/Avatar';
import { Swatch } from '../components/duties/DutyTag';
import { isStaleWriteError } from '../lib/useStaleWriteGuard';
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning';
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { Select, type SelectOption } from '../components/harbor/Select';
import { useToast as useHbToast } from '../components/harbor/Toast';
import {
  Btn,
  Card,
  CardHead,
  CountBadge,
  Empty,
  Pill,
  cx,
  type Tone,
} from '../components/harbor/ui';

/**
 * Organization (Department Duties), Harbor redesign after the Dashboard's
 * My team view (brief §6.1): the structure of the company. What needs your
 * attention comes first (no duties, no supervisor, duties no one holds, each
 * with its fix), then the reporting lines as sections of people cards
 * ("Reports to Maria Lopez"). Drag a card onto a supervisor's card or section
 * to move it; click a card for the person panel (supervisor, reports, duties).
 * Departments and their duties are managed in Settings › Departments & duties.
 *
 * Changes are STAGED and saved together with the one Save bar, because one
 * wrong drop moves a whole team and task access (Phase 13) follows the
 * hierarchy. Admins manage everyone; a Manager manages the people below them.
 */

interface Draft {
  sup: Record<string, string | null>;
  duties: Record<string, Set<string>>;
}

const ALL = '__all';
const ROLE_TONE: Record<string, Tone> = { Admin: 'blue', Manager: 'review', Member: 'grey' };

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

export function OrganizationPage() {
  const [params] = useSearchParams();
  const [org, setOrg] = useState<OrgDto | null>(null);
  const [departments, setDepartments] = useState<DepartmentDto[]>([]);
  const [draft, setDraft] = useState<Draft>({ sup: {}, duties: {} });
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [deptFilter, setDeptFilter] = useState(ALL);
  const [roleFilter, setRoleFilter] = useState(ALL);
  const [selId, setSelId] = useState<string | null>(params.get('person'));
  const [pdOpen, setPdOpen] = useState<Map<string, boolean>>(new Map());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const { showToast } = useShowToast();
  const panelRef = useRef<HTMLElement>(null);

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
  const kidsOf = (pid: string) => people.filter((p) => draft.sup[p.id] === pid).sort(byP);
  const dutyChanged = (p: OrgPersonDto) => {
    const now = draft.duties[p.id] ?? new Set<string>();
    return now.size !== p.dutyIds.length || p.dutyIds.some((u) => !now.has(u));
  };

  // --- What needs attention ----------------------------------------------------
  const noDuties = people.filter((p) => activeDutiesOf(p.id).length === 0).sort(byP);
  // The person at the very top (an Admin) is expected to have no supervisor.
  const noSupervisor =
    org?.scope === 'all'
      ? people.filter((p) => !draft.sup[p.id] && p.role !== 'Admin').sort(byP)
      : [];
  const unheld = activeDepts.flatMap((d) =>
    d.duties
      .filter((u) => !u.archived && !people.some((p) => draft.duties[p.id]?.has(u.id)))
      .map((u) => ({ dept: d, duty: u })),
  );
  const peopleFlags = noDuties.length + noSupervisor.length;

  // --- Filters -----------------------------------------------------------------
  const query = q.trim().toLowerCase();
  const matches = (p: OrgPersonDto) =>
    (!query ||
      pname(p).toLowerCase().includes(query) ||
      (p.title ?? '').toLowerCase().includes(query) ||
      activeDutiesOf(p.id).some((u) => dutyIndex.get(u)!.name.toLowerCase().includes(query))) &&
    (deptFilter === ALL || deptsOf(p.id).some((d) => d.id === deptFilter)) &&
    (roleFilter === ALL || p.role === roleFilter);
  const filtered = query !== '' || deptFilter !== ALL || roleFilter !== ALL;
  const shownCount = people.filter(matches).length;

  // --- Reporting-line sections: who reports to whom, top down ------------------
  const sections = useMemo(() => {
    if (!org) return [];
    const roots = people.filter((p) => !draft.sup[p.id] || !P.has(draft.sup[p.id]!)).sort(byP);
    const out: {
      key: string;
      sup: OrgPersonDto | null;
      members: OrgPersonDto[];
      chain: string[];
    }[] = [{ key: '__root', sup: null, members: roots, chain: [] }];
    const queue = [...roots];
    const seen = new Set<string>();
    while (queue.length) {
      const s = queue.shift()!;
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      const kids = kidsOf(s.id);
      if (!kids.length) continue;
      const chain: string[] = [];
      for (let id = draft.sup[s.id] ?? null, g = 0; id && P.has(id) && g < 50; g++) {
        chain.unshift(pname(P.get(id)!));
        id = draft.sup[id] ?? null;
      }
      out.push({ key: s.id, sup: s, members: kids, chain });
      queue.push(...kids);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, people, draft]);

  // --- Drag & drop (reporting lines) ------------------------------------------
  const canDropOn = (target: string | '__root', subject: string | null): boolean => {
    if (!subject || !org) return false;
    if (target === '__root') return org.scope === 'all';
    if (target === subject) return false;
    const t = P.get(target);
    if (!t || !isSupervisorRole(t.role)) return false;
    return !subtreeOf(subject, draft.sup).has(target);
  };
  function moveTo(subject: string, target: string | '__root') {
    const p = P.get(subject)!;
    if ((draft.sup[subject] ?? null) === (target === '__root' ? null : target)) return;
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
    const before = draft.sup[subject] ?? null;
    const sup = target === '__root' ? null : target;
    setDraft((d) => ({ ...d, sup: { ...d.sup, [subject]: sup } }));
    setSelId(subject);
    showToast(
      sup
        ? `${p.firstName} now reports to ${pname(P.get(sup)!)} (not saved yet)`
        : `${p.firstName} now has no supervisor (not saved yet)`,
      'info',
      () => setDraft((d) => ({ ...d, sup: { ...d.sup, [subject]: before } })),
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
  const dropClass = (target: string) =>
    dragId && dropTarget?.id === target ? (dropTarget.ok ? 'drop-ok' : 'drop-bad') : null;

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

  // Pick a person and bring their panel into view (on narrow screens it is below).
  function openPerson(id: string) {
    setSelId(id);
    if (window.matchMedia?.('(max-width: 1099px)').matches)
      window.setTimeout(() => panelRef.current?.scrollIntoView({ block: 'start' }), 0);
  }
  function giveDuty(pid: string, dutyId: string) {
    const p = P.get(pid);
    if (!p) return;
    setDraft((d) => ({
      ...d,
      duties: { ...d.duties, [pid]: new Set([...(d.duties[pid] ?? []), dutyId]) },
    }));
    showToast(
      `${p.firstName || pname(p)} now holds ${dutyIndex.get(dutyId)?.name ?? 'the duty'} (not saved yet)`,
      'info',
      () =>
        setDraft((d) => {
          const next = new Set(d.duties[pid] ?? []);
          next.delete(dutyId);
          return { ...d, duties: { ...d.duties, [pid]: next } };
        }),
    );
  }

  // --- Render pieces ------------------------------------------------------------
  const sel = selId ? P.get(selId) : null;
  const deptOptions: SelectOption<string>[] = [
    { value: ALL, label: 'All departments' },
    ...activeDepts.map((d) => ({ value: d.id, label: d.name, dot: d.color })),
  ];
  const roleOptions: SelectOption<string>[] = [
    { value: ALL, label: 'Any role' },
    ...(['Admin', 'Manager', 'Member'] as Role[]).map((r) => ({ value: r, label: r })),
  ];
  const changeText = [
    dirty.sup ? `${dirty.sup} supervisor ${dirty.sup === 1 ? 'change' : 'changes'}` : '',
    dirty.dut ? `${dirty.dut} duty ${dirty.dut === 1 ? 'change' : 'changes'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const giveOptions = (dutyId: string): SelectOption<string>[] =>
    people
      .filter((p) => p.canEditDuties && !draft.duties[p.id]?.has(dutyId))
      .sort(byP)
      .map((p) => ({
        value: p.id,
        label: pname(p),
        hint: p.title ?? undefined,
        lead: <Avatar user={p} size="xs" decorative />,
      }));

  const personCard = (p: OrgPersonDto) => {
    const ds = deptsOf(p.id);
    const nDuties = activeDutiesOf(p.id).length;
    const reports = kidsOf(p.id).length;
    const moved = (draft.sup[p.id] ?? null) !== p.supervisorId;
    const canLead = isSupervisorRole(p.role);
    return (
      <div
        key={p.id}
        className={cx(
          'hb-ocard',
          selId === p.id && 'is-sel',
          nDuties === 0 && 'is-flag',
          dragId === p.id && 'is-dragging',
          canLead && dropClass(p.id),
        )}
        draggable={p.canChangeSupervisor || undefined}
        onDragStart={
          p.canChangeSupervisor
            ? (e) => {
                setDragId(p.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', p.id);
              }
            : undefined
        }
        onDragEnd={() => {
          setDragId(null);
          setDropTarget(null);
        }}
        {...(canLead ? dropHandlers(p.id) : {})}
      >
        <button
          type="button"
          className="hb-ocard-main"
          aria-pressed={selId === p.id}
          aria-label={`${pname(p)}, ${p.role}`}
          onClick={() => openPerson(p.id)}
        >
          <span className="hb-ocard-top">
            <Avatar user={p} px={36} decorative />
            <span className="hb-stack">
              <span className="hb-ocard-name">{pname(p)}</span>
              <span className="hb-sub">{p.title || p.email}</span>
            </span>
          </span>
          <span className="hb-ocard-depts">
            {ds.slice(0, 3).map((d) => (
              <span key={d.id} className="hb-org-chip">
                <Swatch color={d.color} size={7} />
                {d.name}
              </span>
            ))}
            {ds.length > 3 && <span className="hb-org-chip">+{ds.length - 3}</span>}
          </span>
          <span className="hb-ocard-stats">
            <span className="stat">
              <b>{nDuties}</b>
              <span>{nDuties === 1 ? 'duty' : 'duties'}</span>
            </span>
            {canLead && (
              <span className="stat">
                <b>{reports}</b>
                <span>{reports === 1 ? 'report' : 'reports'}</span>
              </span>
            )}
            <span className="hb-grow" />
            <Pill tone={ROLE_TONE[p.role] ?? 'grey'}>{p.role}</Pill>
          </span>
          {(nDuties === 0 || moved || dutyChanged(p)) && (
            <span className="hb-ocard-flags">
              {nDuties === 0 && <Pill tone="amber">No duties yet</Pill>}
              {moved && <Pill tone="blue">Moved · not saved</Pill>}
              {dutyChanged(p) && <Pill tone="blue">Duties changed · not saved</Pill>}
            </span>
          )}
        </button>
        {p.canChangeSupervisor && (
          <span className="hb-ocard-grip" title="Drag onto a new supervisor" aria-hidden="true">
            <GripVertical size={15} />
          </span>
        )}
      </div>
    );
  };

  // All clear is one quiet line; anything to fix gets the full card.
  const attention =
    peopleFlags + unheld.length === 0 ? (
      <div className="hb-attn-ok" role="status">
        <Empty good>Everyone has a supervisor and duties, and every duty has someone.</Empty>
      </div>
    ) : (
      <Card className="hb-attn">
        <CardHead
          icon={<AlertTriangle size={16} aria-hidden="true" />}
          tone="amber"
          title="Needs your attention"
          right={<span className="hb-small">{peopleFlags + unheld.length} to sort out</span>}
        />
        <div className="hb-attn-grid">
          {noDuties.length > 0 && (
            <div className="hb-attn-col">
              <span className="hb-attn-title">
                No duties yet <CountBadge n={noDuties.length} red />
              </span>
              {noDuties.slice(0, 5).map((p) => (
                <div key={p.id} className="hb-attn-row">
                  <Avatar user={p} size="xs" decorative />
                  <span className="hb-attn-name">{pname(p)}</span>
                  {p.canEditDuties && (
                    <Btn kind="link" className="hb-btn-sm" onClick={() => openPerson(p.id)}>
                      Choose duties
                    </Btn>
                  )}
                </div>
              ))}
              {noDuties.length > 5 && (
                <span className="hb-small">and {noDuties.length - 5} more</span>
              )}
            </div>
          )}
          {noSupervisor.length > 0 && (
            <div className="hb-attn-col">
              <span className="hb-attn-title">
                No supervisor <CountBadge n={noSupervisor.length} red />
              </span>
              {noSupervisor.slice(0, 5).map((p) => (
                <div key={p.id} className="hb-attn-row">
                  <Avatar user={p} size="xs" decorative />
                  <span className="hb-attn-name">{pname(p)}</span>
                  {p.canChangeSupervisor && (
                    <Btn kind="link" className="hb-btn-sm" onClick={() => openPerson(p.id)}>
                      Choose supervisor
                    </Btn>
                  )}
                </div>
              ))}
            </div>
          )}
          {unheld.length > 0 && (
            <div className="hb-attn-col">
              <span className="hb-attn-title">
                Duties no one holds <CountBadge n={unheld.length} red />
              </span>
              {unheld.slice(0, 5).map(({ dept, duty }) => (
                <div key={duty.id} className="hb-attn-row">
                  <Swatch color={dept.color} />
                  <span className="hb-attn-name">
                    <span className="hb-sub">{dept.name} › </span>
                    {duty.name}
                  </span>
                  {giveOptions(duty.id).length > 0 && (
                    <Select
                      variant="plain"
                      className="hb-give"
                      label={`Give ${duty.name} to`}
                      value={null}
                      placeholder="Give to…"
                      searchPlaceholder="Search people…"
                      options={giveOptions(duty.id)}
                      onChange={(pid) => giveDuty(pid, duty.id)}
                    />
                  )}
                </div>
              ))}
              {unheld.length > 5 && <span className="hb-small">and {unheld.length - 5} more</span>}
            </div>
          )}
        </div>
      </Card>
    );

  const peopleView = (
    <>
      {sections.map((s) => {
        const members = s.members.filter(matches);
        if (!members.length && (filtered || s.key !== '__root')) return null;
        const isRoot = s.key === '__root';
        const target = isRoot ? '__root' : s.key;
        const canDrop = isRoot ? org?.scope === 'all' : true;
        return (
          <section
            key={s.key}
            className={cx('hb-osec', canDrop && dropClass(target))}
            {...(canDrop ? dropHandlers(target) : {})}
          >
            <div className="hb-osec-head">
              {isRoot ? (
                <span className="hb-ic tone-grey" aria-hidden="true">
                  <Network size={15} />
                </span>
              ) : (
                <Avatar user={s.sup!} px={28} decorative />
              )}
              <div className="hb-stack">
                <h2>
                  {isRoot
                    ? org?.scope === 'all'
                      ? 'Top level'
                      : 'You'
                    : `Reports to ${pname(s.sup!)}`}
                </h2>
                {!isRoot && s.chain.length > 0 && (
                  <span className="hb-sub">
                    {s.chain.join(' › ')} › {pname(s.sup!)}
                  </span>
                )}
                {isRoot && org?.scope === 'all' && (
                  <span className="hb-sub">No supervisor · drop someone here to clear theirs</span>
                )}
              </div>
              <span className="hb-count">{members.length}</span>
            </div>
            <div className="hb-ogrid">{members.map(personCard)}</div>
          </section>
        );
      })}
      {filtered && shownCount === 0 && <Empty>No one matches these filters.</Empty>}
    </>
  );

  return (
    <>
      <PageHeader
        title="Organization"
        subtitle={
          <>
            {people.length} {people.length === 1 ? 'person' : 'people'} · {activeDepts.length}{' '}
            {activeDepts.length === 1 ? 'department' : 'departments'}
            {org?.scope === 'team' && ' · you and your team'}
          </>
        }
        searchPlaceholder="Search people, titles, duties"
        searchLabel="Search"
        searchValue={q}
        onSearchChange={setQ}
        onSearch={() => undefined}
        newTask={false}
      />
      <PageBody className={cx(dirty.any && 'hb-has-savebar')}>
        {error && (
          <div className="hb-alert" role="alert">
            {error}
          </div>
        )}

        <div className="hb-toolbar">
          <span className="hb-count-label">
            {`${filtered ? `${shownCount} of ` : ''}${people.length} ${people.length === 1 ? 'person' : 'people'}`}
          </span>
          <Select
            variant="chip"
            label="Department"
            value={deptFilter}
            options={deptOptions}
            active={deptFilter !== ALL}
            onChange={setDeptFilter}
          />
          <Select
            variant="chip"
            label="Role"
            value={roleFilter}
            options={roleOptions}
            active={roleFilter !== ALL}
            onChange={setRoleFilter}
          />
          {filtered && (
            <Btn
              kind="link"
              onClick={() => {
                setQ('');
                setDeptFilter(ALL);
                setRoleFilter(ALL);
              }}
            >
              Reset
            </Btn>
          )}
          <span className="hb-grow" />
          <span className="hb-small hb-org-tip">
            <GripVertical size={14} aria-hidden="true" /> Drag a card onto a supervisor to move it
          </span>
        </div>

        <div className="hb-cols hb-org-cols">
          <div className="hb-col">
            {!org ? (
              <Card>
                <Empty>Loading…</Empty>
              </Card>
            ) : (
              <>
                {attention}
                {peopleView}
              </>
            )}
          </div>

          <aside className="hb-col hb-org-side" ref={panelRef}>
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
                onSupervisor={(sup) =>
                  setDraft((d) => ({ ...d, sup: { ...d.sup, [sel.id]: sup } }))
                }
                onDuties={(next) =>
                  setDraft((d) => ({ ...d, duties: { ...d.duties, [sel.id]: next } }))
                }
              />
            ) : (
              <Card>
                <Empty>
                  <UserRoundX size={16} aria-hidden="true" /> Pick a person to see their supervisor
                  and duties.
                </Empty>
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
