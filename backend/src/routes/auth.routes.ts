import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { loginSchema, forgotPasswordSchema, resetPasswordSchema } from '../validation/schemas.js';
import {
  loginController,
  logoutController,
  meController,
  forgotPasswordController,
  resetPasswordController,
} from '../controllers/auth.controller.js';

export const authRouter = Router();

authRouter.post('/login', validateBody(loginSchema), asyncHandler(loginController));
authRouter.post('/logout', asyncHandler(logoutController));
authRouter.get('/me', requireAuth, asyncHandler(meController));

authRouter.post(
  '/forgot-password',
  validateBody(forgotPasswordSchema),
  asyncHandler(forgotPasswordController),
);
authRouter.post(
  '/reset-password',
  validateBody(resetPasswordSchema),
  asyncHandler(resetPasswordController),
);
