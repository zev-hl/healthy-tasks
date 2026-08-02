import type { Request, Response } from 'express';
import type {
  ActiveUserDto,
  PaginatedResult,
  TaskDashboardDto,
  TaskDetailDto,
  TaskDto,
  TaskHistoryEntryDto,
  TaskRef,
  TaskRowDto,
} from '@healthy-tasks/shared';
import { HttpError } from '../utils/http-error.js';
import {
  createTask,
  deleteTask,
  duplicateTask,
  exitReview,
  getTaskDetail,
  listAllTags,
  listMentionCandidates,
  listReviewerCandidates,
  listTasks,
  setTaskPrivate,
  updateTask,
} from '../services/task.service.js';
import { type Actor, requireTaskAccess } from '../services/access-control.service.js';
import { getTaskHistory } from '../services/task-history.service.js';
import {
  getTaskDashboard,
  searchTasks as searchTaskRows,
  searchTasksForExport,
} from '../services/task-search.service.js';
import { buildTasksWorkbook } from '../services/task-export.service.js';
import type { TaskDashboardInput, TaskSearchInput } from '../validation/schemas.js';
import {
  addDependency,
  clearParent,
  removeDependency,
  searchTasks,
  setParent,
} from '../services/task.relationships.service.js';
import type {
  CreateTaskInput,
  DependencyInput,
  DuplicateTaskInput,
  SetParentInput,
  UpdateTaskInput,
} from '../validation/schemas.js';

/** Parse the :id route param into a positive integer or throw a 400. */
function parseTaskId(req: Request): number {
  const raw = (req.params as { id: string }).id;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw HttpError.badRequest('Invalid task id');
  }
  return id;
}

/** The authenticated actor ({ id, role }) or a 401. */
function actorOf(req: Request): Actor {
  if (!req.user) throw HttpError.unauthorized();
  return { id: req.user.id, role: req.user.role };
}

export async function createTaskController(req: Request, res: Response): Promise<void> {
  const task = await createTask(actorOf(req), req.body as CreateTaskInput);
  res.status(201).json(task satisfies TaskDto);
}

export async function listTasksController(req: Request, res: Response): Promise<void> {
  res.json((await listTasks(actorOf(req))) satisfies TaskDto[]);
}

/** Task Search screen: filtered/sorted/paged results (access-scoped). */
export async function queryTasksController(req: Request, res: Response): Promise<void> {
  const result = await searchTaskRows(req.body as TaskSearchInput, actorOf(req));
  res.json(result satisfies PaginatedResult<TaskRowDto>);
}

/** Task Search dashboard (Phase 7): counts for the current filtered result set. */
export async function dashboardController(req: Request, res: Response): Promise<void> {
  const result = await getTaskDashboard(req.body as TaskDashboardInput, actorOf(req));
  res.json(result satisfies TaskDashboardDto);
}

/** Export the current filtered/sorted result set to .xlsx (all columns). */
export async function exportTasksController(req: Request, res: Response): Promise<void> {
  const rows = await searchTasksForExport(req.body as TaskSearchInput, actorOf(req));
  const workbook = await buildTasksWorkbook(rows);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', 'attachment; filename="tasks.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
}

export async function listTagsController(_req: Request, res: Response): Promise<void> {
  res.json((await listAllTags()) satisfies string[]);
}

export async function getTaskController(req: Request, res: Response): Promise<void> {
  const task = await getTaskDetail(parseTaskId(req), actorOf(req));
  res.json(task satisfies TaskDetailDto);
}

export async function updateTaskController(req: Request, res: Response): Promise<void> {
  const actor = actorOf(req);
  await updateTask(actor, parseTaskId(req), req.body as UpdateTaskInput);
  // Return the full detail so relationship-dependent UI stays in sync.
  const task = await getTaskDetail(parseTaskId(req), actor);
  res.json(task satisfies TaskDetailDto);
}

