import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  createGoalSchema,
  goalMineExportSchema,
  goalTeamExportSchema,
  goalTeamSchema,
  goalVersionSchema,
  rejectGoalSchema,
  resolveGoalSchema,
  updateGoalProgressSchema,
  updateGoalSchema,
} from '../validation/schemas.js';
import {
  approveGoalController,
  createGoalController,
  deleteGoalController,
  exportMyGoalsController,
  exportTeamGoalsController,
  finalizeGoalController,
  getGoalController,
  listMyGoalsController,
  listTeamGoalsController,
  rejectGoalController,
  resolveGoalController,
  submitGoalController,
  updateGoalController,
  updateGoalProgressController,
} from '../controllers/goals.controller.js';

// SMART Goals (Phase 12). Any authenticated user manages their own goals (My
// Goals); Team Goals is gated to Admin/Manager. Per-goal authorization (owner vs
// supervisor vs admin) is enforced in the service on top of these route guards.
export const goalsRouter = Router();

goalsRouter.use(requireAuth);

// Literal paths must precede `/:id`.
goalsRouter.get('/mine', asyncHandler(listMyGoalsController));
goalsRouter.post(
  '/mine/export',
  validateBody(goalMineExportSchema),
  asyncHandler(exportMyGoalsController),
);
goalsRouter.post(
  '/team',
  requireRole('Admin', 'Manager'),
  validateBody(goalTeamSchema),
  asyncHandler(listTeamGoalsController),
);
goalsRouter.post(
  '/team/export',
  requireRole('Admin', 'Manager'),
  validateBody(goalTeamExportSchema),
  asyncHandler(exportTeamGoalsController),
);
goalsRouter.post('/', validateBody(createGoalSchema), asyncHandler(createGoalController));

goalsRouter.get('/:id', asyncHandler(getGoalController));
goalsRouter.patch('/:id', validateBody(updateGoalSchema), asyncHandler(updateGoalController));
goalsRouter.delete('/:id', asyncHandler(deleteGoalController));

// Employee progress updates while the goal is Active.
goalsRouter.patch(
  '/:id/progress',
  validateBody(updateGoalProgressSchema),
  asyncHandler(updateGoalProgressController),
);

// Lifecycle transitions. The no-payload ones still validate a body so the
// optimistic-concurrency token (expectedUpdatedAt) survives validation.
goalsRouter.post('/:id/submit', validateBody(goalVersionSchema), asyncHandler(submitGoalController));
goalsRouter.post('/:id/approve', validateBody(goalVersionSchema), asyncHandler(approveGoalController));
goalsRouter.post('/:id/reject', validateBody(rejectGoalSchema), asyncHandler(rejectGoalController));
goalsRouter.post('/:id/finalize', validateBody(goalVersionSchema), asyncHandler(finalizeGoalController));
goalsRouter.post('/:id/resolve', validateBody(resolveGoalSchema), asyncHandler(resolveGoalController));
