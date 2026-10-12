import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import {
  createDepartmentSchema,
  createDutySchema,
  updateDepartmentSchema,
  updateDutySchema,
} from '../validation/schemas.js';
import {
  archiveDepartmentController,
  archiveDutyController,
  createDepartmentController,
  createDutyController,
  deleteDepartmentController,
  deleteDutyController,
  dutyHoldingsController,
  listDepartmentsController,
  restoreDepartmentController,
  restoreDutyController,
  updateDepartmentController,
  updateDutyController,
} from '../controllers/departments.controller.js';

// Departments & Duties (Department Duties). Every signed-in user can READ the
// catalog and who holds which duty — the task and template pickers need both.
// Only Admins change the catalog.
export const departmentsRouter = Router();

departmentsRouter.use(requireAuth);

departmentsRouter.get('/', asyncHandler(listDepartmentsController));
departmentsRouter.get('/holdings', asyncHandler(dutyHoldingsController));

departmentsRouter.post(
  '/',
  requireAdmin,
  validateBody(createDepartmentSchema),
  asyncHandler(createDepartmentController),
);

// Duty routes (literal `/duties` must precede `/:id`).
departmentsRouter.patch(
  '/duties/:id',
  requireAdmin,
  validateBody(updateDutySchema),
  asyncHandler(updateDutyController),
);
departmentsRouter.post('/duties/:id/archive', requireAdmin, asyncHandler(archiveDutyController));
departmentsRouter.post('/duties/:id/restore', requireAdmin, asyncHandler(restoreDutyController));
departmentsRouter.delete('/duties/:id', requireAdmin, asyncHandler(deleteDutyController));

departmentsRouter.patch(
  '/:id',
  requireAdmin,
  validateBody(updateDepartmentSchema),
  asyncHandler(updateDepartmentController),
);
departmentsRouter.post('/:id/archive', requireAdmin, asyncHandler(archiveDepartmentController));
departmentsRouter.post('/:id/restore', requireAdmin, asyncHandler(restoreDepartmentController));
departmentsRouter.delete('/:id', requireAdmin, asyncHandler(deleteDepartmentController));
departmentsRouter.post(
  '/:id/duties',
  requireAdmin,
  validateBody(createDutySchema),
  asyncHandler(createDutyController),
);
