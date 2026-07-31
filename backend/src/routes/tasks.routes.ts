import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createTaskSchema,
  updateTaskSchema,
  duplicateTaskSchema,
  setTaskPrivateSchema,
  setParentSchema,
  dependencySchema,
  presignAttachmentSchema,
  confirmAttachmentSchema,
  createCommentSchema,
  taskSearchSchema,
  taskDashboardSchema,
} from '../validation/schemas.js';
import {
  createTaskController,
  getTaskController,
  listTasksController,
  listTagsController,
  updateTaskController,
  getTaskHistoryController,
  reviewedController,
  recallReviewController,
  searchTasksController,
  queryTasksController,
  dashboardController,
  exportTasksController,
  setParentController,
  clearParentController,
  addDependencyController,
  removeDependencyController,
  deleteTaskController,
  duplicateTaskController,
  setTaskPrivateController,
  mentionCandidatesController,
  reviewerCandidatesController,
} from '../controllers/tasks.controller.js';
import {
  presignTaskAttachmentController,
  createTaskAttachmentController,
} from '../controllers/attachments.controller.js';
import { createCommentController } from '../controllers/comments.controller.js';
import {
  addTaskReminderController,
  listTaskRemindersController,
} from '../controllers/reminders.controller.js';
import {
  clearTaskRecurrenceController,
  materializeTaskOccurrenceController,
  setTaskRecurrenceController,
  taskGhostsController,
} from '../controllers/task-recurrence.controller.js';
import { addReminderSchema, materializeGhostSchema, setTaskRecurrenceSchema } from '../validation/schemas.js';

// All task routes require authentication; any authenticated user may create,
// read, list, edit, and manage relationships of tasks (no per-user restriction).
export const tasksRouter = Router();

tasksRouter.use(requireAuth);

tasksRouter.get('/', asyncHandler(listTasksController));
tasksRouter.post('/', validateBody(createTaskSchema), asyncHandler(createTaskController));

// `/search`, `/tags`, `/query`, `/export`, `/ghosts` must be declared before `/:id`.
tasksRouter.get('/search', asyncHandler(searchTasksController));
tasksRouter.get('/tags', asyncHandler(listTagsController));
// Phase 11: computed ghost previews of recurring tasks (Gantt/Calendar).
tasksRouter.get('/ghosts', asyncHandler(taskGhostsController));
// Task Search screen (Phase 6): POST bodies carry filters/sort/pagination.
tasksRouter.post('/query', validateBody(taskSearchSchema), asyncHandler(queryTasksController));
tasksRouter.post('/export', validateBody(taskSearchSchema), asyncHandler(exportTasksController));
// Task Search dashboard (Phase 7): counts for the current filtered result set.
tasksRouter.post('/dashboard', validateBody(taskDashboardSchema), asyncHandler(dashboardController));

tasksRouter.get('/:id', asyncHandler(getTaskController));
tasksRouter.get('/:id/history', asyncHandler(getTaskHistoryController));
tasksRouter.patch('/:id', validateBody(updateTaskSchema), asyncHandler(updateTaskController));
// Phase 13 access control: toggle Private, and the Private-aware candidate pools.
tasksRouter.patch(
  '/:id/private',
  validateBody(setTaskPrivateSchema),
  asyncHandler(setTaskPrivateController),
);
tasksRouter.get('/:id/mention-candidates', asyncHandler(mentionCandidatesController));
tasksRouter.get('/:id/reviewer-candidates', asyncHandler(reviewerCandidatesController));
// Review workflow (Phase 10): leave Review via the Reviewed / Recall actions.
tasksRouter.post('/:id/reviewed', asyncHandler(reviewedController));
tasksRouter.post('/:id/recall-review', asyncHandler(recallReviewController));
// Deleting a task is Admin-only (also enforced in the service).
tasksRouter.delete('/:id', asyncHandler(deleteTaskController));
// Duplicate a task, optionally its whole sub-tree.
tasksRouter.post('/:id/duplicate', validateBody(duplicateTaskSchema), asyncHandler(duplicateTaskController));

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

// Reminders (Phase 8): the current user's personal reminders on this task.
tasksRouter.get('/:id/reminders', asyncHandler(listTaskRemindersController));
tasksRouter.post(
  '/:id/reminders',
  validateBody(addReminderSchema),
  asyncHandler(addTaskReminderController),
);

// Recurrence (Phase 11): set/clear a task's own recurrence, and materialize one
// of its ghost occurrences on click-through.
tasksRouter.put(
  '/:id/recurrence',
  validateBody(setTaskRecurrenceSchema),
  asyncHandler(setTaskRecurrenceController),
);
tasksRouter.delete('/:id/recurrence', asyncHandler(clearTaskRecurrenceController));
tasksRouter.post(
  '/:id/recurrence/materialize',
  validateBody(materializeGhostSchema),
  asyncHandler(materializeTaskOccurrenceController),
);
