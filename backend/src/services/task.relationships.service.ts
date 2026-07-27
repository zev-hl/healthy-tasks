import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import type { DependencyType, TaskDetailDto, TaskRef } from '@healthy-tasks/shared';
import { getTaskDetail } from './task.service.js';
import { toTaskRef } from './task.mapper.js';

// NOTE (Phase 5): relationship changes below are where "History of Changes"
// hooks will be added — each add/remove is a discrete auditable event.

async function assertTaskExists(id: number, label: string): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id }, select: { id: true } });
  if (!task) throw HttpError.badRequest(`${label} #${id} does not exist`);
}

// --- Parent / Child --------------------------------------------------------

/**
 * Would setting `taskId`'s parent to `parentId` make `taskId` its own ancestor?
 * Walk up the ancestor chain from `parentId`; if we reach `taskId`, it's a cycle.
 */
async function wouldCreateAncestryCycle(taskId: number, parentId: number): Promise<boolean> {
  let cursor: number | null = parentId;
  const seen = new Set<number>();
  while (cursor !== null) {
    if (cursor === taskId) return true;
    if (seen.has(cursor)) break; // guard against any pre-existing loop
    seen.add(cursor);
    const parent: { parentId: number | null } | null = await prisma.task.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = parent?.parentId ?? null;
  }
  return false;
}

export async function setParent(taskId: number, parentId: number): Promise<TaskDetailDto> {
  await assertTaskExists(taskId, 'Task');
  if (parentId === taskId) {
    throw HttpError.badRequest('A task cannot be its own parent');
  }
  await assertTaskExists(parentId, 'Parent task');

  if (await wouldCreateAncestryCycle(taskId, parentId)) {
    throw HttpError.badRequest(
      'Cannot set that parent: it would make the task its own ancestor (circular hierarchy)',
    );
  }

  await prisma.task.update({ where: { id: taskId }, data: { parentId } });
  return getTaskDetail(taskId);
}

export async function clearParent(taskId: number): Promise<TaskDetailDto> {
  await assertTaskExists(taskId, 'Task');
  await prisma.task.update({ where: { id: taskId }, data: { parentId: null } });
  return getTaskDetail(taskId);
}

// --- Dependencies (Blocks / Is Blocked By) ---------------------------------

/** Resolve a request into a directed edge (blocker must complete before blocked). */
function resolveEdge(
  taskId: number,
  type: DependencyType,
  otherTaskId: number,
): { blockerId: number; blockedId: number } {
  return type === 'blocks'
    ? { blockerId: taskId, blockedId: otherTaskId }
    : { blockerId: otherTaskId, blockedId: taskId };
}

/**
 * Would adding edge blocker→blocked create a cycle? A cycle forms iff `blocked`
 * can already reach `blocker` via existing dependency edges. BFS the blocks
 * graph starting from `blocked`.
 */
async function wouldCreateDependencyCycle(blockerId: number, blockedId: number): Promise<boolean> {
  const stack: number[] = [blockedId];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    if (node === blockerId) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    const outgoing = await prisma.taskDependency.findMany({
      where: { blockerId: node },
      select: { blockedId: true },
    });
    for (const e of outgoing) stack.push(e.blockedId);
  }
  return false;
}

export async function addDependency(
  taskId: number,
  type: DependencyType,
  otherTaskId: number,
): Promise<TaskDetailDto> {
  await assertTaskExists(taskId, 'Task');
  await assertTaskExists(otherTaskId, 'Task');

  const { blockerId, blockedId } = resolveEdge(taskId, type, otherTaskId);
  if (blockerId === blockedId) {
    throw HttpError.badRequest('A task cannot block itself');
  }

  const existing = await prisma.taskDependency.findUnique({
    where: { blockerId_blockedId: { blockerId, blockedId } },
  });
  if (!existing) {
    if (await wouldCreateDependencyCycle(blockerId, blockedId)) {
      throw HttpError.badRequest(
        'Cannot add that dependency: it would create a circular dependency chain',
      );
    }
    await prisma.taskDependency.create({ data: { blockerId, blockedId } });
  }

  return getTaskDetail(taskId);
}

export async function removeDependency(
  taskId: number,
  type: DependencyType,
  otherTaskId: number,
): Promise<TaskDetailDto> {
  await assertTaskExists(taskId, 'Task');
  const { blockerId, blockedId } = resolveEdge(taskId, type, otherTaskId);
  await prisma.taskDependency.deleteMany({ where: { blockerId, blockedId } });
  return getTaskDetail(taskId);
}

// --- Search (for the add-relationship popup) -------------------------------

/**
 * Search tasks by partial id or name for the relationship picker. Matches a
 * numeric query against id and any query against name (case-insensitive).
 * Excludes `excludeId` (the task doing the picking).
 */
export async function searchTasks(query: string, excludeId?: number): Promise<TaskRef[]> {
  const q = query.trim();
  if (q === '') return [];

  const idMatch = /^\d+$/.test(q) ? Number(q) : undefined;

  const tasks = await prisma.task.findMany({
    where: {
      AND: [
        excludeId !== undefined ? { id: { not: excludeId } } : {},
        {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            ...(idMatch !== undefined ? [{ id: idMatch }] : []),
          ],
        },
      ],
    },
    select: { id: true, name: true, status: true },
    orderBy: { id: 'asc' },
    take: 20,
  });
  return tasks.map(toTaskRef);
}
