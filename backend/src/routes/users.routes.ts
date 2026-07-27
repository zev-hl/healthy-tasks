import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { createUserSchema, updateUserSchema } from '../validation/schemas.js';
import {
  listUsersController,
  listActiveUsersController,
  listSupervisorsController,
  createUserController,
  updateUserController,
  deactivateUserController,
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
usersRouter.post('/', validateBody(createUserSchema), asyncHandler(createUserController));
usersRouter.patch('/:id', validateBody(updateUserSchema), asyncHandler(updateUserController));
usersRouter.post('/:id/deactivate', asyncHandler(deactivateUserController));
usersRouter.post('/:id/reset-password', asyncHandler(adminResetPasswordController));
