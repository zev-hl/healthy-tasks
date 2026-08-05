import { useCallback, useEffect, useState } from 'react';
import type { GoalDto, GoalStatus } from '@healthy-tasks/shared';
import { GOAL_STATUSES, GOAL_STATUS_LABELS } from '@healthy-tasks/shared';
import { api, ApiError, exportMyGoalsToExcel } from '../api/client';
import { EmptyState } from '../components/ui/EmptyState';
import { GoalCard } from '../components/goals/GoalCard';
import { GoalDetailModal } from '../components/goals/GoalDetailModal';
import { GoalEditorModal } from '../components/goals/GoalEditorModal';

/** The order lifecycle groups appear in on the My Goals screen. */
const STATUS_ORDER: GoalStatus[] = [...GOAL_STATUSES];

export function MyGoalsPage() {
  const [goals, setGoals] = useState<GoalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      await exportMyGoalsToExcel();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGoals(await api.listMyGoals());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your goals.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = goals.find((g) => g.id === openId) ?? null;

  return (
    <div className="tasks-page goals-page">
      <div className="tasks-toolbar">
        <h1>My Goals</h1>
        <span className="tasks-total">{goals.length}</span>
        <span className="spacer" />
        <button
          type="button"
          className="secondary"
          disabled={exporting || goals.length === 0}
          onClick={() => void handleExport()}
        >
          {exporting ? 'Exporting…' : 'Export'}
        </button>
        <button type="button" onClick={() => setCreating(true)}>
          + New goal
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <div className="muted" style={{ padding: '1rem' }}>
          Loading…
        </div>
      ) : goals.length === 0 ? (
        <EmptyState title="No goals yet">
          Set a SMART goal for yourself — your supervisor will approve it before it becomes active.
        </EmptyState>
      ) : (
        STATUS_ORDER.filter((s) => goals.some((g) => g.status === s)).map((status) => (
          <section key={status} className="goal-group">
            <h2 className="goal-group-title">{GOAL_STATUS_LABELS[status]}</h2>
            <div className="goal-grid">
              {goals
                .filter((g) => g.status === status)
                .map((g) => (
                  <GoalCard key={g.id} goal={g} onOpen={() => setOpenId(g.id)} />
                ))}
            </div>
          </section>
        ))
      )}

      {creating && (
        <GoalEditorModal
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
          supervisorView={false}
          onClose={() => setOpenId(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
