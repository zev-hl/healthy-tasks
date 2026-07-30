import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import {
  DEFAULT_TEMPLATE_LEAD_DAYS,
  TERMINAL_TASK_STATUSES,
  type ApplyToFutureResultDto,
  type FutureOccurrenceDto,
  type GhostOccurrenceDto,
  type InstantiateResultDto,
  type Role,
  type TemplateDto,
  type TemplateSummaryDto,
} from '@healthy-tasks/shared';
import type {
  CreateTemplateInput,
  InstantiateTemplateInput,
  RecurrenceInputParsed,
  TemplateNodeInputParsed,
  UpdateTemplateInput,
} from '../validation/schemas.js';
import {
  templateInclude,
  templateSummaryInclude,
  toTemplateDto,
  toTemplateOccurrenceDto,
  toTemplateSummaryDto,
} from './template.mapper.js';
import { addDays, fixedAnchorForSeq, isWithinLeadTime, seqAllowed, upcomingFixedSeqs, type RecurrenceConfig } from './recurrence.js';
import { carryForwardAssignees, generateOccurrence } from './template-instantiation.service.js';
import {
  buildTaskFieldEntries,
  recordHistory,
  type TaskFieldValues,
} from './task-history.service.js';

type Actor = { id: string; role: Role };
type DependencyInput = { blockerKey: string; blockedKey: string };

/** Template management is restricted to Admin/Manager (route-gated + re-checked). */
function assertTemplateManager(actor: Actor): void {
  if (actor.role !== 'Admin' && actor.role !== 'Manager') {
    throw HttpError.forbidden('Only an admin or manager can manage task templates');
  }
}

function toRecurrenceConfig(t: {
  recurrenceType: RecurrenceConfig['recurrenceType'];
  intervalCount: number | null;
  intervalUnit: RecurrenceConfig['intervalUnit'];
  anchorDate: Date | null;
  endType: RecurrenceConfig['endType'];
  endDate: Date | null;
  maxOccurrences: number | null;
  leadTimeDays: number;
}): RecurrenceConfig {
  return {
    recurrenceType: t.recurrenceType,
    intervalCount: t.intervalCount,
    intervalUnit: t.intervalUnit,
    anchorDate: t.anchorDate,
    endType: t.endType,
    endDate: t.endDate,
    maxOccurrences: t.maxOccurrences,
    leadTimeDays: t.leadTimeDays,
  };
}

// --- Tree payload validation ----------------------------------------------

/**
 * Validate the node/dependency payload and return the nodes in parent-first
 * order. Enforces: unique keys, exactly one root, every parent/dependency
 * reference resolvable, no hierarchy cycle, no self/duplicate dependency, and no
 * dependency cycle. Throws HttpError.badRequest on any violation.
 */
