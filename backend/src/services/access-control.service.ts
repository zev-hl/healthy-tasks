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
// Parent/Child tree walks (for read-only access inheritance — follow-up phase)
// ---------------------------------------------------------------------------

/**
 * All task ids strictly BELOW the given seed tasks in the Parent/Child tree
 * (descendants at any depth), excluding tasks that are themselves Private. A
 * Private task does not stop the walk — its own non-private descendants stay
 * reachable — it is simply omitted from the result. Recursive CTE (the tree is
 * asserted acyclic in task.service).
 */
async function descendantTaskIds(seedIds: number[]): Promise<number[]> {
  if (seedIds.length === 0) return [];
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    WITH RECURSIVE d AS (
      SELECT id, "isPrivate" FROM "Task" WHERE "parentId" = ANY(${seedIds}::int[])
      UNION
      SELECT t.id, t."isPrivate" FROM "Task" t JOIN d ON t."parentId" = d.id
    )
    SELECT id FROM d WHERE "isPrivate" = false`;
  return rows.map((r) => r.id);
}

/** All task ids strictly ABOVE the seed tasks (ancestors at any depth), Private excluded. */
async function ancestorTaskIds(seedIds: number[]): Promise<number[]> {
  if (seedIds.length === 0) return [];
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    WITH RECURSIVE a AS (
      SELECT "parentId" AS id FROM "Task" WHERE id = ANY(${seedIds}::int[]) AND "parentId" IS NOT NULL
      UNION
      SELECT t."parentId" FROM "Task" t JOIN a ON t.id = a.id WHERE t."parentId" IS NOT NULL
    )
    SELECT a.id FROM a JOIN "Task" t ON t.id = a.id WHERE t."isPrivate" = false`;
  return rows.map((r) => r.id);
}

/** Task ids where `actorId` is @mentioned in a non-private comment (mention access). */
async function mentionedTaskIds(actorId: string): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ taskId: number }[]>`
    SELECT DISTINCT c."taskId" FROM "CommentMention" cm
      JOIN "Comment" c ON cm."commentId" = c.id
      JOIN "Task" t ON t.id = c."taskId"
     WHERE cm."userId" = ${actorId} AND t."isPrivate" = false`;
  return rows.map((r) => r.taskId);
}

/**
 * Does `actor` reach `taskId` DOWNWARD — i.e. some ancestor of it is a task they
 * have full access to (its assignee is in the actor's downline-or-self)? The
 * ancestor may itself be Private; full access to a private ancestor still lets
 * the actor see its (non-private) descendants.
 */
async function hasDownwardTreeAccess(fullIds: string[], taskId: number): Promise<boolean> {
  if (fullIds.length === 0) return false;
  const rows = await prisma.$queryRaw<{ one: number }[]>`
    WITH RECURSIVE a AS (
      SELECT "parentId" AS id FROM "Task" WHERE id = ${taskId} AND "parentId" IS NOT NULL
      UNION
      SELECT t."parentId" FROM "Task" t JOIN a ON t.id = a.id WHERE t."parentId" IS NOT NULL
    )
    SELECT 1 AS one FROM a JOIN "Task" t ON t.id = a.id
     WHERE t."assigneeId" = ANY(${fullIds}::text[]) LIMIT 1`;
  return rows.length > 0;
}

/**
 * Does `actor` reach `taskId` UPWARD — i.e. some descendant of it is a task they
 * can access via full access or a mention? (Access to a descendant grants
 * read-only visibility into its ancestors.)
 */
async function hasUpwardTreeAccess(
  actorId: string,
  fullIds: string[],
  taskId: number,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ one: number }[]>`
    WITH RECURSIVE d AS (
      SELECT id FROM "Task" WHERE "parentId" = ${taskId}
      UNION
      SELECT t.id FROM "Task" t JOIN d ON t."parentId" = d.id
    )
    SELECT 1 AS one FROM d JOIN "Task" t ON t.id = d.id
     WHERE t."assigneeId" = ANY(${fullIds}::text[])
        OR (t."isPrivate" = false AND EXISTS (
              SELECT 1 FROM "Comment" c JOIN "CommentMention" cm ON cm."commentId" = c.id
               WHERE c."taskId" = t.id AND cm."userId" = ${actorId}))
     LIMIT 1`;
  return rows.length > 0;
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
 *  - `full`    — Admin, the current Assignee, or a supervisor above the Assignee
 *                (editable).
 *  - `comment` — currently @mentioned in a non-private comment (read-only + comment).
 *  - `tree`    — read-only visibility inherited via Parent/Child tree position
 *                (down from a full-access ancestor, or up from any accessible
 *                descendant); suspended when the task is Private.
 *  - null      — no access (caller turns this into a 404, never leaking existence).
 * Private tasks expose NO mention or tree access — only {Admin, Assignee, chain}.
 */
