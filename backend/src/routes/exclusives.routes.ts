import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import {
  exclusivesAlertQuerySchema,
  exclusivesGroupQuerySchema,
  exclusivesAlertExportSchema,
  exclusivesGroupCreateSchema,
  exclusivesGroupExportSchema,
  exclusivesGroupUpdateSchema,
  exclusivesLookupSchema,
} from '../validation/schemas.js';
import {
  createExclusivesGroupController,
  deleteExclusivesGroupController,
  exclusivesGroupAlertStatsController,
  exclusivesGroupOptionsController,
  exclusivesStatusController,
  exclusivesSummaryController,
  exportExclusivesAlertsController,
  exportExclusivesGroupController,
  getExclusivesGroupController,
  lookupExclusivesListingsController,
  queryExclusivesAlertsController,
  queryExclusivesGroupsController,
  updateExclusivesGroupController,
} from '../controllers/exclusives.controller.js';

export const exclusivesRouter = Router();

exclusivesRouter.use(requireAuth);

exclusivesRouter.get('/status', asyncHandler(exclusivesStatusController));
exclusivesRouter.get('/summary', asyncHandler(exclusivesSummaryController));

// Literal paths before '/groups/:id', so a future GET '/groups/export' or the
// like can never be swallowed by the id route.
exclusivesRouter.post(
  '/groups/query',
  validateBody(exclusivesGroupQuerySchema),
  asyncHandler(queryExclusivesGroupsController),
);

exclusivesRouter.post(
  '/alerts/query',
  validateBody(exclusivesAlertQuerySchema),
  asyncHandler(queryExclusivesAlertsController),
);

exclusivesRouter.post(
  '/listings/lookup',
  validateBody(exclusivesLookupSchema),
  asyncHandler(lookupExclusivesListingsController),
);

exclusivesRouter.post(
  '/alerts/export',
  validateBody(exclusivesAlertExportSchema),
  asyncHandler(exportExclusivesAlertsController),
);

exclusivesRouter.get('/groups/options', asyncHandler(exclusivesGroupOptionsController));

exclusivesRouter.post(
  '/groups',
  validateBody(exclusivesGroupCreateSchema),
  asyncHandler(createExclusivesGroupController),
);

// Everything with a literal path is declared above; the ':id' routes come last
// so a path like '/groups/query' can never be read as an id.
exclusivesRouter.post(
  '/groups/:id/export',
  validateBody(exclusivesGroupExportSchema),
  asyncHandler(exportExclusivesGroupController),
);
exclusivesRouter.get('/groups/:id/alert-stats', asyncHandler(exclusivesGroupAlertStatsController));
exclusivesRouter.get('/groups/:id', asyncHandler(getExclusivesGroupController));
exclusivesRouter.patch(
  '/groups/:id',
  validateBody(exclusivesGroupUpdateSchema),
  asyncHandler(updateExclusivesGroupController),
);
exclusivesRouter.delete('/groups/:id', asyncHandler(deleteExclusivesGroupController));
