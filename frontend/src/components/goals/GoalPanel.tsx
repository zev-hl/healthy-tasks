import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { GoalDto, GoalResolution, GoalStatus } from '@healthy-tasks/shared';
import {
  GOAL_RESOLUTIONS,
  GOAL_RESOLUTION_LABELS,
  GOAL_STATUSES,
  GOAL_STATUS_LABELS,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useStaleWriteGuard } from '../../lib/useStaleWriteGuard';
import { ConflictBanner } from '../ConflictBanner';
import { Avatar, userLabel } from '../ui/Avatar';
import { GoalStatusPill, deadlineHint, formatGoalValue, formatDeadline } from './goalUi';
import { GoalForm } from './GoalForm';
import { confirmDiscard, useUnsavedChangesWarning } from '../../lib/useUnsavedChangesWarning';
import { Btn, Card, cx } from '../harbor/ui';
import { Select } from '../harbor/Select';

export type GoalAction = 'progress' | 'reject' | 'resolve';

interface Props {
  goal: GoalDto;
  /** True on Team goals — surfaces supervisor actions (approve/resolve). */
  supervisorView: boolean;
  /** Open straight into one of the action forms (from a "Waiting on you" row). */
  startWith?: GoalAction | null;
  onClose: () => void;
  /** Called with the updated goal after any action (null when deleted). */
  onChanged: (goal: GoalDto | null) => void;
}

/**
 * One goal, in the page's side panel: what it is, where it is in its
 * lifecycle, and the one or two things that can happen next. Actions that
 * need words (results, a reason for sending back, the resolution) open in
 * place below, never as a pop-up.
 */
