import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface BasicCredentials {
  user: string;
  password: string;
}

/** The user name and password from an `Authorization: Basic …` header, if any. */
export function basicCredentials(header: string | undefined): BasicCredentials | undefined {
  const encoded = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(header?.trim() ?? '')?.[1];
  if (!encoded) return undefined;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return undefined;
  return { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

/**
 * Compared as SHA-256 digests: equal length whatever was typed, so
 * timingSafeEqual neither throws nor gives away the real length.
 */
function sameText(given: string, expected: string): boolean {
  const digest = (text: string) => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * Lets a request through only with this user name and password, sent the way
 * the browser's own sign-in box sends them (HTTP Basic, over HTTPS on Render).
 * Without them the browser is told to show that box. For pages outside the
 * app's own sign-in, such as the queue dashboard.
 */
export function requireBasicAuth(user: string, password: string, realm: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Nothing behind the sign-in is kept by the browser or a proxy.
    res.setHeader('Cache-Control', 'no-store');
    const given = basicCredentials(req.header('authorization'));
    // Both checked every time, so a wrong user name answers as fast as a wrong password.
    const userOk = sameText(given?.user ?? '', user);
    const passwordOk = sameText(given?.password ?? '', password);
    if (given && userOk && passwordOk) {
      next();
      return;
    }
    res.setHeader('WWW-Authenticate', `Basic realm="${realm}", charset="UTF-8"`);
    res.status(401).type('text').send('Sign-in required.');
  };
}
