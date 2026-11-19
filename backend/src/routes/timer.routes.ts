import { Router, type Request } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../utils/http-error.js';
import { startTimerSchema, stopTimerSchema } from '../validation/schemas.js';
import { getMyTimer, startTimer, stopTimer } from '../services/task-time.service.js';
import type { Actor } from '../services/access-control.service.js';

/** The caller's own running timer (Nov 2026 plan, L2), the same in every browser. */
export const timerRouter = Router();
timerRouter.use(requireAuth);

const actorOf = (req: Request): Actor => {
  if (!req.user) throw HttpError.unauthorized();
  return { id: req.user.id, role: req.user.role };
};

timerRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await getMyTimer(actorOf(req)));
  }),
);
timerRouter.post(
  '/start',
  validateBody(startTimerSchema),
  asyncHandler(async (req, res) => {
    res.json(await startTimer(actorOf(req), req.body));
  }),
);
timerRouter.post(
  '/stop',
  validateBody(stopTimerSchema),
  asyncHandler(async (req, res) => {
    res.json(await stopTimer(actorOf(req), req.body));
  }),
);
