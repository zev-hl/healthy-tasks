import { createHmac } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role } from '@healthy-tasks/shared';
import { env } from '../config/env.js';

export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
  role: Role;
  // Token version at issue time; compared against the user's current
  // tokenVersion so we can invalidate tokens after deactivation / reset.
  tv: number;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: SignOptions = { expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'] };
  return jwt.sign(payload, env.jwtSecret, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtSecret) as AccessTokenPayload;
}

// --- The queue dashboard's pass ---------------------------------------------
// What the dashboard's cookie holds after an Admin opens it with the website's
// button. Signed with its own key, made from JWT_SECRET, so a pass is never
// taken as a sign-in to the API, nor a sign-in as a pass.

export interface DashboardPassPayload {
  sub: string; // user id
  tv: number; // token version at issue time, as in the access token
}

/** Lasts 12 hours, even in a browser that is never fully closed. */
const DASHBOARD_PASS_LIFETIME = '12h';

const dashboardPassKey = (): Buffer =>
  createHmac('sha256', env.jwtSecret).update('queue-dashboard-pass').digest();

export function signDashboardPass(payload: DashboardPassPayload): string {
  return jwt.sign({ sub: payload.sub, tv: payload.tv }, dashboardPassKey(), {
    expiresIn: DASHBOARD_PASS_LIFETIME,
  });
}

export function verifyDashboardPass(token: string): DashboardPassPayload {
  return jwt.verify(token, dashboardPassKey()) as DashboardPassPayload;
}
