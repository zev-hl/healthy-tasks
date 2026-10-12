import type { Request, Response } from 'express';
import type {
  RelatedTaskDto,
  TimeDayDto,
  TimeReviewDto,
  TimeReviewPeopleDto,
} from '@healthy-tasks/shared';
import { HttpError } from '../utils/http-error.js';
import { calendarDate } from '../validation/schemas.js';
import type { SaveTimeDayInput, TimeReviewInput } from '../validation/schemas.js';
import type { Actor } from '../services/access-control.service.js';
import {
  getReviewPeople,
  getTimeReview,
  listDays,
  listRelatedTasks,
  saveDay,
  setDayCompleted,
} from '../services/time.service.js';

function actorOf(req: Request): Actor {
  if (!req.user) throw HttpError.unauthorized();
  return { id: req.user.id, role: req.user.role };
}

function dateOf(value: unknown, name: string): string {
  const parsed = calendarDate.safeParse(value);
  if (!parsed.success) throw HttpError.badRequest(`\`${name}\` must be a YYYY-MM-DD date`);
  return parsed.data;
}

/** `?userId=` (defaults to the caller) + `?from=&to=`. */
function rangeQuery(req: Request): { userId: string; from: string; to: string } {
  const q = req.query as Record<string, unknown>;
  const userId = typeof q.userId === 'string' && q.userId ? q.userId : actorOf(req).id;
  return { userId, from: dateOf(q.from, 'from'), to: dateOf(q.to, 'to') };
}

export async function listDaysController(req: Request, res: Response): Promise<void> {
  const { userId, from, to } = rangeQuery(req);
  res.json((await listDays(actorOf(req), userId, from, to)) satisfies TimeDayDto[]);
}

export async function saveDayController(req: Request, res: Response): Promise<void> {
  const date = dateOf((req.params as { date: string }).date, 'date');
  res.json((await saveDay(actorOf(req), date, req.body as SaveTimeDayInput)) satisfies TimeDayDto);
}

export async function setDayCompletedController(req: Request, res: Response): Promise<void> {
  const date = dateOf((req.params as { date: string }).date, 'date');
  const { completed } = req.body as { completed: boolean };
  res.json((await setDayCompleted(actorOf(req), date, completed)) satisfies TimeDayDto);
}

export async function relatedTasksController(req: Request, res: Response): Promise<void> {
  const { userId, from, to } = rangeQuery(req);
  res.json((await listRelatedTasks(actorOf(req), userId, from, to)) satisfies RelatedTaskDto[]);
}

export async function reviewPeopleController(req: Request, res: Response): Promise<void> {
  res.json((await getReviewPeople(actorOf(req))) satisfies TimeReviewPeopleDto);
}

export async function timeReviewController(req: Request, res: Response): Promise<void> {
  res.json(
    (await getTimeReview(actorOf(req), req.body as TimeReviewInput)) satisfies TimeReviewDto,
  );
}
