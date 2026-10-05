import { randomUUID } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { getStorage } from '../storage/index.js';
import { getTaskDetail } from './task.service.js';
import { recordHistory } from './task-history.service.js';
import { assertCanEditTask, requireTaskAccess } from './access-control.service.js';
import { richTextLength } from '../utils/rich-text.js';
import {
  ATTACHMENT_MAX_BYTES,
  COMMENT_MAX_ATTACHMENTS,
  isAllowedAttachmentType,
  TASK_HISTORY_FIELDS,
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
  actor: Actor,
  taskId: number,
  input: UploadInput,
): Promise<PresignAttachmentResponse> {
  // Uploading a task-level attachment is editing the task → full access.
  await assertCanEditTask(actor, taskId);
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

/**
 * The prefix a draft comment's files are uploaded under, before the comment
 * exists. The comment id can't appear in the path — there is no comment yet —
 * so the ACTOR id takes its place. That is what lets `prepareCommentAttachments`
 * prove, with no extra lookup, that a caller is only claiming files they
 * uploaded themselves; without it anyone could post a comment pointing at
 * someone else's freshly uploaded object.
 */
export function commentDraftPrefix(taskId: number, actorId: string): string {
  return `comments/${taskId}/${actorId}/`;
}

/**
 * Pre-sign an upload for a comment that has not been written yet, so text and
 * files can be submitted together in one request.
 *
 * Access mirrors commenting itself: read-only (tree-inherited) viewers cannot
 * comment, so they cannot stage files for one either.
 */
export async function presignCommentDraftUpload(
  actor: Actor,
  taskId: number,
  input: UploadInput,
): Promise<PresignAttachmentResponse> {
  const access = await requireTaskAccess(actor, taskId);
  if (access.level === 'tree') {
    throw HttpError.forbidden('You have read-only access to this task and cannot comment on it');
  }
  assertValidUpload(input.contentType, input.size);
  const storageKey = `${commentDraftPrefix(taskId, actor.id)}${randomUUID()}/${safeName(input.filename)}`;
  const uploadUrl = await getStorage().presignUpload(storageKey, input.contentType, input.size);
  return { uploadUrl, storageKey };
}

/** One validated attachment, ready to be written inside the comment's transaction. */
export interface PreparedAttachment {
  filename: string;
  contentType: string;
  size: number;
  storageKey: string;
}

/**
 * Check every staged file before a comment is written: that the caller uploaded
 * it, that it isn't claimed twice, and that its real size and type (read back
 * from storage, not merely declared) are allowed.
 *
 * Ownership is checked FIRST and separately, because the caller cleans up by
 * deleting these keys when the write fails. A key that failed the prefix check
 * might belong to someone else, so it must never reach that cleanup — which is
 * why this throws on a bad prefix before looking at anything else.
 */
export async function prepareCommentAttachments(
  actor: Actor,
  taskId: number,
  inputs: ConfirmInput[],
): Promise<PreparedAttachment[]> {
  if (inputs.length > COMMENT_MAX_ATTACHMENTS) {
    throw HttpError.badRequest(
      `A comment can carry at most ${COMMENT_MAX_ATTACHMENTS} files; ${inputs.length} were sent.`,
    );
  }
  const prefix = commentDraftPrefix(taskId, actor.id);
  const seen = new Set<string>();
  for (const input of inputs) {
    if (!input.storageKey.startsWith(prefix)) {
      throw HttpError.badRequest('storageKey does not belong to this comment');
    }
    if (seen.has(input.storageKey)) {
      throw HttpError.badRequest('The same file was attached twice');
    }
    seen.add(input.storageKey);
  }

  // A key already on an attachment row is somebody's live file. Accepting it
  // would both duplicate the row and, worse, put a file the previous comment
  // still points at into this call's cleanup list.
  if (inputs.length > 0) {
    const already = await prisma.attachment.findFirst({
      where: { storageKey: { in: inputs.map((i) => i.storageKey) } },
      select: { storageKey: true },
    });
    if (already) {
      throw HttpError.badRequest('That file is already attached');
    }
  }

  const prepared: PreparedAttachment[] = [];
  for (const input of inputs) {
    // Unlike the two-step confirm path, a missing object here is not something
    // to shrug at: it means the browser's upload never landed, and writing the
    // row would leave a comment pointing at nothing. Fail instead.
    const head = await getStorage().headObject(input.storageKey);
    if (!head) {
      throw HttpError.badRequest(`"${input.filename}" was not uploaded; please try again`);
    }
    const contentType = head.contentType || input.contentType;
    assertValidUpload(contentType, head.size);
    prepared.push({
      filename: input.filename.slice(0, 255),
      contentType,
      size: head.size,
      storageKey: input.storageKey,
    });
  }
  return prepared;
}

/**
 * Best-effort removal of objects whose database write failed. Object storage
 * can't join a Prisma transaction, so this is the compensating half: the rows
 * were rolled back, and these bytes would otherwise be orphaned in the bucket.
 * A failure here is logged, never thrown — the caller is already reporting the
 * original error, and burying it under a cleanup error would help nobody.
 */
export async function discardUploads(storageKeys: string[]): Promise<void> {
  for (const key of storageKeys) {
    try {
      await getStorage().deleteObject(key);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to discard an uploaded object after a failed write', key, err);
    }
  }
}

// --- Confirm / persist metadata (step 2) -----------------------------------

export async function createTaskAttachment(
  actor: Actor,
  taskId: number,
  input: ConfirmInput,
): Promise<TaskDetailDto> {
  await assertCanEditTask(actor, taskId);
  // Guard: the key must be one we minted for THIS task.
  if (!input.storageKey.startsWith(`tasks/${taskId}/`)) {
    throw HttpError.badRequest('storageKey does not belong to this task');
  }
  const { size, contentType } = await resolveMetadata(input.storageKey, input);
  assertValidUpload(contentType, size);
  const filename = input.filename.slice(0, 255);
  await prisma.$transaction(async (tx) => {
    await tx.attachment.create({
      data: {
        filename,
        contentType,
        size,
        storageKey: input.storageKey,
        uploadedById: actor.id,
        taskId,
      },
    });
    // History: an attachment was added (identified by filename).
    await recordHistory(tx, {
      taskId,
      userId: actor.id,
      field: TASK_HISTORY_FIELDS.attachment,
      changeType: 'added',
      detail: filename,
    });
  });
  return getTaskDetail(taskId, actor);
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
  const filename = input.filename.slice(0, 255);
  await prisma.$transaction(async (tx) => {
    await tx.attachment.create({
      data: {
        filename,
        contentType,
        size,
        storageKey: input.storageKey,
        uploadedById: actor.id,
        commentId,
      },
    });
    // History: a comment-level attachment is logged against its parent task too.
    await recordHistory(tx, {
      taskId: comment.taskId,
      userId: actor.id,
      field: TASK_HISTORY_FIELDS.attachment,
      changeType: 'added',
      detail: filename,
    });
  });
  return getTaskDetail(comment.taskId, actor);
}

// --- Delete & download -----------------------------------------------------

export async function deleteAttachment(actor: Actor, attachmentId: string): Promise<TaskDetailDto> {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      filename: true,
      storageKey: true,
      uploadedById: true,
      taskId: true,
      commentId: true,
      comment: { select: { taskId: true, body: true } },
    },
  });
  if (!attachment) throw HttpError.notFound('Attachment not found');

  if (!(await canDeleteAttachment(actor, attachment.uploadedById))) {
    throw HttpError.forbidden('You do not have permission to delete this attachment');
  }

  const taskId = attachment.taskId ?? attachment.comment?.taskId;
  if (taskId == null) throw HttpError.badRequest('Attachment is not attached to a task');

  // Remove the object first so a storage failure aborts before the row is gone.
  await getStorage().deleteObject(attachment.storageKey);
  await prisma.$transaction(async (tx) => {
    await tx.attachment.delete({ where: { id: attachmentId } });
    // History: an attachment was removed (identified by filename).
    await recordHistory(tx, {
      taskId,
      userId: actor.id,
      field: TASK_HISTORY_FIELDS.attachment,
      changeType: 'removed',
      detail: attachment.filename,
    });

    // A comment must always carry text or files — that is checked when one is
    // created, and removing the last file of a text-less comment is the only
    // way to break it afterwards. Rather than leave an empty shell in the
    // thread, the comment goes with its last file.
    if (attachment.commentId && richTextLength(attachment.comment?.body ?? '') === 0) {
      const left = await tx.attachment.count({
        where: { commentId: attachment.commentId },
      });
      if (left === 0) {
        await tx.comment.delete({ where: { id: attachment.commentId } });
        await recordHistory(tx, {
          taskId,
          userId: actor.id,
          field: TASK_HISTORY_FIELDS.comment,
          changeType: 'removed',
        });
      }
    }
  });
  return getTaskDetail(taskId, actor);
}

export async function getAttachmentDownloadUrl(
  actor: Actor,
  attachmentId: string,
): Promise<AttachmentDownloadResponse> {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      storageKey: true,
      filename: true,
      taskId: true,
      comment: { select: { taskId: true } },
    },
  });
  if (!attachment) throw HttpError.notFound('Attachment not found');
  // Phase 13: gate download by access to the owning task so a hidden task's
  // files cannot be fetched by URL.
  const taskId = attachment.taskId ?? attachment.comment?.taskId ?? null;
  if (taskId != null) await requireTaskAccess(actor, taskId);
  const url = await getStorage().presignDownload(attachment.storageKey, attachment.filename);
  return { url, filename: attachment.filename };
}
