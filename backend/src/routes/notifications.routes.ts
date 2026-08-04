import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { updateNotificationPreferencesSchema } from '../validation/schemas.js';
import {
  getNotificationPreferencesController,
  listNotificationsController,
  markNotificationReadController,
  markNotificationUnreadController,
  unreadCountController,
  updateNotificationPreferencesController,
} from '../controllers/notifications.controller.js';

// Every user reads/writes only their own notifications (keyed off req.user.id).
export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

// Literal paths declared before the `/:id/*` routes.
notificationsRouter.get('/', asyncHandler(listNotificationsController));
notificationsRouter.get('/unread-count', asyncHandler(unreadCountController));
notificationsRouter.get('/preferences', asyncHandler(getNotificationPreferencesController));
notificationsRouter.put(
  '/preferences',
  validateBody(updateNotificationPreferencesSchema),
  asyncHandler(updateNotificationPreferencesController),
);

notificationsRouter.post('/:id/read', asyncHandler(markNotificationReadController));
notificationsRouter.post('/:id/unread', asyncHandler(markNotificationUnreadController));
