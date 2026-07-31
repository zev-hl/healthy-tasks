import type { Task, TaskRecurrence, User } from '@prisma/client';
import type {
  RecurrenceType,
  TaskAccessLevel,
  TaskDto,
  TaskDetailDto,
  TaskRecurrenceDto,
  TaskRef,
} from '@healthy-tasks/shared';
import { toUserRef } from './user.mapper.js';
import {
  attachmentInclude,
  toAttachmentDto,
  type AttachmentWithUploader,
} from './attachment.mapper.js';
import { commentInclude, toCommentDto, type CommentWithRefs } from './comment.mapper.js';

type UserRefSelect = Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'title'>;

/** A Task row with its creator (and optional assignee) joined in. */
export type TaskWithRefs = Task & {
  creator: UserRefSelect;
  assignee: UserRefSelect | null;
  // Phase 10 review workflow refs (null unless the task is in Review).
  reviewInitiator: UserRefSelect | null;
  priorAssignee: UserRefSelect | null;
};

const userRefSelect = {
  select: { id: true, email: true, firstName: true, lastName: true, title: true },
} as const;

/** The Prisma `include` used everywhere a TaskDto is returned. */
export const taskInclude = {
  creator: userRefSelect,
  assignee: userRefSelect,
  reviewInitiator: userRefSelect,
  priorAssignee: userRefSelect,
} as const;

const taskRefSelect = { id: true, name: true, status: true } as const;

/** Include used for the single-task detail view (adds relationships). */
export const taskDetailInclude = {
  ...taskInclude,
  parent: { select: taskRefSelect },
  children: { select: taskRefSelect, orderBy: { id: 'asc' } },
  blocking: { include: { blocked: { select: taskRefSelect } }, orderBy: { id: 'asc' } },
  blockedBy: { include: { blocker: { select: taskRefSelect } }, orderBy: { id: 'asc' } },
  // Phase 4: task-level attachments (comment attachments live on the comment)
  // and the comment thread (oldest first).
  attachments: { include: attachmentInclude, orderBy: { createdAt: 'asc' } },
  comments: { include: commentInclude, orderBy: { createdAt: 'asc' } },
  // Phase 11: this task's own recurrence rule + how many instances it has spawned.
  recurrence: true,
  _count: { select: { recurrenceOccurrences: true } },
} as const;

export type TaskWithDetail = TaskWithRefs & {
  parent: TaskRef | null;
  children: TaskRef[];
  blocking: { blocked: TaskRef }[];
  blockedBy: { blocker: TaskRef }[];
  attachments: AttachmentWithUploader[];
  comments: CommentWithRefs[];
  recurrence: TaskRecurrence | null;
  recurrenceSourceId: number | null;
  recurrenceSeq: number | null;
  _count: { recurrenceOccurrences: number };
};

export function toTaskRecurrenceDto(r: TaskRecurrence, occurrenceCount: number): TaskRecurrenceDto {
  return {
    recurrenceType: r.recurrenceType as Exclude<RecurrenceType, 'None'>,
    intervalCount: r.intervalCount,
    intervalUnit: r.intervalUnit,
    weekdays: r.weekdays,
    anchorDate: r.anchorDate.toISOString(),
    endType: r.endType,
    endDate: r.endDate?.toISOString() ?? null,
    maxOccurrences: r.maxOccurrences,
    leadTimeDays: r.leadTimeDays,
    isActive: r.isActive,
    occurrenceCount,
  };
}

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
    isPrivate: task.isPrivate,
    startAt: task.startAt?.toISOString() ?? null,
    dueAt: task.dueAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    reviewInitiatorId: task.reviewInitiatorId,
    reviewInitiator: task.reviewInitiator ? toUserRef(task.reviewInitiator) : null,
    priorAssigneeId: task.priorAssigneeId,
    priorAssignee: task.priorAssignee ? toUserRef(task.priorAssignee) : null,
    priorStatus: task.priorStatus,
    instanceLabel: task.instanceLabel,
    templateId: task.templateId,
  };
}

export function toTaskRef(task: Pick<Task, 'id' | 'name' | 'status'>): TaskRef {
  return { id: task.id, name: task.name, status: task.status };
}

/** The requesting user's live access to the task, attached to the detail DTO. */
export interface TaskAccessContext {
  level: TaskAccessLevel;
  canTogglePrivate: boolean;
}

export function toTaskDetailDto(task: TaskWithDetail, access: TaskAccessContext): TaskDetailDto {
  return {
    ...toTaskDto(task),
    access: access.level,
    canTogglePrivate: access.canTogglePrivate,
    parent: task.parent ? toTaskRef(task.parent) : null,
    children: task.children.map(toTaskRef),
    // `blocking` edges → the tasks this one blocks; `blockedBy` edges → predecessors.
    blocks: task.blocking.map((d) => toTaskRef(d.blocked)),
    isBlockedBy: task.blockedBy.map((d) => toTaskRef(d.blocker)),
    attachments: task.attachments.map(toAttachmentDto),
    comments: task.comments.map(toCommentDto),
    recurrence: task.recurrence
      ? toTaskRecurrenceDto(task.recurrence, task._count.recurrenceOccurrences)
      : null,
    recurrenceSourceId: task.recurrenceSourceId,
    recurrenceSeq: task.recurrenceSeq,
  };
}
