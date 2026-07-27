import { randomUUID } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { getStorage } from '../storage/index.js';
import { getTaskDetail } from './task.service.js';
import {
  ATTACHMENT_MAX_BYTES,
  isAllowedAttachmentType,
  type AttachmentDownloadResponse,
  type PresignAttachmentResponse,
  type Role,
  type TaskDetailDto,
} from '@healthy-tasks/shared';

/** The acting user, as populated on req.user by requireAuth. */
export interface Actor {
  id: string;
  role: Role;
}

export interface UploadInput {
  filename: string;
  contentType: string;
  size: number;
}

export interface ConfirmInput extends UploadInput {
  storageKey: string;
}

// --- Validation & helpers --------------------------------------------------

function assertValidUpload(contentType: string, size: number): void {
  if (!isAllowedAttachmentType(contentType)) {
    throw HttpError.badRequest(
      `File type "${contentType}" is not allowed. Allowed types: images, documents, audio, and video.`,
    );
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw HttpError.badRequest('File size is invalid');
  }
  if (size > ATTACHMENT_MAX_BYTES) {
    const mb = (size / (1024 * 1024)).toFixed(1);
    throw HttpError.badRequest(`File is too large (${mb} MB). The maximum is 25 MB.`);
  }
}

/** A filesystem/URL-safe basename for the storage key (the DB keeps the original). */
function safeName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';
}

async function assertTaskExists(taskId: number): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
  if (!task) throw HttpError.notFound('Task not found');
}

async function loadComment(commentId: string) {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, authorId: true, taskId: true },
  });
  if (!comment) throw HttpError.notFound('Comment not found');
  return comment;
}

/**
 * Is `actorId` above `subjectId` in the org (supervisor) chain? Walks up from the
 * subject following supervisorId; true if we reach the actor.
 */
async function isOrgSuperiorOf(actorId: string, subjectId: string): Promise<boolean> {
  const seen = new Set<string>();
  let currentId: string = subjectId;
  for (;;) {
    const row: { supervisorId: string | null } | null = await prisma.user.findUnique({
      where: { id: currentId },
      select: { supervisorId: true },
    });
    const supervisorId: string | null = row?.supervisorId ?? null;
    if (supervisorId === null) return false;
    if (supervisorId === actorId) return true;
    if (seen.has(supervisorId)) return false; // defensive against any cycle
    seen.add(supervisorId);
    currentId = supervisorId;
  }
}

/** An attachment may be deleted by its uploader, an org-superior of the uploader, or an Admin. */
async function canDeleteAttachment(actor: Actor, uploaderId: string): Promise<boolean> {
  if (actor.role === 'Admin' || actor.id === uploaderId) return true;
  return isOrgSuperiorOf(actor.id, uploaderId);
}

/** After an upload, prefer the storage object's real size/type; fall back to the client's. */
async function resolveMetadata(
  storageKey: string,
  declared: { size: number; contentType: string },
): Promise<{ size: number; contentType: string }> {
  const head = await getStorage().headObject(storageKey);
  if (head) return { size: head.size, contentType: head.contentType || declared.contentType };
  return declared;
}

// --- Pre-sign (step 1) -----------------------------------------------------

export async function presignTaskUpload(
  taskId: number,
  input: UploadInput,
): Promise<PresignAttachmentResponse> {
  await assertTaskExists(taskId);
  assertValidUpload(input.contentType, input.size);
  const storageKey = `tasks/${taskId}/${randomUUID()}/${safeName(input.filename)}`;
  const uploadUrl = await getStorage().presignUpload(storageKey, input.contentType, input.size);
  return { uploadUrl, storageKey };
}

export async function presignCommentUpload(
  actor: Actor,
  commentId: string,
  input: UploadInput,
): Promise<PresignAttachmentResponse> {
  const comment = await loadComment(commentId);
  // Only the comment's author may add attachments to their comment.
  if (comment.authorId !== actor.id) {
    throw HttpError.forbidden('Only the comment author can add attachments to this comment');
  }
  assertValidUpload(input.contentType, input.size);
  const storageKey = `comments/${commentId}/${randomUUID()}/${safeName(input.filename)}`;
  const uploadUrl = await getStorage().presignUpload(storageKey, input.contentType, input.size);
  return { uploadUrl, storageKey };
}

// --- Confirm / persist metadata (step 2) -----------------------------------

export async function createTaskAttachment(
  actor: Actor,
  taskId: number,
  input: ConfirmInput,
): Promise<TaskDetailDto> {
  await assertTaskExists(taskId);
  // Guard: the key must be one we minted for THIS task.
  if (!input.storageKey.startsWith(`tasks/${taskId}/`)) {
    throw HttpError.badRequest('storageKey does not belong to this task');
  }
  const { size, contentType } = await resolveMetadata(input.storageKey, input);
  assertValidUpload(contentType, size);
  // Phase 5 (History of Changes) hook: record an attachment-added event here.
  await prisma.attachment.create({
    data: {
      filename: input.filename.slice(0, 255),
      contentType,
      size,
      storageKey: input.storageKey,
      uploadedById: actor.id,
      taskId,
    },
  });
  return getTaskDetail(taskId);
}

export async function createCommentAttachment(
  actor: Actor,
  commentId: string,
  input: ConfirmInput,
): Promise<TaskDetailDto> {
  const comment = await loadComment(commentId);
  if (comment.authorId !== actor.id) {
    throw HttpError.forbidden('Only the comment author can add attachments to this comment');
  }
  if (!input.storageKey.startsWith(`comments/${commentId}/`)) {
    throw HttpError.badRequest('storageKey does not belong to this comment');
  }
  const { size, contentType } = await resolveMetadata(input.storageKey, input);
  assertValidUpload(contentType, size);
  // Phase 5 (History of Changes) hook: record an attachment-added event here.
  await prisma.attachment.create({
    data: {
      filename: input.filename.slice(0, 255),
      contentType,
      size,
      storageKey: input.storageKey,
      uploadedById: actor.id,
      commentId,
    },
  });
  return getTaskDetail(comment.taskId);
}

// --- Delete & download -----------------------------------------------------

export async function deleteAttachment(
  actor: Actor,
  attachmentId: string,
): Promise<TaskDetailDto> {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      storageKey: true,
      uploadedById: true,
      taskId: true,
      comment: { select: { taskId: true } },
    },
  });
  if (!attachment) throw HttpError.notFound('Attachment not found');

  if (!(await canDeleteAttachment(actor, attachment.uploadedById))) {
    throw HttpError.forbidden('You do not have permission to delete this attachment');
  }

  const taskId = attachment.taskId ?? attachment.comment?.taskId;
  if (taskId == null) throw HttpError.badRequest('Attachment is not attached to a task');

  // Phase 5 (History of Changes) hook: record an attachment-removed event here.
  // Remove the object first so a storage failure aborts before the row is gone.
  await getStorage().deleteObject(attachment.storageKey);
  await prisma.attachment.delete({ where: { id: attachmentId } });
  return getTaskDetail(taskId);
}

export async function getAttachmentDownloadUrl(
  attachmentId: string,
): Promise<AttachmentDownloadResponse> {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: { storageKey: true, filename: true },
  });
  if (!attachment) throw HttpError.notFound('Attachment not found');
  const url = await getStorage().presignDownload(attachment.storageKey, attachment.filename);
  return { url, filename: attachment.filename };
}
