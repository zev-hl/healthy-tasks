import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { ApiError } from '@healthy-tasks/shared';
import { HttpError } from '../utils/http-error.js';

/** Central error handler — every thrown error ends up here as JSON. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    const body: ApiError = { error: err.message };
    if (err.details !== undefined) body.details = err.details;
    res.status(err.status).json(body);
    return;
  }

  // Prisma unique-constraint violation (e.g. duplicate email).
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json({ error: 'A record with that value already exists' });
    return;
  }

  // eslint-disable-next-line no-console
  console.error('Unhandled error:', err);
  const body: ApiError = { error: 'Internal server error' };
  res.status(500).json(body);
}

/** 404 fallback for unmatched routes. */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' } satisfies ApiError);
}
