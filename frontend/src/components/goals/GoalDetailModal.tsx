import { useState } from 'react';
import type { GoalDto, GoalResolution } from '@healthy-tasks/shared';
import { GOAL_RESOLUTIONS, GOAL_RESOLUTION_LABELS } from '@healthy-tasks/shared';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { UserChip } from '../ui/Avatar';
import { GoalStatusPill, formatGoalValue, formatDeadline } from './goalUi';
import { GoalEditorModal } from './GoalEditorModal';

interface Props {
  goal: GoalDto;
  /** True on the Team Goals screen — surfaces supervisor actions (approve/resolve). */
  supervisorView: boolean;
  onClose: () => void;
  /** Called with the updated goal after any action (null when deleted). */
  onChanged: (goal: GoalDto | null) => void;
}

type Panel = 'progress' | 'reject' | 'resolve' | null;

export function GoalDetailModal({ goal: initial, supervisorView, onClose, onChanged }: Props) {
  const { user } = useAuth();
  const [goal, setGoal] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Progress / reject / resolve field state.
  const [resultValue, setResultValue] = useState(goal.resultValue != null ? String(goal.resultValue) : '');
  const [notes, setNotes] = useState(goal.notes ?? '');
  const [risks, setRisks] = useState(goal.risks ?? '');
  const [mitigations, setMitigations] = useState(goal.mitigations ?? '');
  const [rejectComments, setRejectComments] = useState('');
  const [resolution, setResolution] = useState<GoalResolution>('Met');
  const [supervisorComments, setSupervisorComments] = useState('');

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
      applied(await fn());
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
      <GoalEditorModal
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide goal-detail" onClick={(e) => e.stopPropagation()}>
        <div className="goal-detail-head">
          <div>
            <div className="goal-detail-eyebrow">Goal #{goal.id}</div>
            <h3 style={{ margin: '0.1rem 0 0' }}>{goal.specific}</h3>
          </div>
          <GoalStatusPill status={goal.status} />
        </div>

        <div className="goal-detail-owner">
          <UserChip user={goal.owner} showTitle />
          <span className="muted"> · drafted by </span>
          <UserChip user={goal.createdBy} />
        </div>

        {error && <div className="alert error">{error}</div>}

        {goal.status === 'Draft' && goal.rejectionComments && (
          <div className="alert error goal-reject-note">
            <strong>Sent back by the supervisor:</strong> {goal.rejectionComments}
          </div>
        )}

        <div className="goal-detail-grid">
          <div className="goal-fact">
            <span className="u-label">Target</span>
            <span className="goal-fact-value">
              {formatGoalValue(goal.targetValue, goal.metricType, unit)}
            </span>
          </div>
          {showResults && (
            <div className="goal-fact">
              <span className="u-label">Result</span>
              <span className="goal-fact-value">
                {formatGoalValue(goal.resultValue, goal.metricType, unit)}
              </span>
            </div>
          )}
          <div className="goal-fact">
            <span className="u-label">Deadline</span>
            <span className="goal-fact-value">{formatDeadline(goal.deadline)}</span>
          </div>
          {goal.resolution && (
            <div className="goal-fact">
              <span className="u-label">Resolution</span>
              <span className="goal-fact-value">{GOAL_RESOLUTION_LABELS[goal.resolution]}</span>
            </div>
          )}
        </div>

        {(goal.risks || goal.mitigations || goal.notes) && (
          <div className="goal-detail-texts">
            {goal.risks && (
              <div>
                <span className="u-label">Risks</span>
                <p>{goal.risks}</p>
              </div>
            )}
            {goal.mitigations && (
              <div>
                <span className="u-label">Mitigations</span>
                <p>{goal.mitigations}</p>
              </div>
            )}
            {goal.notes && (
              <div>
                <span className="u-label">Notes</span>
                <p>{goal.notes}</p>
              </div>
            )}
          </div>
        )}

        {goal.status === 'Resolved' && goal.supervisorComments && (
          <div className="goal-resolution-card">
            <span className="u-label">Supervisor comments</span>
            <p>{goal.supervisorComments}</p>
            {goal.resolvedBy && (
              <div className="muted goal-resolved-by">
                Resolved by <UserChip user={goal.resolvedBy} />
              </div>
            )}
          </div>
        )}

        {/* --- Inline action panels --- */}
        {panel === 'progress' && (
          <div className="goal-action-panel">
            <div className="goal-form-row">
              <div className="field">
                <label htmlFor="p-result">Result ({goal.metricType})</label>
                <input
                  id="p-result"
                  type="number"
                  step="any"
                  value={resultValue}
                  onChange={(e) => setResultValue(e.target.value)}
                />
              </div>
            </div>
            <div className="goal-form-row">
              <div className="field">
                <label htmlFor="p-risks">Risks</label>
                <textarea id="p-risks" rows={2} value={risks} onChange={(e) => setRisks(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="p-mit">Mitigations</label>
                <textarea
                  id="p-mit"
                  rows={2}
                  value={mitigations}
                  onChange={(e) => setMitigations(e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="p-notes">Notes</label>
              <textarea id="p-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="secondary" onClick={() => setPanel(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    api.updateGoalProgress(goal.id, {
                      resultValue: resultValue === '' ? null : Number(resultValue),
                      notes,
                      risks,
                      mitigations,
                    }),
                  )
                }
              >
                Save results
              </button>
            </div>
          </div>
        )}

        {panel === 'reject' && (
          <div className="goal-action-panel">
            <div className="field">
              <label htmlFor="r-comments">Reason for sending back (required)</label>
              <textarea
                id="r-comments"
                rows={3}
                value={rejectComments}
                onChange={(e) => setRejectComments(e.target.value)}
              />
            </div>
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="secondary" onClick={() => setPanel(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy || !rejectComments.trim()}
                onClick={() => run(() => api.rejectGoal(goal.id, { comments: rejectComments.trim() }))}
              >
                Send back to draft
              </button>
            </div>
          </div>
        )}

        {panel === 'resolve' && (
          <div className="goal-action-panel">
            <div className="goal-form-row">
              <div className="field">
                <label htmlFor="res-verdict">Resolution</label>
                <select
                  id="res-verdict"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as GoalResolution)}
                >
                  {GOAL_RESOLUTIONS.map((r) => (
                    <option key={r} value={r}>
                      {GOAL_RESOLUTION_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="res-comments">Supervisor comments (required)</label>
              <textarea
                id="res-comments"
                rows={3}
                value={supervisorComments}
                onChange={(e) => setSupervisorComments(e.target.value)}
              />
            </div>
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="secondary" onClick={() => setPanel(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !supervisorComments.trim()}
                onClick={() =>
                  run(() =>
                    api.resolveGoal(goal.id, { resolution, supervisorComments: supervisorComments.trim() }),
                  )
                }
              >
                Resolve goal
              </button>
            </div>
          </div>
        )}

        {/* --- Primary action bar (hidden while an inline panel is open) --- */}
        {panel === null && (
          <div className="goal-detail-actions">
            {goal.status === 'Draft' && canDraft && (
              <>
                <button type="button" className="secondary" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button type="button" className="ghost danger" onClick={onDelete} disabled={busy}>
                  Delete
                </button>
                <button type="button" disabled={busy} onClick={() => run(() => api.submitGoal(goal.id))}>
                  Submit for approval
                </button>
              </>
            )}

            {goal.status === 'PendingApproval' && canSupervise && (
              <>
                <button type="button" className="secondary" onClick={() => setPanel('reject')}>
                  Reject…
                </button>
                <button type="button" disabled={busy} onClick={() => run(() => api.approveGoal(goal.id))}>
                  Approve
                </button>
              </>
            )}
            {goal.status === 'PendingApproval' && !canSupervise && (
              <span className="muted">Awaiting supervisor approval.</span>
            )}

            {goal.status === 'Approved' && (isOwner || isAdmin) && (
              <>
                <button type="button" className="secondary" onClick={() => setPanel('progress')}>
                  Update results
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm('Mark results final and send for review? You will no longer be able to update results.'))
                      run(() => api.finalizeGoal(goal.id));
                  }}
                >
                  Mark results final
                </button>
              </>
            )}
            {goal.status === 'Approved' && !isOwner && !isAdmin && (
              <span className="muted">Active — the employee is recording results.</span>
            )}

            {goal.status === 'UnderReview' && canSupervise && (
              <button type="button" disabled={busy} onClick={() => setPanel('resolve')}>
                Review &amp; resolve…
              </button>
            )}
            {goal.status === 'UnderReview' && !canSupervise && (
              <span className="muted">Results submitted — awaiting the supervisor&rsquo;s review.</span>
            )}

            <span className="goal-actions-spacer" />
            <button type="button" className="ghost" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
