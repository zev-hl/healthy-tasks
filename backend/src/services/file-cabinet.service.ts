import type { Prisma } from '@prisma/client';
import type { FileCabinetItemDto, FileCabinetPageDto, FileKind } from '@healthy-tasks/shared';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { endOfBusinessDay, fromBusinessDate } from '../utils/business-time.js';
import { buildTaskAccessWhere, getTaskAccessScope, type Actor } from './access-control.service.js';
import { attachmentInclude, toAttachmentDto } from './attachment.mapper.js';

/**
 * The file cabinet (Nov 2026 plan, I3): every file on a task or in a comment
 * that the actor may see — the same rule as the task itself (every non-private
 * task, plus private ones they have full access to; Admins all) — newest first,
 * with filters. Soft-deleted tasks' files are left out. Downloads go through the
 * existing `/api/attachments/:id/download`, which checks the task again.
 */

const PAGE = 50;

export interface FileCabinetFilters {
  q?: string;
  kind?: FileKind;
  departmentId?: string;
  uploadedById?: string;
  from?: string;
  to?: string;
  cursor?: string;
}

/** What each kind means, by the file's type (and recordings by how they were made). */
function kindWhere(kind: FileKind): Prisma.AttachmentWhereInput {
  const notRecording = { recording: null };
  switch (kind) {
    case 'recording':
      return { recording: { not: null } };
    case 'image':
      return { ...notRecording, contentType: { startsWith: 'image/' } };
    case 'video':
      return { ...notRecording, contentType: { startsWith: 'video/' } };
    case 'audio':
      return { ...notRecording, contentType: { startsWith: 'audio/' } };
    case 'document':
      return {
        ...notRecording,
        OR: [
          { contentType: { startsWith: 'text/' } },
          { contentType: 'application/pdf' },
          { contentType: { contains: 'word' } },
          { contentType: { contains: 'excel' } },
          { contentType: { contains: 'spreadsheet' } },
          { contentType: { contains: 'presentation' } },
          { contentType: { contains: 'powerpoint' } },
          { contentType: { contains: 'opendocument' } },
          { contentType: 'application/rtf' },
          { contentType: 'text/csv' },
        ],
      };
    case 'other':
      return {
        AND: [
          notRecording,
          ...(['image', 'video', 'audio', 'document'] as const).map((k) => ({ NOT: kindWhere(k) })),
        ],
      };
  }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** "createdAt|id" of the last row, so the next page starts after it. */
const encodeCursor = (a: { createdAt: Date; id: string }) =>
  Buffer.from(`${a.createdAt.toISOString()}|${a.id}`).toString('base64url');
function decodeCursor(c: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(c, 'base64url').toString().split('|');
  const createdAt = new Date(iso ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) throw HttpError.badRequest('Bad cursor');
  return { createdAt, id };
}

export async function listFiles(actor: Actor, f: FileCabinetFilters): Promise<FileCabinetPageDto> {
  const scope = await getTaskAccessScope(actor);
  const access = buildTaskAccessWhere(scope, true);
  const taskWhere: Prisma.TaskWhereInput = {
    deletedAt: null,
    ...(access ?? {}),
    ...(f.departmentId && { duty: { departmentId: f.departmentId } }),
  };

  const and: Prisma.AttachmentWhereInput[] = [
    { OR: [{ task: taskWhere }, { comment: { task: taskWhere } }] },
  ];
  const q = f.q?.trim();
  if (q) {
    and.push({
      OR: [
        { filename: { contains: q, mode: 'insensitive' } },
        { transcript: { contains: q, mode: 'insensitive' } },
        { task: { name: { contains: q, mode: 'insensitive' } } },
        { comment: { task: { name: { contains: q, mode: 'insensitive' } } } },
      ],
    });
  }
  if (f.kind) and.push(kindWhere(f.kind));
  if (f.uploadedById) and.push({ uploadedById: f.uploadedById });
  if (f.from) {
    if (!YMD.test(f.from)) throw HttpError.badRequest('from must be YYYY-MM-DD');
    and.push({ createdAt: { gte: fromBusinessDate(f.from, 0) } });
  }
  if (f.to) {
    if (!YMD.test(f.to)) throw HttpError.badRequest('to must be YYYY-MM-DD');
    and.push({ createdAt: { lte: endOfBusinessDay(f.to) } });
  }
  if (f.cursor) {
    const c = decodeCursor(f.cursor);
    and.push({
      OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }],
    });
  }

  const taskSelect = {
    id: true,
    name: true,
    isPrivate: true,
    duty: { select: { department: { select: { id: true, name: true, color: true } } } },
  } as const;
  const rows = await prisma.attachment.findMany({
    where: { AND: and },
    include: {
      ...attachmentInclude,
      task: { select: taskSelect },
      comment: { select: { task: { select: taskSelect } } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE + 1,
  });

  const page = rows.slice(0, PAGE);
  const files: FileCabinetItemDto[] = page.flatMap((a) => {
    const task = a.task ?? a.comment?.task;
    if (!task) return [];
    return [
      {
        ...toAttachmentDto(a),
        task: { id: task.id, name: task.name, isPrivate: task.isPrivate },
        on: a.task ? ('task' as const) : ('comment' as const),
        department: task.duty?.department ?? null,
      },
    ];
  });
  const last = page[page.length - 1];
  return { files, next: rows.length > PAGE && last ? encodeCursor(last) : null };
}
