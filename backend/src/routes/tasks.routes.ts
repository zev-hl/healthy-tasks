import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createTaskSchema,
  updateTaskSchema,
  setParentSchema,
  dependencySchema,
} from '../validation/schemas.js';
import {
  createTaskController,
  getTaskController,
  listTasksController,
  updateTaskController,
  searchTasksController,
  setParentController,
  clearParentController,
  addDependencyController,
  removeDependencyController,
} from '../controllers/tasks.controller.js';

// All task routes require authentication; any authenticated user may create,
// read, list, edit, and manage relationships of tasks (no per-user restriction).
export const tasksRouter = Router();

tasksRouter.use(requireAuth);

tasksRouter.get('/', asyncHandler(listTasksController));
tasksRouter.post('/', validateBody(createTaskSchema), asyncHandler(createTaskController));

// `/search` must be declared before `/:id` so it isn't captured as an id.
tasksRouter.get('/search', asyncHandler(searchTasksController));

tasksRouter.get('/:id', asyncHandler(getTaskController));
tasksRouter.patch('/:id', validateBody(updateTaskSchema), asyncHandler(updateTaskController));

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
