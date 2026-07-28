import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { getStorage } from '../storage/index.js';
import { getTaskDetail } from './task.service.js';
import {
  sanitizeAndValidate,
  richTextLength,
  extractMentionUserIds,
} from '../utils/rich-text.js';
import { recordHistory } from './task-history.service.js';
import { createMentionNotifications } from './notification.service.js';
import {
  MENTION_EVENT_DEBOUNCE_MINUTES,
  TASK_HISTORY_FIELDS,
  type Role,
  type TaskDetailDto,
} from '@healthy-tasks/shared';

export interface Actor {
  id: string;
  role: Role;
}

async function assertTaskExists(taskId: number): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
  if (!task) throw HttpError.notFound('Task not found');
}

/** Clean the body, enforce the length limit, and reject empty content. */
function prepareBody(body: string): string {
  const clean = sanitizeAndValidate(body, { allowMentions: true, fieldLabel: 'Comment' });
  if (richTextLength(clean) === 0) {
    throw HttpError.badRequest('Comment cannot be empty');
  }
  return clean;
}

/** Of the given ids, return those that are real, active users (mentions of anyone else are ignored). */
async function activeUserIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/**
 * Reconcile the comment's current-mention set and write mention events per the
 * timing rule:
 *  - a NEW mention (not present before this save) always writes an event;
 *  - a RETAINED mention writes another only if 15+ minutes have passed since the
 *    last event for that (user, comment) pair.
 */
async function reconcileMentionsAndEvents(
  tx: Prisma.TransactionClient,
  commentId: string,
  taskId: number,
  previousIds: string[],
  newIds: string[],
): Promise<string[]> {
  const previous = new Set(previousIds);
  // Users whose mention actually fired an event this save (new, or retained past
  // the debounce window) — the caller turns these into notifications.
  const fired: string[] = [];

  // Update the current-mention set to exactly newIds.
  if (newIds.length === 0) {
    await tx.commentMention.deleteMany({ where: { commentId } });
  } else {
    await tx.commentMention.deleteMany({ where: { commentId, userId: { notIn: newIds } } });
    await tx.commentMention.createMany({
      data: newIds.map((userId) => ({ commentId, userId })),
      skipDuplicates: true,
    });
  }

  const cutoff = new Date(Date.now() - MENTION_EVENT_DEBOUNCE_MINUTES * 60 * 1000);
  for (const userId of newIds) {
    if (!previous.has(userId)) {
      // Brand-new mention → always an event.
      await tx.mentionEvent.create({ data: { userId, taskId, commentId } });
      fired.push(userId);
      continue;
    }
    // Retained mention → only if the debounce window has elapsed.
    const last = await tx.mentionEvent.findFirst({
      where: { userId, commentId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (!last || last.createdAt <= cutoff) {
      await tx.mentionEvent.create({ data: { userId, taskId, commentId } });
      fired.push(userId);
    }
  }
  return fired;
}

export async function createComment(
  actor: Actor,
  taskId: number,
  body: string,
): Promise<TaskDetailDto> {
  await assertTaskExists(taskId);
  const clean = prepareBody(body);
  const mentionIds = await activeUserIds(extractMentionUserIds(clean));

  let commentId = '';
  let fired: string[] = [];
  await prisma.$transaction(async (tx) => {
    const comment = await tx.comment.create({
      data: { taskId, authorId: actor.id, body: clean },
      select: { id: true },
    });
    commentId = comment.id;
    // History: a comment was added (the text itself is never stored in history).
    await recordHistory(tx, {
      taskId,
      userId: actor.id,
      field: TASK_HISTORY_FIELDS.comment,
      changeType: 'added',
    });
    fired = await reconcileMentionsAndEvents(tx, comment.id, taskId, [], mentionIds);
  });

  // Notifications (+ any "also email me" emails) are a post-commit side effect.
  await createMentionNotifications(taskId, commentId, fired, actor.id);
  return getTaskDetail(taskId);
}

export async function updateComment(
  actor: Actor,
  commentId: string,
  body: string,
): Promise<TaskDetailDto> {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, authorId: true, taskId: true },
  });
  if (!comment) throw HttpError.notFound('Comment not found');
  if (comment.authorId !== actor.id) {
    throw HttpError.forbidden('Only the comment author can edit this comment');
  }

  const clean = prepareBody(body);
  const mentionIds = await activeUserIds(extractMentionUserIds(clean));

  let fired: string[] = [];
  await prisma.$transaction(async (tx) => {
    const prevRows = await tx.commentMention.findMany({
      where: { commentId },
      select: { userId: true },
    });
    // Editing updates the displayed timestamp (editedAt) and flips "edited" on.
    await tx.comment.update({
      where: { id: commentId },
      data: { body: clean, editedAt: new Date() },
    });
    // History: a comment was edited (record only that it happened, not the text).
    await recordHistory(tx, {
      taskId: comment.taskId,
      userId: actor.id,
      field: TASK_HISTORY_FIELDS.comment,
      changeType: 'updated',
    });
    fired = await reconcileMentionsAndEvents(
      tx,
      commentId,
      comment.taskId,
      prevRows.map((r) => r.userId),
      mentionIds,
    );
  });

  await createMentionNotifications(comment.taskId, commentId, fired, actor.id);
  return getTaskDetail(comment.taskId);
}

export async function deleteComment(actor: Actor, commentId: string): Promise<TaskDetailDto> {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      authorId: true,
      taskId: true,
      attachments: { select: { storageKey: true } },
    },
  });
  if (!comment) throw HttpError.notFound('Comment not found');
  if (comment.authorId !== actor.id) {
    throw HttpError.forbidden('Only the comment author can delete this comment');
  }

  // Remove the comment's attachment objects, then delete the row (cascades the
  // attachment/mention/event rows). TaskHistory keys off the task, not the
  // comment, so recording the deletion alongside the row delete is safe.
  const storage = getStorage();
  for (const a of comment.attachments) {
    try {
      await storage.deleteObject(a.storageKey);
    } catch (err) {
      console.error('Failed to delete comment attachment object', a.storageKey, err);
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.comment.delete({ where: { id: commentId } });
    // History: a comment was removed.
    await recordHistory(tx, {
      taskId: comment.taskId,
      userId: actor.id,
      field: TASK_HISTORY_FIELDS.comment,
      changeType: 'removed',
    });
  });
  return getTaskDetail(comment.taskId);
}
