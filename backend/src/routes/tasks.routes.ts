import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createTaskSchema,
  updateTaskSchema,
  setParentSchema,
  dependencySchema,
  presignAttachmentSchema,
  confirmAttachmentSchema,
  createCommentSchema,
} from '../validation/schemas.js';
import {
  createTaskController,
  getTaskController,
  listTasksController,
  listTagsController,
  updateTaskController,
  searchTasksController,
  setParentController,
  clearParentController,
  addDependencyController,
  removeDependencyController,
  deleteTaskController,
} from '../controllers/tasks.controller.js';
import {
  presignTaskAttachmentController,
  createTaskAttachmentController,
} from '../controllers/attachments.controller.js';
import { createCommentController } from '../controllers/comments.controller.js';

// All task routes require authentication; any authenticated user may create,
// read, list, edit, and manage relationships of tasks (no per-user restriction).
export const tasksRouter = Router();

tasksRouter.use(requireAuth);

tasksRouter.get('/', asyncHandler(listTasksController));
tasksRouter.post('/', validateBody(createTaskSchema), asyncHandler(createTaskController));

// `/search` and `/tags` must be declared before `/:id` so they aren't captured as an id.
tasksRouter.get('/search', asyncHandler(searchTasksController));
tasksRouter.get('/tags', asyncHandler(listTagsController));

tasksRouter.get('/:id', asyncHandler(getTaskController));
tasksRouter.patch('/:id', validateBody(updateTaskSchema), asyncHandler(updateTaskController));
// Deleting a task is Admin-only (also enforced in the service).
tasksRouter.delete('/:id', asyncHandler(deleteTaskController));

// Parent / Child
tasksRouter.put('/:id/parent', validateBody(setParentSchema), asyncHandler(setParentController));
tasksRouter.delete('/:id/parent', asyncHandler(clearParentController));

// Dependencies (Blocks / Is Blocked By)
tasksRouter.post(
  '/:id/dependencies',
  validateBody(dependencySchema),
  asyncHandler(addDependencyController),
);
tasksRouter.delete(
  '/:id/dependencies',
  validateBody(dependencySchema),
  asyncHandler(removeDependencyController),
);

// Attachments (Phase 4): pre-sign an upload, then confirm the metadata.
tasksRouter.post(
  '/:id/attachments/presign',
  validateBody(presignAttachmentSchema),
  asyncHandler(presignTaskAttachmentController),
);
tasksRouter.post(
  '/:id/attachments',
  validateBody(confirmAttachmentSchema),
  asyncHandler(createTaskAttachmentController),
);

// Comments (Phase 4): create a comment on the task.
tasksRouter.post(
  '/:id/comments',
  validateBody(createCommentSchema),
  asyncHandler(createCommentController),
);
