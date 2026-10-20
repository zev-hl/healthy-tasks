import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  EXCLUSIVES_ALERT_TYPES,
  EXCLUSIVES_ALERT_TYPE_LABELS,
  dutyLabel,
  type ActiveUserDto,
  type ExclusivesAlertTaskSettingDto,
  type ExclusivesAlertTaskSetupDto,
  type ExclusivesAlertType,
  type RoleAssignment,
  type TemplateDto,
  type TemplateSummaryDto,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { ConflictBanner } from '../components/ConflictBanner';
import { AlertTypeBadge } from '../components/exclusives/AlertBadge';
import { LoadingRow } from '../components/exclusives/LoadingRow';
import { SearchSelect, type SearchSelectOption } from '../components/SearchSelect';
import { userLabel } from '../components/ui/Avatar';
import { holdsDuty, useDutyCatalog, type CatalogDuty } from '../lib/duties';
import { useStaleWriteGuard } from '../lib/useStaleWriteGuard';
import { useUnsavedChangesWarning } from '../lib/useUnsavedChangesWarning';

/** Every alert type's setting, by type. */
type Setup = Record<ExclusivesAlertType, ExclusivesAlertTaskSettingDto>;

/** A chosen template's roles and tasks, once loaded (or why not). */
type Details = Record<number, TemplateDto | 'error'>;

const emptySetting = (alertType: ExclusivesAlertType): ExclusivesAlertTaskSettingDto => ({
  alertType,
  templateId: null,
  roleAssignments: [],
});

/** Only the roles someone fills, by role name: one way to write each setup. */
const tidy = (assignments: RoleAssignment[]): RoleAssignment[] =>
  assignments.filter((a) => a.assigneeId !== null).sort((a, b) => a.role.localeCompare(b.role));

/** The saved settings as one entry per alert type; a type not saved yet has none. */
function toSetup(settings: ExclusivesAlertTaskSettingDto[]): Setup {
  const byType = new Map(settings.map((s) => [s.alertType, s]));
  return Object.fromEntries(
    EXCLUSIVES_ALERT_TYPES.map((t) => {
      const s = byType.get(t) ?? emptySetting(t);
      return [t, { ...s, roleAssignments: tidy(s.roleAssignments) }];
    }),
  ) as Setup;
}

/**
 * A setting as it would be saved: only the people for roles its template has.
 * A row keeps the people it had while its template changes, so switching to a
 * template with a role of the same name keeps that person.
 */
function effective(s: ExclusivesAlertTaskSettingDto, details: Details) {
  if (s.templateId === null) return { ...s, roleAssignments: [] };
  const t = details[s.templateId];
  const roles = t && t !== 'error' ? new Set(t.roles) : null;
  return { ...s, roleAssignments: s.roleAssignments.filter((a) => !roles || roles.has(a.role)) };
}

/** The settings in the screen's order, as they are sent and compared. */
const inOrder = (setup: Setup, details: Details) =>
  EXCLUSIVES_ALERT_TYPES.map((t) => effective(setup[t], details));

/** The duties a template's role needs: those its tasks for that role carry. */
const roleNeeds = (template: TemplateDto, role: string): string[] => [
  ...new Set(
    template.nodes
      .filter((n) => n.assigneeRole === role && n.dutyId)
      .map((n) => n.dutyId as string),
  ),
];

/**
 * HLAI-112: the Alert Tasks screen. One row per Exclusives alert type: the
 * template its tasks are made from, and who fills each of that template's
 * roles. The same for every alert group. Admins only.
 *
 * The roles work as in the template's Create tasks window: a person per role,
 * ⚠ for someone missing a duty that role's tasks carry. Nothing is kept until
 * Save, which sends every row at once; Cancel puts back what was last saved.
 * Both stay off until something has changed, and leaving with changes not
 * saved asks first. If another Admin saved first, Save turns into Refresh, as
 * in the group editor.
 */
