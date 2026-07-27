import type { Attachment, User } from '@prisma/client';
import type { AttachmentDto } from '@healthy-tasks/shared';
import { toUserRef } from './user.mapper.js';

/** The Prisma `include` used wherever an AttachmentDto is returned. */
export const attachmentInclude = {
  uploadedBy: { select: { id: true, email: true, title: true } },
} as const;

export type AttachmentWithUploader = Attachment & {
  uploadedBy: Pick<User, 'id' | 'email' | 'title'>;
};

export function toAttachmentDto(a: AttachmentWithUploader): AttachmentDto {
  return {
    id: a.id,
    filename: a.filename,
    contentType: a.contentType,
    size: a.size,
    uploadedBy: toUserRef(a.uploadedBy),
    createdAt: a.createdAt.toISOString(),
    taskId: a.taskId,
    commentId: a.commentId,
  };
}
