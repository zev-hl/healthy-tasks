import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, ListTodo, Plus } from 'lucide-react';
import type { GoalDto, GoalStatus } from '@healthy-tasks/shared';
import { GOAL_STATUS_LABELS } from '@healthy-tasks/shared';
import { api, ApiError, exportMyGoalsToExcel } from '../api/client';
import { GoalPanel, type GoalAction } from '../components/goals/GoalPanel';
import { GoalForm } from '../components/goals/GoalForm';
import { GoalRows, HowGoalsWork, StageStrip } from '../components/goals/GoalList';
import { daysToDeadline, deadlineHint } from '../components/goals/goalUi';
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { useToast } from '../components/harbor/Toast';
import { Btn, Card, CardHead, CountBadge, Empty } from '../components/harbor/ui';

/**
 * My goals, Harbor redesign: what to do next first (drafts to submit, goals
 * sent back, results due), then the lifecycle as a row of steps that filters
 * the list, then the goals as rows. A goal, a new goal and an edit all open in
 * the side panel instead of a pop-up.
 */

type Side = { kind: 'goal'; goal: GoalDto; startWith: GoalAction | null } | { kind: 'new' } | null;

const RESULTS_SOON_DAYS = 14;

export function MyGoalsPage() {
  const toast = useToast();
  const [goals, setGoals] = useState<GoalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<GoalStatus | null>(null);
  const [side, setSide] = useState<Side>(null);
  const [exporting, setExporting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const sideRef = useRef<HTMLElement>(null);

  async function handleExport() {
    setExporting(true);
    try {
      await exportMyGoalsToExcel();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGoals(await api.listMyGoals());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your goals.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // On narrow screens the panel sits below the list: bring it into view.
  function show(next: Side) {
    setSide(next);
    if (next && window.matchMedia?.('(max-width: 1359px)').matches)
      window.setTimeout(() => sideRef.current?.scrollIntoView({ block: 'start' }), 0);
  }
  const open = (g: GoalDto, startWith: GoalAction | null = null) =>
    show({ kind: 'goal', goal: g, startWith });

  async function submit(g: GoalDto) {
    setBusyId(g.id);
    try {
      await api.submitGoal(g.id, g.updatedAt);
      toast({ message: `“${g.specific}” sent to your supervisor for approval`, tone: 'success' });
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit the goal.');
    } finally {
      setBusyId(null);
    }
  }

  // What needs doing next, most urgent first.
  const sentBack = goals.filter((g) => g.status === 'Draft' && g.rejectionComments);
  const drafts = goals.filter((g) => g.status === 'Draft' && !g.rejectionComments);
  const resultsDue = goals.filter(
    (g) => g.status === 'Approved' && daysToDeadline(g.deadline) <= RESULTS_SOON_DAYS,
  );
  const nextCount = sentBack.length + drafts.length + resultsDue.length;
  const shown = stage ? goals.filter((g) => g.status === stage) : goals;
  const selectedId = side?.kind === 'goal' ? side.goal.id : null;

  const active = goals.filter((g) => g.status === 'Approved').length;
  const waiting = goals.filter((g) => g.status === 'PendingApproval').length;

  return (
    <>
      <PageHeader
        title="My goals"
        subtitle={
          loading
            ? 'Loading…'
            : goals.length === 0
              ? 'No goals yet'
              : [
                  `${goals.length} ${goals.length === 1 ? 'goal' : 'goals'}`,
                  active ? `${active} active` : '',
                  waiting ? `${waiting} waiting for approval` : '',
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
            <Btn kind="primary" onClick={() => show({ kind: 'new' })}>
              <Plus size={16} aria-hidden="true" /> New goal
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

        <div className="hb-cols">
          <div className="hb-col">
            {loading ? (
              <Card>
                <Empty>Loading…</Empty>
              </Card>
            ) : goals.length === 0 ? (
              <Card>
                <div className="hb-tpl-empty">
                  <strong>No goals yet</strong>
                  <span>
                    Set a SMART goal for yourself: what you’ll achieve, how much, and by when. Your
                    supervisor approves it before it becomes active.
                  </span>
                  <Btn kind="primary" onClick={() => show({ kind: 'new' })}>
                    <Plus size={16} aria-hidden="true" /> New goal
                  </Btn>
                </div>
              </Card>
            ) : (
              <>
                {nextCount > 0 && (
                  <Card>
                    <CardHead
                      icon={<ListTodo size={16} aria-hidden="true" />}
                      tone="amber"
                      title="Your next steps"
                      right={<CountBadge n={nextCount} red />}
                    />
                    {sentBack.map((g) => (
                      <div key={g.id} className="hb-row hb-wrow">
                        <div className="hb-stack">
                          <span className="hb-name">{g.specific}</span>
                          <span className="hb-sub late">Sent back: {g.rejectionComments}</span>
                        </div>
                        <Btn className="hb-btn-sm" onClick={() => open(g)}>
                          Fix and resubmit
                        </Btn>
                      </div>
                    ))}
                    {drafts.map((g) => (
                      <div key={g.id} className="hb-row hb-wrow">
                        <div className="hb-stack">
                          <span className="hb-name">{g.specific}</span>
                          <span className="hb-sub">Draft · your supervisor hasn’t seen it yet</span>
                        </div>
                        <Btn kind="ghost" className="hb-btn-sm" onClick={() => open(g)}>
                          Open
                        </Btn>
                        <Btn
                          kind="primary"
                          className="hb-btn-sm"
                          disabled={busyId === g.id}
                          onClick={() => void submit(g)}
                        >
                          Submit for approval
                        </Btn>
                      </div>
                    ))}
                    {resultsDue.map((g) => {
                      const d = deadlineHint(g);
                      return (
                        <div key={g.id} className="hb-row hb-wrow">
                          <div className="hb-stack">
                            <span className="hb-name">{g.specific}</span>
                            <span className={d.late ? 'hb-sub late' : 'hb-sub'}>
                              Results due · deadline {d.text}
                            </span>
                          </div>
                          <Btn className="hb-btn-sm" onClick={() => open(g, 'progress')}>
                            Update results
                          </Btn>
                        </div>
                      );
                    })}
                  </Card>
                )}
                <StageStrip goals={goals} value={stage} onChange={setStage} />
                <GoalRows
                  title={stage ? GOAL_STATUS_LABELS[stage] : 'All my goals'}
                  goals={shown}
                  selectedId={selectedId}
                  empty="No goals at this stage."
                  onOpen={(g) => open(g)}
                />
              </>
            )}
          </div>

          <aside className="hb-col hb-gside" ref={sideRef}>
            {side?.kind === 'new' ? (
              <GoalForm
                onClose={() => setSide(null)}
                onSaved={(g) => {
                  toast({ message: 'Goal created as a draft', tone: 'success' });
                  open(g);
                  void load();
                }}
              />
            ) : side?.kind === 'goal' ? (
              <GoalPanel
                key={side.goal.id}
                goal={side.goal}
                startWith={side.startWith}
                supervisorView={false}
                onClose={() => setSide(null)}
                onChanged={(g) => {
                  if (!g) setSide(null);
                  void load();
                }}
              />
            ) : (
              <HowGoalsWork />
            )}
          </aside>
        </div>
      </PageBody>
    </>
  );
}
