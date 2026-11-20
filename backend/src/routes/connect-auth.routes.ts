import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { prisma } from '../db/prisma.js';
import {
  CONNECT_AUTH_COOKIE,
  connectJwks,
  connectSignInAvailable,
  cookieLifetimeMs,
  signConnectCookie,
  signConnectToken,
  userFromConnectCookie,
  verifyFromConnect,
} from '../services/connect-auth.service.js';

/**
 * HL Central as our Connect's sign-in service (Nov 2026 plan, Stage 5),
 * mounted at /api/connect-auth — the address Connect is given as its
 * CENTRAL_AUTH_URL. Mounted before the app's own CORS and JSON parsing: Connect's
 * page calls /token and /me from Connect's site with our cookie, and Connect's
 * server signs the exact bytes it sends. See services/connect-auth.service.ts.
 */
export const connectAuthRouter = Router();

const connectOrigin = (): string | null => {
  try {
    return env.connect.url ? new URL(env.connect.url).origin : null;
  } catch {
    return null;
  }
};

/** Connect's site (for /token, /me) and HL Central's own (for /session). */
connectAuthRouter.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.header('origin');
  if (origin && (origin === connectOrigin() || env.corsOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'content-type, authorization, x-brecx-auth, x-brecx-user',
      );
      res.setHeader('Access-Control-Max-Age', '600');
      res.status(204).end();
      return;
    }
  } else if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Everything is off until it is set up; the page's own check says so. Signing
// out (DELETE /session) always answers, so a sign-out never logs an error.
connectAuthRouter.use((req, res, next) => {
  if (req.path === '/status') return next();
  if (req.method === 'DELETE' && req.path === '/session') return next();
  if (!connectSignInAvailable()) {
    res.status(404).json({ error: 'not_found', message: 'Sign-in for Connect is not set up' });
    return;
  }
  next();
});

// Raw bytes (Connect signs them); JSON read by hand where needed.
connectAuthRouter.use(express.raw({ type: () => true, limit: '64kb' }));
const rawText = (req: Request) => (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '');
function jsonBody(req: Request): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(rawText(req) || '{}');
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const secure = () => env.frontendUrl.startsWith('https:') || env.nodeEnv === 'production';
const cookieOptions = () => ({
  httpOnly: true,
  secure: secure(),
  // Connect's page asks from Connect's site. On one domain (app. and connect.
  // of the same name) the browser treats it as the same site anyway.
  sameSite: secure() ? ('none' as const) : ('lax' as const),
  path: '/api/connect-auth',
});

/** Whether sign-in for Connect is set up (HL Central's /connect-signin page asks). */
connectAuthRouter.get('/status', (_req, res) => {
  res.json({ available: connectSignInAvailable(), connectUrl: env.connect.url || null });
});

connectAuthRouter.get('/.well-known/jwks.json', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(connectJwks());
});

/**
 * POST /session — HL Central's page, signed in (its bearer token), asks for the
 * cookie Connect's page will use. A "keep me signed in" sign-in gets a long one.
 */
connectAuthRouter.post(
  '/session',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    let keep = false;
    try {
      keep = verifyAccessToken(req.header('authorization')!.slice(7)).rm === true;
    } catch {
      /* requireAuth already checked it */
    }
    res.cookie(CONNECT_AUTH_COOKIE, signConnectCookie(user, keep), {
      ...cookieOptions(),
      maxAge: cookieLifetimeMs(keep),
    });
    res.status(204).end();
  }),
);

/** DELETE /session — signing out of HL Central ends it too. */
connectAuthRouter.delete('/session', (_req, res) => {
  res.clearCookie(CONNECT_AUTH_COOKIE, cookieOptions());
  res.status(204).end();
});

const orgDto = () => ({ id: env.connect.orgId, name: env.connect.workspaceName });

/** POST /token — Connect's page: a token for the person our cookie names. */
connectAuthRouter.post(
  '/token',
  asyncHandler(async (req, res) => {
    // Only a page that sent our header (and so passed CORS) gets one.
    if (req.header('x-brecx-auth') !== '1') {
      res.status(400).json({ error: 'bad_request', message: 'Missing x-brecx-auth' });
      return;
    }
    const user = await userFromConnectCookie(req.cookies?.[CONNECT_AUTH_COOKIE]);
    const wanted = req.header('x-brecx-user');
    if (!user || (wanted && wanted !== user.id)) {
      res.status(401).json({ error: 'unauthenticated', message: 'Sign in to HL Central' });
      return;
    }
    const body = jsonBody(req);
    if (
      (body.app !== undefined && body.app !== 'connect') ||
      (body.org_id !== undefined && body.org_id !== env.connect.orgId)
    ) {
      res.status(403).json({ error: 'no_app_access', message: 'Not a workspace of ours' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ access_token: signConnectToken(user), org: orgDto() });
  }),
);

/** GET /me — Connect's page: who our cookie names, and their workspace. */
connectAuthRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const user = await userFromConnectCookie(req.cookies?.[CONNECT_AUTH_COOKIE]);
    if (!user) {
      res.status(401).json({ error: 'unauthenticated', message: 'Sign in to HL Central' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      accounts: [
        { user: { id: user.id, email: user.email }, orgs: [{ ...orgDto(), apps: ['connect'] }] },
      ],
    });
  }),
);

/**
 * POST /apps/connect/members/remove — Connect, signed: someone was deleted in
 * Connect. Connect won't delete them without our yes. Nothing to change here:
 * who works here is decided in HL Central (deactivate them there).
 */
connectAuthRouter.post('/apps/connect/members/remove', (req, res) => {
  if (
    !verifyFromConnect(
      req.header('x-brecx-timestamp'),
      req.header('x-brecx-signature'),
      rawText(req),
    )
  ) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  res.json({});
});
