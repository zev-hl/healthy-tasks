import { Router } from 'express';
import type { ConnectCallsDto, ConnectStatusDto } from '@healthy-tasks/shared';
import { asyncHandler } from '../utils/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { connectAvailable, listPersonCalls } from '../services/connect.service.js';
import { HttpError } from '../utils/http-error.js';

/** Our Connect (Nov 2026 plan, Stage 4): what the browser may know about the link. */
export const connectRouter = Router();
connectRouter.use(requireAuth);

connectRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const available = connectAvailable();
    res.json({ available, url: available ? env.connect.url : null } satisfies ConnectStatusDto);
  }),
);

// K4: the reader's own Connect calls in a range, for the calendar. Calls HL
// Central booked are left out: they are on the calendar already, as events.
connectRouter.get(
  '/calls',
  asyncHandler(async (req, res) => {
    const q = req.query as { from?: string; to?: string };
    if (!q.from || !q.to) throw HttpError.badRequest('`from` and `to` are needed');
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
      throw HttpError.badRequest('`from` and `to` must be dates, `to` after `from`');
    }
    if (!connectAvailable()) {
      res.json({ available: false, calls: [] } satisfies ConnectCallsDto);
      return;
    }
    let calls: Awaited<ReturnType<typeof listPersonCalls>>;
    try {
      calls = await listPersonCalls(req.user!.email, from, to);
    } catch {
      res.json({ available: true, calls: [] } satisfies ConnectCallsDto);
      return;
    }
    res.json({
      available: calls !== null,
      calls: (calls ?? [])
        .filter((c) => !c.externalRef?.startsWith('hlcentral:') && c.status !== 'cancelled')
        .map((c) => ({
          id: c.id,
          title: c.title,
          startAt: c.startAt,
          endAt: c.endAt,
          status: c.status,
          joinUrl: c.joinUrl,
          host: c.host,
        })),
    } satisfies ConnectCallsDto);
  }),
);
