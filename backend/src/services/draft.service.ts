import { randomUUID } from 'node:crypto';
import { DRAFT_MAX_FILES, type DraftDto, TASK_HISTORY_FIELDS } from '@healthy-tasks/shared';
import { prisma } from '../db/prisma.js';
import { getStorage } from '../storage/index.js';
import { HttpError } from '../utils/http-error.js';
import { sanitizeRichText } from '../utils/rich-text.js';
import { computeTaskAccess, type Actor } from './access-control.service.js';
import { assertValidUpload, safeName } from './attachment.service.js';
import { recordHistory } from './task-history.service.js';

/**
 * Drafts (Nov 2026 plan, I1), like Lipa's Planning page: ideas one person keeps
 * — a title, notes and files — that notify no one and start no workflow. Only
 * the owner sees them. "Make task" turns one into a task or project: the task
 * is made on the usual New task page (with its required fields), then
 * `finishDraft` moves the draft's files onto it and removes the draft.
 */

type DraftRow = Awaited<ReturnType<typeof loadOwn>>;

function toDto(d: DraftRow): DraftDto {
  return {
    id: d.id,
    title: d.title,
    notes: d.notes,
    files: d.files.map((f) => ({
      id: f.id,
      filename: f.filename,
      contentType: f.contentType,
      size: f.size,
      createdAt: f.createdAt.toISOString(),
    })),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

async function loadOwn(actor: Actor, id: string) {
  const d = await prisma.draft.findUnique({
    where: { id },
    include: { files: { orderBy: { createdAt: 'asc' } } },
  });
  // Someone else's draft is indistinguishable from a missing one.
  if (!d || d.ownerId !== actor.id) throw HttpError.notFound('Draft not found');
  return d;
}

const cleanTitle = (t: string) => {
  const title = t.trim().slice(0, 300);
  if (!title) throw HttpError.badRequest('Give the draft a title');
  return title;
};
const cleanNotes = (n: string | null | undefined) => {
  const html = n ? sanitizeRichText(n) : '';
  return html.replace(/<[^>]*>/g, '').trim() ? html : null;
};

export async function listDrafts(actor: Actor): Promise<DraftDto[]> {
  const rows = await prisma.draft.findMany({
    where: { ownerId: actor.id },
    include: { files: { orderBy: { createdAt: 'asc' } } },
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map(toDto);
}

export async function createDraft(
  actor: Actor,
  input: { title: string; notes?: string | null },
): Promise<DraftDto> {
  const d = await prisma.draft.create({
    data: { ownerId: actor.id, title: cleanTitle(input.title), notes: cleanNotes(input.notes) },
    include: { files: true },
  });
  return toDto(d);
}

export async function updateDraft(
  actor: Actor,
  id: string,
  input: { title?: string; notes?: string | null },
): Promise<DraftDto> {
  await loadOwn(actor, id);
  await prisma.draft.update({
    where: { id },
    data: {
      ...(input.title !== undefined && { title: cleanTitle(input.title) }),
      ...(input.notes !== undefined && { notes: cleanNotes(input.notes) }),
    },
  });
  return toDto(await loadOwn(actor, id));
}

async function removeObjects(keys: string[]): Promise<void> {
  for (const key of keys) {
    await getStorage()
      .deleteObject(key)
      .catch((err) => console.error('draft file cleanup failed', key, err));
  }
}

export async function deleteDraft(actor: Actor, id: string): Promise<void> {
  const d = await loadOwn(actor, id);
  await prisma.draft.delete({ where: { id } });
  await removeObjects(d.files.map((f) => f.storageKey));
}

export async function presignDraftUpload(
  actor: Actor,
  id: string,
  input: { filename: string; contentType: string; size: number },
): Promise<{ uploadUrl: string; storageKey: string }> {
  const d = await loadOwn(actor, id);
  if (d.files.length >= DRAFT_MAX_FILES) {
    throw HttpError.badRequest(`A draft can keep at most ${DRAFT_MAX_FILES} files`);
  }
  assertValidUpload(input.contentType, input.size);
  const storageKey = `drafts/${id}/${randomUUID()}/${safeName(input.filename)}`;
  const uploadUrl = await getStorage().presignUpload(storageKey, input.contentType, input.size);
  return { uploadUrl, storageKey };
}

export async function addDraftFile(
  actor: Actor,
  id: string,
  input: { filename: string; contentType: string; size: number; storageKey: string },
): Promise<DraftDto> {
  const d = await loadOwn(actor, id);
  if (!input.storageKey.startsWith(`drafts/${id}/`)) {
    throw HttpError.badRequest('storageKey does not belong to this draft');
  }
  if (d.files.length >= DRAFT_MAX_FILES) {
    throw HttpError.badRequest(`A draft can keep at most ${DRAFT_MAX_FILES} files`);
  }
  const head = await getStorage().headObject(input.storageKey);
  if (!head) throw HttpError.badRequest(`"${input.filename}" was not uploaded; please try again`);
  const contentType = head.contentType || input.contentType;
  assertValidUpload(contentType, head.size);
  await prisma.draftFile.create({
    data: {
      draftId: id,
      filename: input.filename.slice(0, 255),
      contentType,
      size: head.size,
      storageKey: input.storageKey,
    },
  });
  return toDto(await loadOwn(actor, id));
}

export async function removeDraftFile(actor: Actor, id: string, fileId: string): Promise<DraftDto> {
  const d = await loadOwn(actor, id);
  const f = d.files.find((x) => x.id === fileId);
  if (!f) throw HttpError.notFound('File not found');
  await prisma.draftFile.delete({ where: { id: fileId } });
  await removeObjects([f.storageKey]);
  return toDto(await loadOwn(actor, id));
}

export async function draftFileUrl(actor: Actor, id: string, fileId: string): Promise<string> {
  const d = await loadOwn(actor, id);
  const f = d.files.find((x) => x.id === fileId);
  if (!f) throw HttpError.notFound('File not found');
  return getStorage().presignDownload(f.storageKey, f.filename);
}

/**
 * "Make task": the task has just been made from this draft (on the New task
 * page). Its files become the task's attachments, and the draft goes.
 */
export async function finishDraft(actor: Actor, id: string, taskId: number): Promise<void> {
  const d = await loadOwn(actor, id);
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, assigneeId: true, isPrivate: true, creatorId: true },
  });
  if (!task || (await computeTaskAccess(actor, task)) !== 'full') {
    throw HttpError.notFound('Task not found');
  }
  await prisma.$transaction(async (tx) => {
    for (const f of d.files) {
      await tx.attachment.create({
        data: {
          filename: f.filename,
          contentType: f.contentType,
          size: f.size,
          storageKey: f.storageKey,
          uploadedById: actor.id,
          taskId,
        },
      });
      await recordHistory(tx, {
        taskId,
        userId: actor.id,
        field: TASK_HISTORY_FIELDS.attachment,
        changeType: 'added',
        detail: f.filename,
      });
    }
    // The files now belong to the task; the draft row (and its file rows) go.
    await tx.draftFile.deleteMany({ where: { draftId: id } });
    await tx.draft.delete({ where: { id } });
  });
}
