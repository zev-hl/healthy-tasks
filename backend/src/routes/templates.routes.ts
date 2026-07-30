import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  applyToFutureSchema,
  createTemplateSchema,
  instantiateTemplateSchema,
  materializeGhostSchema,
  updateTemplateSchema,
} from '../validation/schemas.js';
import {
  applyToFutureController,
  createTemplateController,
  deleteTemplateController,
  getAllGhostsController,
  getTemplateController,
  getTemplateGhostsController,
  instantiateTemplateController,
  listFutureOccurrencesController,
  listTemplatesController,
  materializeGhostController,
  updateTemplateController,
} from '../controllers/templates.controller.js';

// Task templates are an Admin/Manager feature end-to-end (Members have no access
// to template management, per Phase 11). Auth first, then the role gate applies
// to the whole router.
export const templatesRouter = Router();

templatesRouter.use(requireAuth);
templatesRouter.use(requireRole('Admin', 'Manager'));

// Literal paths must precede `/:id`.
templatesRouter.get('/', asyncHandler(listTemplatesController));
templatesRouter.post('/', validateBody(createTemplateSchema), asyncHandler(createTemplateController));
// Computed ghost previews across every active fixed-schedule template (Gantt/Calendar).
templatesRouter.get('/ghosts', asyncHandler(getAllGhostsController));

templatesRouter.get('/:id', asyncHandler(getTemplateController));
templatesRouter.patch('/:id', validateBody(updateTemplateSchema), asyncHandler(updateTemplateController));
templatesRouter.delete('/:id', asyncHandler(deleteTemplateController));

// This template's ghost previews, and its already-materialized future instances.
templatesRouter.get('/:id/ghosts', asyncHandler(getTemplateGhostsController));
templatesRouter.get('/:id/future', asyncHandler(listFutureOccurrencesController));

// Manual instantiation, ghost click-through materialization, and the
// "this and following" re-sync of already-materialized future instances.
templatesRouter.post(
  '/:id/instantiate',
  validateBody(instantiateTemplateSchema),
  asyncHandler(instantiateTemplateController),
);
templatesRouter.post(
  '/:id/materialize',
  validateBody(materializeGhostSchema),
  asyncHandler(materializeGhostController),
);
templatesRouter.post(
  '/:id/apply-to-future',
  validateBody(applyToFutureSchema),
  asyncHandler(applyToFutureController),
);
