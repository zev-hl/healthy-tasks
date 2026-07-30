import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ActiveUserDto, GoalDto, GoalStatus, GoalTeamFilters } from '@healthy-tasks/shared';
import { GOAL_STATUSES, GOAL_STATUS_LABELS } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { EmptyState } from '../components/ui/EmptyState';
import { FilterPopover } from '../components/FilterPopover';
import { MultiSelect } from '../components/MultiSelect';
import { GoalCard } from '../components/goals/GoalCard';
import { GoalDetailModal } from '../components/goals/GoalDetailModal';
import { GoalEditorModal } from '../components/goals/GoalEditorModal';

const EMPTY: GoalTeamFilters = {};

function userLabel(u: ActiveUserDto): string {
  const name = `${u.firstName} ${u.lastName}`.trim();
  return name || u.email;
}

export function TeamGoalsPage() {
  const { user } = useAuth();
  const [goals, setGoals] = useState<GoalDto[]>([]);
  const [reports, setReports] = useState<ActiveUserDto[]>([]);
  const [filters, setFilters] = useState<GoalTeamFilters>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  // The people whose goals this supervisor can manage: their direct reports, or
  // (for Admin) everyone. Drives both the employee filter and the New-goal owner.
  useEffect(() => {
    void api
      .listActiveUsers()
      .then((all) =>
        setReports(user?.role === 'Admin' ? all : all.filter((u) => u.supervisorId === user?.id)),
      )
      .catch(() => setReports([]));
  }, [user?.id, user?.role]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGoals(await api.listTeamGoals({ filters }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load team goals.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const ownerName = useMemo(() => {
    const m = new Map(reports.map((r) => [r.id, userLabel(r)]));
    return (id: string) => m.get(id) ?? id;
  }, [reports]);

  function patch(next: Partial<GoalTeamFilters>) {
    setFilters((f) => ({ ...f, ...next }));
  }

  // Removable filter chips describing the active filters.
  const chips: { id: string; label: string; clear: () => void }[] = [];
  for (const id of filters.ownerIds ?? [])
    chips.push({ id: `own-${id}`, label: `Employee · ${ownerName(id)}`, clear: () =>
      patch({ ownerIds: (filters.ownerIds ?? []).filter((x) => x !== id) }) });
  for (const s of filters.statuses ?? [])
    chips.push({ id: `st-${s}`, label: `Status · ${GOAL_STATUS_LABELS[s]}`, clear: () =>
      patch({ statuses: (filters.statuses ?? []).filter((x) => x !== s) }) });
  if (filters.deadlineFrom)
    chips.push({ id: 'df', label: `From ${filters.deadlineFrom.slice(0, 10)}`, clear: () => patch({ deadlineFrom: null }) });
  if (filters.deadlineTo)
    chips.push({ id: 'dt', label: `To ${filters.deadlineTo.slice(0, 10)}`, clear: () => patch({ deadlineTo: null }) });

  const hasFilters = chips.length > 0;
  const open = goals.find((g) => g.id === openId) ?? null;
  const ownerOptions = reports.map((r) => ({ id: r.id, label: userLabel(r) }));

  return (
    <div className="tasks-page goals-page">
      <div className="tasks-toolbar">
        <h1>Team Goals</h1>
        <span className="tasks-total">{goals.length}</span>
        <span className="spacer" />
        {ownerOptions.length > 0 && (
          <button type="button" onClick={() => setCreating(true)}>
            + New goal
          </button>
        )}
      </div>

      <div className="tasks-chiprow">
        <button
          type="button"
          className={`add-filter${showFilters ? ' open' : ''}`}
          onClick={() => setShowFilters((v) => !v)}
        >
          + Filter
        </button>
        {chips.map((c) => (
          <button key={c.id} type="button" className="filter-chip" onClick={c.clear}>
            {c.label}
            <span className="chip-x">×</span>
          </button>
        ))}
        {hasFilters && (
          <button type="button" className="link-button" onClick={() => setFilters(EMPTY)}>
            Clear all
          </button>
        )}
      </div>

      {showFilters && (
        <div className="card panel tasks-filter-panel">
          <div className="tasks-filter-field">
            <span className="u-label">Employee</span>
            <FilterPopover label="Employee" active={(filters.ownerIds ?? []).length > 0}>
              <MultiSelect
                options={ownerOptions.map((o) => ({ value: o.id, label: o.label }))}
                selected={filters.ownerIds ?? []}
                onChange={(next) => patch({ ownerIds: next })}
              />
            </FilterPopover>
          </div>
          <div className="tasks-filter-field">
            <span className="u-label">Status</span>
            <FilterPopover label="Status" active={(filters.statuses ?? []).length > 0}>
              <MultiSelect
                options={GOAL_STATUSES.map((s) => ({ value: s, label: GOAL_STATUS_LABELS[s] }))}
                selected={filters.statuses ?? []}
                onChange={(next) => patch({ statuses: next as GoalStatus[] })}
              />
            </FilterPopover>
          </div>
          <div className="tasks-filter-field">
            <span className="u-label">Deadline</span>
            <FilterPopover
              label="Deadline"
              active={!!filters.deadlineFrom || !!filters.deadlineTo}
            >
              <div className="pop-range">
                <label>
                  From
                  <input
                    type="date"
                    value={filters.deadlineFrom?.slice(0, 10) ?? ''}
                    onChange={(e) =>
                      patch({ deadlineFrom: e.target.value ? new Date(`${e.target.value}T00:00:00.000Z`).toISOString() : null })
                    }
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    value={filters.deadlineTo?.slice(0, 10) ?? ''}
                    onChange={(e) =>
                      patch({ deadlineTo: e.target.value ? new Date(`${e.target.value}T23:59:59.999Z`).toISOString() : null })
                    }
                  />
                </label>
              </div>
            </FilterPopover>
          </div>
        </div>
      )}

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <div className="muted" style={{ padding: '1rem' }}>
          Loading…
        </div>
      ) : goals.length === 0 ? (
        <EmptyState title="No team goals">
          {hasFilters
            ? 'No goals match the current filters.'
            : 'Goals for your direct reports will appear here once they are created.'}
        </EmptyState>
      ) : (
        <div className="goal-grid">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} showOwner onOpen={() => setOpenId(g.id)} />
          ))}
        </div>
      )}

      {creating && (
        <GoalEditorModal
          ownerOptions={ownerOptions}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void load();
          }}
        />
      )}

      {open && (
        <GoalDetailModal
          goal={open}
          supervisorView
          onClose={() => setOpenId(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