function validateAndOrderTree(
  nodes: TemplateNodeInputParsed[],
  dependencies: DependencyInput[],
): TemplateNodeInputParsed[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  if (byKey.size !== nodes.length) throw HttpError.badRequest('Duplicate template node keys');

  const roots = nodes.filter((n) => n.parentKey === null);
  if (roots.length !== 1) {
    throw HttpError.badRequest('A template must have exactly one root node');
  }
  for (const n of nodes) {
    if (n.parentKey !== null && !byKey.has(n.parentKey)) {
      throw HttpError.badRequest(`Node "${n.name}" references a parent that is not in the template`);
    }
  }

  // Parent-first order; a short result means a cycle or unreachable node.
  const childrenOf = new Map<string | null, TemplateNodeInputParsed[]>();
  for (const n of nodes) {
    const list = childrenOf.get(n.parentKey) ?? [];
    list.push(n);
    childrenOf.set(n.parentKey, list);
  }
  const ordered: TemplateNodeInputParsed[] = [];
  const walk = (parentKey: string | null): void => {
    for (const child of childrenOf.get(parentKey) ?? []) {
      ordered.push(child);
      walk(child.key);
    }
  };
  walk(null);
  if (ordered.length !== nodes.length) {
    throw HttpError.badRequest('Template hierarchy has a cycle or an unreachable node');
  }

  // Dependencies.
  const seen = new Set<string>();
  const adj = new Map<string, string[]>();
  for (const d of dependencies) {
    if (!byKey.has(d.blockerKey) || !byKey.has(d.blockedKey)) {
      throw HttpError.badRequest('A dependency references a node that is not in the template');
    }
    if (d.blockerKey === d.blockedKey) throw HttpError.badRequest('A node cannot block itself');
    const edgeKey = `${d.blockerKey}->${d.blockedKey}`;
    if (seen.has(edgeKey)) continue;
    seen.add(edgeKey);
    const list = adj.get(d.blockerKey) ?? [];
    list.push(d.blockedKey);
    adj.set(d.blockerKey, list);
  }
  // Cycle detection over the blocks graph (DFS with color marks).
  const color = new Map<string, number>(); // 0=unvisited,1=in-stack,2=done
  const hasCycle = (node: string): boolean => {
    color.set(node, 1);
    for (const next of adj.get(node) ?? []) {
      const c = color.get(next) ?? 0;
      if (c === 1) return true;
      if (c === 0 && hasCycle(next)) return true;
    }
    color.set(node, 2);
    return false;
  };
  for (const key of adj.keys()) {
    if ((color.get(key) ?? 0) === 0 && hasCycle(key)) {
      throw HttpError.badRequest('Template dependencies form a cycle');
    }
  }

  return ordered;
}

// --- Recurrence normalization ---------------------------------------------

function recurrenceData(r: RecurrenceInputParsed | undefined) {
  if (!r || r.recurrenceType === 'None') {
    return {
      recurrenceType: 'None' as const,
      intervalCount: null,
      intervalUnit: null,
      anchorDate: null,
      endType: 'Never' as const,
      endDate: null,
      maxOccurrences: null,
      leadTimeDays: r?.leadTimeDays ?? DEFAULT_TEMPLATE_LEAD_DAYS,
      labelPrefix: r?.labelPrefix ?? null,
      isActive: r?.isActive ?? true,
    };
  }
  if (!r.anchorDate) {
    throw HttpError.badRequest('A start (anchor) date is required for a recurring template');
  }
  const endType = r.endType ?? 'Never';
  return {
    recurrenceType: r.recurrenceType,
    intervalCount: r.intervalCount ?? null,
    intervalUnit: r.intervalUnit ?? null,
    anchorDate: r.anchorDate,
    endType,
    endDate: endType === 'OnDate' ? (r.endDate ?? null) : null,
    maxOccurrences: endType === 'AfterOccurrences' ? (r.maxOccurrences ?? null) : null,
    leadTimeDays: r.leadTimeDays ?? DEFAULT_TEMPLATE_LEAD_DAYS,
    labelPrefix: r.labelPrefix ?? null,
    isActive: r.isActive ?? true,
  };
}

// --- Tree reconciliation (create + update share this) ----------------------

/**
 * Reconcile a template's node tree + dependencies against the payload, IN PLACE:
 * update nodes carrying an id, create new ones, delete those no longer present,
 * then rebuild the dependency edges. Preserving node ids keeps the provenance
 * link on already-generated tasks (`templateNodeId`) intact for assignee
 * carry-forward and "this and following" edits.
 */
