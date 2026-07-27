import type { Request, Response } from 'express';
import type { TaskDetailDto, TaskDto, TaskRef } from '@healthy-tasks/shared';
import { HttpError } from '../utils/http-error.js';
import { createTask, getTaskDetail, listTasks, updateTask } from '../services/task.service.js';
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

export async function createTaskController(req: Request, res: Response): Promise<void> {
  if (!req.user) throw HttpError.unauthorized();
  const task = await createTask(req.user.id, req.body as CreateTaskInput);
  res.status(201).json(task satisfies TaskDto);
}

export async function listTasksController(_req: Request, res: Response): Promise<void> {
  res.json((await listTasks()) satisfies TaskDto[]);
}

export async function getTaskController(req: Request, res: Response): Promise<void> {
  const task = await getTaskDetail(parseTaskId(req));
  res.json(task satisfies TaskDetailDto);
}

export async function updateTaskController(req: Request, res: Response): Promise<void> {
  await updateTask(parseTaskId(req), req.body as UpdateTaskInput);
  // Return the full detail so relationship-dependent UI stays in sync.
  const task = await getTaskDetail(parseTaskId(req));
  res.json(task satisfies TaskDetailDto);
}

// --- Relationship endpoints ------------------------------------------------

export async function searchTasksController(req: Request, res: Response): Promise<void> {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const excludeRaw = req.query.exclude;
  const exclude =
    typeof excludeRaw === 'string' && /^\d+$/.test(excludeRaw) ? Number(excludeRaw) : undefined;
  res.json((await searchTasks(q, exclude)) satisfies TaskRef[]);
}

export async function setParentController(req: Request, res: Response): Promise<void> {
  const { parentId } = req.body as SetParentInput;
  const task = await setParent(parseTaskId(req), parentId);
  res.json(task satisfies TaskDetailDto);
}

export async function clearParentController(req: Request, res: Response): Promise<void> {
  const task = await clearParent(parseTaskId(req));
  res.json(task satisfies TaskDetailDto);
}

export async function addDependencyController(req: Request, res: Response): Promise<void> {
  const { type, otherTaskId } = req.body as DependencyInput;
  const task = await addDependency(parseTaskId(req), type, otherTaskId);
  res.status(201).json(task satisfies TaskDetailDto);
}

export async function removeDependencyController(req: Request, res: Response): Promise<void> {
  const { type, otherTaskId } = req.body as DependencyInput;
  const task = await removeDependency(parseTaskId(req), type, otherTaskId);
  res.json(task satisfies TaskDetailDto);
}
