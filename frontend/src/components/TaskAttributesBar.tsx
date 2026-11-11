import { taskAttributeList, type TaskAttributeValues } from '../lib/taskAttributes';
import { InactiveIcon } from './exclusives/icons';

interface Props {
  task: TaskAttributeValues;
}

/**
 * The task's special attributes (HLAI-118), listed under the property row at
 * the top of the task page, read-only: each label with its value, "—" when not
 * set. Anyone who can see the task sees them; editors get TaskAttributeChips
 * instead. A group an Admin
 * has switched off stays until someone picks another, with the Alert Groups
 * page's red "inactive" mark before its name.
 */
export function TaskAttributesBar({ task }: Props) {
  return (
    <div className="task-attrs" role="group" aria-label="Attributes">
      {taskAttributeList(task).map(({ key, label, value }) => (
        <span key={key} className="task-attr">
          <span className="task-attr-label">{label}</span>
          {key === 'alertGroup' && task.alertGroup && !task.alertGroup.isActive && (
            <span
              className="task-attr-inactive"
              role="img"
              aria-label="Inactive group"
              title="Inactive — this group is switched off"
            >
              <InactiveIcon size={14} />
            </span>
          )}
          <span className={`task-attr-value${value ? '' : ' is-empty'}`}>{value ?? '—'}</span>
        </span>
      ))}
    </div>
  );
}
