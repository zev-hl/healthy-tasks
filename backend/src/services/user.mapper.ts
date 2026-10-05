import type { User } from '@prisma/client';
import type { ActiveUserDto, UserDto, TaskUserRef } from '@healthy-tasks/shared';
import { isCompanyAccount } from '../utils/allowed-domain.js';

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

/**
 * Directory entry for the active-users list: the minimal ref plus reporting/
 * role fields for team views. Not embedded in tasks/comments — only the active
 * list carries these.
 */
export function toActiveUserDto(user: User): ActiveUserDto {
  return { ...toUserRef(user), supervisorId: user.supervisorId, role: user.role };
}

/** Convert a Prisma User row into the public DTO (drops passwordHash etc.). */
export function toUserDto(user: User): UserDto {
  return {
    // Derived from the domain rule on every read, never stored: a stored copy
    // would go stale the moment GOOGLE_ALLOWED_DOMAIN changed.
    signInMethod: isCompanyAccount(user.email) ? 'google' : 'password',
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