async function reconcileTree(
  tx: Prisma.TransactionClient,
  templateId: number,
  nodesInput: TemplateNodeInputParsed[],
  dependencies: DependencyInput[],
): Promise<void> {
  const ordered = validateAndOrderTree(nodesInput, dependencies);

  const existing = await tx.taskTemplateNode.findMany({
    where: { templateId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((n) => n.id));
  const payloadIds = new Set(nodesInput.filter((n) => n.id != null).map((n) => n.id as number));
  for (const id of payloadIds) {
    if (!existingIds.has(id)) throw HttpError.badRequest(`Node ${id} does not belong to this template`);
  }

  const keyToId = new Map<string, number>();
  for (const n of nodesInput) if (n.id != null) keyToId.set(n.key, n.id);

  // Upsert in parent-first order so a new parent's id exists before its child.
  for (const n of ordered) {
    const parentNodeId = n.parentKey ? (keyToId.get(n.parentKey) ?? null) : null;
    const data = {
      name: n.name,
      description: n.description ?? null,
      defaultPriority: n.defaultPriority ?? 'Medium',
      startOffsetDays: n.startOffsetDays ?? null,
      dueOffsetDays: n.dueOffsetDays ?? null,
      assigneeRole: n.assigneeRole ?? null,
      orderIndex: n.orderIndex ?? 0,
      parentNodeId,
    };
    if (n.id != null) {
      await tx.taskTemplateNode.update({ where: { id: n.id }, data });
    } else {
      const created = await tx.taskTemplateNode.create({ data: { templateId, ...data } });
      keyToId.set(n.key, created.id);
    }
  }

  // Delete nodes that are no longer present (cascades their child nodes + deps;
  // SetNulls templateNodeId on any already-generated tasks).
  const removed = [...existingIds].filter((id) => !payloadIds.has(id));
  if (removed.length > 0) {
    await tx.taskTemplateNode.deleteMany({ where: { id: { in: removed } } });
  }

  // Rebuild dependency edges from the (now fully-resolved) key→id map.
  await tx.taskTemplateDependency.deleteMany({ where: { blockerNode: { templateId } } });
  const edges = dependencies
    .map((d) => ({ blockerNodeId: keyToId.get(d.blockerKey), blockedNodeId: keyToId.get(d.blockedKey) }))
    .filter((e): e is { blockerNodeId: number; blockedNodeId: number } =>
      e.blockerNodeId != null && e.blockedNodeId != null && e.blockerNodeId !== e.blockedNodeId,
    );
  // Dedup (validation already rejects true dupes, but guard the unique index).
  const uniq = new Map(edges.map((e) => [`${e.blockerNodeId}->${e.blockedNodeId}`, e]));
  if (uniq.size > 0) {
    await tx.taskTemplateDependency.createMany({ data: [...uniq.values()] });
  }
}

// --- CRUD ------------------------------------------------------------------

export async function listTemplates(): Promise<TemplateSummaryDto[]> {
  const rows = await prisma.taskTemplate.findMany({
    include: templateSummaryInclude,
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map(toTemplateSummaryDto);
}

export async function getTemplate(id: number): Promise<TemplateDto> {
  const t = await prisma.taskTemplate.findUnique({ where: { id }, include: templateInclude });
  if (!t) throw HttpError.notFound('Template not found');
  return toTemplateDto(t);
}

export async function createTemplate(actor: Actor, input: CreateTemplateInput): Promise<TemplateDto> {
  assertTemplateManager(actor);
  validateAndOrderTree(input.nodes, input.dependencies ?? []);
  const rec = recurrenceData(input.recurrence);

  const id = await prisma.$transaction(async (tx) => {
    const template = await tx.taskTemplate.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        createdById: actor.id,
        ...rec,
      },
      select: { id: true },
    });
    await reconcileTree(tx, template.id, input.nodes, input.dependencies ?? []);
    return template.id;
  });
  return getTemplate(id);
}

export async function updateTemplate(
  actor: Actor,
  id: number,
  input: UpdateTemplateInput,
): Promise<TemplateDto> {
  assertTemplateManager(actor);
  const existing = await prisma.taskTemplate.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw HttpError.notFound('Template not found');

  if (input.nodes) validateAndOrderTree(input.nodes, input.dependencies ?? []);
  const rec = input.recurrence !== undefined ? recurrenceData(input.recurrence) : undefined;

  await prisma.$transaction(async (tx) => {
    await tx.taskTemplate.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(rec ?? {}),
      },
    });
    // `dependencies` only takes effect alongside a `nodes` replacement (they are
    // keyed by node keys, which only the nodes payload defines).
    if (input.nodes) {
      await reconcileTree(tx, id, input.nodes, input.dependencies ?? []);
    }
  });
  return getTemplate(id);
}

