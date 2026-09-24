/**
 * Exclusives — New Group / Edit Group editor (HLAI-71 Chunk 8c).
 *
 * Matches the reference design: left "Listing" + "ASINs" cards, right "Alert
 * settings" panel. Now backed by the real API — an existing group is loaded
 * from the server, adding an ASIN resolves it against the seller account, and
 * Save creates or updates for real.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  EXCLUSIVES_ALERT_MODES,
  EXCLUSIVES_ALERT_TYPES,
  EXCLUSIVES_ALERT_TYPE_LABELS,
  type ExclusivesAlertMode,
  type ExclusivesAlertType,
  type ExclusivesGroupDto,
  type ExclusivesGroupType,
  type ExclusivesGroupWriteRequest,
  type ExclusivesListingClashDto,
  type ExclusivesLookupListingDto,
  type ExclusivesListingProblemDto,
  type ExclusivesMarketplace,
} from '@healthy-tasks/shared';
import { api, ApiError, exportExclusivesGroupToCsv } from '../api/client';
import { useStaleWriteGuard } from '../lib/useStaleWriteGuard';
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning';
import { formatTimestamp } from '../lib/datetime';
import { ConflictBanner } from '../components/ConflictBanner';
import { alertTone } from '../components/exclusives/AlertBadge';
import { Segmented } from '../components/exclusives/Segmented';
import { Flag } from '../components/exclusives/Flag';
import { Toast, useToast } from '../components/exclusives/Toast';
import { NoticeModal } from '../components/exclusives/NoticeModal';
import { AsinTakenModal } from '../components/exclusives/AsinTakenModal';
import { WarningIcon } from '../components/exclusives/icons';
import { BulkImportModal, type ImportRow } from '../components/exclusives/BulkImportModal';

type Settings = Record<ExclusivesAlertType, ExclusivesAlertMode>;

/** A centred message. Some close themselves; some carry on afterwards. */
interface Notice {
  title?: string;
  message: string;
  autoCloseMs?: number;
  onDone?: () => void;
}

/** How long a save error stays before clearing itself. */
const ERROR_VISIBLE_MS = 10_000;

/** One row of the ASIN list, with whatever the server last told us about it. */
interface AsinRow {
  asin: string;
  marketplace: ExclusivesMarketplace;
  title: string | null;
  /** The group that currently watches it — saving moves it here. */
  ownerId: number | null;
  ownerName: string | null;
  /** Why the last save refused this row, if it did. */
  problem: string | null;
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

const rowKey = (r: { asin: string; marketplace: string }) => `${r.marketplace}:${r.asin}`;

/** What the form holds, flattened, so "has anything changed?" is one compare. */
const snapshotOf = (kind: string, name: string, rows: AsinRow[], settings: Settings): string =>
  JSON.stringify({
    kind,
    name: name.trim(),
    rows: rows.map(rowKey).sort(),
    settings,
  });

export function ExclusivesEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const groupId = id ? Number(id) : null;
  const isNew = groupId === null;

  const [kind, setKind] = useState<ExclusivesGroupType>('GROUP');
  const [name, setName] = useState('');
  const [rows, setRows] = useState<AsinRow[]>([]);
  // Off by default — the creator switches on what they want (HLAI-71 §8 #16).
  const [settings, setSettings] = useState<Settings>(allMode('off'));
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | undefined>(undefined);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [baseline, setBaseline] = useState(() => snapshotOf('GROUP', '', [], allMode('off')));

  const [addAsin, setAddAsin] = useState('');
  const [addMarketplace, setAddMarketplace] = useState<ExclusivesMarketplace>('USA');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [taken, setTaken] = useState<{ asin: string; listing: ExclusivesLookupListingDto } | null>(
    null,
  );
  const { toast, showToast, clearToast } = useToast();
  const { conflict, bannerShown, guard, review, reset } = useStaleWriteGuard();

  /** Fill the form from a group the server returned, and treat that as saved. */
  const hydrate = useCallback((group: ExclusivesGroupDto) => {
    const next: AsinRow[] = group.listings.map((l) => ({
      asin: l.asin,
      marketplace: l.marketplace,
      title: l.title,
      ownerId: null,
      ownerName: null,
      problem: null,
    }));
    setKind(group.groupType);
    setName(group.name);
    setRows(next);
    setSettings({ ...allMode('off'), ...group.settings });
    setExpectedUpdatedAt(group.updatedAt);
    setSavedAt(group.updatedAt);
    setBaseline(
      snapshotOf(group.groupType, group.name, next, { ...allMode('off'), ...group.settings }),
    );
  }, []);

