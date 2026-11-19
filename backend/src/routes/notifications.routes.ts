import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import {
  pushSubscriptionSchema,
  pushUnsubscribeSchema,
  updateNotificationPreferencesSchema,
  type PushSubscriptionInput,
} from '../validation/schemas.js';
import {
  pushPublicKey,
  removePushSubscription,
  savePushSubscription,
} from '../services/push.service.js';
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

// Browser push (Nov 2026 plan, E7).
notificationsRouter.get('/push-config', (_req, res) => {
  res.json({ publicKey: pushPublicKey() });
});
notificationsRouter.post(
  '/push-subscriptions',
  validateBody(pushSubscriptionSchema),
  asyncHandler(async (req, res) => {
    await savePushSubscription(req.user!.id, req.body as PushSubscriptionInput);
    res.status(204).send();
  }),
);
notificationsRouter.delete(
  '/push-subscriptions',
  validateBody(pushUnsubscribeSchema),
  asyncHandler(async (req, res) => {
    await removePushSubscription(req.user!.id, (req.body as { endpoint: string }).endpoint);
    res.status(204).send();
  }),
);

notificationsRouter.post('/:id/read', asyncHandler(markNotificationReadController));
notificationsRouter.post('/:id/unread', asyncHandler(markNotificationUnreadController));
