import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RECURRENCE_UNIT_LABELS,
  RECURRENCE_UNITS,
  WEEKDAYS,
  type RecurrenceEndType,
  type RecurrenceUnit,
  type SetTaskRecurrenceRequest,
  type TaskDetailDto,
  type TaskRecurrenceDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { WeekdayPicker } from './WeekdayPicker';

/** Human summary of a task's recurrence rule for the rail. */
function describeRecurrence(r: TaskRecurrenceDto): string {
  const unit = RECURRENCE_UNIT_LABELS[r.intervalUnit];
  let base =
    r.recurrenceType === 'Fixed'
      ? `Every ${r.intervalCount} ${unit}`
      : `${r.intervalCount} ${unit} after each completion`;
  if (r.recurrenceType === 'Fixed' && r.intervalUnit === 'Week' && r.weekdays.length > 0) {
    base += ` on ${r.weekdays.map((d) => WEEKDAYS[d]?.label.slice(0, 3)).join(', ')}`;
  }
  let end = '';
  if (r.endType === 'AfterOccurrences' && r.maxOccurrences) end = ` · ${r.maxOccurrences} times`;
  else if (r.endType === 'OnDate' && r.endDate) end = ` · until ${r.endDate.slice(0, 10)}`;
  return base + end;
}

type Props = {
  task: TaskDetailDto;
  onChanged: (t: TaskDetailDto) => void;
};

/**
 * Task-level recurrence control (Phase 11) shown in the Task Detail rail. Lets a
 * user set/edit/stop a regular task's recurrence. A generated occurrence instead
 * links back to its source series (recurrence is edited on the source).
 */
export function TaskRecurrencePanel({ task, onChanged }: Props) {
  const rec = task.recurrence;
  const isOccurrence = task.recurrenceSourceId != null;
  const hasAnchor = Boolean(task.startAt || task.dueAt);

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state (seeded from the existing rule or sensible defaults).
  const [type, setType] = useState<TaskRecurrenceDto['recurrenceType']>(rec?.recurrenceType ?? 'Fixed');
  const [count, setCount] = useState(String(rec?.intervalCount ?? 1));
  const [unit, setUnit] = useState<RecurrenceUnit>(rec?.intervalUnit ?? 'Week');
  const [weekdays, setWeekdays] = useState<number[]>(rec?.weekdays ?? []);
  const [endType, setEndType] = useState<RecurrenceEndType>(rec?.endType ?? 'Never');
  const [endDate, setEndDate] = useState(rec?.endDate?.slice(0, 10) ?? '');
  const [maxOccurrences, setMaxOccurrences] = useState(String(rec?.maxOccurrences ?? 3));

  function openEditor() {
    setType(rec?.recurrenceType ?? 'Fixed');
    setCount(String(rec?.intervalCount ?? 1));
    setUnit(rec?.intervalUnit ?? 'Week');
    setWeekdays(rec?.weekdays ?? []);
    setEndType(rec?.endType ?? 'Never');
    setEndDate(rec?.endDate?.slice(0, 10) ?? '');
    setMaxOccurrences(String(rec?.maxOccurrences ?? 3));
    setError(null);
    setEditing(true);
  }

  async function save() {
    setError(null);
    const intervalCount = Number(count);
    if (!Number.isInteger(intervalCount) || intervalCount < 1) {
      setError('Interval must be a positive whole number');
      return;
    }
    const body: SetTaskRecurrenceRequest = {
      recurrenceType: type,
      intervalCount,
      intervalUnit: unit,
      weekdays: unit === 'Week' ? weekdays : [],
      endType,
      endDate: endType === 'OnDate' ? endDate || null : null,
      maxOccurrences: endType === 'AfterOccurrences' ? Number(maxOccurrences) : null,
    };
    setBusy(true);
    try {
      onChanged(await api.setTaskRecurrence(task.id, body));
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save recurrence');
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.clearTaskRecurrence(task.id));
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not stop recurrence');
    } finally {
      setBusy(false);
    }
  }

  if (isOccurrence) {
    return (
      <div className="rail-section">
        <div className="rail-section-title">Recurrence</div>
        <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
          Occurrence #{task.recurrenceSeq} of a recurring task.{' '}
          <Link to={`/tasks/${task.recurrenceSourceId}`}>View the series</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="rail-section">
      <div className="rail-section-title">Recurrence</div>

      {error && <div className="alert error" style={{ marginBottom: '0.5rem' }}>{error}</div>}

      {!editing ? (
        rec ? (
          <div className="recur-summary">
            <p style={{ margin: '0 0 0.35rem' }}>
              <span className="recur-badge">Repeats</span> {describeRecurrence(rec)}
            </p>
            <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.75rem' }}>
              {rec.occurrenceCount} generated so far
              {!rec.isActive && ' · paused'}
            </p>
            <div className="btn-row">
              <button type="button" className="secondary btn-sm" onClick={openEditor} disabled={busy}>
                Edit
              </button>
              <button type="button" className="secondary btn-sm" onClick={() => void stop()} disabled={busy}>
                Stop
              </button>
            </div>
          </div>
        ) : hasAnchor ? (
          <button type="button" className="tertiary btn-sm" onClick={openEditor}>
            + Make recurring
          </button>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
            Add a start or due date to make this task recur.
          </p>
        )
      ) : (
        <div className="recur-form">
          <div className="field">
            <label htmlFor="recur-type">Repeat</label>
            <select id="recur-type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="Fixed">On a fixed schedule</option>
              <option value="RelativeToCompletion">After each completion</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="recur-count">Every</label>
            <div className="recur-interval">
              <input
                id="recur-count"
                type="number"
                min={1}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                style={{ width: 64 }}
              />
              <select value={unit} onChange={(e) => setUnit(e.target.value as RecurrenceUnit)} aria-label="Interval unit">
                {RECURRENCE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {RECURRENCE_UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {unit === 'Week' && (
            <div className="field">
              <label>Repeat on</label>
              <WeekdayPicker value={weekdays} onChange={setWeekdays} />
            </div>
          )}
          <div className="field">
            <label htmlFor="recur-end">Ends</label>
            <select id="recur-end" value={endType} onChange={(e) => setEndType(e.target.value as RecurrenceEndType)}>
              <option value="Never">Never</option>
              <option value="OnDate">On a date</option>
              <option value="AfterOccurrences">
                {type === 'RelativeToCompletion' ? 'Stop after N completions' : 'After N occurrences'}
              </option>
            </select>
          </div>
          {endType === 'OnDate' && (
            <div className="field">
              <label htmlFor="recur-enddate">End date</label>
              <input id="recur-enddate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          )}
          {endType === 'AfterOccurrences' && (
            <div className="field">
              <label htmlFor="recur-max">
                {type === 'RelativeToCompletion' ? 'Completions' : 'Occurrences'}
              </label>
              <input
                id="recur-max"
                type="number"
                min={1}
                value={maxOccurrences}
                onChange={(e) => setMaxOccurrences(e.target.value)}
                style={{ width: 80 }}
              />
            </div>
          )}
          <div className="btn-row">
            <button type="button" className="btn-sm" onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="secondary btn-sm" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
