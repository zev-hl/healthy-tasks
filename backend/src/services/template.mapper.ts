import { Prisma } from '@prisma/client';
import type {
  TemplateDependencyDto,
  TemplateDto,
  TemplateNodeDto,
  TemplateOccurrenceDto,
  TemplateSummaryDto,
} from '@healthy-tasks/shared';
import { toUserRef } from './user.mapper.js';

const userRefSelect = {
  select: { id: true, email: true, firstName: true, lastName: true, title: true },
} as const;

/** Full include used everywhere a TemplateDto is returned. Dependencies are
 * loaded as each node's outgoing (`blocking`) edges, so every edge appears once.
 * Nodes are sorted for stable output in the mapper (a multi-key `orderBy` array
 * can't live inside an `as const` include without becoming readonly). */
export const templateInclude = {
  createdBy: userRefSelect,
  nodes: { include: { blocking: true, _count: { select: { attachments: true } } } },
  occurrences: { orderBy: { id: 'asc' } },
} as const;

export type TemplateWithGraph = Prisma.TaskTemplateGetPayload<{ include: typeof templateInclude }>;

/** Lighter include for the management list. */
export const templateSummaryInclude = {
  createdBy: userRefSelect,
  _count: { select: { nodes: true, occurrences: true } },
} as const;

export type TemplateSummaryRow = Prisma.TaskTemplateGetPayload<{
  include: typeof templateSummaryInclude;
}>;

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function toNodeDto(n: TemplateWithGraph['nodes'][number]): TemplateNodeDto {
  return {
    id: n.id,
    parentNodeId: n.parentNodeId,
    name: n.name,
    description: n.description,
    defaultPriority: n.defaultPriority,
    startOffsetDays: n.startOffsetDays,
    dueOffsetDays: n.dueOffsetDays,
    assigneeRole: n.assigneeRole,
    tags: n.tags,
    orderIndex: n.orderIndex,
    attachmentCount: n._count.attachments,
  };
}

function toDependencyDto(d: { id: number; blockerNodeId: number; blockedNodeId: number }): TemplateDependencyDto {
  return { id: d.id, blockerNodeId: d.blockerNodeId, blockedNodeId: d.blockedNodeId };
}

export function toTemplateOccurrenceDto(o: {
  id: number;
  seq: number | null;
  origin: 'manual' | 'scheduled';
  instanceLabel: string | null;
  anchorStart: Date;
  rootTaskId: number | null;
  materializedAt: Date;
}): TemplateOccurrenceDto {
  return {
    id: o.id,
    seq: o.seq,
    origin: o.origin,
    instanceLabel: o.instanceLabel,
    anchorStart: o.anchorStart.toISOString(),
    rootTaskId: o.rootTaskId,
    materializedAt: o.materializedAt.toISOString(),
  };
}

export function toTemplateDto(t: TemplateWithGraph): TemplateDto {
  // Stable node order (parent bucket → orderIndex → id) for deterministic output.
  const sortedNodes = [...t.nodes].sort(
    (a, b) =>
      (a.parentNodeId ?? -1) - (b.parentNodeId ?? -1) ||
      a.orderIndex - b.orderIndex ||
      a.id - b.id,
  );
  const dependencies = sortedNodes.flatMap((n) => n.blocking.map(toDependencyDto));
  const roles = [...new Set(sortedNodes.map((n) => n.assigneeRole).filter((r): r is string => !!r))];
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    createdBy: toUserRef(t.createdBy),
    recurrenceType: t.recurrenceType,
    intervalCount: t.intervalCount,
    intervalUnit: t.intervalUnit,
    weekdays: t.weekdays,
    anchorDate: iso(t.anchorDate),
    endType: t.endType,
    endDate: iso(t.endDate),
    maxOccurrences: t.maxOccurrences,
    labelPrefix: t.labelPrefix,
    isActive: t.isActive,
    nodes: sortedNodes.map(toNodeDto),
    dependencies,
    occurrences: t.occurrences.map(toTemplateOccurrenceDto),
    roles,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toTemplateSummaryDto(t: TemplateSummaryRow): TemplateSummaryDto {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    createdBy: toUserRef(t.createdBy),
    recurrenceType: t.recurrenceType,
    isActive: t.isActive,
    nodeCount: t._count.nodes,
    occurrenceCount: t._count.occurrences,
    updatedAt: t.updatedAt.toISOString(),
  };
}