export async function computeTaskAccess(
  actor: Actor,
  task: TaskAccessSubject,
): Promise<TaskAccessLevel | null> {
  if (actor.role === 'Admin') return 'full';
  if (task.assigneeId && task.assigneeId === actor.id) return 'full';
  if (await isInSupervisorChain(actor.id, task.assigneeId)) return 'full';
  // A Private task grants no mention or tree access — it overrides inheritance.
  if (task.isPrivate) return null;
  const mention = await prisma.commentMention.findFirst({
    where: { userId: actor.id, comment: { taskId: task.id } },
    select: { userId: true },
  });
  if (mention) return 'comment';
  // Tree inheritance (read-only): reachable down from a full-access ancestor, or
  // up from an accessible descendant.
  const fullIds = [actor.id, ...(await getDownlineIds(actor.id))];
  if (await hasDownwardTreeAccess(fullIds, task.id)) return 'tree';
  if (await hasUpwardTreeAccess(actor.id, fullIds, task.id)) return 'tree';
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
    throw HttpError.forbidden('You have read-only access to this task');
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
 * A precomputed access scope for one actor, reused across a whole list query
 * AND across a Task Detail's referenced tasks. Computed once (a few tree walks):
 *  - `fullIds`     — assignee ids that grant full access (actor + downline); null for Admin.
 *  - `fullTaskIds` — task ids the actor has FULL (edit) access to.
 *  - `mentionIds`  — task ids visible via a mention (non-private).
 *  - `treeIds`     — task ids visible read-only via Parent/Child inheritance (non-private).
 * A task is VISIBLE iff Admin, or its id is in fullTaskIds ∪ mentionIds ∪ treeIds.
 */
export interface TaskAccessScope {
  isAdmin: boolean;
  fullIds: Set<string> | null;
  fullTaskIds: Set<number>;
  mentionIds: Set<number>;
  treeIds: Set<number>;
}

const EMPTY_NUM_SET = (): Set<number> => new Set<number>();

export async function getTaskAccessScope(actor: Actor): Promise<TaskAccessScope> {
  if (actor.role === 'Admin') {
    return {
      isAdmin: true,
      fullIds: null,
      fullTaskIds: EMPTY_NUM_SET(),
      mentionIds: EMPTY_NUM_SET(),
      treeIds: EMPTY_NUM_SET(),
    };
  }
  const downline = await getDownlineIds(actor.id);
  const fullIds = new Set<string>([actor.id, ...downline]);

  // F: tasks the actor has full access to (assignee in fullIds).
  const fullTasks = await prisma.task.findMany({
    where: { assigneeId: { in: [...fullIds] } },
    select: { id: true },
  });
  const fullTaskIds = fullTasks.map((t) => t.id);
  // M: non-private tasks the actor is mentioned in.
  const mentionList = await mentionedTaskIds(actor.id);
  // D: non-private descendants of the full-access tasks (downward inheritance).
  const down = await descendantTaskIds(fullTaskIds);
  // U: non-private ancestors of every accessible task (upward inheritance).
  const upSeed = [...new Set([...fullTaskIds, ...mentionList, ...down])];
  const up = await ancestorTaskIds(upSeed);

  return {
    isAdmin: false,
    fullIds,
    fullTaskIds: new Set(fullTaskIds),
    mentionIds: new Set(mentionList),
    treeIds: new Set<number>([...down, ...up]),
  };
}

/**
 * The Prisma predicate that limits a multi-task query to what `actor` may see.
 * `null` = no restriction (Admin). Full-access tasks stay a cheap `assigneeId IN`
 * predicate; read-only tasks (mention + tree inheritance) are added as an id-set
 * clause, included only when `includeReadOnly` (the "show read-only" toggle).
 */
export function buildTaskAccessWhere(
  scope: TaskAccessScope,
  includeReadOnly: boolean,
): Prisma.TaskWhereInput | null {
  if (scope.isAdmin || scope.fullIds === null) return null;
  const clauses: Prisma.TaskWhereInput[] = [{ assigneeId: { in: [...scope.fullIds] } }];
  if (includeReadOnly) {
    const readOnly = [...scope.mentionIds, ...scope.treeIds];
    if (readOnly.length > 0) clauses.push({ id: { in: readOnly } });
  }
  return { OR: clauses };
}

/** True when `actor` can see this task at all (any access source). */
export function isTaskVisible(scope: TaskAccessScope, taskId: number): boolean {
  return (
    scope.isAdmin ||
    scope.fullTaskIds.has(taskId) ||
    scope.mentionIds.has(taskId) ||
    scope.treeIds.has(taskId)
  );
}

/**
 * The actor's access level for one task, derived from a precomputed scope (no
 * extra queries) — matches `computeTaskAccess` but reuses the batch sets. `null`
 * means no access. Full access wins over mention, which wins over tree.
 */
export function scopeTaskLevel(scope: TaskAccessScope, taskId: number): TaskAccessLevel | null {
  if (scope.isAdmin || scope.fullTaskIds.has(taskId)) return 'full';
  if (scope.mentionIds.has(taskId)) return 'comment';
  if (scope.treeIds.has(taskId)) return 'tree';
  return null;
}

/** How a returned row is visible, for the read-only cues in the multi-task views. */
export interface RowAccessFlags {
  /** Read-only because the actor is only @mentioned (not full access). */
  mentionOnly: boolean;
  /** Read-only because the actor only reaches it via Parent/Child tree position. */
  treeOnly: boolean;
}

export function classifyRow(scope: TaskAccessScope, taskId: number): RowAccessFlags {
  const full = scope.isAdmin || scope.fullTaskIds.has(taskId);
  if (full) return { mentionOnly: false, treeOnly: false };
  return {
    mentionOnly: scope.mentionIds.has(taskId),
    treeOnly: scope.treeIds.has(taskId),
  };
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
