import {
  clearDutyVideo,
  dutyVideoUrl,
  presignDutyVideo,
  setDutyVideo,
} from '../services/duty-video.service.js';
import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import {
  confirmAttachmentSchema,
  createDepartmentSchema,
  presignAttachmentSchema,
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
// A duty's video as a file (Nov 2026 plan, I4): an Admin uploads, everyone watches.
departmentsRouter.post(
  '/duties/:id/video/presign',
  requireAdmin,
  validateBody(presignAttachmentSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await presignDutyVideo((req.params as { id: string }).id, req.body));
  }),
);
departmentsRouter.put(
  '/duties/:id/video',
  requireAdmin,
  validateBody(confirmAttachmentSchema),
  asyncHandler(async (req, res) => {
    await setDutyVideo((req.params as { id: string }).id, req.body);
    res.status(204).send();
  }),
);
departmentsRouter.delete(
  '/duties/:id/video',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await clearDutyVideo((req.params as { id: string }).id);
    res.status(204).send();
  }),
);
departmentsRouter.get(
  '/duties/:id/video',
  asyncHandler(async (req, res) => {
    res.json({ url: await dutyVideoUrl((req.params as { id: string }).id) });
  }),
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
