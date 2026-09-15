import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { exclusivesStatusController } from '../controllers/exclusives.controller.js';

export const exclusivesRouter = Router();

exclusivesRouter.use(requireAuth);

exclusivesRouter.get('/status', asyncHandler(exclusivesStatusController));
