import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient, Role } from '@prisma/client';
import { startTestDb, type TestDb } from './db.js';
import { memoryStorage } from '../src/storage/memory.storage.js';

/** Nov 2026 plan, Stage 3: the calendar, events, Google Calendar. */

let db: TestDb;
let app: Express;
let prisma: PrismaClient;
let prismaWithDeleted: PrismaClient;
let hashPassword: (plaintext: string) => Promise<string>;
let resetUnreadCache: () => void;

const PW = 'Stage3Pass123!';
const ADMIN = 'admin@test.local';

before(async () => {
  db = await startTestDb();
  process.env.DATABASE_URL = db.databaseUrl;
  process.env.JWT_SECRET = 'stage3-test-secret';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.FRONTEND_URL = 'http://localhost:5173';
  process.env.EMAIL_PROVIDER = 'console';
  process.env.EMAIL_DELIVERY = 'direct';
  delete process.env.REDIS_URL;
  process.env.NODE_ENV = 'test';
  process.env.GOOGLE_ALLOWED_DOMAIN = '';
  process.env.STORAGE_DRIVER = 'memory';
  process.env.EXCLUSIVES_SWEEP_ENABLED = 'false';
  process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_CALENDAR_REDIRECT_URI = 'http://localhost:4000/api/google-calendar/callback';
  process.env.GOOGLE_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
  const [appMod, prismaMod, pwMod, cacheMod] = await Promise.all([
    import('../src/app.js'),
    import('../src/db/prisma.js'),
    import('../src/utils/password.js'),
    import('../src/services/unread-cache.js'),
  ]);
  app = appMod.createApp();
  prisma = prismaMod.prisma;
  prismaWithDeleted = prismaMod.prismaWithDeleted;
  hashPassword = pwMod.hashPassword;
  resetUnreadCache = cacheMod.__resetUnreadCache;
});

after(async () => {
  await prisma?.$disconnect();
  await prismaWithDeleted?.$disconnect();
  await db?.stop();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Task", "PasswordResetToken", "User", "SchedulerState", "AppSetting", "Department" RESTART IDENTITY CASCADE',
  );
  memoryStorage.__reset();
  resetUnreadCache();
  await seedUser(ADMIN, 'Admin');
});

async function seedUser(email: string, role: Role, supervisorId: string | null = null) {
  return prisma.user.create({
    data: { email, role, passwordHash: await hashPassword(PW), supervisorId },
  });
}

async function login(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: PW });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token as string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function makeTask(token: string, name: string, extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/tasks')
    .set(auth(token))
    .send({ name, ...extra });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body as { id: number; updatedAt: string };
}

const at = (days: number, hour = 10) => {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  return new Date(d.getTime() + days * 86_400_000).toISOString();
};
const calendar = (token: string, scope: 'me' | 'team' = 'me') =>
  request(app)
    .get(`/api/calendar?from=${at(-7, 0)}&to=${at(30, 0)}&scope=${scope}`)
    .set(auth(token));

