import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@healthy-tasks/shared';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';
import { verifyAccessToken } from '../utils/jwt.js';

function extractToken(req: Request): string | null {
  const header = req.header('authorization');
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  return null;
}

/**
 * Requires a valid, non-expired JWT AND that the user still exists, is active,
 * and the token's version matches the user's current tokenVersion. The last two
 * checks are what give stateless JWTs a revocation path: deactivating a user or
 * resetting their password bumps tokenVersion, instantly invalidating tokens.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) {
      throw HttpError.unauthorized('Authentication required');
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw HttpError.unauthorized('Invalid or expired token');
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw HttpError.unauthorized('Account is inactive or no longer exists');
    }
    if (user.tokenVersion !== payload.tv) {
      throw HttpError.unauthorized('Session has been revoked; please log in again');
    }

    req.user = { id: user.id, email: user.email, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Requires the authenticated user to hold one of the given roles.
 * Must be used after `requireAuth`.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(HttpError.unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(HttpError.forbidden('You do not have permission to perform this action'));
      return;
    }
    next();
  };
}

/** Shorthand for the common admin-only guard. */
export const requireAdmin = requireRole('Admin');
