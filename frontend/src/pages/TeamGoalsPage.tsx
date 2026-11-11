import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Inbox, Plus } from 'lucide-react';
import type { ActiveUserDto, GoalDto, GoalStatus, GoalTeamFilters } from '@healthy-tasks/shared';
import { GOAL_STATUS_LABELS } from '@healthy-tasks/shared';
import { api, ApiError, exportTeamGoalsToExcel } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/ui/Avatar';
import { GoalPanel, type GoalAction } from '../components/goals/GoalPanel';
import { GoalForm } from '../components/goals/GoalForm';
import { GoalRows, HowGoalsWork, StageStrip } from '../components/goals/GoalList';
import { deadlineHint } from '../components/goals/goalUi';
import { formatDay } from '../lib/calendar';
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { Select, type SelectOption } from '../components/harbor/Select';
import { DatePicker } from '../components/harbor/DatePicker';
import { useToast } from '../components/harbor/Toast';
import { Btn, Card, CardHead, CountBadge, Empty } from '../components/harbor/ui';

/**
 * Team goals, Harbor redesign: what's waiting on you first (goals to approve,
 * results to review), then the lifecycle as a row of steps that filters the
 * list, then the goals as rows with their owner. Person and deadline filter
 * the list; a goal, a new goal and every action open in the side panel.
 */

type Side = { kind: 'goal'; goal: GoalDto; startWith: GoalAction | null } | { kind: 'new' } | null;

const ALL = '__all';

function userLabel(u: ActiveUserDto): string {
  const name = `${u.firstName} ${u.lastName}`.trim();
  return name || u.email;
}