  useEffect(() => {
    if (isNew || groupId === null) return;
    let alive = true;
    setLoading(true);
    api
      .getExclusivesGroup(groupId)
      .then((group) => {
        if (alive) hydrate(group);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : 'Could not load the group');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [groupId, isNew, hydrate]);

  const onCount = EXCLUSIVES_ALERT_TYPES.filter((t) => settings[t] !== 'off').length;
  // An individual listing is exactly one product, so the add controls close
  // once it has one. Removing the row opens them again.
  const addLocked = kind === 'INDIVIDUAL' && rows.length >= 1;
  const dirty = useMemo(
    () => snapshotOf(kind, name, rows, settings) !== baseline,
    [kind, name, rows, settings, baseline],
  );
  useUnsavedChangesWarning(dirty && !saving);

  // A save error is about the attempt just made, not a standing condition,
  // so it steps out of the way rather than needing to be dismissed.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), ERROR_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [error]);

  // --- adding one ASIN ------------------------------------------------------

  async function addRow() {
    const asin = addAsin.trim().toUpperCase();
    if (!asin || adding) return;
    if (rows.some((r) => rowKey(r) === `${addMarketplace}:${asin}`)) {
      setNotice({
        title: 'Already in this group',
        message: `${asin} is already in the list below.`,
      });
      return;
    }

    setAdding(true);
    try {
      const res = await api.lookupExclusivesAsins({
        asins: [asin],
        marketplaces: [addMarketplace],
      });
      if (res.invalid.length > 0) {
        setNotice({
          title: 'Not a valid ASIN',
          message: `An ASIN should be 10 characters long.`,
        });
        return;
      }

      const result = res.results[0];
      const listing = result?.listings.find((l) => l.marketplace === addMarketplace);

      if (!listing) {
        // The one failure worth retrying must never read like the final one.
        setNotice(
          result?.status === 'unavailable'
            ? {
                title: 'Amazon did not answer',
                message: `Please try adding ${asin} again in a moment.`,
              }
            : {
                title: 'Not on the seller account',
                message: `${asin} was not found on the seller account in ${addMarketplace}.`,
              },
        );
        return;
      }

      if (listing.groupId !== null && listing.groupId !== groupId) {
        // Taking a product from another group is a choice, not a side effect.
        setTaken({ asin, listing });
        return;
      }
      insertRow(asin, listing, false);
    } catch (err) {
      setNotice({
        title: 'Could not check that ASIN',
        message:
          err instanceof ApiError
            ? err.message
            : `Couldn't check ${asin} right now. Please try again in a moment.`,
      });
    } finally {
      setAdding(false);
    }
  }

  /** Put a resolved listing into the list, noting where it is coming from. */
  function insertRow(asin: string, listing: ExclusivesLookupListingDto, fromGroup: boolean) {
    setRows((prev) => [
      ...prev,
      {
        asin,
        marketplace: listing.marketplace,
        title: listing.title,
        ownerId: fromGroup ? listing.groupId : null,
        ownerName: fromGroup ? listing.groupName : null,
        problem: null,
      },
    ]);
    setAddAsin('');
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => rowKey(r) !== key));
  }

  /** The import replaces the list on screen; the editor's Save persists it. */
  function applyImport(imported: ImportRow[]) {
    setRows(
      imported.map((r) => ({
        asin: r.asin,
        marketplace: r.marketplace,
        title: r.title,
        ownerId: r.ownerId,
        ownerName: r.ownerName,
        problem: null,
      })),
    );
    setImporting(false);
    setNotice({
      title: 'Imported',
      message: `${imported.length} ASIN(s) ready — click Save to apply.`,
      autoCloseMs: 3_000,
    });
  }

  async function onExportList() {
    if (groupId === null) return;
    setExporting(true);
    try {
      await exportExclusivesGroupToCsv(groupId);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Download failed.', 'error');
    } finally {
      setExporting(false);
    }
  }

  // --- saving ---------------------------------------------------------------

