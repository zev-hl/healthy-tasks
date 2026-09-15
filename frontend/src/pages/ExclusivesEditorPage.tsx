/**
 * Exclusives — New Group / Edit Group editor (HLAI-71).
 *
 * Matches the reference design: left "Listing" + "ASINs" cards, right "Alert
 * settings" panel with per-type Off/Daily/Immediate toggles. State is local and
 * seeded from static mock data; Save/Cancel just navigate back for now (no
 * persistence until the backend lands).
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  EXCLUSIVES_ALERT_MODES,
  EXCLUSIVES_ALERT_TYPES,
  EXCLUSIVES_ALERT_TYPE_LABELS,
  type ExclusivesAlertMode,
  type ExclusivesAlertType,
  type ExclusivesGroupType,
} from '@healthy-tasks/shared';
import { MOCK_GROUPS, type AsinRow, type Marketplace } from '../lib/exclusivesMock';
import { alertTone } from '../components/exclusives/AlertBadge';
import { Segmented } from '../components/exclusives/Segmented';
import { Flag } from '../components/exclusives/Flag';

type Settings = Record<ExclusivesAlertType, ExclusivesAlertMode>;

/** Derive the mockup's per-type settings from a group's "on" count. */
function deriveSettings(onCount: number): Settings {
  const s = {} as Settings;
  EXCLUSIVES_ALERT_TYPES.forEach((t, i) => {
    s[t] = i < onCount ? (i % 3 === 0 ? 'daily' : 'immediate') : 'off';
  });
  return s;
}

const allMode = (mode: ExclusivesAlertMode): Settings => {
  const s = {} as Settings;
  EXCLUSIVES_ALERT_TYPES.forEach((t) => (s[t] = mode));
  return s;
};

const MODE_OPTIONS = EXCLUSIVES_ALERT_MODES.map((m) => ({
  value: m,
  label: m.charAt(0).toUpperCase() + m.slice(1),
}));

