import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  DependencyType,
  TaskDetailDto,
  TaskRef,
  UpdateTaskRequest,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { TaskForm } from '../components/TaskForm';
import { TaskRefLink } from '../components/TaskRefLink';
import { TaskPickerModal } from '../components/TaskPickerModal';

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

type PickerKind = 'parent' | DependencyType;

const PICKER_TITLES: Record<PickerKind, string> = {
  parent: 'Set parent task',
  blocks: 'Add a task this one blocks',
  blockedBy: 'Add a task this one is blocked by',
};

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const taskId = Number(id);

  const [task, setTask] = useState<TaskDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [relError, setRelError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState<PickerKind | null>(null);

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

  async function runRel(action: () => Promise<TaskDetailDto>) {
    setRelError(null);
    try {
      setTask(await action());
    } catch (err) {
      setRelError(err instanceof ApiError ? err.message : 'Relationship update failed');
    }
  }

  async function handlePick(picked: TaskRef) {
    if (!task) return;
    const kind = picker;
    setPicker(null);
    if (kind === 'parent') {
      await runRel(() => api.setParent(task.id, picked.id));
    } else if (kind) {
      await runRel(() => api.addDependency(task.id, kind, picked.id));
    }
  }

  if (loading) return <div className="container">Loading…</div>;
  if (error)
    return (
      <div className="container">
        <div className="alert error">{error}</div>
      </div>
    );
  if (!task) return null;

  return (
    <div className="container">
      <p style={{ marginTop: 0 }}>
        <Link to="/tasks">← Back to tasks</Link>
      </p>

      {notice && <div className="alert success">{notice}</div>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>
          Task #{task.id}: {task.name}
        </h2>
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '0.35rem 1rem',
            margin: 0,
          }}
        >
          <dt className="muted">Creator</dt>
          <dd style={{ margin: 0 }}>{task.creator.email}</dd>
          <dt className="muted">Created</dt>
          <dd style={{ margin: 0 }}>{formatDateTime(task.createdAt)}</dd>
          <dt className="muted">Status changed</dt>
          <dd style={{ margin: 0 }}>{formatDateTime(task.statusChangedAt)}</dd>
        </dl>
      </div>

      {/* Relationships */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Relationships</h3>
        {relError && <div className="alert error">{relError}</div>}

        {/* Parent */}
        <div className="rel-section">
          <div className="rel-heading">
            <span>Parent Task</span>
            {!task.parent && (
              <button
                type="button"
                className="secondary rel-add"
                onClick={() => setPicker('parent')}
              >
                + Add
              </button>
            )}
          </div>
          {task.parent ? (
            <div className="rel-row">
              <TaskRefLink task={task.parent} />
              <button
                type="button"
                className="rel-x"
                aria-label="Remove parent"
                onClick={() => runRel(() => api.clearParent(task.id))}
              >
                ×
              </button>
            </div>
          ) : (
            <p className="muted rel-empty">No parent task.</p>
          )}
        </div>

        {/* Children (read-only, derived) */}
        <div className="rel-section">
          <div className="rel-heading">
            <span>Child Tasks</span>
          </div>
          {task.children.length === 0 ? (
            <p className="muted rel-empty">No sub-tasks.</p>
          ) : (
            task.children.map((c) => (
              <div key={c.id} className="rel-row">
                <TaskRefLink task={c} />
              </div>
            ))
          )}
        </div>

        {/* Blocks */}
        <div className="rel-section">
          <div className="rel-heading">
            <span>Blocks</span>
            <button type="button" className="secondary rel-add" onClick={() => setPicker('blocks')}>
              + Add
            </button>
          </div>
          {task.blocks.length === 0 ? (
            <p className="muted rel-empty">Doesn&apos;t block any tasks.</p>
          ) : (
            task.blocks.map((t) => (
              <div key={t.id} className="rel-row">
                <TaskRefLink task={t} />
                <button
                  type="button"
                  className="rel-x"
                  aria-label={`Remove blocks #${t.id}`}
                  onClick={() => runRel(() => api.removeDependency(task.id, 'blocks', t.id))}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        {/* Is Blocked By */}
        <div className="rel-section">
          <div className="rel-heading">
            <span>Is Blocked By</span>
            <button
              type="button"
              className="secondary rel-add"
              onClick={() => setPicker('blockedBy')}
            >
              + Add
            </button>
          </div>
          {task.isBlockedBy.length === 0 ? (
            <p className="muted rel-empty">Not blocked by any tasks.</p>
          ) : (
            task.isBlockedBy.map((t) => (
              <div key={t.id} className="rel-row">
                <TaskRefLink task={t} />
                <button
                  type="button"
                  className="rel-x"
                  aria-label={`Remove is-blocked-by #${t.id}`}
                  onClick={() => runRel(() => api.removeDependency(task.id, 'blockedBy', t.id))}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Edit</h3>
        <TaskForm
          key={task.updatedAt} // reset form state after a successful save
          initial={task}
          submitLabel="Save changes"
          onSubmit={async (payload) => {
            const updated = await api.updateTask(task.id, payload satisfies UpdateTaskRequest);
            setTask(updated);
            setNotice('Task saved.');
          }}
        />
      </div>

      {picker && (
        <TaskPickerModal
          title={PICKER_TITLES[picker]}
          excludeId={task.id}
          onPick={handlePick}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
