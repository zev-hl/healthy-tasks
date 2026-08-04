import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { updateAppSettingsSchema } from '../validation/schemas.js';
import {
  getAppSettingsController,
  updateAppSettingsController,
} from '../controllers/app-settings.controller.js';

// Global, Admin-controlled application settings. Anyone authenticated may read
// them (some client surfaces display the value); only Admins may change them.
export const settingsRouter = Router();

settingsRouter.use(requireAuth);

settingsRouter.get('/', asyncHandler(getAppSettingsController));
settingsRouter.put(
  '/',
  requireAdmin,
  validateBody(updateAppSettingsSchema),
  asyncHandler(updateAppSettingsController),
);
