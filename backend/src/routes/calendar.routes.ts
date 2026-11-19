import { Router, type Request } from 'express';
import type { CalendarScope, SaveEventRequest } from '@healthy-tasks/shared';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../utils/http-error.js';
import { saveEventSchema } from '../validation/schemas.js';
import {
  cancelEvent,
  createEvent,
  getCalendar,
  getEvent,
  updateEvent,
} from '../services/event.service.js';
import type { Actor } from '../services/access-control.service.js';

/** The calendar (Nov 2026 plan, Stage 3): events and reminders for a range. */
export const calendarRouter = Router();
/** Events (H4a). */
export const eventsRouter = Router();
calendarRouter.use(requireAuth);
eventsRouter.use(requireAuth);

const actorOf = (req: Request): Actor => {
  if (!req.user) throw HttpError.unauthorized();
  return { id: req.user.id, role: req.user.role };
};
const idOf = (req: Request) => (req.params as { id: string }).id;

calendarRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    if (!q.from || !q.to) throw HttpError.badRequest('`from` and `to` are needed');
    const scope: CalendarScope = q.scope === 'team' ? 'team' : 'me';
    res.json(await getCalendar(actorOf(req), { from: q.from, to: q.to, scope }));
  }),
);

eventsRouter.post(
  '/',
  validateBody(saveEventSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createEvent(actorOf(req), req.body as SaveEventRequest));
  }),
);
eventsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await getEvent(actorOf(req), idOf(req)));
  }),
);
eventsRouter.patch(
  '/:id',
  validateBody(saveEventSchema),
  asyncHandler(async (req, res) => {
    res.json(await updateEvent(actorOf(req), idOf(req), req.body as SaveEventRequest));
  }),
);
eventsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await cancelEvent(actorOf(req), idOf(req));
    res.status(204).end();
  }),
);
