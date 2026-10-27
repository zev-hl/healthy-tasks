import {
  ALERT_TASK_DUTY_NEEDED_CODE,
  EXCLUSIVES_ALERT_TYPE_LABELS,
  TERMINAL_TASK_STATUSES,
  isSupervisorRole,
  type ExclusivesAlertType,
  type OrgDto,
  type OrgPersonDto,
} from '@healthy-tasks/shared';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { STALE_WRITE_CODE } from '../utils/optimistic.js';
import type { SaveOrgChangesInput } from '../validation/schemas.js';
import { type Actor, getDownlineIds } from './access-control.service.js';
import { assertDutyAssignable } from './department.service.js';
import { alertTaskPicksByPerson } from './exclusives/alert-task-setup.service.js';

/**
 * Organization (Department Duties): who reports to whom, and which duties each
 * person holds, edited in bulk. Admins manage everyone. A Manager manages the
 * people below them — their reports and their reports' reports, the same subtree
 * rule as Phase 13 task access — and may move those people only within that
 * subtree; never themselves. The Supervisor field on Add/Edit User saves to the
 * same column and stays Admin-only.
 */

/** The ids this actor may manage (null = everyone, for Admins). */
async function manageableIds(actor: Actor): Promise<Set<string> | null> {
  if (actor.role === 'Admin') return null;
  if (actor.role !== 'Manager') return new Set();
  return new Set(await getDownlineIds(actor.id));
}

/** True if `actor` may change `userId`'s duties ("Give this duty", Organization). */
export async function canManageDuties(actor: Actor, userId: string): Promise<boolean> {
  const ids = await manageableIds(actor);
  return ids === null || ids.has(userId);
}

export async function getOrg(actor: Actor): Promise<OrgDto> {
  if (actor.role !== 'Admin' && actor.role !== 'Manager') {
    throw HttpError.forbidden('Only an admin or manager can manage the organization');
  }
  const manageable = await manageableIds(actor);
  const visible = manageable === null ? null : [actor.id, ...manageable];

  const users = await prisma.user.findMany({
    where: { isActive: true, ...(visible ? { id: { in: visible } } : {}) },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      title: true,
      role: true,
      supervisorId: true,
      duties: { select: { dutyId: true } },
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }],
  });
  const ids = users.map((u) => u.id);
  const open = await prisma.task.groupBy({
    by: ['assigneeId', 'dutyId'],
    where: {
      assigneeId: { in: ids },
      dutyId: { not: null },
      status: { notIn: [...TERMINAL_TASK_STATUSES] },
    },
    _count: { _all: true },
    orderBy: [{ assigneeId: 'asc' }, { dutyId: 'asc' }],
  });
  const picks = await alertTaskPicksByPerson();
  const openBy = new Map<string, Record<string, number>>();
  for (const g of open) {
    if (!g.assigneeId || !g.dutyId) continue;
    const rec = openBy.get(g.assigneeId) ?? {};
    rec[g.dutyId] = g._count._all;
    openBy.set(g.assigneeId, rec);
  }

  const people: OrgPersonDto[] = users.map((u) => {
    const editable = manageable === null || manageable.has(u.id);
    return {
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      title: u.title,
      role: u.role,
      // A Manager's own supervisor is outside their view; hide it so the tree
      // roots at them.
      supervisorId: visible && !visible.includes(u.supervisorId ?? '') ? null : u.supervisorId,
      dutyIds: u.duties.map((d) => d.dutyId),
      openTaskCountByDuty: openBy.get(u.id) ?? {},
      alertTaskPicks: picks.get(u.id) ?? [],
      canEditDuties: editable,
      canChangeSupervisor: editable,
    };
  });
  return { people, scope: manageable === null ? 'all' : 'team' };
}

/**
 * Apply staged Organization edits in one transaction: supervisor moves first
 * (validated as a whole, so a batch can't create a loop), then duty adds and
 * removals. Removing a duty that open tasks still use is allowed — those tasks
 * are flagged ⚠, never changed. Removing one a person's Alert Task Setup role
 * needs is not (HLAI-112): that role is first set to “Leave unassigned” there.
 */
