import type { Comment, User } from '@prisma/client';
import type { CommentDto } from '@healthy-tasks/shared';
import { toUserRef } from './user.mapper.js';
import {
  attachmentInclude,
  toAttachmentDto,
  type AttachmentWithUploader,
} from './attachment.mapper.js';

const userRefSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  title: true,
} as const;

/** The Prisma `include` used wherever a CommentDto is returned. */
export const commentInclude = {
  author: { select: userRefSelect },
  attachments: { include: attachmentInclude, orderBy: { createdAt: 'asc' } },
  mentions: { include: { user: { select: userRefSelect } } },
} as const;

type UserRef = Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'title'>;

export type CommentWithRefs = Comment & {
  author: UserRef;
  attachments: AttachmentWithUploader[];
  mentions: { user: UserRef }[];
};

export function toCommentDto(c: CommentWithRefs): CommentDto {
  return {
    id: c.id,
    taskId: c.taskId,
    author: toUserRef(c.author),
    body: c.body,
    createdAt: c.createdAt.toISOString(),
    // Non-null editedAt drives the "edited" indicator; the client shows
    // editedAt ?? createdAt as the timestamp.
    editedAt: c.editedAt?.toISOString() ?? null,
    mentionedUsers: c.mentions.map((m) => toUserRef(m.user)),
    attachments: c.attachments.map(toAttachmentDto),
  };
}
