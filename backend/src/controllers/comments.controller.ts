import type { Request, Response } from 'express';
import { HttpError } from '../utils/http-error.js';
import {
  createComment,
  updateComment,
  deleteComment,
  type Actor,
} from '../services/comment.service.js';
import type { CreateCommentInput, UpdateCommentInput } from '../validation/schemas.js';
import type { TaskDetailDto } from '@healthy-tasks/shared';

function actor(req: Request): Actor {
  if (!req.user) throw HttpError.unauthorized();
  return { id: req.user.id, role: req.user.role };
}

/** Task id from :id (comment creation is nested under /tasks/:id/comments). */
function taskIdParam(req: Request): number {
  const id = Number((req.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw HttpError.badRequest('Invalid task id');
  return id;
}

function commentIdParam(req: Request): string {
  const value = (req.params as { id: string }).id;
  if (!value) throw HttpError.badRequest('Missing comment id');
  return value;
}

export async function createCommentController(req: Request, res: Response): Promise<void> {
  const { body } = req.body as CreateCommentInput;
  const task = await createComment(actor(req), taskIdParam(req), body);
  res.status(201).json(task satisfies TaskDetailDto);
}

export async function updateCommentController(req: Request, res: Response): Promise<void> {
  const { body } = req.body as UpdateCommentInput;
  const task = await updateComment(actor(req), commentIdParam(req), body);
  res.json(task satisfies TaskDetailDto);
}

export async function deleteCommentController(req: Request, res: Response): Promise<void> {
  const task = await deleteComment(actor(req), commentIdParam(req));
  res.json(task satisfies TaskDetailDto);
}
