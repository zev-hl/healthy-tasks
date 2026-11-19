import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { User } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';

/**
 * HL Central as our Connect's sign-in service (Nov 2026 plan, Stage 5). Connect
 * already speaks to a "central account" (built for auth.brecx.com,
 * docs/central-signin.md in Connect); HL Central plays that part, so Connect
 * needs settings only:
 *
 * - Connect's "Continue with HL Central" asks us (with our cookie) for a short
 *   EdDSA token naming the person and our workspace, and trades it for a
 *   Connect session. Connect checks it against our public key (JWKS).
 * - The cookie is set when HL Central's own sign-in reaches /connect-signin.
 * - We keep Connect's member list in step: each change to a person here is
 *   pushed to Connect (signed with CONNECT_PROVISION_SECRET).
 *
 * People are matched by HL Central's user id (Connect's auth_user_id) once
 * linked; the first push links an existing Connect account with the same email.
 */

const TOKEN_SECONDS = 5 * 60;
export const CONNECT_AUTH_COOKIE = 'hlc_connect';
/** A plain sign-in's cookie lasts this long; a "keep me signed in" one, KEEP_SIGNED_IN_DAYS. */
const COOKIE_HOURS = 12;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let cachedKey: { raw: string; key: KeyObject } | null = null;
function privateKey(): KeyObject | null {
  const raw = env.connect.signingKey;
  if (!raw) return null;
  if (cachedKey?.raw === raw) return cachedKey.key;
  const pem = raw.includes('BEGIN')
    ? raw.replace(/\\n/g, '\n')
    : Buffer.from(raw, 'base64').toString();
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'ed25519') return null;
    cachedKey = { raw, key };
    return key;
  } catch {
    return null;
  }
}

/** Sign-in for Connect is on: Connect's address, ours, a key and the workspace's id. */
export function connectSignInAvailable(): boolean {
  return !!(env.connect.url && env.connect.authUrl && UUID.test(env.connect.orgId) && privateKey());
}