export function GoalPanel({ goal: initial, supervisorView, startWith, onClose, onChanged }: Props) {
  const { user } = useAuth();
  const [goal, setGoal] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<GoalAction | null>(startWith ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Progress / reject / resolve field state.
  const [resultValue, setResultValue] = useState(
    goal.resultValue != null ? String(goal.resultValue) : '',
  );
  const [notes, setNotes] = useState(goal.notes ?? '');
  const [risks, setRisks] = useState(goal.risks ?? '');
  const [mitigations, setMitigations] = useState(goal.mitigations ?? '');
  const [rejectComments, setRejectComments] = useState('');
  const [resolution, setResolution] = useState<GoalResolution>('Met');
  const [supervisorComments, setSupervisorComments] = useState('');

  const { conflict, bannerShown, guard, review, reset } = useStaleWriteGuard();

  // Unsaved-work guard for the open action form: while it holds typed changes,
  // its Cancel, closing the goal and leaving the page all ask first.
  const panelDirty =
    panel === 'progress'
      ? resultValue !== (goal.resultValue != null ? String(goal.resultValue) : '') ||
        notes !== (goal.notes ?? '') ||
        risks !== (goal.risks ?? '') ||
        mitigations !== (goal.mitigations ?? '')
      : panel === 'reject'
        ? rejectComments.trim() !== ''
        : panel === 'resolve'
          ? supervisorComments.trim() !== '' || resolution !== 'Met'
          : false;
  useUnsavedChangesWarning(panelDirty && !busy);
  const close = () => {
    if (confirmDiscard(panelDirty)) onClose();
  };
  const cancelPanel = () => {
    if (confirmDiscard(panelDirty)) setPanel(null);
  };

  // Sync the editable fields (results/notes/risks/mitigations) to a goal.
  function syncPanelFields(g: GoalDto) {
    setResultValue(g.resultValue != null ? String(g.resultValue) : '');
    setNotes(g.notes ?? '');
    setRisks(g.risks ?? '');
    setMitigations(g.mitigations ?? '');
  }

  // Re-fetch fresh on open: the goal object came from the (possibly stale) list.
  useEffect(() => {
    let cancelled = false;
    setGoal(initial);
    setPanel(startWith ?? null);
    void api
      .getGoal(initial.id)
      .then((fresh) => {
        if (cancelled) return;
        setGoal(fresh);
        syncPanelFields(fresh);
      })
      .catch(() => {
        /* keep the list's copy if the refetch fails */
      });
    return () => {
      cancelled = true;
    };
    // Only when a different goal (or action) is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id, startWith]);

  // Reload current server data onto the screen after a conflict (Refresh).
  async function handleRefresh() {
    setBusy(true);
    setError(null);
    try {
      const fresh = await api.getGoal(goal.id);
      setGoal(fresh);
      syncPanelFields(fresh);
      onChanged(fresh);
      reset();
      setPanel(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not refresh the goal.');
    } finally {
      setBusy(false);
    }
  }

  const isOwner = user?.id === goal.ownerId;
  const isCreator = user?.id === goal.createdById;
  const isAdmin = user?.role === 'Admin';
  const canDraft = isOwner || isCreator || isAdmin;
  const canSupervise = supervisorView || isAdmin;

  function applied(updated: GoalDto) {
    setGoal(updated);
    onChanged(updated);
    setPanel(null);
    setError(null);
  }

  async function run(fn: () => Promise<GoalDto>) {
    setBusy(true);
    setError(null);
    try {
      // On a stale-write 409 the guard raises the conflict banner instead of
      // throwing; other errors fall through to the catch below.
      await guard(async () => {
        applied(await fn());
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!window.confirm('Delete this draft goal? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteGoal(goal.id);
      onChanged(null);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the goal.');
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <GoalForm
        goal={goal}
        onClose={() => setEditing(false)}
        onSaved={(g) => {
          setEditing(false);
          applied(g);
        }}
      />
    );
  }

  const unit = goal.unitLabel;
  const showResults = goal.status !== 'Draft' && goal.status !== 'PendingApproval';
  const due = deadlineHint(goal);
  const step = GOAL_STATUSES.indexOf(goal.status);

  const refreshBtn = (
    <Btn kind="primary" disabled={busy} onClick={() => void handleRefresh()}>
      {busy ? 'Refreshing…' : 'Refresh'}
    </Btn>
  );
  const formFoot = (submit: ReactNode) => (
    <div className="hb-gpanel-foot">
      <Btn kind="ghost" onClick={cancelPanel}>
        Cancel
      </Btn>
      {conflict ? refreshBtn : submit}
    </div>
  );

  return (
    <Card className="hb-gpanel">
      <section aria-label={`Goal #${goal.id}`}>
        <div className="hb-gpanel-head">
          <div className="hb-stack">
            <span className="hb-gpanel-eyebrow">
              Goal #{goal.id} <GoalStatusPill status={goal.status} />
            </span>
            <h2>{goal.specific}</h2>
          </div>
          <button
            type="button"
            className="hb-icon-btn hb-icon-btn-sm"
            aria-label="Close"
            onClick={close}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Where it is in its lifecycle */}
        <ol className="hb-gsteps" aria-label="Goal lifecycle">
          {GOAL_STATUSES.map((s: GoalStatus, i) => (
            <li key={s} className={cx(i < step && 'is-done', i === step && 'is-now')}>
              <span className="dot" aria-hidden="true" />
              <span>{GOAL_STATUS_LABELS[s]}</span>
            </li>
          ))}
        </ol>

        <div className="hb-gpanel-body">
          <div className="hb-gpeople">
            <span className="hb-user-mini">
              <Avatar user={goal.owner} size="xs" decorative />
              {userLabel(goal.owner)}
            </span>
            {goal.createdById !== goal.ownerId && (
              <span className="hb-sub">drafted by {userLabel(goal.createdBy)}</span>
            )}
          </div>

          {error && (
            <div className="hb-alert" role="alert">
              {error}
            </div>
          )}
          {bannerShown && <ConflictBanner entity="goal" onReview={review} />}

          {goal.status === 'Draft' && goal.rejectionComments && (
            <div className="hb-gnote is-bad">
              <strong>Sent back by the supervisor:</strong> {goal.rejectionComments}
            </div>
          )}

          <div className="hb-gfacts">
            <div>
              <span className="hb-tpl-flabel">Target</span>
              <b>{formatGoalValue(goal.targetValue, goal.metricType, unit)}</b>
            </div>
            {showResults && (
              <div>
                <span className="hb-tpl-flabel">Result</span>
                <b>{formatGoalValue(goal.resultValue, goal.metricType, unit)}</b>
              </div>
            )}
            <div>
              <span className="hb-tpl-flabel">Deadline</span>
              <b>{formatDeadline(goal.deadline)}</b>
              {due.text && <span className={cx('hb-sub', due.late && 'late')}>{due.text}</span>}
            </div>
            {goal.resolution && (
              <div>
                <span className="hb-tpl-flabel">Resolution</span>
                <b>{GOAL_RESOLUTION_LABELS[goal.resolution]}</b>
              </div>
            )}
          </div>

          {(goal.risks || goal.mitigations || goal.notes) && (
            <div className="hb-gtexts">
              {goal.risks && (
                <div>
                  <span className="hb-tpl-flabel">Risks</span>
                  <p>{goal.risks}</p>
                </div>
              )}
              {goal.mitigations && (
                <div>
                  <span className="hb-tpl-flabel">Mitigations</span>
                  <p>{goal.mitigations}</p>
                </div>
              )}
              {goal.notes && (
                <div>
                  <span className="hb-tpl-flabel">Notes</span>
                  <p>{goal.notes}</p>
                </div>
              )}
            </div>
          )}

          {goal.status === 'Resolved' && goal.supervisorComments && (
            <div className="hb-gnote is-good">
              <span className="hb-tpl-flabel">Supervisor comments</span>
              <p>{goal.supervisorComments}</p>
              {goal.resolvedBy && (
                <span className="hb-sub">Resolved by {userLabel(goal.resolvedBy)}</span>
              )}
            </div>
          )}
        </div>

        {/* --- The action forms, in place --- */}
        {panel === 'progress' && (
          <div className="hb-gaction">
            <span className="hb-gaction-title">Update results</span>
            <label className="hb-tpl-field">
              <span className="hb-tpl-flabel">Result ({goal.metricType})</span>
              <input
                id="p-result"
                className="hb-tpl-input"
                type="number"
                step="any"
                value={resultValue}
                onChange={(e) => setResultValue(e.target.value)}
              />
            </label>
            <label className="hb-tpl-field">
              <span className="hb-tpl-flabel">Risks</span>
              <textarea
                id="p-risks"
                className="hb-tpl-input"
                rows={2}
                value={risks}
                onChange={(e) => setRisks(e.target.value)}
              />
            </label>
            <label className="hb-tpl-field">
              <span className="hb-tpl-flabel">Mitigations</span>
              <textarea
                id="p-mit"
                className="hb-tpl-input"
                rows={2}
                value={mitigations}
                onChange={(e) => setMitigations(e.target.value)}
              />
            </label>
            <label className="hb-tpl-field">
              <span className="hb-tpl-flabel">Notes</span>
              <textarea
                id="p-notes"
                className="hb-tpl-input"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            {formFoot(
              <Btn
                kind="primary"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    api.updateGoalProgress(
                      goal.id,
                      {
                        resultValue: resultValue === '' ? null : Number(resultValue),
                        notes,
                        risks,
                        mitigations,
                      },
                      goal.updatedAt,
                    ),
                  )
                }
              >
                Save results
              </Btn>,
            )}
          </div>
        )}

        {panel === 'reject' && (
          <div className="hb-gaction">
            <span className="hb-gaction-title">Send back to draft</span>
            <label className="hb-tpl-field">
              <span className="hb-tpl-flabel">Reason for sending back (required)</span>
              <textarea
                id="r-comments"
                className="hb-tpl-input"
                rows={3}
                autoFocus
                value={rejectComments}
                onChange={(e) => setRejectComments(e.target.value)}
              />
            </label>
            {formFoot(
              <Btn
                kind="danger"
                disabled={busy || !rejectComments.trim()}
                onClick={() =>
                  run(() =>
                    api.rejectGoal(goal.id, { comments: rejectComments.trim() }, goal.updatedAt),
                  )
                }
              >
                Send back to draft
              </Btn>,
            )}
          </div>
        )}

        {panel === 'resolve' && (
          <div className="hb-gaction">
            <span className="hb-gaction-title">Review &amp; resolve</span>
            <div className="hb-tpl-field">
              <span className="hb-tpl-flabel">Resolution</span>
              <Select
                label="Resolution"
                value={resolution}
                options={GOAL_RESOLUTIONS.map((r) => ({
                  value: r,
                  label: GOAL_RESOLUTION_LABELS[r],
                }))}
                onChange={setResolution}
              />
            </div>
            <label className="hb-tpl-field">
              <span className="hb-tpl-flabel">Supervisor comments (required)</span>
              <textarea
                id="res-comments"
                className="hb-tpl-input"
                rows={3}
                value={supervisorComments}
                onChange={(e) => setSupervisorComments(e.target.value)}
              />
            </label>
            {formFoot(
              <Btn
                kind="primary"
                disabled={busy || !supervisorComments.trim()}
                onClick={() =>
                  run(() =>
                    api.resolveGoal(
                      goal.id,
                      { resolution, supervisorComments: supervisorComments.trim() },
                      goal.updatedAt,
                    ),
                  )
                }
              >
                Resolve goal
              </Btn>,
            )}
          </div>
        )}

        {/* --- What can happen next (hidden while an action form is open) --- */}
        {panel === null && (
          <div className="hb-gpanel-foot">
            {conflict ? (
              refreshBtn
            ) : (
              <>
                {goal.status === 'Draft' && canDraft && (
                  <>
                    <Btn kind="ghost" className="hb-tpl-del" onClick={onDelete} disabled={busy}>
                      Delete
                    </Btn>
                    <span className="hb-grow" />
                    <Btn onClick={() => setEditing(true)}>Edit</Btn>
                    <Btn
                      kind="primary"
                      disabled={busy}
                      onClick={() => run(() => api.submitGoal(goal.id, goal.updatedAt))}
                    >
                      Submit for approval
                    </Btn>
                  </>
                )}

                {goal.status === 'PendingApproval' && canSupervise && (
                  <>
                    <span className="hb-grow" />
                    <Btn onClick={() => setPanel('reject')}>Send back…</Btn>
                    <Btn
                      kind="primary"
                      disabled={busy}
                      onClick={() => run(() => api.approveGoal(goal.id, goal.updatedAt))}
                    >
                      Approve
                    </Btn>
                  </>
                )}
                {goal.status === 'PendingApproval' && !canSupervise && (
                  <span className="hb-small">Waiting for your supervisor to approve it.</span>
                )}

                {goal.status === 'Approved' && (isOwner || isAdmin) && (
                  <>
                    <span className="hb-grow" />
                    <Btn onClick={() => setPanel('progress')}>Update results</Btn>
                    <Btn
                      kind="primary"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            'Mark results final and send for review? You will no longer be able to update results.',
                          )
                        )
                          void run(() => api.finalizeGoal(goal.id, goal.updatedAt));
                      }}
                    >
                      Mark results final
                    </Btn>
                  </>
                )}
                {goal.status === 'Approved' && !isOwner && !isAdmin && (
                  <span className="hb-small">Active — the employee is recording results.</span>
                )}

                {goal.status === 'UnderReview' && canSupervise && (
                  <>
                    <span className="hb-grow" />
                    <Btn kind="primary" disabled={busy} onClick={() => setPanel('resolve')}>
                      Review &amp; resolve…
                    </Btn>
                  </>
                )}
                {goal.status === 'UnderReview' && !canSupervise && (
                  <span className="hb-small">
                    Results submitted — waiting for your supervisor&rsquo;s review.
                  </span>
                )}
                {goal.status === 'Resolved' && <span className="hb-small">This goal is done.</span>}
              </>
            )}
          </div>
        )}
      </section>
    </Card>
  );
}
