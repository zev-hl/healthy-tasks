import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { getTaskDetail } from './task.service.js';
import { createAssignedNotification } from './notification.service.js';
import { type Actor, assertCanEditTask } from './access-control.service.js';
import { getMaterializeLeadDays } from './app-settings.service.js';
import {
  addInterval,
  dueFixedSeqs,
  fixedAnchorForSeq,
  isWithinLeadTime,
  seqAllowed,
  upcomingFixedSeqs,
  type RecurrenceConfig,
} from './recurrence.js';
import { type GhostOccurrenceDto, type TaskDetailDto } from '@healthy-tasks/shared';
import type { SetTaskRecurrenceInput } from '../validation/schemas.js';

/**
 * Task-level recurrence (Phase 11): a regular task can be set to recur. The
 * source task IS occurrence #1; this module generates its future instances
 * (seq 2, 3, …), computes its ghost previews, and materializes them — reusing
 * the same pure date math and scheduler contract as template recurrence. Ghosts
 * from recurring tasks are visible to every user who can see the task (no
 * Admin/Manager gate), unlike template ghosts.
 */

type RecurrenceRow = {
  recurrenceType: RecurrenceConfig['recurrenceType'];
  intervalCount: number;
  intervalUnit: NonNullable<RecurrenceConfig['intervalUnit']>;
  weekdays: number[];
  anchorDate: Date;
  endType: RecurrenceConfig['endType'];
  endDate: Date | null;
  maxOccurrences: number | null;
  isActive: boolean;
};

function toConfig(r: RecurrenceRow): RecurrenceConfig {
  return {
    recurrenceType: r.recurrenceType,
    intervalCount: r.intervalCount,
    intervalUnit: r.intervalUnit,
    weekdays: r.weekdays,
    anchorDate: r.anchorDate,
    endType: r.endType,
    endDate: r.endDate,
    maxOccurrences: r.maxOccurrences,
  };
}

/** The earliest of a task's start/due dates — the recurrence anchor + the
 * reference point for the lead-time (ghost) window. */
export function earliestDate(startAt: Date | null, dueAt: Date | null): Date | null {
  if (startAt && dueAt) return startAt.getTime() <= dueAt.getTime() ? startAt : dueAt;
  return startAt ?? dueAt ?? null;
}

// --- Set / clear -----------------------------------------------------------

export async function setTaskRecurrence(
  actor: Actor,
  taskId: number,
  input: SetTaskRecurrenceInput,
): Promise<TaskDetailDto> {
  await assertCanEditTask(actor, taskId);
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, startAt: true, dueAt: true, recurrenceSourceId: true },
  });
  if (!task) throw HttpError.notFound('Task not found');
  if (task.recurrenceSourceId != null) {
    // A generated instance is an occurrence, not a definition; recur the source.
    throw HttpError.badRequest('This task is a generated occurrence; set recurrence on its source task');
  }
  const anchor = earliestDate(task.startAt, task.dueAt);
  if (!anchor) throw HttpError.badRequest('A task needs a start or due date before it can recur');

  const endType = input.endType ?? 'Never';
  const data = {
    recurrenceType: input.recurrenceType,
    intervalCount: input.intervalCount,
    intervalUnit: input.intervalUnit,
    // Weekday selection only applies to a weekly interval.
    weekdays: input.intervalUnit === 'Week' ? (input.weekdays ?? []) : [],
    anchorDate: anchor,
    endType,
    endDate: endType === 'OnDate' ? (input.endDate ?? null) : null,
    maxOccurrences: endType === 'AfterOccurrences' ? (input.maxOccurrences ?? null) : null,
    isActive: input.isActive ?? true,
  };
  await prisma.taskRecurrence.upsert({
    where: { taskId },
    create: { taskId, ...data },
    update: data,
  });
  return getTaskDetail(taskId, actor);
}

export async function clearTaskRecurrence(actor: Actor, taskId: number): Promise<TaskDetailDto> {
  await assertCanEditTask(actor, taskId);
  await prisma.taskRecurrence.deleteMany({ where: { taskId } });
  return getTaskDetail(taskId, actor);
}

// --- Generation ------------------------------------------------------------

interface SourceTask {
  id: number;
  name: string;
  description: string | null;
  priority: Prisma.TaskCreateInput['priority'];
  tags: string[];
  creatorId: string;
  instanceLabel: string | null;
}

/** The assignee to carry forward: the most recent instance's assignee (the last
 * generated occurrence, else the source). */
async function carryForwardAssignee(sourceId: number): Promise<string | null> {
  const latest = await prisma.task.findFirst({
    where: { recurrenceSourceId: sourceId },
    orderBy: { recurrenceSeq: 'desc' },
    select: { assigneeId: true },
  });
  if (latest) return latest.assigneeId;
  const source = await prisma.task.findUnique({ where: { id: sourceId }, select: { assigneeId: true } });
  return source?.assigneeId ?? null;
}

