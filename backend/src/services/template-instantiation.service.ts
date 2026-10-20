import { randomUUID } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { sanitizeAndValidate } from '../utils/rich-text.js';
import { getStorage } from '../storage/index.js';
import { offsetFromAnchor } from '../utils/business-time.js';
import { recordHistory } from './task-history.service.js';
import { createAssignedNotification } from './notification.service.js';
import { notifyDutyMismatches } from './duty-check.service.js';
import {
  DEFAULT_DUE_HOUR,
  DEFAULT_START_HOUR,
  EXCLUSIVES_ALERT_TYPE_LABELS,
  TASK_HISTORY_FIELDS,
  type ExclusivesAlertType,
  type TaskPriority,
  type TemplateOccurrenceOrigin,
} from '@healthy-tasks/shared';

/**
 * Template instantiation (Phase 11): turn a template definition + a concrete
 * anchor date + a per-node assignee map into a REAL, fully independent task tree
 * (real parent/child links, real dependencies, real assignees/dates). Shared by
 * manual instantiation, ghost click-through materialization, and the scheduler.
 * From creation onward a generated tree behaves exactly like a hand-built one.
 */

interface NodeForGen {
  id: number;
  parentNodeId: number | null;
  name: string;
  description: string | null;
  defaultPriority: TaskPriority;
  tags: string[];
  startOffsetDays: number | null;
  dueOffsetDays: number | null;
  dutyId: string | null;
}

/** Order nodes so every parent precedes its children (the tree is acyclic). */
function orderParentsFirst<T extends { id: number; parentNodeId: number | null }>(nodes: T[]): T[] {
  const byParent = new Map<number | null, T[]>();
  for (const n of nodes) {
    const list = byParent.get(n.parentNodeId) ?? [];
    list.push(n);
    byParent.set(n.parentNodeId, list);
  }
  const out: T[] = [];
  const walk = (parentId: number | null): void => {
    for (const n of byParent.get(parentId) ?? []) {
      out.push(n);
      walk(n.id);
    }
  };
  walk(null); // roots
  // Any nodes not reachable from a root (shouldn't happen) are appended so none
  // are silently dropped.
  if (out.length !== nodes.length) {
    const placed = new Set(out.map((n) => n.id));
    for (const n of nodes) if (!placed.has(n.id)) out.push(n);
  }
  return out;
}

export interface GenerateOccurrenceParams {
  templateId: number;
  /** 1-based schedule index for a scheduled fire; null for a manual instantiation. */
  seq: number | null;
  origin: TemplateOccurrenceOrigin;
  instanceLabel: string | null;
  anchorStart: Date;
  /** Resolved real assignee per template node id (missing/null ⇒ unassigned). */
  assigneeByNodeId: Map<number, string | null>;
  /** Creator stamped on every generated task. */
  creatorId: string;
  /** Actor that assignment notifications are attributed to. */
  actorId: string;
  /**
   * HLAI-112: tasks made from an Exclusives alert (origin `alert`) carry its
   * group and type as their HLAI-118 attributes, on every task of the tree. Other
   * origins leave them unset, to be picked on the task page.
   */
  alertGroupId?: number | null;
  alertType?: ExclusivesAlertType | null;
  /**
   * Rich text added after the top task's own description (HLAI-112: the Daily
   * task's list of alerts). Sanitized and size-checked with it.
   */
  rootDescriptionExtra?: string | null;
  /**
   * HLAI-112: the alerts these tasks are made for. Linked to the top task and
   * marked handled in the same transaction; if any already was, nothing is made
   * (409), so an alert never makes two tasks.
   */
  alertLogIds?: number[];
}

export interface GeneratedOccurrence {
  occurrenceId: number;
  rootTaskId: number;
  taskIds: number[];
}

/**
 * Generate one occurrence's task tree in a single transaction (tasks + parent
 * links + dependency edges + a provenance history entry), then fire assignment
 * notifications post-commit. Returns the new occurrence + generated task ids.
 */