export function ExclusivesAlertTasksPage() {
  const [templates, setTemplates] = useState<TemplateSummaryDto[] | null>(null);
  const [users, setUsers] = useState<ActiveUserDto[]>([]);
  const [saved, setSaved] = useState<Setup | null>(null);
  const [draft, setDraft] = useState<Setup | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [details, setDetails] = useState<Details>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0); // "Try again" loads once more
  const [notice, setNotice] = useState<string | null>(null);
  const catalog = useDutyCatalog();
  const { conflict, bannerShown, guard, review, reset } = useStaleWriteGuard();

  /** Show a setup as saved: on screen, with nothing changed yet. */
  function load(setup: ExclusivesAlertTaskSetupDto) {
    const loaded = toSetup(setup.settings);
    setSaved(loaded);
    setDraft(loaded);
    setUpdatedAt(setup.updatedAt);
  }

  useEffect(() => {
    let alive = true;
    Promise.all([api.listTemplates(), api.listActiveUsers(), api.getExclusivesAlertTaskSetup()])
      .then(([list, people, setup]) => {
        if (!alive) return;
        setTemplates(list);
        setUsers([...people].sort((a, b) => userLabel(a).localeCompare(userLabel(b))));
        load(setup);
      })
      .catch((err) => {
        if (!alive) return;
        setLoadError(err instanceof ApiError ? err.message : 'Could not load the alert tasks.');
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  function tryAgain() {
    setLoadError(null);
    setAttempt((n) => n + 1);
  }

  // Each chosen template's roles and tasks, fetched once when first picked.
  const chosenIds = useMemo(
    () =>
      draft
        ? [
            ...new Set(
              EXCLUSIVES_ALERT_TYPES.map((t) => draft[t].templateId).filter(
                (id): id is number => id !== null,
              ),
            ),
          ]
        : [],
    [draft],
  );
  const requested = useRef(new Set<number>());
  useEffect(() => {
    for (const id of chosenIds) {
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      api
        .getTemplate(id)
        .then((t) => setDetails((d) => ({ ...d, [id]: t })))
        .catch(() => setDetails((d) => ({ ...d, [id]: 'error' })));
    }
  }, [chosenIds]);

  const templateOptions = useMemo<SearchSelectOption[]>(
    () =>
      [...(templates ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({ value: String(t.id), label: t.name })),
    [templates],
  );
  const activeIds = useMemo(() => new Set(users.map((u) => u.id)), [users]);

  /** The duties a chosen person is missing for a role (none while duties load). */
  const missingDuties = useCallback(
    (template: TemplateDto, role: string, userId: string): string[] =>
      catalog.loading
        ? []
        : roleNeeds(template, role).filter((d) => !holdsDuty(catalog.holdings, userId, d)),
    [catalog.loading, catalog.holdings],
  );

  const loading = draft === null;
  const rolesLoading = chosenIds.some((id) => details[id] === undefined);
  const dirty =
    saved !== null &&
    draft !== null &&
    JSON.stringify(inOrder(draft, details)) !== JSON.stringify(inOrder(saved, details));

  // Leaving the page (a link, Back, a reload) with changes not saved asks first.
  useUnsavedChangesWarning(dirty && !saving);

  // Who cannot be saved as picked: missing a duty, or no longer active.
  const problems = draft
    ? inOrder(draft, details).flatMap((s) => {
        const t = s.templateId === null ? undefined : details[s.templateId];
        if (!t || t === 'error') return [];
        return s.roleAssignments.filter(
          (a) =>
            a.assigneeId !== null &&
            (!activeIds.has(a.assigneeId) || missingDuties(t, a.role, a.assigneeId).length > 0),
        );
      }).length
    : 0;

  const saveBlocker = !dirty
    ? 'Nothing has changed yet'
    : rolesLoading || catalog.loading
      ? 'Still loading the templates’ roles'
      : problems > 0
        ? 'Someone picked can’t fill their role yet: see the ⚠ below'
        : undefined;

  function update(type: ExclusivesAlertType, change: Partial<ExclusivesAlertTaskSettingDto>) {
    setNotice(null);
    setDraft((d) => (d ? { ...d, [type]: { ...d[type], ...change } } : d));
  }

  function pickTemplate(type: ExclusivesAlertType, value: string | null) {
    update(type, { templateId: value === null ? null : Number(value) });
  }

  function pickPerson(type: ExclusivesAlertType, role: string, assigneeId: string) {
    if (!draft) return;
    const others = draft[type].roleAssignments.filter((a) => a.role !== role);
    update(type, {
      roleAssignments: tidy([...others, { role, assigneeId: assigneeId || null }]),
    });
  }

  function cancel() {
    setDraft(saved);
    setError(null);
    setNotice(null);
  }

  async function save() {
    if (!draft || saveBlocker) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const ok = await guard(async () => {
        load(
          await api.saveExclusivesAlertTaskSetup({
            settings: inOrder(draft, details),
            expectedUpdatedAt: updatedAt,
          }),
        );
        setNotice('Saved.');
      });
      if (!ok) return; // another Admin saved first; the conflict banner explains
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the alert tasks.');
    } finally {
      setSaving(false);
    }
  }

  async function refreshAfterConflict() {
    try {
      load(await api.getExclusivesAlertTaskSetup());
      reset();
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reload the alert tasks.');
    }
  }

  return (
    <div className="exc-page alert-tasks">
      <header className="page-head exc-head">
        <div>
          <h1>Alert Task Setup</h1>
          <p className="muted">
            The template each alert type&apos;s tasks are made from, and who does them. The same for
            every alert group.
          </p>
        </div>
        <div className="exc-actions">
          {dirty && <span className="mono exc-crumb-hint">Unsaved changes</span>}
          <button
            type="button"
            className="secondary"
            onClick={cancel}
            disabled={!dirty || saving}
            title={!dirty ? 'Nothing has changed yet' : undefined}
          >
            Cancel
          </button>
          {conflict ? (
            <button type="button" onClick={() => void refreshAfterConflict()}>
              Refresh
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void save()}
              disabled={saveBlocker !== undefined || saving}
              title={saveBlocker}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </header>

      {bannerShown && <ConflictBanner entity="alert task setup" onReview={review} />}
      {error && <div className="alert error">{error}</div>}
      {catalog.error && (
        <div className="alert error">Could not load the duties, so they are not checked.</div>
      )}
      {notice && <div className="alert success">{notice}</div>}
      {templates !== null && templates.length === 0 && (
        <div className="alert info alert-tasks-note">
          There are no templates yet. Make one on the <Link to="/admin/templates">Templates</Link>{' '}
          page, then pick it here.
        </div>
      )}

      <section className="card exc-table-card" aria-label="Alert types">
        <div className="exc-table-scroll">
          <table className="results-table exc-table alert-tasks-table">
            <thead>
              <tr>
                <th>Alert Type</th>
                <th>Template</th>
                <th>Role Assignment</th>
              </tr>
            </thead>
            <tbody>
              {loadError ? (
                <tr>
                  <td className="empty-cell" colSpan={3}>
                    <div className="empty-state compact alert-tasks-load-error">
                      <span className="alert-tasks-warn">{loadError}</span>
                      <button type="button" className="secondary btn-sm" onClick={tryAgain}>
                        Try again
                      </button>
                    </div>
                  </td>
                </tr>
              ) : loading ? (
                <LoadingRow colSpan={3} />
              ) : (
                EXCLUSIVES_ALERT_TYPES.map((type) => {
                  const setting = draft?.[type] ?? emptySetting(type);
                  const label = EXCLUSIVES_ALERT_TYPE_LABELS[type];
                  return (
                    <tr key={type}>
                      <td className="alert-tasks-type">
                        <AlertTypeBadge type={type} />
                      </td>
                      <td className="alert-tasks-template">
                        <SearchSelect
                          label={`Template for ${label}`}
                          options={templateOptions}
                          value={setting.templateId === null ? null : String(setting.templateId)}
                          valueLabel="Template no longer exists"
                          disabled={loading || saving}
                          onChange={(v) => pickTemplate(type, v)}
                        />
                      </td>
                      <td className="alert-tasks-roles">
                        <RoleCell
                          typeLabel={label}
                          setting={setting}
                          template={
                            setting.templateId === null ? null : details[setting.templateId]
                          }
                          users={users}
                          activeIds={activeIds}
                          duties={catalog.duties}
                          missingDuties={missingDuties}
                          holds={(userId, dutyId) => holdsDuty(catalog.holdings, userId, dutyId)}
                          dutiesLoading={catalog.loading}
                          disabled={saving}
                          onPick={(role, userId) => pickPerson(type, role, userId)}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/**
 * One alert type's Role Assignment cell: each role of its template with a
 * person, as the Create tasks window asks for them.
 */
function RoleCell({
  typeLabel,
  setting,
  template,
  users,
  activeIds,
  duties,
  missingDuties,
  holds,
  dutiesLoading,
  disabled,
  onPick,
}: {
  typeLabel: string;
  setting: ExclusivesAlertTaskSettingDto;
  /** null: no template; undefined: still loading. */
  template: TemplateDto | 'error' | null | undefined;
  users: ActiveUserDto[];
  activeIds: Set<string>;
  duties: Map<string, CatalogDuty>;
  missingDuties: (template: TemplateDto, role: string, userId: string) => string[];
  holds: (userId: string, dutyId: string) => boolean;
  dutiesLoading: boolean;
  disabled: boolean;
  onPick: (role: string, userId: string) => void;
}) {
  if (template === null) return <span className="muted">Pick a template first</span>;
  if (template === undefined) return <span className="muted">Loading roles…</span>;
  if (template === 'error') {
    return <span className="alert-tasks-warn">Could not load this template&apos;s roles.</span>;
  }
  if (template.roles.length === 0) {
    return <span className="muted">No roles: its tasks will be unassigned</span>;
  }

  return (
    <div className="alert-tasks-role-list">
      {template.roles.map((role) => {
        const tasks = template.nodes.filter((n) => n.assigneeRole === role).length;
        const needs = roleNeeds(template, role);
        const pid = setting.roleAssignments.find((a) => a.role === role)?.assigneeId ?? '';
        const gone = pid !== '' && !activeIds.has(pid);
        const missing = pid && !gone ? missingDuties(template, role, pid) : [];
        return (
          <div key={role} className="alert-tasks-role">
            <div>
              <span className="dd-role-chip">{role}</span>
              <div className="muted alert-tasks-role-meta">
                {tasks} {tasks === 1 ? 'task' : 'tasks'} · needs {needs.length}{' '}
                {needs.length === 1 ? 'duty' : 'duties'}
              </div>
            </div>
            <select
              value={pid}
              aria-label={`Person for ${role} (${typeLabel})`}
              disabled={disabled}
              onChange={(e) => onPick(role, e.target.value)}
            >
              <option value="">— Leave unassigned —</option>
              {gone && <option value={pid}>A deactivated person</option>}
              {users.map((u) => {
                const ok = dutiesLoading || needs.every((d) => holds(u.id, d));
                return (
                  <option key={u.id} value={u.id}>
                    {ok ? '' : '⚠ '}
                    {userLabel(u)}
                  </option>
                );
              })}
            </select>
            <div className="alert-tasks-role-status">
              {!pid ? (
                <span className="muted">Tasks will be unassigned</span>
              ) : gone ? (
                <span className="alert-tasks-warn">⚠ No longer active: pick someone else</span>
              ) : missing.length > 0 ? (
                missing.map((d) => {
                  const duty = duties.get(d);
                  return (
                    <div key={d} className="alert-tasks-warn">
                      ⚠ Doesn’t hold {duty ? dutyLabel(duty) : 'a required duty'}
                    </div>
                  );
                })
              ) : needs.length > 0 && !dutiesLoading ? (
                <span className="dd-tag ok">✓ Holds every duty needed</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