export async function deleteTemplate(actor: Actor, id: number): Promise<void> {
  assertTemplateManager(actor);
  const existing = await prisma.taskTemplate.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw HttpError.notFound('Template not found');
  // Cascades nodes/deps/occurrences; already-generated real tasks survive (their
  // template* provenance fields SetNull), consistent with History immutability.
  await prisma.taskTemplate.delete({ where: { id } });
}

// --- Manual instantiation --------------------------------------------------

async function loadTemplateForGeneration(id: number) {
  const t = await prisma.taskTemplate.findUnique({
    where: { id },
    include: { nodes: true },
  });
  if (!t) throw HttpError.notFound('Template not found');
  return t;
}

async function assertAssigneeActive(assigneeId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: assigneeId }, select: { isActive: true } });
  if (!user) throw HttpError.badRequest('Selected assignee does not exist');
  if (!user.isActive) throw HttpError.badRequest('Selected assignee is inactive');
}

/**
 * Manually instantiate a template into a real, independent task tree. Resolves
 * the relative offsets against `anchorStart`, maps each role placeholder to the
 * chosen real user, and prefixes the instance label onto every task name.
 */
export async function instantiateTemplate(
  actor: Actor,
  id: number,
  input: InstantiateTemplateInput,
): Promise<InstantiateResultDto> {
  assertTemplateManager(actor);
  const template = await loadTemplateForGeneration(id);

  const roleMap = new Map<string, string | null>();
  for (const ra of input.roleAssignments ?? []) roleMap.set(ra.role, ra.assigneeId ?? null);
  // Validate every mapped assignee is a real, active user.
  for (const assigneeId of new Set([...roleMap.values()].filter((v): v is string => !!v))) {
    await assertAssigneeActive(assigneeId);
  }

  const assigneeByNodeId = new Map<number, string | null>();
  for (const node of template.nodes) {
    assigneeByNodeId.set(node.id, node.assigneeRole ? (roleMap.get(node.assigneeRole) ?? null) : null);
  }

  const gen = await generateOccurrence({
    templateId: id,
    seq: null,
    origin: 'manual',
    instanceLabel: input.instanceLabel ?? null,
    anchorStart: input.anchorStart,
    assigneeByNodeId,
    creatorId: actor.id,
    actorId: actor.id,
  });

  return loadInstantiateResult(gen);
}

async function loadInstantiateResult(gen: {
  occurrenceId: number;
  rootTaskId: number;
  taskIds: number[];
}): Promise<InstantiateResultDto> {
  const occ = await prisma.templateOccurrence.findUnique({ where: { id: gen.occurrenceId } });
  if (!occ) throw HttpError.notFound('Occurrence not found');
  return { occurrence: toTemplateOccurrenceDto(occ), rootTaskId: gen.rootTaskId, taskIds: gen.taskIds };
}

/**
 * Materialize a specific FIXED-schedule ghost (seq) into real tasks — the
 * click-through path. Assignees carry forward from the prior occurrence, exactly
 * like a scheduled fire.
 */
export async function materializeGhost(actor: Actor, id: number, seq: number): Promise<InstantiateResultDto> {
  assertTemplateManager(actor);
  const template = await prisma.taskTemplate.findUnique({ where: { id } });
  if (!template) throw HttpError.notFound('Template not found');
  if (template.recurrenceType !== 'Fixed') {
    throw HttpError.badRequest('Only fixed-schedule templates have materializable ghosts');
  }
  const cfg = toRecurrenceConfig(template);
  const anchor = fixedAnchorForSeq(cfg, seq);
  if (!seqAllowed(cfg, seq, anchor)) {
    throw HttpError.badRequest('That occurrence is beyond the recurrence limit');
  }
  const already = await prisma.templateOccurrence.findFirst({ where: { templateId: id, seq } });
  if (already) throw HttpError.conflict('That occurrence has already been materialized');

  const assigneeByNodeId = await carryForwardAssignees(id);
  const label = template.labelPrefix ? `${template.labelPrefix}-${seq}` : null;
  const gen = await generateOccurrence({
    templateId: id,
    seq,
    origin: 'scheduled',
    instanceLabel: label,
    anchorStart: anchor,
    assigneeByNodeId,
    creatorId: actor.id,
    actorId: actor.id,
  });
  return loadInstantiateResult(gen);
}