export function ExclusivesEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const existing = useMemo(() => MOCK_GROUPS.find((g) => g.id === id), [id]);

  const [kind, setKind] = useState<ExclusivesGroupType>(existing?.kind ?? 'GROUP');
  const [name, setName] = useState(existing?.name ?? '');
  const [asins, setAsins] = useState<AsinRow[]>(existing ? [...existing.asins] : []);
  const [settings, setSettings] = useState<Settings>(
    existing ? deriveSettings(existing.onCount) : allMode('immediate'),
  );
  const [addAsin, setAddAsin] = useState('');
  const [addPlatform, setAddPlatform] = useState<Marketplace>('USA');

  const onCount = EXCLUSIVES_ALERT_TYPES.filter((t) => settings[t] !== 'off').length;
  const crumb = existing ? existing.name : 'New group';

  function addRow() {
    const code = addAsin.trim().toUpperCase();
    if (!code) return;
    setAsins((prev) => [...prev, { asin: code, title: '', platform: addPlatform }]);
    setAddAsin('');
  }

  function removeRow(idx: number) {
    setAsins((prev) => prev.filter((_, i) => i !== idx));
  }

  function togglePlatform(idx: number) {
    setAsins((prev) =>
      prev.map((a, i) =>
        i === idx ? { ...a, platform: a.platform === 'USA' ? 'Canada' : 'USA' } : a,
      ),
    );
  }

  return (
    <div className="exc-page exc-editor">
      <div className="exc-crumbbar">
        <Link to="/exclusives/groups" className="exc-crumb-link mono">
          Alert Groups
        </Link>
        <span className="exc-crumb-sep mono">/</span>
        <span className="exc-crumb mono">{crumb}</span>
        <div className="exc-crumb-right">
          <span className="mono exc-crumb-meta">{existing ? 'Last saved earlier' : 'Not yet saved'}</span>
          <span className="exc-crumb-div" />
          <span className="mono exc-crumb-hint">Unsaved changes</span>
          <button type="button" className="secondary" onClick={() => navigate('/exclusives/groups')}>
            Cancel
          </button>
          <button type="button" onClick={() => navigate('/exclusives/groups')}>
            Save
          </button>
        </div>
      </div>

      <div className="exc-editor-body">
        <div className="exc-editor-left">
          <section className="card exc-panel">
            <div className="exc-panel-head">
              <span className="exc-panel-title">Listing</span>
              <div className="exc-panel-head-right">
                <Segmented
                  ariaLabel="Listing type"
                  tone="ink"
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: 'INDIVIDUAL', label: 'Individual' },
                    { value: 'GROUP', label: 'Group' },
                  ]}
                />
              </div>
            </div>
            <div className="exc-field">
              <label className="exc-field-label" htmlFor="exc-name">
                {kind === 'GROUP' ? 'Group name' : 'ASIN title'}
              </label>
              <input
                id="exc-name"
                className="exc-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  kind === 'GROUP'
                    ? 'e.g. Nordic Vitality — Omega line'
                    : 'Pulled from Amazon once the ASIN is added'
                }
              />
              <span className="exc-field-help">
                {kind === 'GROUP'
                  ? 'Required and must be unique across all groups.'
                  : 'An individual listing is stored as a single-ASIN group.'}
              </span>
            </div>
          </section>

          <section className="card exc-panel exc-asin-panel">
            <div className="exc-panel-head exc-asin-head">
              <span className="exc-panel-title">ASINs</span>
              <span className="mono muted">
                {asins.length} {kind === 'GROUP' ? 'in this group' : '(individual)'}
              </span>
              <div className="exc-asin-head-btns">
                <button type="button" className="secondary btn-sm">
                  Bulk import &amp; replace
                </button>
                <button type="button" className="secondary btn-sm">
                  Export list
                </button>
              </div>
            </div>

            <div className="exc-add-row">
              <input
                className="exc-input mono exc-add-asin"
                value={addAsin}
                onChange={(e) => setAddAsin(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addRow()}
                placeholder="Add ASIN, e.g. B0C7QMV3RK"
              />
              <div className="exc-country" role="group" aria-label="Marketplace">
                <button
                  type="button"
                  className={`exc-country-btn${addPlatform === 'USA' ? ' active us' : ''}`}
                  onClick={() => setAddPlatform('USA')}
                >
                  USA
                </button>
                <button
                  type="button"
                  className={`exc-country-btn${addPlatform === 'Canada' ? ' active ca' : ''}`}
                  onClick={() => setAddPlatform('Canada')}
                >
                  Canada
                </button>
              </div>
              <button type="button" onClick={addRow}>
                Add
              </button>
            </div>

            <div className="exc-asin-table">
              <div className="exc-asin-thead">
                <span className="exc-asin-c-asin">ASIN</span>
                <span className="exc-asin-c-title">Title</span>
                <span className="exc-asin-c-plat">Platform</span>
                <span className="exc-asin-c-x" />
              </div>
              {asins.length === 0 ? (
                <div className="exc-asin-empty muted">No ASINs yet — add one above.</div>
              ) : (
                asins.map((a, i) => (
                  <div className="exc-asin-trow" key={`${a.asin}-${i}`}>
                    <span className="exc-asin-c-asin mono">{a.asin}</span>
                    <span className="exc-asin-c-title">
                      {a.title || <span className="muted">Fetching from Amazon…</span>}
                    </span>
                    <button
                      type="button"
                      className="exc-asin-c-plat exc-plat-toggle"
                      onClick={() => togglePlatform(i)}
                      title="Toggle marketplace"
                    >
                      <Flag platform={a.platform} />
                    </button>
                    <button
                      type="button"
                      className="exc-asin-c-x exc-asin-remove"
                      onClick={() => removeRow(i)}
                      aria-label={`Remove ${a.asin}`}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <section className="card exc-panel exc-settings">
          <span className="exc-panel-title">Alert settings</span>
          <p className="exc-settings-sub">Daily and Immediate both mean “on” in this phase.</p>
          <div className="exc-settings-status">
            <span className="mono exc-settings-count">{onCount} of 12 on</span>
            <button
              type="button"
              className="exc-quick accent"
              onClick={() => setSettings(allMode('immediate'))}
            >
              All immediate
            </button>
            <button type="button" className="exc-quick" onClick={() => setSettings(allMode('off'))}>
              All off
            </button>
          </div>

          <div className="exc-settings-rows">
            {EXCLUSIVES_ALERT_TYPES.map((t) => {
              const mode = settings[t];
              const dot = mode === 'off' ? 'var(--border-dashed)' : alertTone(t).dot;
              return (
                <div className="exc-settings-row" key={t}>
                  <span className="exc-settings-dot" style={{ background: dot }} aria-hidden="true" />
                  <span className="exc-settings-name">{EXCLUSIVES_ALERT_TYPE_LABELS[t]}</span>
                  <Segmented
                    ariaLabel={EXCLUSIVES_ALERT_TYPE_LABELS[t]}
                    size="sm"
                    value={mode}
                    options={MODE_OPTIONS}
                    onChange={(v) => setSettings((prev) => ({ ...prev, [t]: v }))}
                    tone={mode === 'off' ? 'neutral' : 'accent'}
                  />
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
