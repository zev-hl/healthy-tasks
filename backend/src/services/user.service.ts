import type { User } from '@prisma/client';
import { isSupervisorRole } from '@healthy-tasks/shared';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import type { CreateUserInput, UpdateUserInput } from '../validation/schemas.js';
import { hashPassword } from '../utils/password.js';
import crypto from 'node:crypto';

/**
 * Validate that `supervisorId` refers to an existing, active user whose role is
 * Manager or Admin. This is the application-layer enforcement of the rule
 * "supervisor must be a Manager or Admin". Throws HttpError on any violation.
 *
 * @param subjectUserId  the user being assigned a supervisor (to block self-ref)
 */
export async function assertValidSupervisor(
  supervisorId: string,
  subjectUserId?: string,
): Promise<void> {
  if (subjectUserId && supervisorId === subjectUserId) {
    throw HttpError.badRequest('A user cannot be their own supervisor');
  }

  const supervisor = await prisma.user.findUnique({ where: { id: supervisorId } });
  if (!supervisor) {
    throw HttpError.badRequest('Selected supervisor does not exist');
  }
  if (!supervisor.isActive) {
    throw HttpError.badRequest('Selected supervisor is inactive');
  }
  if (!isSupervisorRole(supervisor.role)) {
    throw HttpError.badRequest(
      `Supervisor must be a Manager or Admin (selected user is a ${supervisor.role})`,
    );
  }
}

export async function listUsers(): Promise<User[]> {
  return prisma.user.findMany({ orderBy: [{ isActive: 'desc' }, { email: 'asc' }] });
}

/** All active users — used by the task assignee picker (any authenticated user). */
export async function listActiveUsers(): Promise<User[]> {
  return prisma.user.findMany({ where: { isActive: true }, orderBy: { email: 'asc' } });
}

/** Users eligible to be selected as a supervisor: active Managers and Admins. */
export async function listEligibleSupervisors(): Promise<User[]> {
  return prisma.user.findMany({
    where: { isActive: true, role: { in: ['Admin', 'Manager'] } },
    orderBy: { email: 'asc' },
  });
}

export async function getUserById(id: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw HttpError.notFound('User not found');
  return user;
}

/**
 * Create a user with a random unusable password. The admin is expected to send
 * a reset link (see auth.service.createPasswordReset) so the user sets their
 * own password — we never generate a plaintext password the admin can see.
 */
export async function createUser(input: CreateUserInput): Promise<User> {
  if (input.supervisorId) {
    await assertValidSupervisor(input.supervisorId);
  }

  // Placeholder hash of a random secret — the account can only be accessed
  // after the user completes a password reset.
  const placeholderHash = await hashPassword(crypto.randomBytes(32).toString('hex'));

  return prisma.user.create({
    data: {
      email: input.email,
      role: input.role,
      title: input.title ?? null,
      jobDescription: input.jobDescription ?? null,
      supervisorId: input.supervisorId ?? null,
      passwordHash: placeholderHash,
    },
  });
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<User> {
  // Ensure the target exists (throws 404 otherwise).
  await getUserById(id);

  if (input.supervisorId) {
    await assertValidSupervisor(input.supervisorId, id);
  }

  // Guard against demoting a supervisor who still has reports: doing so would
  // leave those reports pointing at a Member, violating the invariant. Require
  // the reports to be reassigned first.
  if (input.role !== undefined && !isSupervisorRole(input.role)) {
    const reportCount = await prisma.user.count({ where: { supervisorId: id } });
    if (reportCount > 0) {
      throw HttpError.badRequest(
        `Cannot change this user to ${input.role}: they are still the supervisor of ` +
          `${reportCount} user(s). Reassign those reports first.`,
      );
    }
  }

  return prisma.user.update({
    where: { id },
    data: {
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.jobDescription !== undefined ? { jobDescription: input.jobDescription } : {}),
      ...(input.supervisorId !== undefined ? { supervisorId: input.supervisorId } : {}),
    },
  });
}

/**
 * Deactivate a user (soft delete). Bumps tokenVersion so any live JWTs stop
 * working immediately. Also clears this user as a supervisor from any reports,
 * since an inactive user may not supervise.
 */
export async function deactivateUser(id: string): Promise<User> {
  const user = await getUserById(id);
  if (!user.isActive) return user;

  const [updated] = await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data: { isActive: false, tokenVersion: { increment: 1 } },
    }),
    prisma.user.updateMany({
      where: { supervisorId: id },
      data: { supervisorId: null },
    }),
  ]);

  return updated;
}
