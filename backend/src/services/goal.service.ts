import type { GoalDto, Role } from '@healthy-tasks/shared';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import type {
  CreateGoalInput,
  GoalTeamInput,
  RejectGoalInput,
  ResolveGoalInput,
  UpdateGoalInput,
  UpdateGoalProgressInput,
} from '../validation/schemas.js';
import { goalInclude, toGoalDto, type GoalWithRefs } from './goal.mapper.js';

/**
 * SMART Goals (Phase 12). A goal belongs to an employee and moves through a
 * fixed lifecycle: Draft → PendingApproval → Approved (Active) → UnderReview →
 * Resolved. Either the employee or their supervisor drafts it, but the
 * supervisor must always approve it. Visibility/authorization:
 *  - the owner sees & manages their own goal (drafts, results while Active);
 *  - a supervisor manages goals whose owner's `supervisorId` is them (approve /
 *    reject / resolve) — direct reports only, reusing the existing User field;
 *  - an Admin has full visibility and supervisor authority across all goals.
 * All transition rules are enforced here (not just at the route) so the service
 * is the single source of truth.
 */

export interface GoalActor {
  id: string;
  role: Role;
}

async function findGoalOrThrow(id: number): Promise<GoalWithRefs> {
  const goal = await prisma.goal.findUnique({ where: { id }, include: goalInclude });
  if (!goal) throw HttpError.notFound('Goal not found');
  return goal;
}

/** True when `actorId` is the DIRECT supervisor of `ownerId` (owner.supervisorId). */
async function isDirectSupervisor(actorId: string, ownerId: string): Promise<boolean> {
  if (actorId === ownerId) return false;
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { supervisorId: true } });
  return !!owner && owner.supervisorId === actorId;
}

/** Admin, or the owner's direct supervisor — the only actors who may approve /
 * reject / resolve. A Manager who is not this owner's supervisor is rejected. */
async function assertCanSupervise(actor: GoalActor, goal: GoalWithRefs): Promise<void> {
  if (actor.role === 'Admin') return;
  if (await isDirectSupervisor(actor.id, goal.ownerId)) return;
  throw HttpError.forbidden("Only the employee's supervisor can perform this action");
}

/** Whether `actor` may see the goal at all (owner / supervisor / admin). */
async function canView(actor: GoalActor, goal: GoalWithRefs): Promise<boolean> {
  if (actor.role === 'Admin') return true;
  if (goal.ownerId === actor.id) return true;
  return isDirectSupervisor(actor.id, goal.ownerId);
}

/** A Draft is editable by whoever drafted it or the owner (plus Admin). */
function canEditDraft(actor: GoalActor, goal: GoalWithRefs): boolean {
  return actor.role === 'Admin' || goal.createdById === actor.id || goal.ownerId === actor.id;
}

/** Only the owner (the employee) — plus Admin — updates results / marks final. */
function assertIsOwner(actor: GoalActor, goal: GoalWithRefs): void {
  if (actor.role === 'Admin' || actor.id === goal.ownerId) return;
  throw HttpError.forbidden('Only the goal owner can perform this action');
}

// --- Reads -----------------------------------------------------------------

export async function getGoal(actor: GoalActor, id: number): Promise<GoalDto> {
  const goal = await findGoalOrThrow(id);
  if (!(await canView(actor, goal))) throw HttpError.forbidden('You do not have access to this goal');
  return toGoalDto(goal);
}

/** The caller's own goals, across every status. */
export async function listMyGoals(actor: GoalActor): Promise<GoalDto[]> {
  const goals = await prisma.goal.findMany({
    where: { ownerId: actor.id },
    include: goalInclude,
    orderBy: [{ updatedAt: 'desc' }],
  });
  return goals.map(toGoalDto);
}

/**
 * Team Goals for a supervisor/admin, scoped and filtered. A supervisor sees ONLY
 * goals whose owner reports directly to them; an Admin sees all. Filterable by
 * employee (ownerIds), status, and deadline range, per the Task Search
 * conventions.
 */
