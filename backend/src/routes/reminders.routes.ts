import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { snoozeReminderSchema } from '../validation/schemas.js';
import {
  markReminderReadController,
  removeReminderController,
  snoozeReminderController,
} from '../controllers/reminders.controller.js';

// Reminders scoped to a single reminder id. Adding/listing reminders for a task
// lives under /api/tasks/:id/reminders (see tasks.routes.ts).
export const remindersRouter = Router();

remindersRouter.use(requireAuth);

remindersRouter.delete('/:id', asyncHandler(removeReminderController));
remindersRouter.post('/:id/read', asyncHandler(markReminderReadController));
remindersRouter.post(
  '/:id/snooze',
  validateBody(snoozeReminderSchema),
  asyncHandler(snoozeReminderController),
);
