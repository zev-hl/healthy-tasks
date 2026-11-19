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
