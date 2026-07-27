import type { Task, User } from '@prisma/client';
import type { TaskDto, TaskDetailDto, TaskRef } from '@healthy-tasks/shared';
import { toUserRef } from './user.mapper.js';

/** A Task row with its creator (and optional assignee) joined in. */
export type TaskWithRefs = Task & {
  creator: Pick<User, 'id' | 'email' | 'title'>;
  assignee: Pick<User, 'id' | 'email' | 'title'> | null;
};

/** The Prisma `include` used everywhere a TaskDto is returned. */
export const taskInclude = {
  creator: { select: { id: true, email: true, title: true } },
  assignee: { select: { id: true, email: true, title: true } },
} as const;

const taskRefSelect = { id: true, name: true, status: true } as const;

/** Include used for the single-task detail view (adds relationships). */
export const taskDetailInclude = {
  ...taskInclude,
  parent: { select: taskRefSelect },
  children: { select: taskRefSelect, orderBy: { id: 'asc' } },
  blocking: { include: { blocked: { select: taskRefSelect } }, orderBy: { id: 'asc' } },
  blockedBy: { include: { blocker: { select: taskRefSelect } }, orderBy: { id: 'asc' } },
} as const;

export type TaskWithDetail = TaskWithRefs & {
  parent: TaskRef | null;
  children: TaskRef[];
  blocking: { blocked: TaskRef }[];
  blockedBy: { blocker: TaskRef }[];
};

export function toTaskDto(task: TaskWithRefs): TaskDto {
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    creatorId: task.creatorId,
    creator: toUserRef(task.creator),
    assigneeId: task.assigneeId,
    assignee: task.assignee ? toUserRef(task.assignee) : null,
    parentId: task.parentId,
    priority: task.priority,
    status: task.status,
    statusChangedAt: task.statusChangedAt?.toISOString() ?? null,
    tags: task.tags,
    startAt: task.startAt?.toISOString() ?? null,
    dueAt: task.dueAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export function toTaskRef(task: Pick<Task, 'id' | 'name' | 'status'>): TaskRef {
  return { id: task.id, name: task.name, status: task.status };
}

export function toTaskDetailDto(task: TaskWithDetail): TaskDetailDto {
  return {
    ...toTaskDto(task),
    parent: task.parent ? toTaskRef(task.parent) : null,
    children: task.children.map(toTaskRef),
    // `blocking` edges → the tasks this one blocks; `blockedBy` edges → predecessors.
    blocks: task.blocking.map((d) => toTaskRef(d.blocked)),
    isBlockedBy: task.blockedBy.map((d) => toTaskRef(d.blocker)),
  };
}