export async function saveOrgChanges(actor: Actor, input: SaveOrgChangesInput): Promise<OrgDto> {
  if (actor.role !== 'Admin' && actor.role !== 'Manager') {
    throw HttpError.forbidden('Only an admin or manager can manage the organization');
  }
  const manageable = await manageableIds(actor);
  const isAdmin = manageable === null;
  const supChanges = input.supervisorChanges ?? [];
  const dutyChanges = (input.dutyChanges ?? []).filter((c) => c.add.length + c.remove.length > 0);

  const all = await prisma.user.findMany({
    select: {
      id: true,
      role: true,
      isActive: true,
      supervisorId: true,
      firstName: true,
      lastName: true,
    },
  });
  const byId = new Map(all.map((u) => [u.id, u]));

  const assertManageable = (userId: string): void => {
    const u = byId.get(userId);
    if (!u || !u.isActive) throw HttpError.badRequest('That person does not exist or is inactive');
    if (!isAdmin && !manageable!.has(userId)) {
      throw HttpError.forbidden(
        'You can only change people who report to you (directly or indirectly)',
      );
    }
  };

  // --- Supervisors ---------------------------------------------------------
  const finalSup = new Map(all.map((u) => [u.id, u.supervisorId]));
  for (const c of supChanges) {
    assertManageable(c.userId);
    const current = byId.get(c.userId)!.supervisorId;
    if (current !== c.expectedSupervisorId) {
      throw new HttpError(
        409,
        'Someone changed this reporting line while you were editing. Reload and try again.',
        {
          code: STALE_WRITE_CODE,
        },
      );
    }
    if (c.supervisorId === null) {
      // Top level = outside every Manager's team, so only an Admin may do it.
      if (!isAdmin) throw HttpError.forbidden('Only an admin can remove a supervisor');
    } else {
      if (c.supervisorId === c.userId)
        throw HttpError.badRequest('A person cannot be their own supervisor');
      const sup = byId.get(c.supervisorId);
      if (!sup || !sup.isActive)
        throw HttpError.badRequest('Selected supervisor does not exist or is inactive');
      if (!isSupervisorRole(sup.role)) {
        throw HttpError.badRequest(
          `Supervisor must be a Manager or Admin (${sup.firstName || 'that person'} is a ${sup.role})`,
        );
      }
      if (!isAdmin && c.supervisorId !== actor.id && !manageable!.has(c.supervisorId)) {
        throw HttpError.forbidden('You can only move people within your own team');
      }
    }
    finalSup.set(c.userId, c.supervisorId);
  }
  // No loops in the resulting chart (someone ending up under their own report).
  for (const c of supChanges) {
    const seen = new Set<string>([c.userId]);
    let cur = finalSup.get(c.userId) ?? null;
    while (cur) {
      if (seen.has(cur)) {
        throw HttpError.badRequest(
          'That move would put someone under one of their own subordinates',
        );
      }
      seen.add(cur);
      cur = finalSup.get(cur) ?? null;
    }
  }

  // --- Duties ----------------------------------------------------------------
  for (const c of dutyChanges) assertManageable(c.userId);
  const newDutyIds = new Set(dutyChanges.flatMap((c) => c.add));
  for (const dutyId of newDutyIds) await assertDutyAssignable(dutyId);
  await assertAlertTaskDutiesKept(
    dutyChanges.filter((c) => c.remove.length > 0),
    (id) => byId.get(id),
    isAdmin,
  );

  await prisma.$transaction(async (tx) => {
    for (const c of supChanges) {
      await tx.user.update({ where: { id: c.userId }, data: { supervisorId: c.supervisorId } });
    }
    for (const c of dutyChanges) {
      if (c.remove.length > 0) {
        await tx.userDuty.deleteMany({ where: { userId: c.userId, dutyId: { in: c.remove } } });
      }
      if (c.add.length > 0) {
        await tx.userDuty.createMany({
          data: c.add.map((dutyId) => ({ userId: c.userId, dutyId })),
          skipDuplicates: true,
        });
      }
    }
  });

  return getOrg(actor);
}

/** "Give this person this duty" — the one-click fix on tasks and templates. */
export async function grantDuty(actor: Actor, userId: string, dutyId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  if (!user || !user.isActive)
    throw HttpError.badRequest('That person does not exist or is inactive');
  if (!(await canManageDuties(actor, userId))) {
    throw HttpError.forbidden("Only an admin or this person's supervisor can change their duties");
  }
  await assertDutyAssignable(dutyId);
  await prisma.userDuty.upsert({
    where: { userId_dutyId: { userId, dutyId } },
    create: { userId, dutyId },
    update: {},
  });
}

/**
 * HLAI-112: refuse taking away a duty that a role someone fills on Alert Task
 * Setup needs — their alert tasks would go to them without it, and the screen
 * would show ⚠. That role is first set to "Leave unassigned" there (or given to
 * someone else), by an Admin: only Admins change Alert Task Setup.
 */
async function assertAlertTaskDutiesKept(
  removals: { userId: string; remove: string[] }[],
  person: (id: string) => { firstName: string; lastName: string } | undefined,
  isAdmin: boolean,
): Promise<void> {
  if (removals.length === 0) return;
  const picks = await alertTaskPicksByPerson();
  const problems: {
    userId: string;
    alertType: ExclusivesAlertType;
    role: string;
    dutyId: string;
  }[] = [];
  for (const c of removals) {
    for (const pick of picks.get(c.userId) ?? []) {
      for (const dutyId of pick.dutyIds) {
        if (c.remove.includes(dutyId)) {
          problems.push({ userId: c.userId, alertType: pick.alertType, role: pick.role, dutyId });
        }
      }
    }
  }
  if (problems.length === 0) return;

  const duties = new Map(
    (
      await prisma.duty.findMany({
        where: { id: { in: [...new Set(problems.map((x) => x.dutyId))] } },
        select: { id: true, name: true, department: { select: { name: true } } },
      })
    ).map((d) => [d.id, `${d.department.name} › ${d.name}`]),
  );
  const sentences = problems.map((x) => {
    const who = person(x.userId);
    const name = who ? `${who.firstName} ${who.lastName}`.trim() : 'Someone';
    return (
      `${name} is needed as ${x.role} for ${EXCLUSIVES_ALERT_TYPE_LABELS[x.alertType]} on ` +
      `Alert Task Setup, which needs ${duties.get(x.dutyId) ?? 'that duty'}.`
    );
  });
  const fix =
    `Set ${problems.length === 1 ? 'that role' : 'those roles'} to “Leave unassigned” ` +
    `on Alert Task Setup first` +
    (isAdmin ? '.' : ' (only an Admin can change Alert Task Setup).');
  throw new HttpError(422, `${sentences.join(' ')} ${fix}`, {
    code: ALERT_TASK_DUTY_NEEDED_CODE,
    problems,
  });
}
