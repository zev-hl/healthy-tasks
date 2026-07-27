import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import {
  deleteAttachmentController,
  downloadAttachmentController,
} from '../controllers/attachments.controller.js';

// Attachment routes (Phase 4) shared by task- and comment-level attachments.
// Download is available to any authenticated user; delete is restricted to the
// uploader, an org-superior, or an Admin (enforced in the service).
export const attachmentsRouter = Router();

attachmentsRouter.use(requireAuth);

attachmentsRouter.get('/:id/download', asyncHandler(downloadAttachmentController));
attachmentsRouter.delete('/:id', asyncHandler(deleteAttachmentController));
