import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TASK_STATUS_LABELS, type TaskDto } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';

/**
 * Bare-bones list — Phase 2 scaffolding only. The real Search screen (columns,
 * filters, sort, hierarchy) is Phase 6, so this is intentionally unstyled.
 */
export function TaskListPage() {
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listTasks()
      .then(setTasks)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load tasks'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="container">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Tasks</h2>
        <div className="spacer" />
        <Link to="/tasks/new">
          <button>New task</button>
        </Link>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <p>Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="muted">No tasks yet. Create one to get started.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Assignee</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td>{t.id}</td>
                <td>
                  <Link to={`/tasks/${t.id}`}>{t.name}</Link>
                </td>
                <td>{TASK_STATUS_LABELS[t.status]}</td>
                <td>{t.priority}</td>
                <td>{t.assignee ? t.assignee.email : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
