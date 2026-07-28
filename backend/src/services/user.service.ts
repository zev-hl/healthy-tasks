import type { Prisma, User } from '@prisma/client';
import { isSupervisorRole, TASK_HISTORY_FIELDS } from '@healthy-tasks/shared';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import type { CreateUserInput, MergeUsersInput, UpdateUserInput } from '../validation/schemas.js';
import { hashPassword } from '../utils/password.js';
import { recordHistory, type HistoryEntryInput } from './task-history.service.js';
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
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      title: input.title ?? null,
      jobDescription: input.jobDescription ?? null,
      supervisorId: input.supervisorId ?? null,
      passwordHash: placeholderHash,
    },
  });
}

/** Reject an email already used by another user (email is the global login id). */
async function assertEmailAvailable(email: string, exceptUserId: string): Promise<void> {
  const clash = await prisma.user.findFirst({
    where: { email, id: { not: exceptUserId } },
    select: { id: true },
  });
  if (clash) {
    throw HttpError.badRequest('That email address is already in use by another account');
  }
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<User> {
  // Ensure the target exists (throws 404 otherwise).
  const existing = await getUserById(id);

  if (input.supervisorId) {
    await assertValidSupervisor(input.supervisorId, id);
  }

  // Email change: reject a collision with another account before writing.
  if (input.email !== undefined && input.email !== existing.email) {
    await assertEmailAvailable(input.email, id);
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

  // Deactivating (active → inactive) mirrors deactivateUser: revoke live tokens
  // and drop this user as a supervisor from any reports.
  const deactivating = input.isActive === false && existing.isActive;

  const data: Prisma.UserUpdateInput = {
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
    ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.jobDescription !== undefined ? { jobDescription: input.jobDescription } : {}),
    ...(input.supervisorId !== undefined ? { supervisorId: input.supervisorId } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    ...(deactivating ? { tokenVersion: { increment: 1 } } : {}),
  };

  if (!deactivating) {
    return prisma.user.update({ where: { id }, data });
  }

  const [updated] = await prisma.$transaction([
    prisma.user.update({ where: { id }, data }),
    prisma.user.updateMany({ where: { supervisorId: id }, data: { supervisorId: null } }),
  ]);
  return updated;
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

/**
 * Merge two accounts believed to be the same person (Phase 5, admin-only).
 *
 * The surviving account keeps its own email/login and takes the admin's
 * field-by-field profile choices. Every reference to the non-surviving account
 * — created/assigned tasks, comments, @mentions, attachments, history entries —
 * is reassigned to the survivor, supervisees are repointed, and the merged
 * account is deactivated (never deleted) and flagged as merged so historical
 * references still resolve. The merge is logged to the history of every task it
 * touched. Destructive and hard to reverse, so the caller (and the API) require
 * a type-to-confirm step.
 *
 * NOTE: reminders and notification preferences (Phase 8) don't exist yet; when
 * they're added, their reassignment must be included in this transaction.
 */
export async function mergeUsers(actorId: string, input: MergeUsersInput): Promise<User> {
  const { survivingId, mergedId, confirmEmail, fieldChoices } = input;

  if (survivingId === mergedId) {
    throw HttpError.badRequest('Select two different accounts to merge');
  }

  const survivor = await getUserById(survivingId);
  const merged = await getUserById(mergedId);

  if (!survivor.isActive) {
    throw HttpError.badRequest('The surviving account must be active');
  }
  if (merged.mergedIntoId) {
    throw HttpError.badRequest('That account has already been merged into another');
  }

  // Type-to-confirm guard: the confirmation must match the merged account email.
  if (confirmEmail !== merged.email.toLowerCase()) {
    throw HttpError.badRequest(
      'Confirmation does not match: type the exact email of the account being merged away',
    );
  }

  // A chosen supervisor that points at either merge participant is nonsensical
  // (the merged account is going away; the survivor can't supervise itself).
  let chosenSupervisorId = fieldChoices.supervisorId;
  if (chosenSupervisorId === mergedId || chosenSupervisorId === survivingId) {
    chosenSupervisorId = null;
  }
  if (chosenSupervisorId) {
    await assertValidSupervisor(chosenSupervisorId, survivingId);
  }

  // Invariant guard: after the merge the survivor inherits the merged account's
  // reports (plus keeps its own). If anyone ends up supervised by the survivor,
  // the survivor's chosen role must be a supervisor role.
  const superviseeCount = await prisma.user.count({
    where: { supervisorId: { in: [survivingId, mergedId] }, id: { notIn: [survivingId, mergedId] } },
  });
  if (superviseeCount > 0 && !isSupervisorRole(fieldChoices.role)) {
    throw HttpError.badRequest(
      `The surviving account would supervise ${superviseeCount} user(s), so its role ` +
        `cannot be ${fieldChoices.role}. Choose Manager or Admin, or reassign those reports first.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    // 1. Apply the survivor's chosen profile FIRST so its (possibly changed)
    //    role is in place before any supervisee is repointed to it (the DB
    //    supervisor-role trigger validates the survivor at repoint time).
    const survivorUpdated = await tx.user.update({
      where: { id: survivingId },
      data: {
        firstName: fieldChoices.firstName,
        lastName: fieldChoices.lastName,
        title: fieldChoices.title,
        jobDescription: fieldChoices.jobDescription,
        role: fieldChoices.role,
        supervisorId: chosenSupervisorId,
      },
    });

    // 2. Collect every task the merged account touches, BEFORE reassigning, so
    //    we can log the merge on each of them afterward.
    const taskIds = new Set<number>();
    const add = (rows: { taskId: number }[]) => rows.forEach((r) => taskIds.add(r.taskId));
    (await tx.task.findMany({
      where: { OR: [{ creatorId: mergedId }, { assigneeId: mergedId }] },
      select: { id: true },
    })).forEach((t) => taskIds.add(t.id));
    add(await tx.comment.findMany({ where: { authorId: mergedId }, select: { taskId: true } }));
    add(await tx.mentionEvent.findMany({ where: { userId: mergedId }, select: { taskId: true } }));
    add(await tx.taskHistory.findMany({ where: { userId: mergedId }, select: { taskId: true } }));
    (await tx.attachment.findMany({
      where: { uploadedById: mergedId },
      select: { taskId: true, comment: { select: { taskId: true } } },
    })).forEach((a) => {
      const tid = a.taskId ?? a.comment?.taskId;
      if (tid != null) taskIds.add(tid);
    });

    // 3. Reassign all references from the merged account to the survivor.
    await tx.task.updateMany({ where: { creatorId: mergedId }, data: { creatorId: survivingId } });
    await tx.task.updateMany({ where: { assigneeId: mergedId }, data: { assigneeId: survivingId } });
    await tx.comment.updateMany({ where: { authorId: mergedId }, data: { authorId: survivingId } });
    await tx.attachment.updateMany({
      where: { uploadedById: mergedId },
      data: { uploadedById: survivingId },
    });
    await tx.mentionEvent.updateMany({ where: { userId: mergedId }, data: { userId: survivingId } });
    await tx.taskHistory.updateMany({ where: { userId: mergedId }, data: { userId: survivingId } });

    // CommentMention has a (commentId, userId) primary key, so drop the merged
    // account's rows that would collide with the survivor's before reassigning.
    const survivorMentions = await tx.commentMention.findMany({
      where: { userId: survivingId },
      select: { commentId: true },
    });
    const survivorCommentIds = survivorMentions.map((m) => m.commentId);
    if (survivorCommentIds.length > 0) {
      await tx.commentMention.deleteMany({
        where: { userId: mergedId, commentId: { in: survivorCommentIds } },
      });
    }
    await tx.commentMention.updateMany({
      where: { userId: mergedId },
      data: { userId: survivingId },
    });

    // 4. Repoint anyone supervised by the merged account to the survivor.
    await tx.user.updateMany({
      where: { supervisorId: mergedId },
      data: { supervisorId: survivingId },
    });

    // 5. Deactivate + flag the merged account; revoke its live tokens.
    await tx.user.update({
      where: { id: mergedId },
      data: {
        isActive: false,
        mergedIntoId: survivingId,
        tokenVersion: { increment: 1 },
      },
    });

    // 6. Log the merge on every affected task (reusing the history mechanism).
    const entries: HistoryEntryInput[] = [...taskIds].map((taskId) => ({
      taskId,
      userId: actorId,
      field: TASK_HISTORY_FIELDS.merge,
      changeType: 'updated' as const,
      previousValue: merged.email,
      newValue: survivor.email,
    }));
    await recordHistory(tx, entries);

    return survivorUpdated;
  });
}