/** Member pushes are on: sign-in, plus the shared secret. */
export function connectMembersAvailable(): boolean {
  return connectSignInAvailable() && env.connect.provisionSecret.length >= 32;
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** Our public key as Connect reads it (`/.well-known/jwks.json`). */
export function connectJwks(): { keys: Record<string, string>[] } {
  const key = privateKey();
  if (!key) return { keys: [] };
  const jwk = createPublicKey(key).export({ format: 'jwk' }) as {
    kty: string;
    crv: string;
    x: string;
  };
  return {
    keys: [{ kty: jwk.kty, crv: jwk.crv, x: jwk.x, kid: kidOf(jwk.x), alg: 'EdDSA', use: 'sig' }],
  };
}
const kidOf = (x: string) => createHash('sha256').update(x).digest('base64url').slice(0, 16);

/** The token Connect trades for a session: this person, our workspace, five minutes. */
export function signConnectToken(user: Pick<User, 'id' | 'email'>, now = Date.now()): string {
  const key = privateKey();
  if (!key) throw new Error('No Connect signing key');
  const x = (createPublicKey(key).export({ format: 'jwk' }) as { x: string }).x;
  const iat = Math.floor(now / 1000);
  const header = { alg: 'EdDSA', typ: 'JWT', kid: kidOf(x) };
  const payload = {
    iss: env.connect.authUrl,
    aud: 'brecx:connect',
    sub: user.id,
    org: env.connect.orgId,
    apps: ['connect'],
    email: user.email,
    iat,
    exp: iat + TOKEN_SECONDS,
  };
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  return `${input}.${b64u(edSign(null, Buffer.from(input), key))}`;
}

// --- The cookie ---------------------------------------------------------------

const cookieKey = (): Buffer =>
  createHmac('sha256', env.jwtSecret).update('connect-auth-session').digest();

export function cookieLifetimeMs(keep: boolean): number {
  return keep && env.keepSignedInDays > 0
    ? env.keepSignedInDays * 86_400_000
    : COOKIE_HOURS * 3_600_000;
}

export function signConnectCookie(user: Pick<User, 'id' | 'tokenVersion'>, keep: boolean): string {
  return jwt.sign({ sub: user.id, tv: user.tokenVersion }, cookieKey(), {
    expiresIn: Math.floor(cookieLifetimeMs(keep) / 1000),
  });
}

/** The person the cookie names, if it is good and they are still active and signed in. */
export async function userFromConnectCookie(value: unknown): Promise<User | null> {
  if (typeof value !== 'string' || !value) return null;
  let p: { sub?: string; tv?: number };
  try {
    p = jwt.verify(value, cookieKey()) as { sub?: string; tv?: number };
  } catch {
    return null;
  }
  if (!p.sub) return null;
  const user = await prisma.user.findUnique({ where: { id: p.sub } });
  // "Sign out everywhere", a password reset or deactivation ends it too.
  if (!user || !user.isActive || user.tokenVersion !== p.tv) return null;
  return user;
}

// --- Signed calls, both ways --------------------------------------------------

export function provisionSignature(timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', env.connect.provisionSecret)
    .update(`${timestamp}.${body}`)
    .digest('hex')}`;
}

/** A call Connect signed (x-brecx-timestamp, x-brecx-signature), within five minutes. */
export function verifyFromConnect(
  timestamp: string | undefined,
  signature: string | undefined,
  rawBody: string,
  now = Date.now(),
): boolean {
  if (env.connect.provisionSecret.length < 32 || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const want = Buffer.from(provisionSignature(timestamp, rawBody));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

// --- Members --------------------------------------------------------------------

type Fetch = typeof fetch;
let doFetch: Fetch = (...args) => fetch(...args);
/** Tests stand in for Connect. */
export function __setConnectAuthFetch(f: Fetch | null): void {
  doFetch = f ?? ((...args) => fetch(...args));
}

export interface MemberPushResult {
  userId: string;
  ok: boolean;
  outcome?: string;
  error?: string;
}

const displayName = (u: Pick<User, 'firstName' | 'lastName' | 'email'>) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ').trim().slice(0, 80) || u.email;

async function pushOne(u: User): Promise<MemberPushResult> {
  const body = JSON.stringify({
    org_id: env.connect.orgId,
    member: { auth_user_id: u.id, email: u.email, name: displayName(u) },
    role: u.role === 'Admin' ? 'admin' : 'member',
    active: u.isActive,
  });
  const ts = String(Math.floor(Date.now() / 1000));
  try {
    const res = await doFetch(`${env.connect.url}/api/v1/central/members`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-brecx-timestamp': ts,
        'x-brecx-signature': provisionSignature(ts, body),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as {
      outcome?: string;
      error?: { code?: string; message?: string };
    } | null;
    if (!res.ok) {
      return {
        userId: u.id,
        ok: false,
        error: json?.error?.message ?? json?.error?.code ?? `Connect answered ${res.status}`,
      };
    }
    return { userId: u.id, ok: true, outcome: json?.outcome };
  } catch {
    return { userId: u.id, ok: false, error: 'Connect couldn’t be reached' };
  }
}

const pending = new Set<Promise<unknown>>();
/** Tests: wait for every push in flight. */
export async function connectMembersSettled(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}

/**
 * Tell Connect about these people as they are now (added, renamed, new
 * address, role, deactivated or back). In the background: a change here never
 * waits on Connect or fails because of it; a miss is caught up by the Admin's
 * "Send everyone to Connect".
 */
export function pushConnectMembers(userIds: string[]): void {
  if (!connectMembersAvailable() || userIds.length === 0) return;
  const p = (async () => {
    const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
    for (const u of users) {
      const r = await pushOne(u);
      if (!r.ok) console.warn(`[connect] member push for ${u.id} failed: ${r.error}`);
    }
  })().catch((e) => console.warn('[connect] member push failed', e));
  pending.add(p);
  void p.finally(() => pending.delete(p));
}

/** Everyone, now, with what Connect said about each (the Admin's button). */
export async function pushAllConnectMembers(): Promise<{
  sent: number;
  failed: { email: string; error: string }[];
}> {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  const failed: { email: string; error: string }[] = [];
  for (const u of users) {
    const r = await pushOne(u);
    if (!r.ok) failed.push({ email: u.email, error: r.error ?? 'failed' });
  }
  return { sent: users.length - failed.length, failed };
}
