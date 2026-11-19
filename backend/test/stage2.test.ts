import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient, Role } from '@prisma/client';
import { startTestDb, type TestDb } from './db.js';
import { memoryStorage } from '../src/storage/memory.storage.js';

/**
 * Nov 2026 plan, Stage 2 (workflows): snooze, reminders,
 * request update, notification settings and the rest of Stage 2.
 *
 */

let db: TestDb;
let app: Express;
let prisma: PrismaClient;
let prismaWithDeleted: PrismaClient;
let hashPassword: (plaintext: string) => Promise<string>;
let resetUnreadCache: () => void;

const PW = 'Stage2Pass123!';
const ADMIN = 'admin@test.local';

before(async () => {
  db = await startTestDb();
  process.env.DATABASE_URL = db.databaseUrl;
  process.env.JWT_SECRET = 'stage2-test-secret';
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

const getTask = (token: string, id: number) =>
  request(app).get(`/api/tasks/${id}`).set(auth(token));
const setParent = (token: string, id: number, parentId: number) =>
  request(app).put(`/api/tasks/${id}/parent`).set(auth(token)).send({ parentId });
const patch = (token: string, id: number, body: Record<string, unknown>) =>
  request(app).patch(`/api/tasks/${id}`).set(auth(token)).send(body);

const query = (token: string, body: Record<string, unknown>) =>
  request(app).post('/api/tasks/query').set(auth(token)).send(body);
const notifs = async (token: string) =>
  (await request(app).get('/api/notifications').set(auth(token))).body as {
    reminders: { id: string; taskId: number; source: string; note: string | null }[];
  };
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

describe('Stage 2: snooze (E1, E2)', () => {
  it('the assignee, the creator or someone above them may snooze, up to 30 days', async () => {
    const admin = await login(ADMIN);
    const boss = await seedUser('boss@test.local', 'Manager');
    const worker = await seedUser('worker@test.local', 'Member', boss.id);
    await seedUser('other@test.local', 'Member');
    const t = await makeTask(admin, 'Park me', { assigneeId: worker.id });
    const workerTok = await login('worker@test.local');
    const otherTok = await login('other@test.local');
    const bossTok = await login('boss@test.local');
    const snooze = (tok: string, until: string) =>
      request(app).post(`/api/tasks/${t.id}/snooze`).set(auth(tok)).send({ until });

    assert.equal((await snooze(otherTok, inDays(2))).status, 403);
    assert.equal((await snooze(workerTok, inDays(31))).status, 400);
    assert.equal((await snooze(workerTok, inDays(-1))).status, 400);
    const ok = await snooze(bossTok, inDays(3));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.body.snoozedUntil);
    assert.equal(ok.body.snoozedBy.email, 'boss@test.local');
    // Others see "snoozed until" on the task; the due date is untouched.
    const seen = await getTask(otherTok, t.id);
    assert.ok(seen.body.snoozedUntil);
    assert.equal(seen.body.canSnooze, false);
  });

  it('leaves the active lists until its time; the Snoozed view lists it', async () => {
    const admin = await login(ADMIN);
    const parked = await makeTask(admin, 'Parked one');
    const active = await makeTask(admin, 'Active one');
    await request(app)
      .post(`/api/tasks/${parked.id}/snooze`)
      .set(auth(admin))
      .send({ until: inDays(1) });
    const ids = async (filters: Record<string, unknown>) =>
      ((await query(admin, { filters })).body.rows as { id: number }[]).map((r) => r.id).sort();
    assert.deepEqual(await ids({}), [active.id]);
    assert.deepEqual(await ids({ snoozed: 'only' }), [parked.id]);
    assert.deepEqual(await ids({ snoozed: 'include' }), [parked.id, active.id].sort());
    const row = (await query(admin, { filters: { snoozed: 'only' } })).body.rows[0];
    assert.ok(row.snoozedUntil);
  });

  it('comes back by itself as a reminder for whoever snoozed it and the assignee', async () => {
    const admin = await login(ADMIN);
    const worker = await seedUser('w2@test.local', 'Member');
    const t = await makeTask(admin, 'Wake me', { assigneeId: worker.id });
    await request(app)
      .post(`/api/tasks/${t.id}/snooze`)
      .set(auth(admin))
      .send({ until: inDays(1) });
    const wakes = await prisma.reminder.findMany({ where: { taskId: t.id, kind: 'snooze' } });
    assert.equal(wakes.length, 2);
    assert.equal((await notifs(admin)).reminders.length, 0, 'not yet');

    // Its time comes.
    const past = new Date(Date.now() - 60_000);
    await prisma.task.update({ where: { id: t.id }, data: { snoozedUntil: past } });
    await prisma.reminder.updateMany({ where: { taskId: t.id }, data: { remindAt: past } });
    resetUnreadCache();
    const back = (await notifs(admin)).reminders;
    assert.equal(back.length, 1);
    assert.equal(back[0]!.source, 'snooze');
    const workerFeed = await notifs(await login('w2@test.local'));
    assert.equal(workerFeed.reminders[0]?.source, 'snooze');
    const listed = ((await query(admin, {})).body.rows as { id: number }[]).map((r) => r.id);
    assert.ok(listed.includes(t.id), 'back in the active lists');
    assert.equal((await getTask(admin, t.id)).body.snoozedUntil, null);
  });

  it('bringing it back early (or snoozing again) drops the wake-up still to come', async () => {
    const admin = await login(ADMIN);
    const t = await makeTask(admin, 'Change of plan');
    const snooze = (until: string) =>
      request(app).post(`/api/tasks/${t.id}/snooze`).set(auth(admin)).send({ until });
    await snooze(inDays(2));
    await snooze(inDays(5));
    const wakes = await prisma.reminder.findMany({ where: { taskId: t.id, kind: 'snooze' } });
    assert.equal(wakes.length, 1, 'the second snooze replaced the first');
    const res = await request(app).delete(`/api/tasks/${t.id}/snooze`).set(auth(admin));
    assert.equal(res.status, 200);
    assert.equal(res.body.snoozedUntil, null);
    assert.equal(await prisma.reminder.count({ where: { taskId: t.id, kind: 'snooze' } }), 0);
    const history = await prisma.taskHistory.findMany({
      where: { taskId: t.id, field: 'snooze' },
      orderBy: { id: 'asc' },
    });
    assert.deepEqual(
      history.map((h) => h.changeType),
      ['added', 'added', 'removed'],
    );
  });
});
