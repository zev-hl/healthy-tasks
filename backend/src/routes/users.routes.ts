import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  createUserSchema,
  updateUserSchema,
  mergeUsersSchema,
  userSearchSchema,
} from '../validation/schemas.js';
import {
  listUsersController,
  searchUsersController,
  userCountsController,
  userFilterOptionsController,
  listActiveUsersController,
  listSupervisorsController,
  createUserController,
  updateUserController,
  deactivateUserController,
  mergeUsersController,
  adminResetPasswordController,
} from '../controllers/users.controller.js';

export const usersRouter = Router();

// All user routes require authentication.
usersRouter.use(requireAuth);

// Available to any authenticated user (assignee picker). Declared before the
// admin guard below so it is reached without the Admin role.
usersRouter.get('/active', asyncHandler(listActiveUsersController));

// Everything below is admin-only.
usersRouter.use(requireAdmin);

usersRouter.get('/', asyncHandler(listUsersController));
usersRouter.get('/supervisors', asyncHandler(listSupervisorsController));
// Users screen filtered/sorted/paged search (Phase 6). Before `/:id`.
usersRouter.post('/search', validateBody(userSearchSchema), asyncHandler(searchUsersController));
usersRouter.get('/filter-options', asyncHandler(userFilterOptionsController));
usersRouter.get('/counts', asyncHandler(userCountsController));
usersRouter.post('/', validateBody(createUserSchema), asyncHandler(createUserController));
// Merge two accounts. Declared before `/:id` so `merge` isn't captured as an id.
usersRouter.post('/merge', validateBody(mergeUsersSchema), asyncHandler(mergeUsersController));
usersRouter.patch('/:id', validateBody(updateUserSchema), asyncHandler(updateUserController));
usersRouter.post('/:id/deactivate', asyncHandler(deactivateUserController));
usersRouter.post('/:id/reset-password', asyncHandler(adminResetPasswordController));
