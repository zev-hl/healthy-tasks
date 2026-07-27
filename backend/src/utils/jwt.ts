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
