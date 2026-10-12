import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  saveTimeDaySchema,
  setTimeDayCompletedSchema,
  timeReviewSchema,
} from '../validation/schemas.js';
import {
  listDaysController,
  relatedTasksController,
  reviewPeopleController,
  saveDayController,
  setDayCompletedController,
  timeReviewController,
} from '../controllers/time.controller.js';

// Time logging (Department Duties). Everyone logs their own time; reading
// someone else's is limited to their supervisors and Admins (checked in the
// service). Time Review is a supervisor screen.
export const timeRouter = Router();

timeRouter.use(requireAuth);

timeRouter.get('/days', asyncHandler(listDaysController));
timeRouter.put('/days/:date', validateBody(saveTimeDaySchema), asyncHandler(saveDayController));
timeRouter.post(
  '/days/:date/complete',
  validateBody(setTimeDayCompletedSchema),
  asyncHandler(setDayCompletedController),
);
timeRouter.get('/related', asyncHandler(relatedTasksController));

timeRouter.get(
  '/review/people',
  requireRole('Admin', 'Manager'),
  asyncHandler(reviewPeopleController),
);
timeRouter.post(
  '/review',
  requireRole('Admin', 'Manager'),
  validateBody(timeReviewSchema),
  asyncHandler(timeReviewController),
);
