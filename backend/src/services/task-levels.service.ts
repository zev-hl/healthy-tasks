import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';

/**
 * Task levels (Nov 2026 plan, F1/F5): Project › Task › Sub-task.
 *
 *  - A project is a top-level task marked as one (a CHECK keeps it top-level).
 *  - Under a project: tasks, and under those, sub-tasks. Three levels in all.
 *  - A top-level task that is not a project holds one level of sub-tasks.
 *
 * Checked whenever a task is placed under another one or (un)marked as a
 * project. Trees deeper than this from before the rule are left as they are;
 * only a change that would make (or keep making) a tree too deep is refused.
 * Templates follow the same rule: one holds at most three levels
 * (template.service.ts), and tasks made from a three-level template get a
 * project on top (template-instantiation.service.ts).
 */

type Db = Prisma.TransactionClient | typeof prisma;

const FOURTH_LEVEL =
  'That would make a fourth level: a project holds tasks, and a task holds sub-tasks.';
const SUBTASK_UNDER_SUBTASK =
  'That would put a sub-task under a sub-task. Only a project can hold three levels: mark the top task as a project first.';

/** The chain from `taskId` up to its top task: [taskId, parent, …, top]. */
async function chainUp(db: Db, taskId: number): Promise<{ id: number; isProject: boolean }[]> {
  const chain: { id: number; isProject: boolean }[] = [];
  const seen = new Set<number>();
  let id: number | null = taskId;
  while (id != null && !seen.has(id)) {
    seen.add(id);
    const row: { id: number; isProject: boolean; parentId: number | null } | null =
      await db.task.findUnique({
        where: { id },
        select: { id: true, isProject: true, parentId: true },
      });
    if (!row) break;
    chain.push({ id: row.id, isProject: row.isProject });
    id = row.parentId;
  }
  return chain;
}

/** How many levels sit below `taskId` (0 = no sub-tasks). */
export async function levelsBelow(db: Db, taskId: number): Promise<number> {
  let height = 0;
  let frontier = [taskId];
  const seen = new Set<number>(frontier);
  for (;;) {
    const kids = await db.task.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    const next = kids.map((k) => k.id).filter((k) => !seen.has(k));
    if (next.length === 0) return height;
    next.forEach((k) => seen.add(k));
    frontier = next;
    height += 1;
  }
}

/** Where `taskId` sits: depth (0 = top), whether its top is a project, levels below. */
export async function levelInfo(
  db: Db,
  taskId: number,
): Promise<{ depth: number; topIsProject: boolean; below: number }> {
  const chain = await chainUp(db, taskId);
  const top = chain[chain.length - 1];
  return {
    depth: Math.max(chain.length - 1, 0),
    topIsProject: top?.isProject ?? false,
    below: await levelsBelow(db, taskId),
  };
}

/** Whether `taskId` may go under `parentId` (the check below, as a yes/no). */
export async function fitsUnder(db: Db, taskId: number, parentId: number): Promise<boolean> {
  try {
    await assertCanPlaceUnder(db, taskId, parentId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Refuse placing `taskId` (null = a brand-new task with no sub-tasks) under
 * `parentId` when the result would break the levels.
 */
export async function assertCanPlaceUnder(
  db: Db,
  taskId: number | null,
  parentId: number,
): Promise<void> {
  if (taskId != null) {
    const t = await db.task.findUnique({ where: { id: taskId }, select: { isProject: true } });
    if (t?.isProject) {
      throw HttpError.badRequest(
        'A project is always a top-level task: unmark it as a project first',
      );
    }
  }
  const chain = await chainUp(db, parentId);
  if (chain.length === 0) return; // the parent's own check reports a missing parent
  const top = chain[chain.length - 1]!;
  const parentDepth = chain.length - 1; // the top task is depth 0
  const limit = top.isProject ? 2 : 1;
  const below = taskId != null ? await levelsBelow(db, taskId) : 0;
  if (parentDepth + 1 + below > limit) {
    throw HttpError.badRequest(top.isProject ? FOURTH_LEVEL : SUBTASK_UNDER_SUBTASK);
  }
}

/** Refuse (un)marking `taskId` as a project when the levels don't allow it. */
export async function assertCanSetProject(
  db: Db,
  taskId: number,
  isProject: boolean,
): Promise<void> {
  const t = await db.task.findUnique({
    where: { id: taskId },
    select: { parentId: true, isProject: true },
  });
  if (!t || t.isProject === isProject) return;
  if (isProject && t.parentId != null) {
    throw HttpError.badRequest('Only a top-level task can be a project: remove its parent first');
  }
  if (!isProject && (await levelsBelow(db, taskId)) > 1) {
    throw HttpError.badRequest(
      'Its tasks have sub-tasks of their own, and only a project can hold three levels',
    );
  }
}
