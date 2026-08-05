import { useState } from 'react';
import type { CreateGoalRequest, GoalDto, GoalMetricType, UpdateGoalRequest } from '@healthy-tasks/shared';
import {
  GOAL_METRIC_TYPES,
  GOAL_METRIC_TYPE_LABELS,
  GOAL_METRIC_TYPES_NEEDING_UNIT,
} from '@healthy-tasks/shared';
import { api } from '../../api/client';
import { ApiError } from '../../api/client';
import { useStaleWriteGuard } from '../../lib/useStaleWriteGuard';
import { ConflictBanner } from '../ConflictBanner';
import { isoToDateInput, dateInputToIso } from './goalUi';

interface Props {
  /** Present ⇒ edit that draft; absent ⇒ create a new goal. */
  goal?: GoalDto;
  /** Team Goals: choose which report the goal is for. Absent ⇒ for the caller. */
  ownerOptions?: { id: string; label: string }[];
  onClose: () => void;
  onSaved: (goal: GoalDto) => void;
}

/** Create a new SMART goal, or edit a Draft's SMART fields. */
export function GoalEditorModal({ goal, ownerOptions, onClose, onSaved }: Props) {
  const editing = !!goal;
  const [ownerId, setOwnerId] = useState(goal?.ownerId ?? ownerOptions?.[0]?.id ?? '');
  const [specific, setSpecific] = useState(goal?.specific ?? '');
  const [metricType, setMetricType] = useState<GoalMetricType>(goal?.metricType ?? 'Count');
  const [unitLabel, setUnitLabel] = useState(goal?.unitLabel ?? '');
  const [targetValue, setTargetValue] = useState(goal ? String(goal.targetValue) : '');
  const [deadline, setDeadline] = useState(isoToDateInput(goal?.deadline));
  const [risks, setRisks] = useState(goal?.risks ?? '');
  const [mitigations, setMitigations] = useState(goal?.mitigations ?? '');
  const [notes, setNotes] = useState(goal?.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Version token for the edit path (optimistic concurrency); refreshed on Refresh.
  const [version, setVersion] = useState(goal?.updatedAt);
  const { conflict, bannerShown, guard, review, reset } = useStaleWriteGuard();

  const needsUnit = GOAL_METRIC_TYPES_NEEDING_UNIT.includes(metricType);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const target = Number(targetValue);
    if (!Number.isFinite(target)) {
      setError('Enter a numeric target value.');
      return;
    }
    if (!deadline) {
      setError('Choose a deadline.');
      return;
    }
    if (needsUnit && !unitLabel.trim()) {
      setError('A unit label is required for a custom metric.');
      return;
    }

    setSubmitting(true);
    try {
      // On a stale-write 409 the guard raises the conflict banner instead of throwing.
      await guard(async () => {
        let saved: GoalDto;
        if (editing) {
          const body: UpdateGoalRequest = {
            specific: specific.trim(),
            metricType,
            unitLabel: unitLabel.trim() || null,
            targetValue: target,
            deadline: dateInputToIso(deadline),
            risks: risks.trim() || null,
            mitigations: mitigations.trim() || null,
            notes: notes.trim() || null,
          };
          saved = await api.updateGoal(goal!.id, body, version);
        } else {
          const body: CreateGoalRequest = {
            ownerId: ownerOptions ? ownerId : null,
            specific: specific.trim(),
            metricType,
            unitLabel: unitLabel.trim() || null,
            targetValue: target,
            deadline: dateInputToIso(deadline),
            risks: risks.trim() || null,
            mitigations: mitigations.trim() || null,
            notes: notes.trim() || null,
          };
          saved = await api.createGoal(body);
        }
        onSaved(saved);
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the goal.');
    } finally {
      setSubmitting(false);
    }
  }

  // Reload current server data into the form after a conflict (Refresh).
  async function handleRefresh() {
    if (!goal) return;
    setSubmitting(true);
    setError(null);
    try {
      const fresh = await api.getGoal(goal.id);
      setOwnerId(fresh.ownerId);
      setSpecific(fresh.specific);
      setMetricType(fresh.metricType);
      setUnitLabel(fresh.unitLabel ?? '');
      setTargetValue(String(fresh.targetValue));
      setDeadline(isoToDateInput(fresh.deadline));
      setRisks(fresh.risks ?? '');
      setMitigations(fresh.mitigations ?? '');
      setNotes(fresh.notes ?? '');
      setVersion(fresh.updatedAt);
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not refresh the goal.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{editing ? 'Edit goal' : 'New goal'}</h3>
        {error && <div className="alert error">{error}</div>}
        {bannerShown && <ConflictBanner entity="goal" onReview={review} />}
        <form onSubmit={onSubmit}>
          {ownerOptions && !editing && (
            <div className="field">
              <label htmlFor="goal-owner">Employee</label>
              <select id="goal-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                {ownerOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label htmlFor="goal-specific">What — Specific</label>
            <textarea
              id="goal-specific"
              rows={2}
              placeholder="What, specifically, will be achieved?"
              value={specific}
              onChange={(e) => setSpecific(e.target.value)}
            />
          </div>

          <div className="goal-form-row">
            <div className="field">
              <label htmlFor="goal-metric">How Much — Metric</label>
              <select
                id="goal-metric"
                value={metricType}
                onChange={(e) => setMetricType(e.target.value as GoalMetricType)}
              >
                {GOAL_METRIC_TYPES.map((m) => (
                  <option key={m} value={m}>
                    {GOAL_METRIC_TYPE_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="goal-target">Target value</label>
              <input
                id="goal-target"
                type="number"
                step="any"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="goal-unit">Unit {needsUnit ? '(required)' : '(optional)'}</label>
              <input
                id="goal-unit"
                type="text"
                placeholder={needsUnit ? 'e.g. pallets' : 'optional'}
                value={unitLabel}
                onChange={(e) => setUnitLabel(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="goal-deadline">By When — Deadline</label>
            <input
              id="goal-deadline"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>

          <div className="goal-form-row">
            <div className="field">
              <label htmlFor="goal-risks">Risks</label>
              <textarea id="goal-risks" rows={2} value={risks} onChange={(e) => setRisks(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="goal-mit">Mitigations</label>
              <textarea
                id="goal-mit"
                rows={2}
                value={mitigations}
                onChange={(e) => setMitigations(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="goal-notes">Notes</label>
            <textarea id="goal-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            {conflict ? (
              <button type="button" disabled={submitting} onClick={() => void handleRefresh()}>
                {submitting ? 'Refreshing…' : 'Refresh'}
              </button>
            ) : (
              <button type="submit" disabled={submitting}>
                {submitting ? 'Saving…' : editing ? 'Save changes' : 'Create goal'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
