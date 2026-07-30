import type { Goal, User } from '@prisma/client';
import type { GoalDto } from '@healthy-tasks/shared';
import { toUserRef } from './user.mapper.js';

type UserRefSelect = Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'title'>;

const userRefSelect = {
  select: { id: true, email: true, firstName: true, lastName: true, title: true },
} as const;

/** The Prisma `include` used everywhere a GoalDto is returned. */
export const goalInclude = {
  owner: userRefSelect,
  createdBy: userRefSelect,
  approvedBy: userRefSelect,
  resolvedBy: userRefSelect,
} as const;

/** A Goal row with its owner/creator (and optional approver/resolver) joined. */
export type GoalWithRefs = Goal & {
  owner: UserRefSelect;
  createdBy: UserRefSelect;
  approvedBy: UserRefSelect | null;
  resolvedBy: UserRefSelect | null;
};

export function toGoalDto(goal: GoalWithRefs): GoalDto {
  return {
    id: goal.id,
    ownerId: goal.ownerId,
    owner: toUserRef(goal.owner),
    createdById: goal.createdById,
    createdBy: toUserRef(goal.createdBy),
    specific: goal.specific,
    metricType: goal.metricType,
    unitLabel: goal.unitLabel,
    targetValue: goal.targetValue,
    deadline: goal.deadline.toISOString(),
    risks: goal.risks,
    mitigations: goal.mitigations,
    notes: goal.notes,
    resultValue: goal.resultValue,
    resultsFinalizedAt: goal.resultsFinalizedAt?.toISOString() ?? null,
    resolution: goal.resolution,
    supervisorComments: goal.supervisorComments,
    rejectionComments: goal.rejectionComments,
    status: goal.status,
    submittedAt: goal.submittedAt?.toISOString() ?? null,
    approvedAt: goal.approvedAt?.toISOString() ?? null,
    approvedById: goal.approvedById,
    approvedBy: goal.approvedBy ? toUserRef(goal.approvedBy) : null,
    underReviewAt: goal.underReviewAt?.toISOString() ?? null,
    resolvedAt: goal.resolvedAt?.toISOString() ?? null,
    resolvedById: goal.resolvedById,
    resolvedBy: goal.resolvedBy ? toUserRef(goal.resolvedBy) : null,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}
