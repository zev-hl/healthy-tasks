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
  const [checkHours, setCheckHours] = useState(String(TIMER_CHECK_IN_HOURS_DEFAULT));
  const [grace, setGrace] = useState(String(TIMER_CHECK_IN_GRACE_DEFAULT));
  const [timerSaving, setTimerSaving] = useState(false);
  const [timerSaved, setTimerSaved] = useState(false);
  const [timerError, setTimerError] = useState<string | null>(null);

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
    setError(null);
    setSaved(false);
    const days = Number(lead);
    if (
      !Number.isInteger(days) ||
      days < MATERIALIZE_LEAD_DAYS_MIN ||
      days > MATERIALIZE_LEAD_DAYS_MAX
    ) {
      setError(
        `Enter a whole number of days between ${MATERIALIZE_LEAD_DAYS_MIN} and ${MATERIALIZE_LEAD_DAYS_MAX}.`,
      );
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateAppSettings({ materializeLeadDays: days });
      setLead(String(updated.materializeLeadDays));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function saveTimer() {
    setTimerError(null);
    setTimerSaved(false);
    const hours = Number(checkHours);
    const minutes = Number(grace);
    if (
      !Number.isInteger(hours) ||
      hours < TIMER_CHECK_IN_HOURS_MIN ||
      hours > TIMER_CHECK_IN_HOURS_MAX
    ) {
      setTimerError(
        `Enter a whole number of hours between ${TIMER_CHECK_IN_HOURS_MIN} and ${TIMER_CHECK_IN_HOURS_MAX}.`,
      );
      return;
    }
    if (
      !Number.isInteger(minutes) ||
      minutes < TIMER_CHECK_IN_GRACE_MIN ||
      minutes > TIMER_CHECK_IN_GRACE_MAX
    ) {
      setTimerError(
        `Enter a whole number of minutes between ${TIMER_CHECK_IN_GRACE_MIN} and ${TIMER_CHECK_IN_GRACE_MAX}.`,
      );
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
              onChange={(e) => {
                setLead(e.target.value);
                setSaved(false);
              }}
              style={{ width: 100 }}
            />
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
          </div>
        </section>

        <section className="card settings-card">
          <h2 className="settings-card-title">Timer</h2>
          {timerError && <div className="alert error">{timerError}</div>}
          <div className="field">
            <label htmlFor="timer-check-hours">Ask “Still working?” after (hours)</label>
            <input
              id="timer-check-hours"
              type="number"
              min={TIMER_CHECK_IN_HOURS_MIN}
              max={TIMER_CHECK_IN_HOURS_MAX}
              value={checkHours}
              disabled={loading || timerSaving}
              onChange={(e) => {
                setCheckHours(e.target.value);
                setTimerSaved(false);
              }}
              style={{ width: 100 }}
            />
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
              onChange={(e) => {
                setGrace(e.target.value);
                setTimerSaved(false);
              }}
              style={{ width: 100 }}
            />
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
          </div>
        </section>

        <ConnectSignInCard />

        {/* Admins only: the email queue dashboard (moved here from the profile page). */}
        <QueueDashboardCard />
      </div>
    </>
  );
}
