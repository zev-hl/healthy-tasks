import type { TaskHistory, User } from '@prisma/client';
import type { TaskHistoryEntryDto } from '@healthy-tasks/shared';
import { toUserRef } from './user.mapper.js';

/** A TaskHistory row with its (optional) actor joined in. */
export type TaskHistoryWithUser = TaskHistory & {
  user: Pick<User, 'id' | 'email' | 'title'> | null;
};

/** The Prisma `include` used wherever a TaskHistoryEntryDto is returned. */
export const taskHistoryInclude = {
  user: { select: { id: true, email: true, title: true } },
} as const;

export function toTaskHistoryDto(entry: TaskHistoryWithUser): TaskHistoryEntryDto {
  return {
    id: entry.id,
    taskId: entry.taskId,
    field: entry.field,
    changeType: entry.changeType,
    previousValue: entry.previousValue,
    newValue: entry.newValue,
    detail: entry.detail,
    changedAt: entry.changedAt.toISOString(),
    user: entry.user ? toUserRef(entry.user) : null,
  };
}
