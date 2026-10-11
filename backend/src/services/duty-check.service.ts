import { DUTY_NOT_HELD_CODE, dutyLabel } from '@healthy-tasks/shared';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { createDutyMismatchNotification } from './notification.service.js';
import { dutyRefSelect, isDutyMismatch, toDutyRef } from './duty.mapper.js';

/**
 * Department Duties: the assignee ⇄ duty rule. A task with a duty may only go to
 * someone who holds that duty. Interactive saves are blocked (422
 * DUTY_NOT_HELD); work the background timer creates can't answer a prompt, so
 * it is created anyway, flagged ⚠, and the template owner / recurring task's
 * creator is notified.
 */

export async function userHoldsDuty(userId: string, dutyId: string): Promise<boolean> {
  const row = await prisma.userDuty.findUnique({
    where: { userId_dutyId: { userId, dutyId } },
    select: { userId: true },
  });
  return row !== null;
}

/** Throw 422 DUTY_NOT_HELD unless `userId` holds `dutyId`. */
export async function assertHoldsDuty(userId: string, dutyId: string): Promise<void> {
  if (await userHoldsDuty(userId, dutyId)) return;
  const [user, duty] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    }),
    prisma.duty.findUnique({ where: { id: dutyId }, ...dutyRefSelect }),
  ]);
  const who = user ? `${user.firstName} ${user.lastName}`.trim() || user.email : 'The assignee';
  const what = duty ? dutyLabel(toDutyRef(duty)) : 'this duty';
  throw new HttpError(422, `${who} doesn't hold the duty ${what}`, {
    code: DUTY_NOT_HELD_CODE,
    userId,
    dutyId,
  });
}

/**
 * After automatic creation: for each of these tasks whose assignee doesn't hold
 * its duty, send `recipientId` a dutyMismatch notification. Best-effort — a
 * failed notification never undoes the work that was created.
 */
export async function notifyDutyMismatches(taskIds: number[], recipientId: string): Promise<void> {
  if (taskIds.length === 0) return;
  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds }, dutyId: { not: null }, assigneeId: { not: null } },
    select: {
      id: true,
      dutyId: true,
      status: true,
      assignee: { select: { duties: { select: { dutyId: true } } } },
    },
  });
  for (const t of tasks) {
    if (!isDutyMismatch(t)) continue;
    try {
      await createDutyMismatchNotification({ recipientId, taskId: t.id });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`duty mismatch notification failed for task ${t.id}`, err);
    }
  }
}

/**
 * Ids of tasks carrying the ⚠ flag: a duty that the person doing the task
 * doesn't hold. That person is the assignee, or the prior assignee while the
 * task is in Review (the reviewer is exempt). Mirrors `isDutyMismatch`.
 */
export async function mismatchedTaskIds(): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT t.id
    FROM "Task" t
    WHERE t."dutyId" IS NOT NULL
      AND (CASE WHEN t.status = 'Review' AND t."priorAssigneeId" IS NOT NULL
                THEN t."priorAssigneeId" ELSE t."assigneeId" END) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "UserDuty" ud
        WHERE ud."dutyId" = t."dutyId"
          AND ud."userId" = (CASE WHEN t.status = 'Review' AND t."priorAssigneeId" IS NOT NULL
                                  THEN t."priorAssigneeId" ELSE t."assigneeId" END)
      )`;
  return rows.map((r) => r.id);
}