/** Phase 13: toggle a task's Private flag (Admin / supervisor-chain only). */
export async function setTaskPrivateController(req: Request, res: Response): Promise<void> {
  const { isPrivate } = req.body as { isPrivate: boolean };
  const task = await setTaskPrivate(actorOf(req), parseTaskId(req), isPrivate);
  res.json(task satisfies TaskDetailDto);
}

/** Phase 13: users who may be @mentioned on this task (Private-aware). */
export async function mentionCandidatesController(req: Request, res: Response): Promise<void> {
  const id = parseTaskId(req);
  await requireTaskAccess(actorOf(req), id); // 404 if the caller can't see the task
  res.json((await listMentionCandidates(id)) satisfies ActiveUserDto[]);
}

/** Phase 13: the reviewer-selection pool for this task. */
export async function reviewerCandidatesController(req: Request, res: Response): Promise<void> {
  const id = parseTaskId(req);
  await requireTaskAccess(actorOf(req), id);
  res.json((await listReviewerCandidates(id)) satisfies ActiveUserDto[]);
}

export async function getTaskHistoryController(req: Request, res: Response): Promise<void> {
  const id = parseTaskId(req);
  const actor = actorOf(req);
  await requireTaskAccess(actor, id); // 404 if the caller can't see the task
  const history = await getTaskHistory(id, actor);
  res.json(history satisfies TaskHistoryEntryDto[]);
}

/** Phase 10: finish a review — restore Prior Assignee + Prior Status ("Reviewed"). */
export async function reviewedController(req: Request, res: Response): Promise<void> {
  if (!req.user) throw HttpError.unauthorized();
  const task = await exitReview(
    { id: req.user.id, role: req.user.role },
    parseTaskId(req),
    'reviewed',
  );
  res.json(task satisfies TaskDetailDto);
}

/** Phase 10: recall from review — same restore, but for the initiator / prior assignee. */
export async function recallReviewController(req: Request, res: Response): Promise<void> {
  if (!req.user) throw HttpError.unauthorized();
  const task = await exitReview(
    { id: req.user.id, role: req.user.role },
    parseTaskId(req),
    'recall',
  );
  res.json(task satisfies TaskDetailDto);
}

// --- Relationship endpoints ------------------------------------------------

export async function searchTasksController(req: Request, res: Response): Promise<void> {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const excludeRaw = req.query.exclude;
  const exclude =
    typeof excludeRaw === 'string' && /^\d+$/.test(excludeRaw) ? Number(excludeRaw) : undefined;
  res.json((await searchTasks(actorOf(req), q, exclude)) satisfies TaskRef[]);
}

export async function setParentController(req: Request, res: Response): Promise<void> {
  const { parentId } = req.body as SetParentInput;
  const task = await setParent(actorOf(req), parseTaskId(req), parentId);
  res.json(task satisfies TaskDetailDto);
}

export async function clearParentController(req: Request, res: Response): Promise<void> {
  const task = await clearParent(actorOf(req), parseTaskId(req));
  res.json(task satisfies TaskDetailDto);
}

export async function addDependencyController(req: Request, res: Response): Promise<void> {
  const { type, otherTaskId } = req.body as DependencyInput;
  const task = await addDependency(actorOf(req), parseTaskId(req), type, otherTaskId);
  res.status(201).json(task satisfies TaskDetailDto);
}

export async function removeDependencyController(req: Request, res: Response): Promise<void> {
  const { type, otherTaskId } = req.body as DependencyInput;
  const task = await removeDependency(actorOf(req), parseTaskId(req), type, otherTaskId);
  res.json(task satisfies TaskDetailDto);
}

export async function deleteTaskController(req: Request, res: Response): Promise<void> {
  // Admin-only; also enforced in the service.
  await deleteTask(actorOf(req), parseTaskId(req));
  res.status(204).send();
}

export async function duplicateTaskController(req: Request, res: Response): Promise<void> {
  const { includeDescendants } = req.body as DuplicateTaskInput;
  const task = await duplicateTask(actorOf(req), parseTaskId(req), includeDescendants ?? false);
  res.status(201).json(task satisfies TaskDetailDto);
}
