import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { TaskDetailDto } from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { TaskDetailView } from '../components/TaskDetailView';

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const taskId = Number(id);
  const { user } = useAuth();

  const [task, setTask] = useState<TaskDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTask(await api.getTask(taskId));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load task');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <div className="container">Loading…</div>;
  if (error)
    return (
      <div className="container">
        <div className="alert error">{error}</div>
      </div>
    );
  if (!task || !user) return null;

  // Keyed by id so navigating between tasks remounts with fresh edit state.
  // TaskDetailView owns the task from here and updates it in place on each save.
  // Keyed by id so navigating between tasks remounts with fresh edit state.
  return <TaskDetailView key={task.id} initialTask={task} currentUser={user} />;
}
