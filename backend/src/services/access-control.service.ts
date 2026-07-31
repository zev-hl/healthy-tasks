import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import type { OrgHierarchyNode, Role, TaskAccessLevel } from '@healthy-tasks/shared';

/**
 * Task-Level Access Control (Phase 13). The single, shared source of truth for
 * "who can see / edit / assign / mention on which task" across every screen
 * (Search, Kanban, Gantt, Calendar, Task Detail, Goals, the Review workflow, and
 * the Due Date Performance Report).
 *
 * Everything here is computed LIVE from the current org chart (`User.supervisor`)
 * and the task's current Assignee / comment mentions / Private flag — nothing is
 * cached or frozen at creation time, so access follows reorganisations and edits
 * immediately. See docs/architecture.md "Task-Level Access Control".
 */

export interface Actor {
  id: string;
  role: Role;
}

// ---------------------------------------------------------------------------
// Org-chart walks (all cycle-guarded)
// ---------------------------------------------------------------------------

/**
 * Ids of everyone strictly ABOVE `userId` in the supervisor chain, nearest
 * first. Walks `User.supervisorId` upward; a visited set guards against a
 * malformed cycle.
 */
export async function getSupervisorChainIds(userId: string | null): Promise<string[]> {
  const chain: string[] = [];
  const visited = new Set<string>();
  let currentId = userId;
  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const current = await prisma.user.findUnique({
      where: { id: currentId },
      select: { supervisorId: true },
    });
    const supId = current?.supervisorId ?? null;
    if (!supId || visited.has(supId)) break;
    chain.push(supId);
    currentId = supId;
  }
  return chain;
}

/** True when `actorId` appears anywhere above `subordinateId` in the chain. */
export async function isInSupervisorChain(
  actorId: string,
  subordinateId: string | null,
): Promise<boolean> {
  if (!subordinateId || actorId === subordinateId) return false;
  const chain = await getSupervisorChainIds(subordinateId);
  return chain.includes(actorId);
}

/**
 * All ids strictly BELOW `userId` (direct reports and everyone under them, at
 * any depth). BFS over `supervisorId`; a visited set guards against cycles.
 */
export async function getDownlineIds(userId: string): Promise<string[]> {
  const out: string[] = [];
  const visited = new Set<string>([userId]);
  let frontier = [userId];
  while (frontier.length > 0) {
    const reports = await prisma.user.findMany({
      where: { supervisorId: { in: frontier } },
      select: { id: true },
    });
    const next: string[] = [];
    for (const r of reports) {
      if (visited.has(r.id)) continue;
      visited.add(r.id);
      out.push(r.id);
      next.push(r.id);
    }
    frontier = next;
  }
  return out;
}

/**
 * The actor's IMMEDIATE TEAM: their own direct supervisor plus that supervisor's
 * other direct reports (their peers). Excludes the actor themselves (callers add
 * self where the rule allows). Empty when the actor has no supervisor.
 */
export async function getImmediateTeamIds(userId: string): Promise<string[]> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { supervisorId: true },
  });
  const supId = me?.supervisorId ?? null;
  if (!supId) return [];
  const peers = await prisma.user.findMany({
    where: { supervisorId: supId },
    select: { id: true },
  });
  const ids = new Set<string>([supId]);
  for (const p of peers) if (p.id !== userId) ids.add(p.id);
  return [...ids];
}

// ---------------------------------------------------------------------------
// Per-task access
// ---------------------------------------------------------------------------

/** The minimal task fields every access decision needs. */
export interface TaskAccessSubject {
  id: number;
  assigneeId: string | null;
  isPrivate: boolean;
}

/**
 * The actor's live access to one task, or null if they cannot see it at all:
 *  - `full`    — Admin, the current Assignee, or a supervisor above the Assignee.
 *  - `comment` — currently @mentioned in a non-private comment (mention-only).
 *  - null      — no access (caller turns this into a 404, never leaking existence).
 */
export async function computeTaskAccess(
  actor: Actor,
  task: TaskAccessSubject,
): Promise<TaskAccessLevel | null> {
  if (actor.role === 'Admin') return 'full';
  if (task.assigneeId && task.assigneeId === actor.id) return 'full';
  if (await isInSupervisorChain(actor.id, task.assigneeId)) return 'full';
  // Mention-only access is suspended while the task is Private.
  if (!task.isPrivate) {
    const mention = await prisma.commentMention.findFirst({
      where: { userId: actor.id, comment: { taskId: task.id } },
      select: { userId: true },
    });
    if (mention) return 'comment';
  }
  return null;
}

