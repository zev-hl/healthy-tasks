import { TASK_HISTORY_FIELDS, type DeletedTaskDto, type Role } from '@healthy-tasks/shared';
import { prisma, prismaWithDeleted } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { recordHistory } from './task-history.service.js';
import { toUserRef } from './user.mapper.js';

/**
 * Soft delete and restore (Nov 2026 plan, D10).
 *
 * Deleting a task hides it and every sub-task under it (at any depth) at the
 * same moment: they all get the same `deletedAt`, which is how restore finds
 * them again. Nothing else is removed, so comments, files, history and
 * dependencies come back with the task. While deleted, the app's client
 * (db/prisma.ts) treats them as gone.
 *
 * Deleting stays Admin-only, as before; restoring is Admin-only too.
 */

interface Actor {
  id: string;
  role: Role;
}

function assertAdmin(actor: Actor, what: string): void {
  if (actor.role !== 'Admin') throw HttpError.forbidden(`Only an administrator can ${what}`);
}

/** Ids of the live sub-tree under `rootId` (root first). */
async function liveSubtreeIds(rootId: number): Promise<number[]> {
  const ids = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const kids = await prisma.task.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    frontier = kids.map((k) => k.id);
    ids.push(...frontier);
  }
  return ids;
}

/** Ids of the sub-tree under `rootId` deleted at exactly `stamp` (root first). */
async function deletedSubtreeIds(rootId: number, stamp: Date): Promise<number[]> {
  const ids = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const kids = await prismaWithDeleted.task.findMany({
      where: { parentId: { in: frontier }, deletedAt: stamp },
      select: { id: true },
    });
    frontier = kids.map((k) => k.id);
    ids.push(...frontier);
  }
  return ids;
}

export async function deleteTask(actor: Actor, id: number): Promise<void> {
  assertAdmin(actor, 'delete a task');
  const task = await prisma.task.findUnique({ where: { id }, select: { id: true } });
  if (!task) throw HttpError.notFound('Task not found');

  const ids = await liveSubtreeIds(id);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.task.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: now, deletedById: actor.id },
    });
    await recordHistory(tx, {
      taskId: id,
      userId: actor.id,
      field: TASK_HISTORY_FIELDS.deleted,
      changeType: 'added',
      detail: ids.length > 1 ? `with ${ids.length - 1} sub-task(s)` : null,
    });
  });
}

/** The Admin's Deleted tasks list: each deletion once (its top task), newest first. */
export async function listDeletedTasks(actor: Actor): Promise<DeletedTaskDto[]> {
  assertAdmin(actor, 'see deleted tasks');
  const rows = await prismaWithDeleted.task.findMany({
    where: { deletedAt: { not: null } },
    select: {
      id: true,
      name: true,
      status: true,
      isProject: true,
      parentId: true,
      deletedAt: true,
      deletedBy: {
        select: { id: true, email: true, firstName: true, lastName: true, title: true },
      },
    },
    orderBy: [{ deletedAt: 'desc' }, { id: 'asc' }],
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  // A row whose parent was deleted at the same moment went with that parent.
  const went = (r: (typeof rows)[number]): boolean => {
    const p = r.parentId != null ? byId.get(r.parentId) : undefined;
    return !!p && p.deletedAt!.getTime() === r.deletedAt!.getTime();
  };
  const tops = rows.filter((r) => !went(r));
  const counts = new Map<number, number>();
  for (const r of rows) {
    if (!went(r)) continue;
    // Walk up to the top of this deletion.
    let top = r;
    while (went(top)) top = byId.get(top.parentId!)!;
    counts.set(top.id, (counts.get(top.id) ?? 0) + 1);
  }
  return tops.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    isProject: r.isProject,
    deletedAt: r.deletedAt!.toISOString(),
    deletedBy: r.deletedBy ? toUserRef(r.deletedBy) : null,
    subtaskCount: counts.get(r.id) ?? 0,
  }));
}

/** Restore a deleted task and the sub-tasks deleted with it. */
export async function restoreTask(actor: Actor, id: number): Promise<void> {
  assertAdmin(actor, 'restore a task');
  const task = await prismaWithDeleted.task.findUnique({
    where: { id },
    select: { id: true, deletedAt: true, parent: { select: { deletedAt: true } } },
  });
  if (!task || !task.deletedAt) throw HttpError.notFound('Deleted task not found');
  if (task.parent?.deletedAt) {
    throw HttpError.badRequest('Its parent task is deleted too: restore the parent first');
  }
  const ids = await deletedSubtreeIds(id, task.deletedAt);
  await prismaWithDeleted.$transaction(async (tx) => {
    await tx.task.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: null, deletedById: null, lastActivityAt: new Date() },
    });
    await recordHistory(tx, {
      taskId: id,
      userId: actor.id,
      field: TASK_HISTORY_FIELDS.deleted,
      changeType: 'removed',
      detail: 'Restored',
    });
  });
}
