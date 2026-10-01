import type { Request, Response } from 'express';
import { HttpError } from '../utils/http-error.js';
import {
  presignTaskUpload,
  presignCommentUpload,
  presignCommentDraftUpload,
  createTaskAttachment,
  createCommentAttachment,
  deleteAttachment,
  getAttachmentDownloadUrl,
  type Actor,
} from '../services/attachment.service.js';
import type { PresignAttachmentInput, ConfirmAttachmentInput } from '../validation/schemas.js';
import type {
  AttachmentDownloadResponse,
  PresignAttachmentResponse,
  TaskDetailDto,
} from '@healthy-tasks/shared';

function actor(req: Request): Actor {
  if (!req.user) throw HttpError.unauthorized();
  return { id: req.user.id, role: req.user.role };
}

/** Task id from :id (task-attachment routes are nested under /tasks/:id). */
function taskIdParam(req: Request): number {
  const id = Number((req.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw HttpError.badRequest('Invalid task id');
  return id;
}

/** String id from :id (comment id or attachment id). */
function idParam(req: Request): string {
  const value = (req.params as { id: string }).id;
  if (!value) throw HttpError.badRequest('Missing id');
  return value;
}

// --- Task attachments ------------------------------------------------------

export async function presignTaskAttachmentController(req: Request, res: Response): Promise<void> {
  const result = await presignTaskUpload(
    actor(req),
    taskIdParam(req),
    req.body as PresignAttachmentInput,
  );
  res.status(201).json(result satisfies PresignAttachmentResponse);
}

export async function createTaskAttachmentController(req: Request, res: Response): Promise<void> {
  const task = await createTaskAttachment(
    actor(req),
    taskIdParam(req),
    req.body as ConfirmAttachmentInput,
  );
  res.status(201).json(task satisfies TaskDetailDto);
}

// --- Comment attachments ---------------------------------------------------

/**
 * Pre-sign a file for a comment that is still being written, so text and
 * attachments can be submitted together. Nested under the TASK, because the
 * comment it belongs to does not exist yet.
 */
export async function presignCommentDraftController(req: Request, res: Response): Promise<void> {
  const result = await presignCommentDraftUpload(
    actor(req),
    taskIdParam(req),
    req.body as PresignAttachmentInput,
  );
  res.status(201).json(result satisfies PresignAttachmentResponse);
}

export async function presignCommentAttachmentController(
  req: Request,
  res: Response,
): Promise<void> {
  const result = await presignCommentUpload(
    actor(req),
    idParam(req),
    req.body as PresignAttachmentInput,
  );
  res.status(201).json(result satisfies PresignAttachmentResponse);
}

export async function createCommentAttachmentController(
  req: Request,
  res: Response,
): Promise<void> {
  const task = await createCommentAttachment(
    actor(req),
    idParam(req),
    req.body as ConfirmAttachmentInput,
  );
  res.status(201).json(task satisfies TaskDetailDto);
}

// --- Delete & download (unified under /attachments/:id) --------------------

export async function deleteAttachmentController(req: Request, res: Response): Promise<void> {
  const task = await deleteAttachment(actor(req), idParam(req));
  res.json(task satisfies TaskDetailDto);
}

export async function downloadAttachmentController(req: Request, res: Response): Promise<void> {
  const result = await getAttachmentDownloadUrl(actor(req), idParam(req));
  res.json(result satisfies AttachmentDownloadResponse);
}
