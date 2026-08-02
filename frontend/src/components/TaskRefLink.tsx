import { Link } from 'react-router-dom';
import { TASK_STATUS_LABELS, type TaskRef } from '@healthy-tasks/shared';

/**
 * Renders a task reference. When the user can see the task, it's a hyperlink
 * "#id name (Status)". When they cannot (`accessible === false`), it degrades to
 * a non-linked "#id 🔒 (Status)" — Id + lock + Status only, no name. Reflects the
 * live access the server computed for this response.
 */
export function TaskRefLink({ task }: { task: TaskRef }) {
  if (!task.accessible) {
    return (
      <span className="task-ref-locked" title="You do not have access to this task">
        #{task.id} <span aria-label="No access" className="task-ref-lock">🔒</span>{' '}
        <span className="muted">({TASK_STATUS_LABELS[task.status]})</span>
      </span>
    );
  }
  return (
    <Link to={`/tasks/${task.id}`}>
      #{task.id} {task.name} <span className="muted">({TASK_STATUS_LABELS[task.status]})</span>
    </Link>
  );
}