/**
 * Load the task's access-relevant fields and compute the actor's level; throws
 * 404 when they cannot see it (so a hidden task is indistinguishable from a
 * missing one). Returns the level plus those fields for follow-on checks.
 */
export async function requireTaskAccess(
  actor: Actor,
  taskId: number,
): Promise<{ level: TaskAccessLevel } & TaskAccessSubject> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, assigneeId: true, isPrivate: true },
  });
  if (!task) throw HttpError.notFound('Task not found');
  const level = await computeTaskAccess(actor, task);
  if (!level) throw HttpError.notFound('Task not found');
  return { level, ...task };
}

/**
 * Require FULL (edit) access. A no-access actor gets 404 (existence hidden); a
 * mention-only actor gets 403 (they can see it, but it is read-only for them).
 */
export async function assertCanEditTask(actor: Actor, taskId: number): Promise<void> {
  const { level } = await requireTaskAccess(actor, taskId);
  if (level !== 'full') {
    throw HttpError.forbidden('You have read-only (comment-only) access to this task');
  }
}

/**
 * Whether the actor may flip the Private toggle: Admin, or someone in the
 * Assignee's supervisor chain — but never the Assignee themselves.
 */
export async function canTogglePrivate(actor: Actor, assigneeId: string | null): Promise<boolean> {
  if (actor.role === 'Admin') return true;
  if (actor.id === assigneeId) return false;
  return isInSupervisorChain(actor.id, assigneeId);
}

// ---------------------------------------------------------------------------
// Assignment restriction (who may be set as Assignee)
// ---------------------------------------------------------------------------

/**
 * The set of user ids `actor` may set as an Assignee, or null for Admin (any
 * active user). Rules (see spec / architecture):
 *  - Member  → self + immediate team (own supervisor + peers).
 *  - Manager → the above + their entire downline.
 *  - Admin   → unrestricted.
 */
export async function getAssignableUserIds(actor: Actor): Promise<Set<string> | null> {
  if (actor.role === 'Admin') return null;
  const ids = new Set<string>([actor.id]); // you can always assign to yourself
  for (const id of await getImmediateTeamIds(actor.id)) ids.add(id);
  if (actor.role === 'Manager') {
    for (const id of await getDownlineIds(actor.id)) ids.add(id);
  }
  return ids;
}

/** Throw 403 if `actor` may not assign to `assigneeId`. No-op for Admin. */
export async function assertAssigneeAllowed(actor: Actor, assigneeId: string): Promise<void> {
  const allowed = await getAssignableUserIds(actor);
  if (allowed === null) return;
  if (!allowed.has(assigneeId)) {
    throw HttpError.forbidden(
      'You can only assign tasks to yourself, your immediate team, or your downline',
    );
  }
}

// ---------------------------------------------------------------------------
// Mention & reviewer candidate pools
// ---------------------------------------------------------------------------

/**
 * User ids that may be @mentioned on a task. `null` means unrestricted (all
 * active users) — the case for a non-private task. A Private task restricts
 * mentions to its visibility set: {Admin(s), Assignee, Assignee's chain}.
 */
export async function getMentionCandidateIds(
  task: Pick<TaskAccessSubject, 'assigneeId' | 'isPrivate'>,
): Promise<Set<string> | null> {
  if (!task.isPrivate) return null;
  const ids = new Set<string>();
  if (task.assigneeId) ids.add(task.assigneeId);
  for (const id of await getSupervisorChainIds(task.assigneeId)) ids.add(id);
  for (const id of await activeAdminIds()) ids.add(id);
  return ids;
}

/**
 * The reviewer-selection pool for the Review workflow: Admin(s) plus anyone in
 * the Assignee's supervisor chain. Deliberately narrower and DIFFERENT from the
 * "who may click Reviewed" check (Admin / the Assignee / a supervisor above);
 * the two coexist.
 */
export async function getReviewerCandidateIds(assigneeId: string | null): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const id of await getSupervisorChainIds(assigneeId)) ids.add(id);
  for (const id of await activeAdminIds()) ids.add(id);
  return ids;
}

async function activeAdminIds(): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: { role: 'Admin', isActive: true },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

