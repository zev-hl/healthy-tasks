import { Router, type Request } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../utils/http-error.js';
import {
  disconnectGoogleCalendar,
  finishGoogleCalendarConnect,
  getGoogleCalendarStatus,
  listGoogleEvents,
  startGoogleCalendarConnect,
} from '../services/google-calendar.service.js';

/** Each person's own Google Calendar, read-only (Nov 2026 plan, H6). */
export const googleCalendarRouter = Router();

// Google sends the browser back here: no sign-in header, the signed state says who.
googleCalendarRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    res.redirect(302, await finishGoogleCalendarConnect(q));
  }),
);

googleCalendarRouter.use(requireAuth);
const me = (req: Request) => {
  if (!req.user) throw HttpError.unauthorized();
  return req.user;
};

googleCalendarRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await getGoogleCalendarStatus(me(req).id));
  }),
);
googleCalendarRouter.post(
  '/connect',
  asyncHandler(async (req, res) => {
    const u = me(req);
    res.json(await startGoogleCalendarConnect({ id: u.id, email: u.email }));
  }),
);
googleCalendarRouter.delete(
  '/',
  asyncHandler(async (req, res) => {
    await disconnectGoogleCalendar(me(req).id);
    res.status(204).end();
  }),
);
googleCalendarRouter.get(
  '/events',
  asyncHandler(async (req, res) => {
    const q = req.query as { from?: string; to?: string };
    if (!q.from || !q.to) throw HttpError.badRequest('`from` and `to` are needed');
    res.json(await listGoogleEvents(me(req).id, q.from, q.to));
  }),
);
