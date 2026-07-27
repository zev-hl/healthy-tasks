import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, infer as ZodInfer } from 'zod';
import { HttpError } from '../utils/http-error.js';

/**
 * Validates and replaces `req.body` with the parsed, typed result. On failure
 * responds via the central error handler with a 400 and field-level details.
 */
export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(HttpError.badRequest('Validation failed', result.error.flatten().fieldErrors));
      return;
    }
    req.body = result.data as ZodInfer<T>;
    next();
  };
}