// --- Ghost previews --------------------------------------------------------

/**
 * Computed future occurrences ("ghosts") for a Fixed schedule — never DB rows.
 * Empty for manual-only / paused / relative-to-completion templates (the latter
 * has no computable future date until the prior instance completes).
 */
export async function getTemplateGhosts(id: number, now: Date): Promise<GhostOccurrenceDto[]> {
  const template = await prisma.taskTemplate.findUnique({ where: { id }, include: { nodes: true } });
  if (!template) throw HttpError.notFound('Template not found');
  if (template.recurrenceType !== 'Fixed' || !template.isActive) return [];

  const cfg = toRecurrenceConfig(template);
  const fired = await prisma.templateOccurrence.findMany({
    where: { templateId: id, seq: { not: null } },
    select: { seq: true },
  });
  const firedSeqs = new Set(fired.map((o) => o.seq as number));
  const root = template.nodes.find((n) => n.parentNodeId === null);
  if (!root) return [];
  // An occurrence's earliest date is its anchor plus the tree's smallest offset;
  // that is what the lead-time (ghost) window is measured against.
  const earliestOffset = treeEarliestOffset(template.nodes);

  return upcomingFixedSeqs(cfg, firedSeqs).map(({ seq, anchor }) => {
    const label = template.labelPrefix ? `${template.labelPrefix}-${seq}` : null;
    const rootName = label ? `${label}: ${root.name}` : root.name;
    return {
      sourceType: 'template' as const,
      sourceId: id,
      sourceName: template.name,
      seq,
      name: rootName,
      startAt: root.startOffsetDays != null ? addDays(anchor, root.startOffsetDays).toISOString() : null,
      dueAt: root.dueOffsetDays != null ? addDays(anchor, root.dueOffsetDays).toISOString() : null,
      priority: root.defaultPriority,
      withinLeadTime: isWithinLeadTime(anchor, cfg.leadTimeDays, now, earliestOffset),
    };
  });
}

/** The smallest start/due offset anywhere in a template tree (0 if none carry a
 * date). Defines an occurrence's earliest date relative to its anchor. */
export function treeEarliestOffset(
  nodes: { startOffsetDays: number | null; dueOffsetDays: number | null }[],
): number {
  let min = Infinity;
  for (const n of nodes) {
    if (n.startOffsetDays != null) min = Math.min(min, n.startOffsetDays);
    if (n.dueOffsetDays != null) min = Math.min(min, n.dueOffsetDays);
  }
  return Number.isFinite(min) ? min : 0;
}

/** Ghosts across ALL active fixed-schedule templates (for the Gantt/Calendar). */
export async function getAllGhosts(now: Date): Promise<GhostOccurrenceDto[]> {
  const templates = await prisma.taskTemplate.findMany({
    where: { recurrenceType: 'Fixed', isActive: true },
    select: { id: true },
  });
  const all = await Promise.all(templates.map((t) => getTemplateGhosts(t.id, now)));
  return all.flat();
}

// --- "This and following" edits -------------------------------------------

/**
 * Already-materialized occurrences whose root task has NOT reached a terminal
 * status — i.e. work that hasn't happened yet and could be re-synced to the
 * template after a "this and following" edit. Past/completed instances are
 * excluded (never rewritten).
 */
