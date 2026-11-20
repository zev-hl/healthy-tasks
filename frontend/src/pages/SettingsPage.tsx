import { useEffect, useState } from 'react';
import { ConnectSignInCard } from '../components/connect/ConnectSignInCard';
import {
  DEFAULT_MATERIALIZE_LEAD_DAYS,
  MATERIALIZE_LEAD_DAYS_MAX,
  MATERIALIZE_LEAD_DAYS_MIN,
  TIMER_CHECK_IN_GRACE_DEFAULT,
  TIMER_CHECK_IN_GRACE_MAX,
  TIMER_CHECK_IN_GRACE_MIN,
  TIMER_CHECK_IN_HOURS_DEFAULT,
  TIMER_CHECK_IN_HOURS_MAX,
  TIMER_CHECK_IN_HOURS_MIN,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { PageHeader } from '../components/harbor/PageHeader';
import { QueueDashboardCard } from '../components/QueueDashboardCard';

type FieldKey = 'lead' | 'hours' | 'grace';

/**
 * A whole number between `min` and `max`, or the message to show under the
 * field. An empty box is refused, not read as 0: the setting keeps its saved
 * value until a number is typed.
 */
function checkWhole(raw: string, min: number, max: number, unit: string): number | string {
  if (raw.trim() === '') return `Enter a number of ${unit} between ${min} and ${max}.`;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max)
    return `Enter a whole number of ${unit} between ${min} and ${max}.`;
  return n;
}

/** The message under a field, tied to it for screen readers. */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="settings-field-error" role="alert">
      {message}
    </p>
  );
}

/**
 * Admin-only global settings: the single materialization lead time that every
 * recurring template and task reads from (there is no per-template or per-task
 * override), and the timer's check-in (L2).
 */
