import { useEffect, useState } from 'react';
import {
  DEFAULT_MATERIALIZE_LEAD_DAYS,
  MATERIALIZE_LEAD_DAYS_MAX,
  MATERIALIZE_LEAD_DAYS_MIN,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';

/**
 * Admin-only global settings. Currently the single materialization lead time
 * that every recurring template and task reads from (there is no per-template or
 * per-task override).
 */
export function SettingsPage() {
  const [lead, setLead] = useState(String(DEFAULT_MATERIALIZE_LEAD_DAYS));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void api
      .getAppSettings()
      .then((s) => {
        if (alive) setLead(String(s.materializeLeadDays));
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

  return (
    <div className="container settings-page">
      <header className="page-head">
        <h1>Settings</h1>
        <p className="muted">Global settings that apply to everyone in HL Central.</p>
      </header>

      {error && <div className="alert error">{error}</div>}

      <section className="card settings-card">
        <h2 className="settings-card-title">Recurring tasks</h2>
        <div className="field">
          <label htmlFor="materialize-lead">Materialize (days ahead)</label>
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
            Occurrences turn into real tasks this many days before they’re due; further-out ones
            show as ghost previews.
          </p>
        </div>
        <div className="btn-row">
          <button type="button" className="btn-sm" onClick={() => void save()} disabled={loading || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="settings-saved">Saved.</span>}
        </div>
      </section>
    </div>
  );
}