  function applyProblems(details: unknown): boolean {
    const d = details as
      | { listings?: ExclusivesListingProblemDto[]; clashes?: ExclusivesListingClashDto[] }
      | undefined;
    const problems = new Map<string, string>();
    for (const p of d?.listings ?? []) {
      problems.set(
        rowKey(p),
        p.reason === 'unavailable' ? 'Amazon did not answer' : 'Not on the seller account',
      );
    }
    const clashes = new Map((d?.clashes ?? []).map((c) => [rowKey(c), c]));
    if (problems.size === 0 && clashes.size === 0) return false;

    setRows((prev) =>
      prev.map((r) => {
        const key = rowKey(r);
        const clash = clashes.get(key);
        if (clash) {
          return { ...r, ownerId: clash.groupId, ownerName: clash.groupName, problem: null };
        }
        return { ...r, problem: problems.get(key) ?? null };
      }),
    );
    return true;
  }

  async function save(moveExisting: boolean) {
    setSaving(true);
    setError(null);
    setNameError(null);
    try {
      const body: ExclusivesGroupWriteRequest = {
        name: name.trim() || undefined,
        groupType: kind,
        listings: rows.map((r) => ({ asin: r.asin, marketplace: r.marketplace })),
        // The editor shows the whole list, so what is on screen is the group.
        // 'merge' would quietly ignore rows the person removed.
        listingsMode: 'replace',
        moveExisting: moveExisting || rows.some((r) => r.ownerId !== null),
        settings,
        expectedUpdatedAt,
      };

      const ok = await guard(async () => {
        const saved = isNew
          ? await api.createExclusivesGroup(body)
          : await api.updateExclusivesGroup(groupId as number, body);
        hydrate(saved);
        setNotice({
          title: 'Group saved successfully',
          message: `“${saved.name}” now watches ${saved.listings.length} ASIN(s).`,
          onDone: () => navigate('/exclusives/groups'),
        });
      });
      if (!ok) return; // a stale write; the conflict banner explains it
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setError('Could not save the group');
        return;
      }
      const code = (err.details as { code?: string } | undefined)?.code;
      if (code === 'DUPLICATE_NAME') setNameError(err.message);
      applyProblems(err.details);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function refreshAfterConflict() {
    if (groupId === null) return;
    try {
      hydrate(await api.getExclusivesGroup(groupId));
      reset();
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reload the group');
    }
  }

  const clashing = rows.filter((r) => r.ownerId !== null);
  const crumb = isNew ? 'New group' : name || 'Group';

  return (
    <div className="exc-page exc-editor">
      <div className="exc-crumbbar">
        <Link to="/exclusives/groups" className="exc-crumb-link mono">
          Alert Groups
        </Link>
        <span className="exc-crumb-sep mono">/</span>
        <span className="exc-crumb mono">{crumb}</span>
        <div className="exc-crumb-right">
          <span className="mono exc-crumb-meta">
            {savedAt ? `Saved ${formatTimestamp(savedAt)}` : 'Not yet saved'}
          </span>
          <span className="exc-crumb-div" />
          {dirty && <span className="mono exc-crumb-hint">Unsaved changes</span>}
          <button
            type="button"
            className="secondary"
            onClick={() => navigate('/exclusives/groups')}
          >
            Cancel
          </button>
          {conflict ? (
            <button type="button" onClick={() => void refreshAfterConflict()}>
              Refresh
            </button>
          ) : (
            <button type="button" onClick={() => void save(false)} disabled={saving || loading}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {bannerShown && <ConflictBanner entity="group" onReview={review} />}
      {error && <div className="alert error">{error}</div>}
      {clashing.length > 0 && (
        <div className="alert warning">
          <WarningIcon />
          <span>
            {clashing.length} ASIN{clashing.length === 1 ? '' : 's'} listed below{' '}
            {clashing.length === 1 ? 'is' : 'are'} watched by another group. Saving moves{' '}
            {clashing.length === 1 ? 'it' : 'them'} here, keeping{' '}
            {clashing.length === 1 ? 'its' : 'their'} history.
          </span>
        </div>
      )}

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
              <span className={`exc-field-help${nameError ? ' error' : ''}`}>
                {nameError ??
                  (kind === 'GROUP'
                    ? 'Required and must be unique across all groups.'
                    : 'Leave blank and the Amazon title is used.')}
              </span>
            </div>
          </section>

          <section className="card exc-panel exc-asin-panel">
            <div className="exc-panel-head exc-asin-head">
              <span className="exc-panel-title">ASINs</span>
              <span className="mono muted">
                {rows.length} {kind === 'GROUP' ? 'in this group' : '(individual)'}
              </span>
              <div className="exc-asin-head-btns">
                <button
                  type="button"
                  className="secondary btn-sm"
                  onClick={() => setImporting(true)}
                  disabled={kind === 'INDIVIDUAL'}
                >
                  Bulk import &amp; replace
                </button>
                <button
                  type="button"
                  className="secondary btn-sm"
                  onClick={() => void onExportList()}
                  disabled={isNew || exporting || rows.length === 0}
                  title={isNew ? 'Save the group first' : undefined}
                >
                  {exporting ? 'Preparing…' : 'Export list'}
                </button>
              </div>
            </div>

            <div className="exc-add-row">
              <input
                className="exc-input mono exc-add-asin"
                value={addAsin}
                onChange={(e) => setAddAsin(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addRow()}
                placeholder={
                  addLocked ? 'Remove the ASIN to choose another' : 'Add ASIN, e.g. B0C7QMV3RK'
                }
                aria-label="Add ASIN"
                disabled={adding || addLocked}
              />
              <div className="exc-country" role="group" aria-label="Marketplace">
                <button
                  type="button"
                  className={`exc-country-btn${addMarketplace === 'USA' ? ' active us' : ''}`}
                  onClick={() => setAddMarketplace('USA')}
                  disabled={addLocked}
                >
                  USA
                </button>
                <button
                  type="button"
                  className={`exc-country-btn${addMarketplace === 'Canada' ? ' active ca' : ''}`}
                  onClick={() => setAddMarketplace('Canada')}
                  disabled={addLocked}
                >
                  Canada
                </button>
              </div>
              <button type="button" onClick={() => void addRow()} disabled={adding || addLocked}>
                {adding ? 'Checking…' : 'Add'}
              </button>
            </div>

            <div className="exc-asin-table">
              <div className="exc-asin-thead">
                <span className="exc-asin-c-asin">ASIN</span>
                <span className="exc-asin-c-title">Title</span>
                <span className="exc-asin-c-plat">Platform</span>
                <span className="exc-asin-c-x" />
              </div>
              {loading ? (
                <div className="exc-asin-empty muted">Loading…</div>
              ) : rows.length === 0 ? (
                <div className="exc-asin-empty muted">No ASINs yet — add one above.</div>
              ) : (
                rows.map((r) => (
                  <div className="exc-asin-trow" key={rowKey(r)}>
                    <span className="exc-asin-c-asin mono">{r.asin}</span>
                    <span className="exc-asin-c-title">
                      {r.title ?? <span className="muted">No title yet</span>}
                      {r.problem && <span className="exc-log-detail error"> {r.problem}</span>}
                      {r.ownerName && (
                        <span className="exc-log-detail"> Moving from “{r.ownerName}”</span>
                      )}
                    </span>
                    <span className="exc-asin-c-plat">
                      <Flag platform={r.marketplace} />
                    </span>
                    <button
                      type="button"
                      className="exc-asin-c-x exc-asin-remove"
                      onClick={() => removeRow(rowKey(r))}
                      aria-label={`Remove ${r.asin}`}
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
            <button
              type="button"
              className="exc-quick accent"
              onClick={() => setSettings(allMode('daily'))}
            >
              All daily
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
                  <span
                    className="exc-settings-dot"
                    style={{ background: dot }}
                    aria-hidden="true"
                  />
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

      {importing && (
        <BulkImportModal
          groupId={groupId}
          current={rows.map((r) => ({ asin: r.asin, marketplace: r.marketplace }))}
          onCancel={() => setImporting(false)}
          onImport={applyImport}
        />
      )}

      {taken && (
        <AsinTakenModal
          asin={taken.asin}
          listing={taken.listing}
          groupName={name}
          onCancel={() => setTaken(null)}
          onMove={() => {
            insertRow(taken.asin, taken.listing, true);
            setTaken(null);
          }}
        />
      )}

      {notice && (
        <NoticeModal
          title={notice.title}
          message={notice.message}
          autoCloseMs={notice.autoCloseMs}
          onClose={() => {
            const done = notice.onDone;
            setNotice(null);
            done?.();
          }}
        />
      )}

      <Toast toast={toast} onClose={clearToast} />
    </div>
  );
}