export function TeamGoalsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [goals, setGoals] = useState<GoalDto[]>([]);
  const [reports, setReports] = useState<ActiveUserDto[]>([]);
  const [filters, setFilters] = useState<GoalTeamFilters>({});
  const [stage, setStage] = useState<GoalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The open goal is held directly rather than looked up in the filtered list:
  // an action (e.g. Approve) can move it out of the filters, and the panel
  // must not vanish under the person who just clicked.
  const [side, setSide] = useState<Side>(null);
  const [exporting, setExporting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const sideRef = useRef<HTMLElement>(null);

  async function handleExport() {
    setExporting(true);
    try {
      await exportTeamGoalsToExcel({ filters });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  // Phase 13: the person filter shows the supervisor's ENTIRE downline (Admin:
  // everyone), matching the broadened Team goals visibility. Creating a goal
  // "on behalf" is still limited to DIRECT reports (the backend enforces this),
  // so those are tracked separately. Both come from the scoped org hierarchy.
  const [directReports, setDirectReports] = useState<ActiveUserDto[]>([]);
  useEffect(() => {
    void api
      .getUserHierarchy()
      .then((tree) => {
        const all: ActiveUserDto[] = [];
        const walk = (nodes: typeof tree): void => {
          for (const n of nodes) {
            all.push(n.user);
            walk(n.children);
          }
        };
        walk(tree);
        if (user?.role === 'Admin') {
          setReports(all);
          setDirectReports(all);
        } else {
          setReports(all.filter((u) => u.id !== user?.id));
          const self = tree.find((n) => n.user.id === user?.id);
          setDirectReports(self ? self.children.map((c) => c.user) : []);
        }
      })
      .catch(() => {
        setReports([]);
        setDirectReports([]);
      });
  }, [user?.id, user?.role]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGoals(await api.listTeamGoals({ filters }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load team goals.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  function show(next: Side) {
    setSide(next);
    if (next && window.matchMedia?.('(max-width: 1359px)').matches)
      window.setTimeout(() => sideRef.current?.scrollIntoView({ block: 'start' }), 0);
  }
  const open = (g: GoalDto, startWith: GoalAction | null = null) =>
    show({ kind: 'goal', goal: g, startWith });

  async function approve(g: GoalDto) {
    setBusyId(g.id);
    try {
      const updated = await api.approveGoal(g.id, g.updatedAt);
      toast({ message: `Approved “${g.specific}”`, tone: 'success' });
      if (side?.kind === 'goal' && side.goal.id === g.id) open(updated);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve the goal.');
    } finally {
      setBusyId(null);
    }
  }

  const patch = (next: Partial<GoalTeamFilters>) => setFilters((f) => ({ ...f, ...next }));
  const personOptions: SelectOption<string>[] = useMemo(
    () => [
      { value: ALL, label: 'Everyone' },
      ...reports
        .map((r) => ({
          value: r.id,
          label: userLabel(r),
          lead: <Avatar user={r} size="xs" decorative />,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ],
    [reports],
  );
  const ownerId = filters.ownerIds?.length === 1 ? filters.ownerIds[0]! : ALL;
  const filtered =
    (filters.ownerIds?.length ?? 0) > 0 || !!filters.deadlineFrom || !!filters.deadlineTo;
  const createOwnerOptions = directReports.map((r) => ({ id: r.id, label: userLabel(r) }));

  const toApprove = goals.filter((g) => g.status === 'PendingApproval');
  const toReview = goals.filter((g) => g.status === 'UnderReview');
  const waiting = toApprove.length + toReview.length;
  const shown = stage ? goals.filter((g) => g.status === stage) : goals;
  const selectedId = side?.kind === 'goal' ? side.goal.id : null;
  const late = goals.filter((g) => deadlineHint(g).late).length;

  return (
    <>
      <PageHeader
        title="Team goals"
        subtitle={
          loading
            ? 'Loading…'
            : [
                `${goals.length} ${goals.length === 1 ? 'goal' : 'goals'} of the people you supervise`,
                waiting ? `${waiting} waiting on you` : '',
                late ? `${late} past the deadline` : '',
              ]
                .filter(Boolean)
                .join(' · ')
        }
        search={false}
        newTask={false}
        actions={
          <>
            <Btn disabled={exporting || goals.length === 0} onClick={() => void handleExport()}>
              <Download size={16} aria-hidden="true" /> {exporting ? 'Exporting…' : 'Export'}
            </Btn>
            {createOwnerOptions.length > 0 && (
              <Btn kind="primary" onClick={() => show({ kind: 'new' })}>
                <Plus size={16} aria-hidden="true" /> New goal
              </Btn>
            )}
          </>
        }
      />
      <PageBody>
        <div className="hb-toolbar">
          <Select
            variant="chip"
            label="Person"
            value={ownerId}
            options={personOptions}
            active={ownerId !== ALL}
            searchPlaceholder="Search people…"
            onChange={(v) => patch({ ownerIds: v === ALL ? [] : [v] })}
          />
          <DatePicker
            variant="chip"
            label="Deadline from"
            renderValue={(v) => (
              <>
                <span className="hb-chip-k">Due from</span> {v ? formatDay(v) : 'any date'}
              </>
            )}
            value={filters.deadlineFrom?.slice(0, 10) ?? null}
            onChange={(v) =>
              patch({ deadlineFrom: v ? new Date(`${v}T00:00:00.000Z`).toISOString() : null })
            }
          />
          <DatePicker
            variant="chip"
            label="Deadline to"
            renderValue={(v) => (
              <>
                <span className="hb-chip-k">Due by</span> {v ? formatDay(v) : 'any date'}
              </>
            )}
            value={filters.deadlineTo?.slice(0, 10) ?? null}
            onChange={(v) =>
              patch({ deadlineTo: v ? new Date(`${v}T23:59:59.999Z`).toISOString() : null })
            }
          />
          {filtered && (
            <Btn kind="link" onClick={() => setFilters({})}>
              Clear
            </Btn>
          )}
        </div>

        {error && (
          <div className="hb-alert" role="alert">
            {error}
          </div>
        )}

        <div className="hb-cols">
          <div className="hb-col">
            {loading && goals.length === 0 ? (
              <Card>
                <Empty>Loading…</Empty>
              </Card>
            ) : (
              <>
                {waiting > 0 && (
                  <Card>
                    <CardHead
                      icon={<Inbox size={16} aria-hidden="true" />}
                      tone="amber"
                      title="Waiting on you"
                      right={<CountBadge n={waiting} red />}
                    />
                    {toApprove.map((g) => (
                      <div key={g.id} className="hb-row hb-wrow">
                        <Avatar user={g.owner} px={28} decorative />
                        <div className="hb-stack">
                          <span className="hb-name">{g.specific}</span>
                          <span className="hb-sub">
                            {g.owner.firstName || g.owner.email} asks you to approve it
                          </span>
                        </div>
                        <Btn kind="ghost" className="hb-btn-sm" onClick={() => open(g, 'reject')}>
                          Send back…
                        </Btn>
                        <Btn
                          kind="ok"
                          className="hb-btn-sm"
                          disabled={busyId === g.id}
                          onClick={() => void approve(g)}
                        >
                          Approve
                        </Btn>
                      </div>
                    ))}
                    {toReview.map((g) => (
                      <div key={g.id} className="hb-row hb-wrow">
                        <Avatar user={g.owner} px={28} decorative />
                        <div className="hb-stack">
                          <span className="hb-name">{g.specific}</span>
                          <span className="hb-sub">
                            {g.owner.firstName || g.owner.email} marked results final
                          </span>
                        </div>
                        <Btn
                          kind="primary"
                          className="hb-btn-sm"
                          onClick={() => open(g, 'resolve')}
                        >
                          Review &amp; resolve
                        </Btn>
                      </div>
                    ))}
                  </Card>
                )}
                <StageStrip goals={goals} value={stage} onChange={setStage} />
                <GoalRows
                  title={stage ? GOAL_STATUS_LABELS[stage] : 'All team goals'}
                  goals={shown}
                  selectedId={selectedId}
                  showOwner
                  empty={
                    filtered || stage
                      ? 'No goals match these filters.'
                      : 'Goals for the people you supervise appear here once they’re created.'
                  }
                  onOpen={(g) => open(g)}
                />
              </>
            )}
          </div>

          <aside className="hb-col hb-gside" ref={sideRef}>
            {side?.kind === 'new' ? (
              <GoalForm
                ownerOptions={createOwnerOptions}
                onClose={() => setSide(null)}
                onSaved={(g) => {
                  toast({ message: 'Goal created as a draft', tone: 'success' });
                  open(g);
                  void load();
                }}
              />
            ) : side?.kind === 'goal' ? (
              <GoalPanel
                key={`${side.goal.id}:${side.startWith ?? ''}`}
                goal={side.goal}
                startWith={side.startWith}
                supervisorView
                onClose={() => setSide(null)}
                onChanged={(g) => {
                  if (!g) setSide(null);
                  void load();
                }}
              />
            ) : (
              <HowGoalsWork supervisor />
            )}
          </aside>
        </div>
      </PageBody>
    </>
  );
}
