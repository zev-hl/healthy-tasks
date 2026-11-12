import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  WEEKDAYS,
  type RecurrenceEndType,
  type RecurrenceUnit,
  type SetTaskRecurrenceRequest,
  type TaskDetailDto,
  type TaskRecurrenceDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { Btn, Segmented, cx } from './harbor/ui';
import { Select, type SelectOption } from './harbor/Select';
import { DatePicker } from './harbor/DatePicker';

type RepeatKind = TaskRecurrenceDto['recurrenceType'];

interface Rule {
  type: RepeatKind;
  count: number;
  unit: RecurrenceUnit;
  weekdays: number[];
  endType: RecurrenceEndType;
  endDate: string | null;
  max: number;
}

const UNIT_WORDS: Record<RecurrenceUnit, [string, string]> = {
  Day: ['day', 'days'],
  Week: ['week', 'weeks'],
  Month: ['month', 'months'],
  Year: ['year', 'years'],
};
const unitWord = (u: RecurrenceUnit, n: number) => UNIT_WORDS[u][n === 1 ? 0 : 1];

const shortDay = (d: number) => WEEKDAYS[d]?.label.slice(0, 3) ?? '';
const niceDate = (ymd: string) =>
  new Date(`${ymd.slice(0, 10)}T12:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/** The rule in one plain sentence: "Every 2 weeks on Mon, Thu, until Dec 31, 2026". */
export function describeRule(r: Rule): string {
  const every =
    r.count === 1
      ? `Every ${unitWord(r.unit, 1)}`
      : `Every ${r.count} ${unitWord(r.unit, r.count)}`;
  let s =
    r.type === 'Fixed'
      ? every
      : `${r.count} ${unitWord(r.unit, r.count)} after each time it’s done`;
  if (r.type === 'Fixed' && r.unit === 'Week' && r.weekdays.length > 0) {
    s += ` on ${[...r.weekdays].sort().map(shortDay).join(', ')}`;
  }
  if (r.endType === 'OnDate' && r.endDate) s += `, until ${niceDate(r.endDate)}`;
  if (r.endType === 'AfterOccurrences') s += `, ${r.max} ${r.max === 1 ? 'time' : 'times'} in all`;
  return s;
}

const fromDto = (r: TaskRecurrenceDto): Rule => ({
  type: r.recurrenceType,
  count: r.intervalCount,
  unit: r.intervalUnit,
  weekdays: r.weekdays,
  endType: r.endType,
  endDate: r.endDate?.slice(0, 10) ?? null,
  max: r.maxOccurrences ?? 3,
});

const UNIT_OPTIONS = (n: number): SelectOption<RecurrenceUnit>[] =>
  (['Day', 'Week', 'Month', 'Year'] as const).map((u) => ({ value: u, label: unitWord(u, n) }));

const END_OPTIONS: SelectOption<RecurrenceEndType>[] = [
  { value: 'Never', label: 'never' },
  { value: 'OnDate', label: 'on a date' },
  { value: 'AfterOccurrences', label: 'after a number of times' },
];

type Props = {
  task: TaskDetailDto;
  onChanged: (t: TaskDetailDto) => void;
};

/**
 * Repeats on the task page (Phase 11; made simpler on Nov 11). One click on a
 * common choice — Daily, Weekly on the task's day, Monthly — fills in the rule;
 * "Custom" opens the same form. The form reads as a sentence and shows the
 * result in words before saving. A copy made by a repeat links to its series.
 */
export function TaskRecurrencePanel({ task, onChanged }: Props) {
  const rec = task.recurrence;
  const isOccurrence = task.recurrenceSourceId != null;
  const anchor = task.dueAt ?? task.startAt;
  const anchorDay = anchor ? new Date(anchor).getDay() : 1;

  const [draft, setDraft] = useState<Rule | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blank: Rule = {
    type: 'Fixed',
    count: 1,
    unit: 'Week',
    weekdays: [anchorDay],
    endType: 'Never',
    endDate: null,
    max: 3,
  };
  const presets: { label: string; rule: Rule }[] = [
    { label: 'Daily', rule: { ...blank, unit: 'Day', weekdays: [] } },
    { label: `Weekly on ${shortDay(anchorDay)}`, rule: blank },
    { label: 'Monthly', rule: { ...blank, unit: 'Month', weekdays: [] } },
  ];

  const set = (p: Partial<Rule>) => setDraft((d) => (d ? { ...d, ...p } : d));

  function open(rule: Rule) {
    setError(null);
    setDraft(rule);
  }

  async function save() {
    if (!draft) return;
    if (!Number.isInteger(draft.count) || draft.count < 1) {
      setError('“Every” needs a whole number, 1 or more.');
      return;
    }
    if (draft.endType === 'OnDate' && !draft.endDate) {
      setError('Pick the date it ends on.');
      return;
    }
    const body: SetTaskRecurrenceRequest = {
      recurrenceType: draft.type,
      intervalCount: draft.count,
      intervalUnit: draft.unit,
      weekdays: draft.type === 'Fixed' && draft.unit === 'Week' ? draft.weekdays : [],
      endType: draft.endType,
      endDate: draft.endType === 'OnDate' ? draft.endDate : null,
      maxOccurrences: draft.endType === 'AfterOccurrences' ? draft.max : null,
    };
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.setTaskRecurrence(task.id, body));
      setDraft(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the repeat.');
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.clearTaskRecurrence(task.id));
      setDraft(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not stop the repeat.');
    } finally {
      setBusy(false);
    }
  }

  if (isOccurrence) {
    return (
      <p className="hb-recur-note">
        This is repeat #{task.recurrenceSeq} of a repeating task.{' '}
        <Link to={`/tasks/${task.recurrenceSourceId}`}>Open the original</Link>
      </p>
    );
  }

  const errorBox = error && (
    <p className="hb-recur-error" role="alert">
      {error}
    </p>
  );

  if (draft) {
    const weekly = draft.type === 'Fixed' && draft.unit === 'Week';
    return (
      <div className="hb-recur-form">
        <div className="hb-recur-line">
          <span className="hb-recur-k">Repeat</span>
          <Segmented
            small
            label="How it repeats"
            value={draft.type}
            options={[
              { value: 'Fixed', label: 'On a schedule' },
              { value: 'RelativeToCompletion', label: 'After it’s done' },
            ]}
            onChange={(type) => set({ type })}
          />
        </div>
        <div className="hb-recur-line">
          <span className="hb-recur-k">{draft.type === 'Fixed' ? 'Every' : 'Wait'}</span>
          <input
            className="hb-recur-num"
            type="number"
            min={1}
            value={Number.isNaN(draft.count) ? '' : draft.count}
            aria-label="How many"
            onChange={(e) => set({ count: e.target.valueAsNumber })}
          />
          <Select
            variant="field"
            label="Unit"
            hideLabel
            value={draft.unit}
            options={UNIT_OPTIONS(draft.count)}
            onChange={(unit) => set({ unit })}
          />
        </div>
        {weekly && (
          <div className="hb-recur-line">
            <span className="hb-recur-k">On</span>
            <div className="hb-recur-days" role="group" aria-label="Days of the week">
              {WEEKDAYS.map((d) => {
                const on = draft.weekdays.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    className={cx('hb-recur-day', on && 'is-on')}
                    aria-pressed={on}
                    aria-label={d.label}
                    title={d.label}
                    onClick={() =>
                      set({
                        weekdays: on
                          ? draft.weekdays.filter((x) => x !== d.value)
                          : [...draft.weekdays, d.value],
                      })
                    }
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="hb-recur-line">
          <span className="hb-recur-k">Ends</span>
          <Select
            variant="field"
            label="Ends"
            hideLabel
            value={draft.endType}
            options={END_OPTIONS}
            onChange={(endType) => set({ endType })}
          />
          {draft.endType === 'OnDate' && (
            <DatePicker
              variant="field"
              label="End date"
              placeholder="Pick a date"
              value={draft.endDate}
              onChange={(endDate) => set({ endDate })}
            />
          )}
          {draft.endType === 'AfterOccurrences' && (
            <>
              <input
                className="hb-recur-num"
                type="number"
                min={1}
                value={Number.isNaN(draft.max) ? '' : draft.max}
                aria-label="How many times"
                onChange={(e) => set({ max: e.target.valueAsNumber })}
              />
              <span className="hb-recur-k">times</span>
            </>
          )}
        </div>
        <p className="hb-recur-preview" aria-live="polite">
          {describeRule(draft)}
        </p>
        {errorBox}
        <div className="hb-recur-actions">
          <Btn kind="primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Btn>
          <Btn onClick={() => setDraft(null)} disabled={busy}>
            Cancel
          </Btn>
        </div>
      </div>
    );
  }

  if (rec) {
    return (
      <div className="hb-recur-summary">
        <p className="hb-recur-rule">{describeRule(fromDto(rec))}</p>
        <p className="hb-recur-note">
          {rec.occurrenceCount === 0
            ? 'No repeats made yet'
            : `${rec.occurrenceCount} ${rec.occurrenceCount === 1 ? 'repeat' : 'repeats'} made so far`}
          {!rec.isActive && ' · paused'}
        </p>
        {errorBox}
        <div className="hb-recur-actions">
          <Btn onClick={() => open(fromDto(rec))} disabled={busy}>
            Change
          </Btn>
          <Btn kind="link" onClick={() => void stop()} disabled={busy}>
            Stop repeating
          </Btn>
        </div>
      </div>
    );
  }

  if (!anchor) {
    return <p className="hb-recur-note">Give the task a due or start date to make it repeat.</p>;
  }

  return (
    <div className="hb-recur-presets" role="group" aria-label="Make it repeat">
      {presets.map((p) => (
        <button key={p.label} type="button" className="hb-chip" onClick={() => open(p.rule)}>
          {p.label}
        </button>
      ))}
      <button type="button" className="hb-chip" onClick={() => open(blank)}>
        Custom…
      </button>
    </div>
  );
}
