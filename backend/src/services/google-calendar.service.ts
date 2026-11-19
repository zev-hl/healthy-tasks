import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type {
  GoogleCalendarStatusDto,
  GoogleEventDto,
  GoogleEventsDto,
} from '@healthy-tasks/shared';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/http-error.js';

/**
 * Each person's own Google Calendar, shown read-only in HL Central's calendar
 * (Nov 2026 plan, H6). A person connects it from their profile: Google asks
 * them to allow "See your calendars" (calendar.readonly), and we keep the
 * refresh token it hands back, encrypted (AES-256-GCM, GOOGLE_TOKEN_KEY).
 * Access tokens live in memory only. Nothing is ever written to Google.
 * Off until GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALENDAR_REDIRECT_URI
 * and GOOGLE_TOKEN_KEY are all set.
 */

const SCOPE = 'openid email https://www.googleapis.com/auth/calendar.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

type Fetch = typeof fetch;
let doFetch: Fetch = (...args) => fetch(...args);
/** Tests stand in for Google. */
export function __setGoogleFetch(f: Fetch | null): void {
  doFetch = f ?? ((...args) => fetch(...args));
  accessTokens.clear();
}

export function googleCalendarAvailable(): boolean {
  const g = env.google;
  return !!(g.clientId && g.clientSecret && g.calendarRedirectUri && tokenKey());
}

function tokenKey(): Buffer | null {
  if (!env.google.tokenKey) return null;
  const k = Buffer.from(env.google.tokenKey, 'base64');
  return k.length === 32 ? k : null;
}

function requireAvailable(): Buffer {
  const key = tokenKey();
  if (!googleCalendarAvailable() || !key) {
    throw new HttpError(503, 'Google Calendar isn’t set up on this server yet');
  }
  return key;
}

export function encryptToken(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64')).join('.');
}

export function decryptToken(sealed: string, key: Buffer): string {
  const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64'));
  if (!iv || !tag || !body) throw new Error('bad token');
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8');
}

// The OAuth `state`: who started connecting, signed so the callback can trust
// it, and short-lived. Its own key (from JWT_SECRET), never a sign-in token.
const stateKey = () => createHmac('sha256', env.jwtSecret).update('google-calendar-state').digest();

/** GET /api/google-calendar */
export async function getGoogleCalendarStatus(userId: string): Promise<GoogleCalendarStatusDto> {
  const link = await prisma.googleCalendarLink.findUnique({ where: { userId } });
  return {
    available: googleCalendarAvailable(),
    connected: !!link,
    email: link?.email ?? null,
    problem: link?.lastError ?? null,
  };
}

/** POST /api/google-calendar/connect — where to send the browser to allow it. */
export async function startGoogleCalendarConnect(user: {
  id: string;
  email: string;
}): Promise<{ url: string }> {
  requireAvailable();
  const state = jwt.sign({ sub: user.id }, stateKey(), { expiresIn: '10m' });
  const q = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: env.google.calendarRedirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    login_hint: user.email,
    state,
  });
  return { url: `${AUTH_URL}?${q.toString()}` };
}

function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const payload = jwt.decode(idToken) as { email?: string } | null;
  return payload?.email ?? null;
}

/**
 * GET /api/google-calendar/callback — Google sends the browser back here. Swaps
 * the code for a refresh token and keeps it; answers where to send the browser
 * next (the profile, saying how it went).
 */
export async function finishGoogleCalendarConnect(q: {
  code?: string;
  state?: string;
  error?: string;
}): Promise<string> {
  const back = (result: string) => `${env.frontendUrl}/profile?google=${result}#google-calendar`;
  if (q.error) return back(q.error === 'access_denied' ? 'declined' : 'failed');
  let userId: string;
  try {
    userId = (jwt.verify(q.state ?? '', stateKey()) as { sub: string }).sub;
  } catch {
    return back('expired');
  }
  const key = tokenKey();
  if (!googleCalendarAvailable() || !key || !q.code) return back('failed');
  const res = await doFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: q.code,
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      redirect_uri: env.google.calendarRedirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) return back('failed');
  const body = (await res.json()) as {
    refresh_token?: string;
    access_token?: string;
    expires_in?: number;
    id_token?: string;
    scope?: string;
  };
  // They may untick the calendar box on Google's screen.
  if (!body.refresh_token || !body.scope?.includes('calendar.readonly')) return back('declined');
  const data = {
    email: emailFromIdToken(body.id_token),
    refreshToken: encryptToken(body.refresh_token, key),
    connectedAt: new Date(),
    lastError: null,
    lastErrorAt: null,
  };
  await prisma.googleCalendarLink.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  if (body.access_token) {
    accessTokens.set(userId, {
      token: body.access_token,
      until: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
    });
  }
  return back('connected');
}

