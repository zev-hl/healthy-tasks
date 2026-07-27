import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import {
  updateCommentSchema,
  presignAttachmentSchema,
  confirmAttachmentSchema,
} from '../validation/schemas.js';
import {
  updateCommentController,
  deleteCommentController,
} from '../controllers/comments.controller.js';
import {
  presignCommentAttachmentController,
  createCommentAttachmentController,
} from '../controllers/attachments.controller.js';

// Comment routes (Phase 4). Editing/deleting a comment and managing its
// attachments are author-only (enforced in the service). Creating a comment is
// under /api/tasks/:id/comments.
export const commentsRouter = Router();

commentsRouter.use(requireAuth);

commentsRouter.patch('/:id', validateBody(updateCommentSchema), asyncHandler(updateCommentController));
commentsRouter.delete('/:id', asyncHandler(deleteCommentController));

commentsRouter.post(
  '/:id/attachments/presign',
  validateBody(presignAttachmentSchema),
  asyncHandler(presignCommentAttachmentController),
);
commentsRouter.post(
  '/:id/attachments',
  validateBody(confirmAttachmentSchema),
  asyncHandler(createCommentAttachmentController),
);