/**
 * Generate one occurrence (a copy of the source) at the given dates. The
 * (recurrenceSourceId, recurrenceSeq) unique index is the claim against a
 * concurrent double-fire (P2002 ⇒ already generated). Returns the new task id,
 * or null if it was already claimed.
 */
async function generateTaskOccurrence(params: {
  source: SourceTask;
  seq: number;
  startAt: Date | null;
  dueAt: Date | null;
  actorId: string;
}): Promise<number | null> {
  const { source, seq, startAt, dueAt, actorId } = params;
  const assigneeId = await carryForwardAssignee(source.id);
  try {
    const created = await prisma.task.create({
      data: {
        name: source.name,
        description: source.description,
        creatorId: source.creatorId,
        assigneeId,
        priority: source.priority,
        tags: source.tags,
        startAt,
        dueAt,
        // Carry the PO/batch label so the filterable field matches the copied name.
        instanceLabel: source.instanceLabel,
        recurrenceSourceId: source.id,
        recurrenceSeq: seq,
      },
      select: { id: true },
    });
    if (assigneeId) {
      await createAssignedNotification({ recipientId: assigneeId, actorId, taskId: created.id, action: 'added' });
    }
    return created.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
    throw err;
  }
}

/**
 * The start/due for the seq-th occurrence of a Fixed schedule. The occurrence's
 * earliest date is `fixedAnchorForSeq` (which handles the weekly "repeat on"
 * enumeration); the source's start and due both shift by the same delta from the
 * recurrence anchor, so the span is preserved and the earliest lands on the
 * occurrence date.
 */
function occurrenceStartDue(
  cfg: RecurrenceConfig,
  src: { startAt: Date | null; dueAt: Date | null },
  seq: number,
): { startAt: Date | null; dueAt: Date | null } {
  const delta = fixedAnchorForSeq(cfg, seq).getTime() - cfg.anchorDate!.getTime();
  return {
    startAt: src.startAt ? new Date(src.startAt.getTime() + delta) : null,
    dueAt: src.dueAt ? new Date(src.dueAt.getTime() + delta) : null,
  };
}

// --- Ghost previews --------------------------------------------------------

type GhostSource = SourceTask & {
  startAt: Date | null;
  dueAt: Date | null;
  recurrence: RecurrenceRow | null;
  recurrenceOccurrences: { recurrenceSeq: number | null }[];
};

function ghostsForSource(s: GhostSource, now: Date, leadDays: number): GhostOccurrenceDto[] {
  if (!s.recurrence || !s.recurrence.isActive || s.recurrence.recurrenceType !== 'Fixed') return [];
  const cfg = toConfig(s.recurrence);
  // seq 1 is the source itself; occurrences carry their own seqs.
  const fired = new Set<number>([1, ...s.recurrenceOccurrences.map((o) => o.recurrenceSeq ?? 0)]);
  return upcomingFixedSeqs(cfg, fired).map(({ seq, anchor }) => {
    const { startAt, dueAt } = occurrenceStartDue(cfg, s, seq);
    return {
      sourceType: 'task' as const,
      sourceId: s.id,
      sourceName: s.name,
      seq,
      name: s.name,
      startAt: startAt?.toISOString() ?? null,
      dueAt: dueAt?.toISOString() ?? null,
      priority: s.priority as GhostOccurrenceDto['priority'],
      withinLeadTime: isWithinLeadTime(anchor, leadDays, now),
    };
  });
}

const ghostSourceSelect = {
  id: true,
  name: true,
  description: true,
  priority: true,
  tags: true,
  creatorId: true,
  instanceLabel: true,
  startAt: true,
  dueAt: true,
  recurrence: true,
  recurrenceOccurrences: { select: { recurrenceSeq: true } },
} as const;

/** Ghosts across every active fixed-schedule recurring task (for Gantt/Calendar,
 * visible to all authenticated users). */
export async function getTaskGhosts(now: Date): Promise<GhostOccurrenceDto[]> {
  const leadDays = await getMaterializeLeadDays();
  const sources = await prisma.task.findMany({
    where: { recurrence: { isActive: true, recurrenceType: 'Fixed' } },
    select: ghostSourceSelect,
  });
  return sources.flatMap((s) => ghostsForSource(s as GhostSource, now, leadDays));
}

// --- Click-through materialization -----------------------------------------

