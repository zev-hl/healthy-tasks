import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { dueDateReportSchema } from '../validation/schemas.js';
import {
  dueDateReportController,
  dueDateReportExportController,
} from '../controllers/reports.controller.js';

// Reports (Phase 13). All routes require auth; results are access-scoped in the
// service (a supervisor naturally sees only their downline's tasks).
export const reportsRouter = Router();

reportsRouter.use(requireAuth);

reportsRouter.post('/due-date', validateBody(dueDateReportSchema), asyncHandler(dueDateReportController));
reportsRouter.post(
  '/due-date/export',
  validateBody(dueDateReportSchema),
  asyncHandler(dueDateReportExportController),
);