describe('Stage 3: events (H4a)', () => {
  it('makes an event with attendees, a place and a linked task; attendees are told', async () => {
    const admin = await login(ADMIN);
    const ana = await seedUser('ana@test.local', 'Member');
    const anaTok = await login('ana@test.local');
    const t = await makeTask(admin, 'Plan the Q1 launch');
    const res = await request(app)
      .post('/api/events')
      .set(auth(admin))
      .send({
        kind: 'meeting',
        title: 'Launch kickoff',
        startAt: at(2, 14),
        endAt: at(2, 15),
        location: 'https://meet.example.com/abc',
        notes: 'Bring the numbers',
        taskId: t.id,
        attendeeIds: [ana.id],
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.task.name, 'Plan the Q1 launch');
    assert.equal(res.body.attendees[0].id, ana.id);
    assert.equal(res.body.canEdit, true);

    // Ana sees it on her calendar, with a notice, but can't change it.
    const cal = (await calendar(anaTok)).body;
    assert.equal(cal.events.length, 1);
    assert.equal(cal.events[0].canEdit, false);
    const notices = (await request(app).get('/api/notifications').set(auth(anaTok))).body;
    assert.equal(notices.events.length, 1);
    assert.equal(notices.events[0].type, 'eventInvited');
    assert.equal(
      (await request(app).get('/api/notifications/unread-count').set(auth(anaTok))).body.events,
      1,
    );
    const edit = await request(app)
      .patch(`/api/events/${res.body.id}`)
      .set(auth(anaTok))
      .send({ kind: 'meeting', title: 'Mine now', startAt: at(2, 14), endAt: at(2, 15) });
    assert.equal(edit.status, 403);

    // On the task, too.
    const onTask = (await request(app).get(`/api/tasks/${t.id}/events`).set(auth(anaTok))).body;
    assert.equal(onTask.length, 1);
  });

  it('moving it tells those who stay, adding tells the new, removing and canceling tell those left out', async () => {
    const admin = await login(ADMIN);
    const ana = await seedUser('ana2@test.local', 'Member');
    const bo = await seedUser('bo2@test.local', 'Member');
    const made = (
      await request(app)
        .post('/api/events')
        .set(auth(admin))
        .send({
          kind: 'call',
          title: 'Supplier call',
          startAt: at(1),
          endAt: at(1, 11),
          attendeeIds: [ana.id],
        })
    ).body;
    const moved = await request(app)
      .patch(`/api/events/${made.id}`)
      .set(auth(admin))
      .send({
        kind: 'call',
        title: 'Supplier call',
        startAt: at(3),
        endAt: at(3, 11),
        attendeeIds: [ana.id, bo.id],
        expectedUpdatedAt: made.updatedAt,
      });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const types = async (userId: string) =>
      (
        await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })
      ).map((n) => n.type);
    assert.deepEqual(await types(ana.id), ['eventInvited', 'eventChanged']);
    assert.deepEqual(await types(bo.id), ['eventInvited']);
    // A stale save is refused.
    const stale = await request(app)
      .patch(`/api/events/${made.id}`)
      .set(auth(admin))
      .send({
        kind: 'call',
        title: 'x',
        startAt: at(3),
        endAt: at(3, 11),
        expectedUpdatedAt: made.updatedAt,
      });
    assert.equal(stale.status, 409);

    assert.equal(
      (await request(app).delete(`/api/events/${made.id}`).set(auth(admin))).status,
      204,
    );
    assert.deepEqual(await types(bo.id), ['eventInvited', 'eventCanceled']);
    assert.equal((await calendar(admin)).body.events.length, 0);
    assert.equal((await request(app).get(`/api/events/${made.id}`).set(auth(admin))).status, 404);
  });

  it('a private event is seen only by its creator, attendees and Admins; Team shows the team’s', async () => {
    const admin = await login(ADMIN);
    const mgr = await seedUser('mgr@test.local', 'Manager');
    const ana = await seedUser('ana3@test.local', 'Member', mgr.id);
    const bo = await seedUser('bo3@test.local', 'Member');
    const mgrTok = await login('mgr@test.local');
    const anaTok = await login('ana3@test.local');
    const boTok = await login('bo3@test.local');
    const mk = (token: string, title: string, extra: Record<string, unknown> = {}) =>
      request(app)
        .post('/api/events')
        .set(auth(token))
        .send({ kind: 'other', title, startAt: at(1), endAt: at(1, 11), ...extra });
    assert.equal((await mk(anaTok, 'Dentist', { isPrivate: true })).status, 201);
    assert.equal((await mk(anaTok, 'Shelf audit')).status, 201);

    // Ana's manager sees Ana's open event on Team, not the private one.
    const team = (await calendar(mgrTok, 'team')).body.events.map(
      (e: { title: string }) => e.title,
    );
    assert.deepEqual(team, ['Shelf audit']);
    assert.deepEqual((await calendar(mgrTok, 'me')).body.events, []);
    // Bo isn't on Ana's team.
    assert.deepEqual((await calendar(boTok, 'team')).body.events, []);
    // An Admin sees both on Team.
    assert.equal((await calendar(admin, 'team')).body.events.length, 2);
    void bo;
  });

  it('refuses an event that ends before it starts, or with a task the reader can’t open', async () => {
    const admin = await login(ADMIN);
    await seedUser('cy@test.local', 'Member');
    const cyTok = await login('cy@test.local');
    const t = await makeTask(admin, 'Hidden');
    await prisma.task.update({ where: { id: t.id }, data: { isPrivate: true } });
    const backwards = await request(app)
      .post('/api/events')
      .set(auth(admin))
      .send({ kind: 'meeting', title: 'x', startAt: at(2, 15), endAt: at(2, 14) });
    assert.equal(backwards.status, 400);
    const hidden = await request(app)
      .post('/api/events')
      .set(auth(cyTok))
      .send({ kind: 'meeting', title: 'x', startAt: at(2), endAt: at(2, 11), taskId: t.id });
    assert.equal(hidden.status, 400);
  });

  it('shows my reminders on my calendar only', async () => {
    const admin = await login(ADMIN);
    const t = await makeTask(admin, 'Call the bank');
    const r = await request(app)
      .post(`/api/tasks/${t.id}/reminders`)
      .set(auth(admin))
      .send({ remindAt: at(2, 9), note: 'Ask about fees' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const cal = (await calendar(admin)).body;
    assert.equal(cal.reminders.length, 1);
    assert.equal(cal.reminders[0].taskName, 'Call the bank');
    assert.equal(cal.reminders[0].note, 'Ask about fees');
  });
});

describe('Stage 3: Google Calendar, read-only (H6)', () => {
  /** A stand-in for Google: answers the token and events calls, and records them. */
  function fakeGoogle(opts: { refreshFails?: boolean } = {}) {
    const calls: string[] = [];
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const idToken = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ email: 'me@gmail.com' })}.sig`;
    const fetchFn = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url.split('?')[0]!);
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        const body = new URLSearchParams(String(init?.body));
        if (body.get('grant_type') === 'authorization_code') {
          return json(200, {
            refresh_token: 'refresh-123',
            access_token: 'access-1',
            expires_in: 3600,
            id_token: idToken,
            scope: 'openid email https://www.googleapis.com/auth/calendar.readonly',
          });
        }
        return opts.refreshFails
          ? json(400, { error: 'invalid_grant' })
          : json(200, { access_token: 'access-2', expires_in: 3600 });
      }
      if (url.startsWith('https://www.googleapis.com/calendar/v3/')) {
        return json(200, {
          items: [
            {
              id: 'g1',
              summary: 'Dentist',
              start: { dateTime: '2026-11-21T15:00:00Z' },
              end: { dateTime: '2026-11-21T16:00:00Z' },
              htmlLink: 'https://calendar.google.com/event?eid=g1',
            },
            {
              id: 'g2',
              summary: 'Holiday',
              start: { date: '2026-11-26' },
              end: { date: '2026-11-28' },
            },
            {
              id: 'g3',
              status: 'cancelled',
              start: { date: '2026-11-26' },
              end: { date: '2026-11-27' },
            },
          ],
        });
      }
      if (url.startsWith('https://oauth2.googleapis.com/revoke'))
        return new Response('', { status: 200 });
      return new Response('', { status: 404 });
    }) as typeof fetch;
    return { fetchFn, calls };
  }

  async function connect(token: string) {
    const start = await request(app).post('/api/google-calendar/connect').set(auth(token));
    assert.equal(start.status, 200, JSON.stringify(start.body));
    const url = new URL(start.body.url);
    assert.match(url.searchParams.get('scope')!, /calendar\.readonly/);
    const back = await request(app)
      .get(`/api/google-calendar/callback?code=abc&state=${url.searchParams.get('state')}`)
      .redirects(0);
    assert.equal(back.status, 302);
    return back.headers.location as string;
  }

  it('connects, keeps the refresh token sealed, lists the Google events, and disconnects', async () => {
    const { __setGoogleFetch } = await import('../src/services/google-calendar.service.js');
    const g = fakeGoogle();
    __setGoogleFetch(g.fetchFn);
    const admin = await login(ADMIN);
    assert.equal(
      (await request(app).get('/api/google-calendar').set(auth(admin))).body.available,
      true,
    );
    assert.match(await connect(admin), /google=connected/);

    const link = await prisma.googleCalendarLink.findFirstOrThrow();
    assert.equal(link.email, 'me@gmail.com');
    assert.ok(!link.refreshToken.includes('refresh-123'), 'stored sealed');

    const ev = (
      await request(app)
        .get('/api/google-calendar/events?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z')
        .set(auth(admin))
    ).body;
    assert.equal(ev.connected, true);
    assert.deepEqual(
      ev.events.map((e: { title: string; allDay: boolean; endAt: string }) => [
        e.title,
        e.allDay,
        e.endAt,
      ]),
      [
        ['Dentist', false, '2026-11-21T16:00:00.000Z'],
        // Google's all-day end is the day after; ours is the last day.
        ['Holiday', true, '2026-11-27T00:00:00.000Z'],
      ],
    );

    assert.equal((await request(app).delete('/api/google-calendar').set(auth(admin))).status, 204);
    assert.ok(g.calls.includes('https://oauth2.googleapis.com/revoke'));
    assert.equal(await prisma.googleCalendarLink.count(), 0);
    __setGoogleFetch(null);
  });

  it('says so when Google takes the access away', async () => {
    const { __setGoogleFetch } = await import('../src/services/google-calendar.service.js');
    __setGoogleFetch(fakeGoogle({ refreshFails: true }).fetchFn);
    const admin = await login(ADMIN);
    await connect(admin);
    // Forget the access token from connecting, so the next read must refresh.
    __setGoogleFetch(fakeGoogle({ refreshFails: true }).fetchFn);
    const ev = (
      await request(app)
        .get('/api/google-calendar/events?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z')
        .set(auth(admin))
    ).body;
    assert.deepEqual(ev.events, []);
    assert.match(ev.problem, /no longer lets HL Central read your calendar/);
    assert.match(
      (await request(app).get('/api/google-calendar').set(auth(admin))).body.problem,
      /Connect it again/,
    );
    __setGoogleFetch(null);
  });

  it('a forged or old state does not connect anyone', async () => {
    const back = await request(app)
      .get('/api/google-calendar/callback?code=abc&state=nope')
      .redirects(0);
    assert.match(back.headers.location, /google=expired/);
    assert.equal(await prisma.googleCalendarLink.count(), 0);
  });
});
