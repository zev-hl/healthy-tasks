import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import {
  loginSchema,
  googleLoginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../validation/schemas.js';
import {
  loginController,
  googleLoginController,
  logoutController,
  meController,
  forgotPasswordController,
  resetPasswordController,
} from '../controllers/auth.controller.js';

export const authRouter = Router();

authRouter.post('/login', validateBody(loginSchema), asyncHandler(loginController));
// Sign in with Google. Sits BESIDE /login, not instead of it — both ways in are
// supported, and either issues the same session token.
authRouter.post('/google', validateBody(googleLoginSchema), asyncHandler(googleLoginController));
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
