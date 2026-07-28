import type { User } from '@prisma/client';
import type { UserDto, TaskUserRef } from '@healthy-tasks/shared';

/**
 * Minimal, non-sensitive user reference for embedding in other resources
 * (task creator/assignee) and for the assignee picker. Safe to expose to any
 * authenticated user.
 */
export function toUserRef(
  user: Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'title'>,
): TaskUserRef {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    title: user.title,
  };
}

/** Convert a Prisma User row into the public DTO (drops passwordHash etc.). */
export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    title: user.title,
    jobDescription: user.jobDescription,
    role: user.role,
    supervisorId: user.supervisorId,
    isActive: user.isActive,
    mergedIntoId: user.mergedIntoId,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