export function SettingsPage() {
  const [lead, setLead] = useState(String(DEFAULT_MATERIALIZE_LEAD_DAYS));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // A failed save of the Recurring tasks card, shown beside its Save button.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [checkHours, setCheckHours] = useState(String(TIMER_CHECK_IN_HOURS_DEFAULT));
  const [grace, setGrace] = useState(String(TIMER_CHECK_IN_GRACE_DEFAULT));
  const [timerSaving, setTimerSaving] = useState(false);
  const [timerSaved, setTimerSaved] = useState(false);
  const [timerError, setTimerError] = useState<string | null>(null);
  // Problems with what was typed, shown under the field they're about.
  const [fieldErr, setFieldErr] = useState<Partial<Record<FieldKey, string>>>({});
  const clearField = (k: FieldKey) =>
    setFieldErr((f) => {
      const { [k]: _gone, ...rest } = f;
      return rest;
    });

  useEffect(() => {
    let alive = true;
    void api
      .getAppSettings()
      .then((s) => {
        if (!alive) return;
        setLead(String(s.materializeLeadDays));
        setCheckHours(String(s.timerCheckInHours));
        setGrace(String(s.timerCheckInGraceMinutes));
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : 'Failed to load settings');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    setSaveError(null);
    setSaved(false);
    const days = checkWhole(lead, MATERIALIZE_LEAD_DAYS_MIN, MATERIALIZE_LEAD_DAYS_MAX, 'days');
    if (typeof days === 'string') {
      setFieldErr((f) => ({ ...f, lead: days }));
      document.getElementById('materialize-lead')?.focus();
      return;
    }
    clearField('lead');
    setSaving(true);
    try {
      const updated = await api.updateAppSettings({ materializeLeadDays: days });
      setLead(String(updated.materializeLeadDays));
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function saveTimer() {
    setTimerError(null);
    setTimerSaved(false);
    const hours = checkWhole(
      checkHours,
      TIMER_CHECK_IN_HOURS_MIN,
      TIMER_CHECK_IN_HOURS_MAX,
      'hours',
    );
    const minutes = checkWhole(
      grace,
      TIMER_CHECK_IN_GRACE_MIN,
      TIMER_CHECK_IN_GRACE_MAX,
      'minutes',
    );
    setFieldErr((f) => {
      const { hours: _h, grace: _g, ...rest } = f;
      return {
        ...rest,
        ...(typeof hours === 'string' && { hours }),
        ...(typeof minutes === 'string' && { grace: minutes }),
      };
    });
    if (typeof hours === 'string' || typeof minutes === 'string') {
      document
        .getElementById(typeof hours === 'string' ? 'timer-check-hours' : 'timer-check-grace')
        ?.focus();
      return;
    }
    setTimerSaving(true);
    try {
      const updated = await api.updateAppSettings({
        timerCheckInHours: hours,
        timerCheckInGraceMinutes: minutes,
      });
      setCheckHours(String(updated.timerCheckInHours));
      setGrace(String(updated.timerCheckInGraceMinutes));
      setTimerSaved(true);
    } catch (err) {
      setTimerError(err instanceof ApiError ? err.message : 'Failed to save settings');
    } finally {
      setTimerSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="App settings"
        subtitle="Global settings that apply to everyone in HL Central."
        search={false}
        newTask={false}
      />
      <div className="container settings-page hb-legacy-body">
        {error && <div className="alert error">{error}</div>}

        <section className="card settings-card">
          <h2 className="settings-card-title">Recurring tasks</h2>
          <div className="field">
            <label htmlFor="materialize-lead">Create repeating tasks (days ahead)</label>
            <input
              id="materialize-lead"
              type="number"
              min={MATERIALIZE_LEAD_DAYS_MIN}
              max={MATERIALIZE_LEAD_DAYS_MAX}
              value={lead}
              disabled={loading || saving}
              aria-invalid={!!fieldErr.lead}
              aria-describedby={fieldErr.lead ? 'materialize-lead-err' : undefined}
              onChange={(e) => {
                setLead(e.target.value);
                setSaved(false);
                clearField('lead');
              }}
              style={{ width: 100 }}
            />
            <FieldError id="materialize-lead-err" message={fieldErr.lead} />
            <p className="muted settings-help">
              Repeating tasks are created this many days before they’re due; later ones show as
              faded previews on the calendar.
            </p>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn-sm"
              onClick={() => void save()}
              disabled={loading || saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="settings-saved">Saved.</span>}
            {saveError && (
              <span className="settings-field-error" role="alert">
                {saveError}
              </span>
            )}
          </div>
        </section>

        <section className="card settings-card">
          <h2 className="settings-card-title">Timer</h2>
          <div className="field">
            <label htmlFor="timer-check-hours">Ask “Still working?” after (hours)</label>
            <input
              id="timer-check-hours"
              type="number"
              min={TIMER_CHECK_IN_HOURS_MIN}
              max={TIMER_CHECK_IN_HOURS_MAX}
              value={checkHours}
              disabled={loading || timerSaving}
              aria-invalid={!!fieldErr.hours}
              aria-describedby={fieldErr.hours ? 'timer-check-hours-err' : undefined}
              onChange={(e) => {
                setCheckHours(e.target.value);
                setTimerSaved(false);
                clearField('hours');
              }}
              style={{ width: 100 }}
            />
            <FieldError id="timer-check-hours-err" message={fieldErr.hours} />
            <p className="muted settings-help">
              After this long without a break, the timer asks whether you’re still working on the
              task. “Keep going” starts the count again.
            </p>
          </div>
          <div className="field">
            <label htmlFor="timer-check-grace">Stop it if nobody answers within (minutes)</label>
            <input
              id="timer-check-grace"
              type="number"
              min={TIMER_CHECK_IN_GRACE_MIN}
              max={TIMER_CHECK_IN_GRACE_MAX}
              value={grace}
              disabled={loading || timerSaving}
              aria-invalid={!!fieldErr.grace}
              aria-describedby={fieldErr.grace ? 'timer-check-grace-err' : undefined}
              onChange={(e) => {
                setGrace(e.target.value);
                setTimerSaved(false);
                clearField('grace');
              }}
              style={{ width: 100 }}
            />
            <FieldError id="timer-check-grace-err" message={fieldErr.grace} />
            <p className="muted settings-help">
              With no answer, the timer stops by itself and keeps the time up to when it asked, so a
              forgotten timer doesn’t count the hours after.
            </p>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn-sm"
              onClick={() => void saveTimer()}
              disabled={loading || timerSaving}
            >
              {timerSaving ? 'Saving…' : 'Save'}
            </button>
            {timerSaved && <span className="settings-saved">Saved.</span>}
            {timerError && (
              <span className="settings-field-error" role="alert">
                {timerError}
              </span>
            )}
          </div>
        </section>

        <ConnectSignInCard />

        {/* Admins only: the email queue dashboard (moved here from the profile page). */}
        <QueueDashboardCard />
      </div>
    </>
  );
}
