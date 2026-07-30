import type { Request, Response } from 'express';
import { HttpError } from '../utils/http-error.js';
import type { GhostOccurrenceDto, TaskDetailDto } from '@healthy-tasks/shared';
import type { MaterializeGhostInput, SetTaskRecurrenceInput } from '../validation/schemas.js';
import {
  clearTaskRecurrence,
  getTaskGhosts,
  materializeTaskOccurrence,
  setTaskRecurrence,
} from '../services/task-recurrence.service.js';

function currentUserId(req: Request): string {
  if (!req.user) throw HttpError.unauthorized();
  return req.user.id;
}

function parseTaskId(req: Request): number {
  const id = Number((req.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw HttpError.badRequest('Invalid task id');
  return id;
}

/** GET /api/tasks/ghosts — computed ghost previews of every active recurring
 * task, for the Gantt/Calendar views. Available to any authenticated user. */
export async function taskGhostsController(_req: Request, res: Response): Promise<void> {
  res.json((await getTaskGhosts(new Date())) satisfies GhostOccurrenceDto[]);
}

/** PUT /api/tasks/:id/recurrence — set/update this task's recurrence rule. */
export async function setTaskRecurrenceController(req: Request, res: Response): Promise<void> {
  const result = await setTaskRecurrence(
    currentUserId(req),
    parseTaskId(req),
    req.body as SetTaskRecurrenceInput,
  );
  res.json(result satisfies TaskDetailDto);
}

/** DELETE /api/tasks/:id/recurrence — stop this task recurring. */
export async function clearTaskRecurrenceController(req: Request, res: Response): Promise<void> {
  res.json((await clearTaskRecurrence(parseTaskId(req))) satisfies TaskDetailDto);
}

/** POST /api/tasks/:id/recurrence/materialize — turn one ghost into a real task. */
export async function materializeTaskOccurrenceController(req: Request, res: Response): Promise<void> {
  const { seq } = req.body as MaterializeGhostInput;
  const result = await materializeTaskOccurrence(currentUserId(req), parseTaskId(req), seq);
  res.status(201).json(result satisfies TaskDetailDto);
}
