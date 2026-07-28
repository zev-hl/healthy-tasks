import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { screenStateSchema } from '../validation/schemas.js';
import {
  getPreferenceController,
  putPreferenceController,
} from '../controllers/preferences.controller.js';

// Per-user saved screen state (filters/sort/columns/pagination). Each user only
// ever reads/writes their own state (keyed off req.user.id in the controller).
export const preferencesRouter = Router();

preferencesRouter.use(requireAuth);

preferencesRouter.get('/:screen', asyncHandler(getPreferenceController));
preferencesRouter.put('/:screen', validateBody(screenStateSchema), asyncHandler(putPreferenceController));
