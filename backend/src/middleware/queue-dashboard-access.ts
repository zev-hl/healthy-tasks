import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { signDashboardPass, verifyAccessToken, verifyDashboardPass } from '../utils/jwt.js';
import { requireBasicAuth } from './basic-auth.js';

/** The cookie that lets an Admin who came from the website's button in. */
export const DASHBOARD_COOKIE = 'hl_queue_dashboard';

/** Still an active Admin, with the token version the sign-in or pass was given at. */
async function isActiveAdmin(userId: string, tokenVersion: number): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, role: true, tokenVersion: true },
  });
  return !!user && user.isActive && user.role === 'Admin' && user.tokenVersion === tokenVersion;
}

/** The person an HL Central sign-in names, when they may open the dashboard. */
async function adminFromSignIn(token: unknown): Promise<{ id: string; tv: number } | null> {
  if (typeof token !== 'string' || token === '') return null;
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return null;
  }
  return (await isActiveAdmin(payload.sub, payload.tv))
    ? { id: payload.sub, tv: payload.tv }
    : null;
}

async function hasPass(token: unknown): Promise<boolean> {
  if (typeof token !== 'string' || token === '') return false;
  let payload;
  try {
    payload = verifyDashboardPass(token);
  } catch {
    return false;
  }
  return isActiveAdmin(payload.sub, payload.tv);
}

/**
 * `POST <path>/enter`, from the website's "Open queue dashboard" button: a form
 * carrying the Admin's HL Central sign-in. An active Admin's, from the website
 * itself, gets a pass in a cookie for the dashboard only, kept until the
 * browser is closed (and 12 hours at most, inside the pass). Either way the tab
 * goes on to the dashboard, which asks for its user name and password when
 * there is no pass.
 */
export function enterQueueDashboard(path: string) {
  return asyncHandler(async (req: Request, res: Response) => {
    const fromWebsite = req.header('origin') === env.corsOrigin;
    const admin = fromWebsite ? await adminFromSignIn(req.body?.token) : null;
    if (admin) {
      res.cookie(DASHBOARD_COOKIE, signDashboardPass({ sub: admin.id, tv: admin.tv }), {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path,
        // No maxAge or expires: the browser drops it when it is closed.
      });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(303, path);
  });
}

/**
 * The dashboard's door: a pass from the button, if its Admin is still an
 * active Admin with the same token version (so switching them off, a new role
 * or a password reset closes it at once); otherwise the user name and password.
 */
export function queueDashboardGate(path: string, user: string, password: string, realm: string) {
  const passwordCheck = requireBasicAuth(user, password, realm);
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const pass: unknown = req.cookies?.[DASHBOARD_COOKIE];
    if (await hasPass(pass)) {
      res.setHeader('Cache-Control', 'no-store');
      next();
      return;
    }
    // A pass that no longer works is dropped, so it isn't checked again.
    if (pass !== undefined) {
      res.clearCookie(DASHBOARD_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path });
    }
    passwordCheck(req, res, next);
  });
}