export async function listTeamGoals(actor: GoalActor, input: GoalTeamInput): Promise<GoalDto[]> {
  const filters = input.filters ?? {};

  // Establish the owner scope this actor is allowed to see.
  let ownerScope: string[] | null; // null ⇒ unrestricted (Admin, all users)
  if (actor.role === 'Admin') {
    ownerScope = null;
  } else {
    const reports = await prisma.user.findMany({
      where: { supervisorId: actor.id },
      select: { id: true },
    });
    ownerScope = reports.map((r) => r.id);
  }

  // Intersect the requested ownerIds filter with the allowed scope so a
  // supervisor can never widen past their direct reports.
  let ownerIdFilter: string[] | undefined;
  if (ownerScope === null) {
    ownerIdFilter = filters.ownerIds && filters.ownerIds.length > 0 ? filters.ownerIds : undefined;
  } else {
    const requested = filters.ownerIds && filters.ownerIds.length > 0 ? new Set(filters.ownerIds) : null;
    const allowed = requested ? ownerScope.filter((id) => requested.has(id)) : ownerScope;
    // A supervisor with no reports (or an empty intersection) sees nothing.
    if (allowed.length === 0) return [];
    ownerIdFilter = allowed;
  }

  const deadline =
    filters.deadlineFrom || filters.deadlineTo
      ? {
          ...(filters.deadlineFrom ? { gte: filters.deadlineFrom } : {}),
          ...(filters.deadlineTo ? { lte: filters.deadlineTo } : {}),
        }
      : undefined;

  const goals = await prisma.goal.findMany({
    where: {
      ...(ownerIdFilter ? { ownerId: { in: ownerIdFilter } } : {}),
      ...(filters.statuses && filters.statuses.length > 0 ? { status: { in: filters.statuses } } : {}),
      ...(deadline ? { deadline } : {}),
    },
    include: goalInclude,
    orderBy: [{ deadline: 'asc' }, { id: 'asc' }],
  });
  return goals.map(toGoalDto);
}

// --- Create / draft edits --------------------------------------------------

export async function createGoal(actor: GoalActor, input: CreateGoalInput): Promise<GoalDto> {
  const ownerId = input.ownerId ?? actor.id;

  if (ownerId !== actor.id) {
    // Drafting on behalf of someone else is allowed only for that person's
    // supervisor (or an Admin).
    if (actor.role !== 'Admin' && !(await isDirectSupervisor(actor.id, ownerId))) {
      throw HttpError.forbidden('You can only create goals for yourself or your direct reports');
    }
  }

  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { isActive: true } });
  if (!owner || !owner.isActive) throw HttpError.badRequest('The goal owner must be an active user');

  const goal = await prisma.goal.create({
    data: {
      ownerId,
      createdById: actor.id,
      specific: input.specific,
      metricType: input.metricType,
      unitLabel: input.unitLabel ?? null,
      targetValue: input.targetValue,
      deadline: input.deadline,
      risks: input.risks ?? null,
      mitigations: input.mitigations ?? null,
      notes: input.notes ?? null,
      status: 'Draft',
    },
    include: goalInclude,
  });
  return toGoalDto(goal);
}

export async function updateGoalDraft(
  actor: GoalActor,
  id: number,
  input: UpdateGoalInput,
): Promise<GoalDto> {
  const goal = await findGoalOrThrow(id);
  if (goal.status !== 'Draft') throw HttpError.conflict('Only a draft goal can be edited');
  if (!canEditDraft(actor, goal)) throw HttpError.forbidden('You cannot edit this goal');

  // Cross-check the metric/unit against the MERGED result (a custom metric needs
  // a unit label whether it came from this edit or was already set).
  const finalMetric = input.metricType ?? goal.metricType;
  const finalUnit = input.unitLabel !== undefined ? input.unitLabel : goal.unitLabel;
  if (finalMetric === 'Other' && !finalUnit) {
    throw HttpError.badRequest('A unit label is required for a custom metric', {
      unitLabel: 'A unit label is required for a custom metric',
    });
  }

  const updated = await prisma.goal.update({
    where: { id },
    // Prisma ignores `undefined`, so omitted fields are left unchanged.
    data: {
      specific: input.specific,
      metricType: input.metricType,
      unitLabel: input.unitLabel,
      targetValue: input.targetValue,
      deadline: input.deadline,
      risks: input.risks,
      mitigations: input.mitigations,
      notes: input.notes,
    },
    include: goalInclude,
  });
  return toGoalDto(updated);
}

export async function deleteGoal(actor: GoalActor, id: number): Promise<void> {
  const goal = await findGoalOrThrow(id);
  if (goal.status !== 'Draft') throw HttpError.conflict('Only a draft goal can be deleted');
  if (!canEditDraft(actor, goal)) throw HttpError.forbidden('You cannot delete this goal');
  await prisma.goal.delete({ where: { id } });
}

// --- Employee progress (while Active) --------------------------------------