export async function generateOccurrence(params: GenerateOccurrenceParams): Promise<GeneratedOccurrence> {
  const { templateId, seq, origin, instanceLabel, anchorStart, assigneeByNodeId, creatorId, actorId } =
    params;
  const alertGroupId = params.alertGroupId ?? null;
  const alertType = params.alertType ?? null;

  const prefixName = (name: string): string => (instanceLabel ? `${instanceLabel}: ${name}` : name);
  const cleanDesc = (d: string | null): string | null =>
    d ? sanitizeAndValidate(d, { fieldLabel: 'Description' }) : null;
  // The top task's description, then any extra (the template's text comes first).
  const rootDesc = (d: string | null): string | null =>
    cleanDesc([d, params.rootDescriptionExtra].filter(Boolean).join('') || null);

  const result = await prisma.$transaction(async (tx) => {
    const template = await tx.taskTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, name: true, createdById: true },
    });
    if (!template) throw HttpError.notFound('Template not found');

    const nodes = await tx.taskTemplateNode.findMany({ where: { templateId } });
    if (nodes.length === 0) throw HttpError.badRequest('Template has no nodes to instantiate');
    const deps = await tx.taskTemplateDependency.findMany({
      where: { blockerNode: { templateId } },
      select: { blockerNodeId: true, blockedNodeId: true },
    });

    const group =
      alertGroupId === null
        ? null
        : await tx.alertGroup.findUnique({ where: { id: alertGroupId }, select: { name: true } });
    if (alertGroupId !== null && !group) throw HttpError.badRequest('Alert group not found');

    const occurrence = await tx.templateOccurrence.create({
      data: { templateId, seq, origin, instanceLabel, anchorStart },
    });

    const ordered = orderParentsFirst(nodes as NodeForGen[]);
    const nodeIdToTaskId = new Map<number, number>();
    const created: { taskId: number; assigneeId: string | null; nodeId: number }[] = [];
    let rootTaskId: number | null = null;

    for (const node of ordered) {
      const parentTaskId = node.parentNodeId ? (nodeIdToTaskId.get(node.parentNodeId) ?? null) : null;
      const assigneeId = assigneeByNodeId.get(node.id) ?? null;
      // Business-zone calendar days, then the default hour — so offsets 0 and 1
      // land on consecutive days at 7:00 AM / 7:00 PM, not at midnight UTC
      // (which reads as the previous evening anywhere west of UTC).
      const startAt =
        node.startOffsetDays != null
          ? offsetFromAnchor(anchorStart, node.startOffsetDays, DEFAULT_START_HOUR)
          : null;
      const dueAt =
        node.dueOffsetDays != null
          ? offsetFromAnchor(anchorStart, node.dueOffsetDays, DEFAULT_DUE_HOUR)
          : null;

      const isRoot = node.parentNodeId === null && rootTaskId === null;
      const description = isRoot ? rootDesc(node.description) : cleanDesc(node.description);
      // Typed here: `rootTaskId` (read above) is set from it below, in this loop.
      const task: { id: number } = await tx.task.create({
        data: {
          name: prefixName(node.name),
          description,
          creatorId,
          assigneeId,
          priority: node.defaultPriority,
          tags: node.tags,
          startAt,
          dueAt,
          parentId: parentTaskId,
          instanceLabel,
          templateId,
          templateNodeId: node.id,
          templateOccurrenceId: occurrence.id,
          dutyId: node.dutyId,
          alertGroupId,
          alertType,
        },
        select: { id: true },
      });
      nodeIdToTaskId.set(node.id, task.id);
      created.push({ taskId: task.id, assigneeId, nodeId: node.id });
      if (isRoot) rootTaskId = task.id;
    }

    if (rootTaskId === null) throw HttpError.badRequest('Template has no root node');

    // Carry the template's between-node dependencies into real task edges.
    for (const d of deps) {
      const blockerId = nodeIdToTaskId.get(d.blockerNodeId);
      const blockedId = nodeIdToTaskId.get(d.blockedNodeId);
      if (blockerId && blockedId && blockerId !== blockedId) {
        await tx.taskDependency.create({ data: { blockerId, blockedId } });
      }
    }

    await tx.templateOccurrence.update({ where: { id: occurrence.id }, data: { rootTaskId } });

    const alertLogIds = params.alertLogIds ?? [];
    if (alertLogIds.length > 0) {
      const { count } = await tx.alertLog.updateMany({
        where: { id: { in: alertLogIds }, taskHandledAt: null },
        data: { taskId: rootTaskId, taskHandledAt: new Date() },
      });
      if (count !== alertLogIds.length) {
        throw new HttpError(409, 'These alerts already have their task.');
      }
    }

    // Provenance entry on the root task (History treats the past as immutable, so
    // this records only that the task was generated from a template).
    const labelPart = instanceLabel ? ` (${instanceLabel})` : seq != null ? ` (#${seq})` : '';
    await recordHistory(tx, {
      taskId: rootTaskId,
      userId: actorId,
      field: TASK_HISTORY_FIELDS.template,
      changeType: 'added',
      detail: `${template.name}${labelPart}`,
    });

    // HLAI-112: every task made from an alert says so, so nobody takes it for one
    // its creator made by hand.
    if (origin === 'alert') {
      const what = alertType ? `a ${EXCLUSIVES_ALERT_TYPE_LABELS[alertType]} alert` : 'an alert';
      await recordHistory(
        tx,
        created.map((c) => ({
          taskId: c.taskId,
          userId: actorId,
          field: TASK_HISTORY_FIELDS.alert,
          changeType: 'added' as const,
          detail: group ? `${what} (${group.name})` : what,
        })),
      );
    }

    return { occurrenceId: occurrence.id, rootTaskId, created, ownerId: template.createdById };
  });

  // Copy each node's default attachments onto its generated task (independent
  // blobs). Done post-commit since it performs external (S3) copies; best-effort.
  await copyTemplateAttachmentsToTasks(
    result.created.map((c) => ({ taskId: c.taskId, nodeId: c.nodeId })),
    actorId,
  );

  // Assignment notifications post-commit (self-assignments are skipped inside).
  for (const c of result.created) {
    if (c.assigneeId) {
      await createAssignedNotification({
        recipientId: c.assigneeId,
        actorId,
        taskId: c.taskId,
        action: 'added',
      });
    }
  }

  // Department Duties: a manual instantiation was already checked (422 on any
  // missing duty), so a mismatch here means automatic creation — a scheduled
  // fire or a ghost click-through carrying assignees forward — where nobody can
  // answer a prompt. The task is created anyway (flagged ⚠) and the template
  // owner is told.
  await notifyDutyMismatches(
    result.created.map((c) => c.taskId),
    result.ownerId,
  );

  return {
    occurrenceId: result.occurrenceId,
    rootTaskId: result.rootTaskId,
    taskIds: result.created.map((c) => c.taskId),
  };
}