export async function materializeTaskOccurrence(
  actor: Actor,
  sourceId: number,
  seq: number,
): Promise<TaskDetailDto> {
  const actorId = actor.id;
  // Turning a ghost into a real occurrence acts on the recurring series → the
  // caller needs full (edit) access to the source task.
  await assertCanEditTask(actor, sourceId);
  const source = await prisma.task.findUnique({
    where: { id: sourceId },
    select: { ...ghostSourceSelect },
  });
  if (!source) throw HttpError.notFound('Task not found');
  if (!source.recurrence || source.recurrence.recurrenceType !== 'Fixed') {
    throw HttpError.badRequest('Only fixed-schedule recurring tasks have materializable ghosts');
  }
  const cfg = toConfig(source.recurrence);
  const anchor = fixedAnchorForSeq(cfg, seq);
  if (seq < 2 || !seqAllowed(cfg, seq, anchor)) {
    throw HttpError.badRequest('That occurrence is not part of the schedule');
  }
  // Common case: the occurrence already exists → conflict without hitting (and
  // logging) the unique constraint. The constraint still backstops real races.
  const already = await prisma.task.findFirst({
    where: { recurrenceSourceId: sourceId, recurrenceSeq: seq },
    select: { id: true },
  });
  if (already) throw HttpError.conflict('That occurrence has already been materialized');

  const { startAt, dueAt } = occurrenceStartDue(cfg, source, seq);
  const newId = await generateTaskOccurrence({
    source: source as SourceTask,
    seq,
    startAt,
    dueAt,
    actorId,
  });
  if (newId === null) throw HttpError.conflict('That occurrence has already been materialized');
  return getTaskDetail(newId, actor);
}

// --- Scheduler pass --------------------------------------------------------

type ScheduleSource = SourceTask & {
  startAt: Date | null;
  dueAt: Date | null;
  status: string;
  statusChangedAt: Date | null;
  recurrence: RecurrenceRow;
  recurrenceOccurrences: { recurrenceSeq: number | null }[];
};

async function materializeDueForSource(s: ScheduleSource, now: Date, leadDays: number): Promise<number> {
  const cfg = toConfig(s.recurrence);
  let count = 0;

  if (cfg.recurrenceType === 'Fixed') {
    const fired = new Set<number>([1, ...s.recurrenceOccurrences.map((o) => o.recurrenceSeq ?? 0)]);
    for (const seq of dueFixedSeqs(cfg, fired, now, leadDays)) {
      const { startAt, dueAt } = occurrenceStartDue(cfg, s, seq);
      const id = await generateTaskOccurrence({ source: s, seq, startAt, dueAt, actorId: s.creatorId });
      if (id !== null) count += 1;
    }
    return count;
  }

  // RelativeToCompletion: the next instance is scheduled only once the prior
  // instance's task is Completed. The "prior instance" is the latest occurrence,
  // or the source itself if none have been generated yet.
  const latestOcc = await prisma.task.findFirst({
    where: { recurrenceSourceId: s.id },
    orderBy: { recurrenceSeq: 'desc' },
    select: { recurrenceSeq: true, status: true, statusChangedAt: true },
  });
  const latest = latestOcc ?? { recurrenceSeq: 1, status: s.status, statusChangedAt: s.statusChangedAt };
  if (latest.status !== 'Completed') return 0;

  const completedAt = latest.statusChangedAt ?? now;
  const nextSeq = (latest.recurrenceSeq ?? 1) + 1;
  const nextAnchor = addInterval(completedAt, cfg.intervalUnit!, cfg.intervalCount!);
  if (!seqAllowed(cfg, nextSeq, nextAnchor) || !isWithinLeadTime(nextAnchor, leadDays, now)) {
    return 0;
  }
  // Anchor the next instance at nextAnchor, preserving the source's start→due span.
  const span = s.startAt && s.dueAt ? s.dueAt.getTime() - s.startAt.getTime() : null;
  const newStart = s.startAt ? nextAnchor : null;
  const newDue = s.dueAt ? (span != null ? new Date(nextAnchor.getTime() + span) : nextAnchor) : null;
  const id = await generateTaskOccurrence({ source: s, seq: nextSeq, startAt: newStart, dueAt: newDue, actorId: s.creatorId });
  return id !== null ? 1 : 0;
}

/** Materialize all due task-recurrence occurrences; returns how many fired.
 * `leadDays` is the single global materialization lead time (AppSetting). */
export async function materializeDueTaskRecurrences(now: Date, leadDays: number): Promise<number> {
  const sources = await prisma.task.findMany({
    where: { recurrence: { isActive: true, recurrenceType: { in: ['Fixed', 'RelativeToCompletion'] } } },
    select: { ...ghostSourceSelect, status: true, statusChangedAt: true },
  });
  let count = 0;
  for (const s of sources) {
    try {
      count += await materializeDueForSource(s as ScheduleSource, now, leadDays);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`task-recurrence: source ${s.id} failed`, err);
    }
  }
  return count;
}
