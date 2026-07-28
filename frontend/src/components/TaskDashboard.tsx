import { useEffect, useState } from 'react';
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type TaskDashboardDto,
  type TaskSearchFilters,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import {
  COMPLETED_TODAY_STAT,
  OVERDUE_STAT,
  dashboardActiveStats,
  effectiveFilters,
  nowContext,
  relationStat,
  statusStat,
} from '../lib/taskSearch';
import { AnimatedCount } from './ui/AnimatedCount';

interface TaskDashboardProps {
  /** Debounced search text (raw; trimmed here). */
  text: string;
  filters: TaskSearchFilters;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Apply/toggle the dashboard quick-filter for the clicked count. */
  onSelectStat: (key: string) => void;
}

// Re-tally periodically so the time-relative counts stay honest without a
// reload: tasks crossing their due time, and the Completed-Today window rolling
// over at local midnight.
const REFRESH_MS = 60_000;

export function TaskDashboard({
  text,
  filters,
  collapsed,
  onToggleCollapsed,
  onSelectStat,
}: TaskDashboardProps) {
  const [data, setData] = useState<TaskDashboardDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Fetch counts for the current text + filters whenever they change, and on
  // each refresh tick. Skipped while collapsed (nothing is shown).
  useEffect(() => {
    if (collapsed) return;
    let cancelled = false;
    setLoading(true);
    void api
      .getTaskDashboard({ text: text.trim() || undefined, filters: effectiveFilters(filters), ...nowContext() })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load dashboard');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [text, filters, collapsed, tick]);

  useEffect(() => {
    if (collapsed) return;
    const id = window.setInterval(() => setTick((t) => t + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [collapsed]);

  const active = dashboardActiveStats(filters);

  const stat = (label: string, value: number, key: string) => {
    const isActive = active.has(key);
    return (
      <button
        key={key}
        type="button"
        className={`dash-stat${isActive ? ' active' : ''}`}
        aria-pressed={isActive}
        onClick={() => onSelectStat(key)}
      >
        <span className="dash-stat-value">
          <AnimatedCount value={value} />
        </span>
        <span className="dash-stat-label">{label}</span>
      </button>
    );
  };

  return (
    <section className="card dashboard" aria-label="Task dashboard">
      <button
        type="button"
        className="dash-toggle"
        aria-expanded={!collapsed}
        onClick={onToggleCollapsed}
      >
        <span className={`dash-caret${collapsed ? '' : ' open'}`} aria-hidden="true">
          ▸
        </span>
        <strong>Dashboard</strong>
        {data && <span className="muted dash-subtitle">Total in view: {data.total}</span>}
        {loading && !data && <span className="muted dash-subtitle">Loading…</span>}
      </button>

      {!collapsed && (
        <div className="dash-body">
          {error && <div className="alert error">{error}</div>}
          {!error && !data && <div className="muted">Loading…</div>}
          {!error && data && (
            <>
              <div className="dash-group">
                <span className="dash-group-label">Breakdown</span>
                {stat('Parents-only', data.parent, relationStat('parent'))}
                {stat('Children', data.child, relationStat('child'))}
                {stat('Standalone', data.standalone, relationStat('standalone'))}
              </div>

              <div className="dash-group">
                <span className="dash-group-label">Status</span>
                {TASK_STATUSES.map((s) =>
                  stat(TASK_STATUS_LABELS[s], data.byStatus[s] ?? 0, statusStat(s)),
                )}
              </div>

              <div className="dash-group">
                <span className="dash-group-label">Attention</span>
                {stat('Overdue', data.overdue, OVERDUE_STAT)}
                {stat('Completed Today', data.completedToday, COMPLETED_TODAY_STAT)}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