// ---------------------------------------------------------------------------
// Multi-task view scoping (Search, Kanban, Gantt, Calendar, Report, Dashboard)
// ---------------------------------------------------------------------------

/**
 * A precomputed access scope for one actor, reused across a whole list query.
 * `fullIds` = the assignee ids that grant full access (the actor + their entire
 * downline); `null` for Admin (unrestricted).
 */
export interface TaskAccessScope {
  isAdmin: boolean;
  fullIds: Set<string> | null;
}

export async function getTaskAccessScope(actor: Actor): Promise<TaskAccessScope> {
  if (actor.role === 'Admin') return { isAdmin: true, fullIds: null };
  const downline = await getDownlineIds(actor.id);
  return { isAdmin: false, fullIds: new Set<string>([actor.id, ...downline]) };
}

/**
 * The Prisma predicate that limits a multi-task query to what `actor` may see.
 * `null` = no restriction (Admin). The first clause is full-access (assignee in
 * the actor's downline-or-self); the second, added only when `includeMentioned`,
 * is the non-private mention-only clause.
 */
export function buildTaskAccessWhere(
  scope: TaskAccessScope,
  actorId: string,
  includeMentioned: boolean,
): Prisma.TaskWhereInput | null {
  if (scope.isAdmin || scope.fullIds === null) return null;
  const clauses: Prisma.TaskWhereInput[] = [{ assigneeId: { in: [...scope.fullIds] } }];
  if (includeMentioned) {
    clauses.push({
      isPrivate: false,
      comments: { some: { mentions: { some: { userId: actorId } } } },
    });
  }
  return { OR: clauses };
}

/**
 * Whether a returned row is visible ONLY via a mention (not full access) — the
 * flag that drives the read-only cue and disabled drag in the views. Always
 * false for Admin (who has full access to everything).
 */
export function isMentionOnly(scope: TaskAccessScope, assigneeId: string | null): boolean {
  if (scope.isAdmin || scope.fullIds === null) return false;
  return assigneeId === null || !scope.fullIds.has(assigneeId);
}

// ---------------------------------------------------------------------------
// Scoped org hierarchy (Team Hierarchy filter + Goals downline)
// ---------------------------------------------------------------------------

interface OrgUserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  title: string | null;
  supervisorId: string | null;
  role: Role;
}

/**
 * The org tree the actor is allowed to see/select: Admin sees everyone; anyone
 * else sees themselves as the root with their entire downline beneath. Built by
 * walking the Supervisor field. Active users only.
 */
export async function getScopedHierarchy(actor: Actor): Promise<OrgHierarchyNode[]> {
  const select = {
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    title: true,
    supervisorId: true,
    role: true,
  } as const;

  let users: OrgUserRow[];
  if (actor.role === 'Admin') {
    users = await prisma.user.findMany({ where: { isActive: true }, select });
  } else {
    const ids = [actor.id, ...(await getDownlineIds(actor.id))];
    users = await prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select });
  }

  const inSet = new Set(users.map((u) => u.id));
  const childrenBySup = new Map<string, OrgUserRow[]>();
  for (const u of users) {
    const sup = u.supervisorId && inSet.has(u.supervisorId) ? u.supervisorId : null;
    if (sup) {
      const list = childrenBySup.get(sup) ?? [];
      list.push(u);
      childrenBySup.set(sup, list);
    }
  }
  const byName = (a: OrgUserRow, b: OrgUserRow): number =>
    `${a.lastName} ${a.firstName} ${a.email}`.localeCompare(`${b.lastName} ${b.firstName} ${b.email}`);

  const visited = new Set<string>();
  const build = (u: OrgUserRow): OrgHierarchyNode => {
    visited.add(u.id);
    const kids = (childrenBySup.get(u.id) ?? [])
      .filter((k) => !visited.has(k.id))
      .sort(byName)
      .map(build);
    return {
      user: {
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        title: u.title,
        supervisorId: u.supervisorId,
        role: u.role,
      },
      children: kids,
    };
  };

  // Roots: the actor for a non-admin; for Admin, everyone whose supervisor is
  // outside the visible set (or null).
  if (actor.role !== 'Admin') {
    const self = users.find((u) => u.id === actor.id);
    return self ? [build(self)] : [];
  }
  return users
    .filter((u) => !u.supervisorId || !inSet.has(u.supervisorId))
    .sort(byName)
    .map(build);
}