export async function listFutureOccurrences(id: number): Promise<FutureOccurrenceDto[]> {
  const occ = await prisma.templateOccurrence.findMany({
    where: { templateId: id },
    include: {
      rootTask: { select: { id: true, name: true, status: true } },
      _count: { select: { tasks: true } },
    },
    orderBy: [{ anchorStart: 'asc' }, { id: 'asc' }],
  });
  return occ
    .filter((o) => o.rootTask && !TERMINAL_TASK_STATUSES.includes(o.rootTask.status))
    .map((o) => ({
      occurrenceId: o.id,
      seq: o.seq,
      instanceLabel: o.instanceLabel,
      anchorStart: o.anchorStart.toISOString(),
      rootTaskId: o.rootTaskId,
      rootName: o.rootTask?.name ?? null,
      rootStatus: o.rootTask?.status ?? null,
      taskCount: o._count.tasks,
    }));
}

/**
 * Re-sync the given already-materialized occurrences' tasks to the CURRENT
 * template definition (name/label prefix, description, priority, and dates
 * recomputed from each occurrence's own anchor). Never touches assignee, status,
 * tags, structure, or any task in a terminal state — so in-progress work is
 * preserved and completed work is never rewritten. Each field change is audited.
 */
export async function applyTemplateToOccurrences(
  actor: Actor,
  id: number,
  occurrenceIds: number[],
): Promise<ApplyToFutureResultDto> {
  assertTemplateManager(actor);
  const template = await prisma.taskTemplate.findUnique({ where: { id }, include: { nodes: true } });
  if (!template) throw HttpError.notFound('Template not found');
  const nodeById = new Map(template.nodes.map((n) => [n.id, n]));

  const occurrences = await prisma.templateOccurrence.findMany({
    where: { id: { in: occurrenceIds }, templateId: id },
    include: {
      tasks: {
        select: {
          id: true,
          name: true,
          description: true,
          priority: true,
          status: true,
          assigneeId: true,
          tags: true,
          startAt: true,
          dueAt: true,
          templateNodeId: true,
        },
      },
    },
  });

  let updatedOccurrences = 0;
  let updatedTasks = 0;

  await prisma.$transaction(async (tx) => {
    for (const occ of occurrences) {
      let touchedThisOccurrence = false;
      for (const task of occ.tasks) {
        if (task.templateNodeId == null) continue;
        const node = nodeById.get(task.templateNodeId);
        if (!node) continue;
        if (TERMINAL_TASK_STATUSES.includes(task.status)) continue; // never rewrite done work

        const newName = occ.instanceLabel ? `${occ.instanceLabel}: ${node.name}` : node.name;
        const newDescription = node.description ?? null;
        const newStart = node.startOffsetDays != null ? addDays(occ.anchorStart, node.startOffsetDays) : null;
        const newDue = node.dueOffsetDays != null ? addDays(occ.anchorStart, node.dueOffsetDays) : null;

        const descriptionChanged = newDescription !== task.description;
        const changed =
          newName !== task.name ||
          descriptionChanged ||
          node.defaultPriority !== task.priority ||
          (newStart?.getTime() ?? null) !== (task.startAt?.getTime() ?? null) ||
          (newDue?.getTime() ?? null) !== (task.dueAt?.getTime() ?? null);
        if (!changed) continue;

        await tx.task.update({
          where: { id: task.id },
          data: {
            name: newName,
            description: newDescription,
            priority: node.defaultPriority,
            startAt: newStart,
            dueAt: newDue,
          },
        });

        // Audit: diff only the fields this sync can change (assignee/status/tags
        // are held equal so they never produce a spurious entry).
        const before: TaskFieldValues = {
          name: task.name,
          assignee: task.assigneeId,
          priority: task.priority,
          status: task.status,
          tags: task.tags,
          startAt: task.startAt,
          dueAt: task.dueAt,
        };
        const after: TaskFieldValues = {
          name: newName,
          assignee: task.assigneeId,
          priority: node.defaultPriority,
          status: task.status,
          tags: task.tags,
          startAt: newStart,
          dueAt: newDue,
        };
        await recordHistory(
          tx,
          buildTaskFieldEntries({ actorId: actor.id, taskId: task.id, before, after, descriptionChanged }),
        );
        updatedTasks += 1;
        touchedThisOccurrence = true;
      }
      if (touchedThisOccurrence) updatedOccurrences += 1;
    }
  });

  return { updatedOccurrences, updatedTasks };
}