/** DELETE /api/google-calendar — forget it here, and tell Google to drop our access. */
export async function disconnectGoogleCalendar(userId: string): Promise<void> {
  const link = await prisma.googleCalendarLink.findUnique({ where: { userId } });
  if (!link) return;
  await prisma.googleCalendarLink.delete({ where: { userId } });
  accessTokens.delete(userId);
  const key = tokenKey();
  if (!key) return;
  try {
    const token = decryptToken(link.refreshToken, key);
    await doFetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' });
  } catch {
    /* gone already, or Google unreachable: it is forgotten here either way */
  }
}

const accessTokens = new Map<string, { token: string; until: number }>();

class Revoked extends Error {}

async function accessTokenFor(userId: string, sealed: string, key: Buffer): Promise<string> {
  const cached = accessTokens.get(userId);
  if (cached && cached.until > Date.now()) return cached.token;
  const res = await doFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: decryptToken(sealed, key),
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (res.status === 400 || res.status === 401)
    throw new Revoked('Google no longer lets HL Central read your calendar');
  if (!res.ok) throw new Error(`Google answered ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in?: number };
  accessTokens.set(userId, {
    token: body.access_token,
    until: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
  });
  return body.access_token;
}

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

/** A Google all-day date ("2026-11-20") as that day's midnight, UTC (as our all-day events). */
const dayIso = (d: string) => new Date(`${d}T00:00:00.000Z`).toISOString();

function toDto(e: GoogleEvent): GoogleEventDto | null {
  if (e.status === 'cancelled' || !e.start || !e.end) return null;
  const allDay = !!e.start.date;
  const start = allDay ? dayIso(e.start.date!) : e.start.dateTime;
  // Google's all-day end is the day after; ours is the last day itself.
  const end = allDay
    ? new Date(Date.parse(dayIso(e.end.date!)) - 86_400_000).toISOString()
    : e.end.dateTime;
  if (!start || !end) return null;
  return {
    id: e.id,
    title: e.summary?.trim() || '(No title)',
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
    allDay,
    location: e.location ?? null,
    link: e.htmlLink ?? null,
  };
}

/** GET /api/google-calendar/events — the reader's own Google events in a range. */
export async function listGoogleEvents(
  userId: string,
  from: string,
  to: string,
): Promise<GoogleEventsDto> {
  const link = await prisma.googleCalendarLink.findUnique({ where: { userId } });
  const key = tokenKey();
  if (!link || !key || !googleCalendarAvailable()) {
    return { connected: !!link, events: [], problem: null };
  }
  try {
    const token = await accessTokenFor(userId, link.refreshToken, key);
    const events: GoogleEventDto[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page++) {
      const q = new URLSearchParams({
        timeMin: new Date(from).toISOString(),
        timeMax: new Date(to).toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
        ...(pageToken && { pageToken }),
      });
      const res = await doFetch(`${EVENTS_URL}?${q.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        accessTokens.delete(userId);
        throw new Revoked('Google no longer lets HL Central read your calendar');
      }
      if (!res.ok) throw new Error(`Google answered ${res.status}`);
      const body = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
      for (const e of body.items ?? []) {
        const dto = toDto(e);
        if (dto) events.push(dto);
      }
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    if (link.lastError) {
      await prisma.googleCalendarLink.update({
        where: { userId },
        data: { lastError: null, lastErrorAt: null },
      });
    }
    return { connected: true, events, problem: null };
  } catch (err) {
    if (err instanceof Revoked) {
      const problem = `${err.message}. Connect it again from your profile.`;
      await prisma.googleCalendarLink.update({
        where: { userId },
        data: { lastError: problem, lastErrorAt: new Date() },
      });
      return { connected: true, events: [], problem };
    }
    // Google is down or slow: say so, keep the link.
    return {
      connected: true,
      events: [],
      problem: 'Google Calendar couldn’t be reached just now.',
    };
  }
}
