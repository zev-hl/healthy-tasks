import { timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { TASK_NAME_MIN_LENGTH, type TaskStatus } from '@healthy-tasks/shared';

const OPEN: TaskStatus[] = ['Open', 'InProgress', 'OnHold', 'Review'];
import { asyncHandler } from '../utils/async-handler.js';
import { validateBody } from '../middleware/validate.js';
import { HttpError } from '../utils/http-error.js';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { createTask } from '../services/task.service.js';
import { searchTasks } from '../services/task-search.service.js';
import { getMyTimer, startTimer, stopTimer } from '../services/task-time.service.js';
import type { Actor } from '../services/access-control.service.js';
import { toBusinessDate } from '../utils/business-time.js';

/**
 * What our Connect calls on HL Central (Nov 2026 plan, K6, K7): make a task
 * from a chat or voice note, list a person's tasks, and their timer — for the
 * Tasks section inside Connect. Server to server, with its own key
 * (`Authorization: Bearer <CONNECT_INBOUND_KEY>`), never a person's sign-in.
 * Each call names the person it acts for (`as`: their email); it acts with
 * that person's own rights, so they see and do only what they could here.
 * Off while CONNECT_INBOUND_KEY is blank.
 */
export const connectInboundRouter = Router();

function requireConnectKey(req: Request, _res: Response, next: NextFunction): void {
  const key = env.connect.inboundKey;
  if (!key || key.length < 32) {
    next(new HttpError(503, 'Connect’s access to HL Central isn’t set up'));
    return;
  }
  const given = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    next(HttpError.unauthorized('Bad key'));
    return;
  }
  next();
}
connectInboundRouter.use(requireConnectKey);

/** The active person a call acts for, by email (`as` in the query or body). */
async function actorFor(req: Request): Promise<Actor> {
  const email = String(
    (req.query as { as?: string }).as ?? (req.body as { as?: string } | undefined)?.as ?? '',
  )
    .trim()
    .toLowerCase();
  if (!email) throw HttpError.badRequest('Say who it is for (`as`: their email)');
  const u = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, isActive: true },
    select: { id: true, role: true },
  });
  if (!u) throw HttpError.notFound('Nobody active in HL Central has that address');
  return { id: u.id, role: u.role };
}

const taskUrl = (id: number) => `${env.frontendUrl}/tasks/${id}`;

/** Plain text into the task description (rich text: paragraphs, escaped). */
const asHtml = (text: string) =>
  text
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p>${p
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>')}</p>`,
    )
    .join('');

const createFromConnectSchema = z.object({
  as: z.string().email(),
  name: z.string().trim().min(TASK_NAME_MIN_LENGTH).max(300),
  /** The chat message's words, or a voice note's transcript. */
  text: z.string().trim().max(10_000).optional(),
  assignee: z.string().email().optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  /** Where it came from in Connect, shown on the task. */
  sourceUrl: z.string().url().max(1000).optional(),
});

// K6: make a task from a Connect chat or voice note.
connectInboundRouter.post(
  '/tasks',
  validateBody(createFromConnectSchema),
  asyncHandler(async (req, res) => {
    const actor = await actorFor(req);
    const body = req.body as z.infer<typeof createFromConnectSchema>;
    let assigneeId: string | undefined;
    if (body.assignee) {
      const a = await prisma.user.findFirst({
        where: { email: { equals: body.assignee, mode: 'insensitive' }, isActive: true },
        select: { id: true },
      });
      if (!a) throw HttpError.badRequest('The assignee isn’t an active HL Central user');
      assigneeId = a.id;
    }
    const parts = [
      body.text,
      body.sourceUrl ? `From Connect: ${body.sourceUrl}` : 'From Connect',
    ].filter((x): x is string => !!x);
    const task = await createTask(actor, {
      name: body.name,
      description: asHtml(parts.join('\n\n')),
      ...(assigneeId && { assigneeId }),
      ...(body.dueAt && { dueAt: new Date(body.dueAt) }),
    });
    res.status(201).json({ id: task.id, name: task.name, url: taskUrl(task.id) });
  }),
);

// K7: a person's open tasks (theirs, soonest due first), for Connect's Tasks section.
connectInboundRouter.get(
  '/tasks',
  asyncHandler(async (req, res) => {
    const actor = await actorFor(req);
    const result = await searchTasks(
      {
        filters: {
          assigneeIds: [actor.id],
          statuses: OPEN,
          includeNoDue: true,
          includeNoStart: true,
        },
        sort: [{ field: 'dueAt', dir: 'asc' }],
        page: 1,
        pageSize: 100,
      },
      actor,
    );
    res.json({
      tasks: result.rows.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        priority: t.priority,
        dueAt: t.dueAt,
        url: taskUrl(t.id),
      })),
    });
  }),
);

// K7: the person's timer (the same one as in HL Central: one per person).
connectInboundRouter.get(
  '/timer',
  asyncHandler(async (req, res) => {
    res.json(await getMyTimer(await actorFor(req)));
  }),
);
const timerSchema = z.object({
  as: z.string().email(),
  taskId: z.number().int().positive(),
  /** The task whose timer the caller believes is running (null: none). */
  replacing: z.number().int().positive().nullable().optional(),
});
connectInboundRouter.post(
  '/timer/start',
  validateBody(timerSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof timerSchema>;
    res.json(
      await startTimer(await actorFor(req), {
        taskId: b.taskId,
        replacing: b.replacing ?? null,
        date: toBusinessDate(new Date()),
      }),
    );
  }),
);
connectInboundRouter.post(
  '/timer/stop',
  validateBody(timerSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof timerSchema>;
    res.json(
      await stopTimer(await actorFor(req), { taskId: b.taskId, date: toBusinessDate(new Date()) }),
    );
  }),
);