/** URL/storage-safe attachment filename (mirrors attachment.service `safeName`). */
function safeAttachmentName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';
}

/**
 * Copy every template node's default attachments onto the real task generated
 * from that node, as fresh independent task-level blobs. Best-effort per file
 * (a blob that can't be copied is skipped, never failing the instantiation).
 */
async function copyTemplateAttachmentsToTasks(
  pairs: { taskId: number; nodeId: number }[],
  actorId: string,
): Promise<void> {
  const nodeIds = pairs.map((p) => p.nodeId);
  const defaults = await prisma.taskTemplateNodeAttachment.findMany({
    where: { templateNodeId: { in: nodeIds } },
  });
  if (defaults.length === 0) return;
  const taskByNode = new Map(pairs.map((p) => [p.nodeId, p.taskId]));
  const storage = getStorage();
  for (const a of defaults) {
    const taskId = taskByNode.get(a.templateNodeId);
    if (taskId == null) continue;
    const destKey = `tasks/${taskId}/${randomUUID()}/${safeAttachmentName(a.filename)}`;
    try {
      await storage.copyObject(a.storageKey, destKey);
    } catch {
      continue; // best-effort
    }
    await prisma.attachment.create({
      data: {
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
        storageKey: destKey,
        uploadedById: actorId,
        taskId,
      },
    });
  }
}

/**
 * Build the per-node assignee map for a SCHEDULED occurrence by carrying forward
 * the assignees from the template's most recent prior occurrence (manual or
 * scheduled, never one made from alerts): for each node, reuse whoever was assigned to the task generated from
 * that same node last time. Returns an empty map when there is no prior
 * occurrence (the first scheduled fire is unassigned unless manually seeded).
 */
export async function carryForwardAssignees(templateId: number): Promise<Map<number, string | null>> {
  const prior = await prisma.templateOccurrence.findFirst({
    // Tasks made from alerts have their own people (the Alert Task Setup), so a
    // schedule never takes its people from them.
    where: { templateId, origin: { not: 'alert' } },
    orderBy: [{ materializedAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  const map = new Map<number, string | null>();
  if (!prior) return map;
  const tasks = await prisma.task.findMany({
    where: { templateOccurrenceId: prior.id, templateNodeId: { not: null } },
    select: { templateNodeId: true, assigneeId: true },
  });
  for (const t of tasks) {
    if (t.templateNodeId != null) map.set(t.templateNodeId, t.assigneeId);
  }
  return map;
}
