import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type {
  CreateGoalRequest,
  GoalDto,
  GoalMetricType,
  UpdateGoalRequest,
} from '@healthy-tasks/shared';
import {
  GOAL_METRIC_TYPES,
  GOAL_METRIC_TYPE_LABELS,
  GOAL_METRIC_TYPES_NEEDING_UNIT,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../../api/client';
import { useStaleWriteGuard } from '../../lib/useStaleWriteGuard';
import { ConflictBanner } from '../ConflictBanner';
import { isoToDateInput, dateInputToIso } from './goalUi';
import { confirmDiscard, useUnsavedChangesWarning } from '../../lib/useUnsavedChangesWarning';
import { Card } from '../harbor/ui';
import { Select } from '../harbor/Select';
import { DatePicker } from '../harbor/DatePicker';

interface Props {
  /** Present ⇒ edit that draft; absent ⇒ create a new goal. */
  goal?: GoalDto;
  /** Team goals: choose which report the goal is for. Absent ⇒ for the caller. */
  ownerOptions?: { id: string; label: string }[];
  onClose: () => void;
  onSaved: (goal: GoalDto) => void;
}

/**
 * Create a new SMART goal, or edit a Draft's SMART fields — in the page's side
 * panel, not a pop-up (brief: everything that could be a modal is inline).
 * The four SMART questions are numbered so the form reads as a short guide.
 */
export function GoalForm({ goal, ownerOptions, onClose, onSaved }: Props) {
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

  // Unsaved-work guard: while anything differs from how the form opened,
  // closing it and leaving the page both ask first.
  const fields = () =>
    JSON.stringify([
      ownerId,
      specific,
      metricType,
      unitLabel,
      targetValue,
      deadline,
      risks,
      mitigations,
      notes,
    ]);
  const [original] = useState(fields);
  const dirty = fields() !== original;
  useUnsavedChangesWarning(dirty && !submitting);
  const dismiss = () => {
    if (confirmDiscard(dirty)) onClose();
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return; // nothing changed yet
    setError(null);

    const target = Number(targetValue);
    if (targetValue.trim() === '' || !Number.isFinite(target)) {
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
    <Card className="hb-gpanel">
      <form onSubmit={onSubmit} aria-label={editing ? 'Edit goal' : 'New goal'}>
        <div className="hb-gpanel-head">
          <div className="hb-stack">
            <span className="hb-gpanel-eyebrow">
              {editing ? `Goal #${goal!.id}` : 'SMART goal'}
            </span>
            <h2>{editing ? 'Edit goal' : 'New goal'}</h2>
          </div>
          <button
            type="button"
            className="hb-icon-btn hb-icon-btn-sm"
            aria-label="Close"
            onClick={dismiss}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="hb-gpanel-body">
          {error && (
            <div className="hb-alert" role="alert">
              {error}
            </div>
          )}
          {bannerShown && <ConflictBanner entity="goal" onReview={review} />}

          {ownerOptions && !editing && (
            <div className="hb-tpl-field">
              <span className="hb-tpl-flabel">For</span>
              <Select
                label="Employee"
                value={ownerId}
                options={ownerOptions.map((o) => ({ value: o.id, label: o.label }))}
                searchPlaceholder="Search people…"
                onChange={setOwnerId}
              />
            </div>
          )}

          <div className="hb-gstep">
            <span className="hb-gstep-n">1</span>
            <label className="hb-tpl-field">
              <span className="hb-tpl-flabel">What — Specific</span>
              <textarea
                id="goal-specific"
                className="hb-tpl-input"
                rows={2}
                placeholder="What, specifically, will be achieved?"
                value={specific}
                onChange={(e) => setSpecific(e.target.value)}
              />
            </label>
          </div>

          <div className="hb-gstep">
            <span className="hb-gstep-n">2</span>
            <div className="hb-gstep-grid">
              <div className="hb-tpl-field">
                <span className="hb-tpl-flabel">How much — Metric</span>
                <Select
                  label="How much — Metric"
                  value={metricType}
                  options={GOAL_METRIC_TYPES.map((m) => ({
                    value: m,
                    label: GOAL_METRIC_TYPE_LABELS[m],
                  }))}
                  onChange={setMetricType}
                />
              </div>
              <label className="hb-tpl-field">
                <span className="hb-tpl-flabel">Target value</span>
                <input
                  id="goal-target"
                  className="hb-tpl-input"
                  type="number"
                  step="any"
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                />
              </label>
              <label className="hb-tpl-field">
                <span className="hb-tpl-flabel">
                  Unit {needsUnit ? '(required)' : '(optional)'}
                </span>
                <input
                  id="goal-unit"
                  className="hb-tpl-input"
                  type="text"
                  placeholder={needsUnit ? 'e.g. pallets' : 'e.g. orders'}
                  value={unitLabel}
                  onChange={(e) => setUnitLabel(e.target.value)}
                />
              </label>
            </div>
          </div>

          <div className="hb-gstep">
            <span className="hb-gstep-n">3</span>
            <div className="hb-tpl-field">
              <span className="hb-tpl-flabel">By when — Deadline</span>
              <DatePicker
                label="By when — Deadline"
                value={deadline || null}
                placeholder="Pick a date"
                onChange={(v) => setDeadline(v ?? '')}
              />
            </div>
          </div>

          <div className="hb-gstep">
            <span className="hb-gstep-n">4</span>
            <div className="hb-gstep-grid two">
              <label className="hb-tpl-field">
                <span className="hb-tpl-flabel">Risks</span>
                <textarea
                  id="goal-risks"
                  className="hb-tpl-input"
                  rows={2}
                  value={risks}
                  onChange={(e) => setRisks(e.target.value)}
                />
              </label>
              <label className="hb-tpl-field">
                <span className="hb-tpl-flabel">Mitigations</span>
                <textarea
                  id="goal-mit"
                  className="hb-tpl-input"
                  rows={2}
                  value={mitigations}
                  onChange={(e) => setMitigations(e.target.value)}
                />
              </label>
              <label className="hb-tpl-field is-wide">
                <span className="hb-tpl-flabel">Notes</span>
                <textarea
                  id="goal-notes"
                  className="hb-tpl-input"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
            </div>
          </div>
        </div>

        <div className="hb-gpanel-foot">
          <button type="button" className="hb-btn hb-btn-ghost" onClick={dismiss}>
            Cancel
          </button>
          {conflict ? (
            <button
              type="button"
              className="hb-btn hb-btn-primary"
              disabled={submitting}
              onClick={() => void handleRefresh()}
            >
              {submitting ? 'Refreshing…' : 'Refresh'}
            </button>
          ) : (
            <button
              type="submit"
              className="hb-btn hb-btn-primary"
              disabled={submitting || !dirty}
              title={dirty ? undefined : 'Nothing has changed yet'}
            >
              {submitting ? 'Saving…' : editing ? 'Save changes' : 'Create goal'}
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}