export async function updateGoalProgress(
  actor: GoalActor,
  id: number,
  input: UpdateGoalProgressInput,
): Promise<GoalDto> {
  const goal = await findGoalOrThrow(id);
  assertIsOwner(actor, goal);
  if (goal.status !== 'Approved') {
    throw HttpError.conflict('Results can only be updated while the goal is active');
  }
  const updated = await prisma.goal.update({
    where: { id },
    data: {
      resultValue: input.resultValue,
      notes: input.notes,
      risks: input.risks,
      mitigations: input.mitigations,
    },
    include: goalInclude,
  });
  return toGoalDto(updated);
}

// --- Lifecycle transitions -------------------------------------------------

export async function submitGoal(actor: GoalActor, id: number): Promise<GoalDto> {
  const goal = await findGoalOrThrow(id);
  if (goal.status !== 'Draft') throw HttpError.conflict('Only a draft goal can be submitted for approval');
  if (!canEditDraft(actor, goal)) throw HttpError.forbidden('You cannot submit this goal');
  if (goal.metricType === 'Other' && !goal.unitLabel) {
    throw HttpError.badRequest('A unit label is required before submitting a custom-metric goal');
  }

  const updated = await prisma.goal.update({
    where: { id },
    data: { status: 'PendingApproval', submittedAt: new Date() },
    include: goalInclude,
  });
  return toGoalDto(updated);
}

export async function approveGoal(actor: GoalActor, id: number): Promise<GoalDto> {
  const goal = await findGoalOrThrow(id);
  if (goal.status !== 'PendingApproval') {
    throw HttpError.conflict('Only a goal pending approval can be approved');
  }
  await assertCanSupervise(actor, goal);

  const updated = await prisma.goal.update({
    where: { id },
    data: {
      status: 'Approved',
      approvedAt: new Date(),
      approvedById: actor.id,
      // Approval supersedes any prior rejection reason.
      rejectionComments: null,
    },
    include: goalInclude,
  });
  return toGoalDto(updated);
}

export async function rejectGoal(actor: GoalActor, id: number, input: RejectGoalInput): Promise<GoalDto> {
  const goal = await findGoalOrThrow(id);
  if (goal.status !== 'PendingApproval') {
    throw HttpError.conflict('Only a goal pending approval can be rejected');
  }
  await assertCanSupervise(actor, goal);

  const updated = await prisma.goal.update({
    where: { id },
    // Return to Draft with the reason visible; clear the submission stamp so the
    // goal reads as un-submitted again.
    data: { status: 'Draft', rejectionComments: input.comments, submittedAt: null },
    include: goalInclude,
  });
  return toGoalDto(updated);
}

/**
 * Employee marks Results final, moving an Active goal straight to UnderReview
 * even before its deadline (whichever comes first). If the deadline pass already
 * moved it, the status guard rejects this as a no-op conflict.
 */
export async function finalizeResults(actor: GoalActor, id: number): Promise<GoalDto> {
  const goal = await findGoalOrThrow(id);
  assertIsOwner(actor, goal);
  if (goal.status !== 'Approved') {
    throw HttpError.conflict('Only an active goal can have its results marked final');
  }
  const now = new Date();
  const updated = await prisma.goal.update({
    where: { id },
    data: { status: 'UnderReview', resultsFinalizedAt: now, underReviewAt: now },
    include: goalInclude,
  });
  return toGoalDto(updated);
}

export async function resolveGoal(actor: GoalActor, id: number, input: ResolveGoalInput): Promise<GoalDto> {
  const goal = await findGoalOrThrow(id);
  if (goal.status !== 'UnderReview') {
    throw HttpError.conflict('A goal can only be resolved once it is under review');
  }
  await assertCanSupervise(actor, goal);

  const updated = await prisma.goal.update({
    where: { id },
    data: {
      status: 'Resolved',
      resolution: input.resolution,
      supervisorComments: input.supervisorComments,
      resolvedAt: new Date(),
      resolvedById: actor.id,
    },
    include: goalInclude,
  });
  return toGoalDto(updated);
}

// --- Scheduled review transition -------------------------------------------

/**
 * Move every Active (Approved) goal whose deadline has passed to UnderReview.
 * Run on each scheduler tick (and callable directly in tests with an explicit
 * `now`). Goals the employee already marked final are no longer Approved, so
 * they are untouched — the two triggers race cleanly with "whichever first".
 * Returns how many goals transitioned.
 */
export async function runGoalReviewPass(now: Date): Promise<number> {
  const result = await prisma.goal.updateMany({
    where: { status: 'Approved', deadline: { lte: now } },
    data: { status: 'UnderReview', underReviewAt: now },
  });
  return result.count;
}
