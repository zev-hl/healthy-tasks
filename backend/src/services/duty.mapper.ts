import type { DutyRef } from '@healthy-tasks/shared';

/**
 * Department Duties: the compact duty reference embedded in tasks, template
 * nodes and time rows. A duty always travels with its department (name +
 * color), since it is only ever shown as "Department › Duty".
 */

/** Prisma `select` for a duty plus the department fields a DutyRef needs. */
export const dutyRefSelect = {
  select: {
    id: true,
    name: true,
    archivedAt: true,
    department: { select: { id: true, name: true, color: true, archivedAt: true } },
  },
} as const;

export interface DutyWithDepartment {
  id: string;
  name: string;
  archivedAt: Date | null;
  department: { id: string; name: string; color: string; archivedAt: Date | null };
}

export function toDutyRef(d: DutyWithDepartment): DutyRef {
  return {
    id: d.id,
    name: d.name,
    departmentId: d.department.id,
    departmentName: d.department.name,
    color: d.department.color,
    // A duty under an archived department is effectively archived too.
    archived: d.archivedAt !== null || d.department.archivedAt !== null,
  };
}

/**
 * Select the duty ids a user holds — joined onto a task's assignee / prior
 * assignee so the ⚠ mismatch flag can be computed without another query.
 */
export const heldDutiesSelect = { duties: { select: { dutyId: true } } } as const;

export interface HolderWithDuties {
  duties: { dutyId: string }[];
}

/**
 * Whether a task's duty is held by the person doing it. The person doing it is
 * the assignee — except while the task is in Review, where the assignee is the
 * temporary reviewer and the rule is judged against the prior assignee instead
 * (review hand-offs are exempt from the duty rule). False when there's no duty
 * or no one to hold it.
 */
export function isDutyMismatch(task: {
  dutyId: string | null;
  status: string;
  assignee: HolderWithDuties | null;
  priorAssigneeId?: string | null;
  priorAssignee?: HolderWithDuties | null;
}): boolean {
  if (!task.dutyId) return false;
  const holder =
    task.status === 'Review' && task.priorAssigneeId ? (task.priorAssignee ?? null) : task.assignee;
  if (!holder) return false;
  return !holder.duties.some((d) => d.dutyId === task.dutyId);
}
