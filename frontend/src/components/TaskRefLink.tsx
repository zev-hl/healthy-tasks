import { Link } from 'react-router-dom';
import { TASK_STATUS_LABELS, type TaskRef } from '@healthy-tasks/shared';

/** Renders a task reference as a hyperlink: #id name (Status). */
export function TaskRefLink({ task }: { task: TaskRef }) {
  return (
    <Link to={`/tasks/${task.id}`}>
      #{task.id} {task.name} <span className="muted">({TASK_STATUS_LABELS[task.status]})</span>
    </Link>
  );
}
