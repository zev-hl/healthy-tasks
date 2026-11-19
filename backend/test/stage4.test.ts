import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient, Role } from '@prisma/client';
import { startTestDb, type TestDb } from './db.js';
import { memoryStorage } from '../src/storage/memory.storage.js';

/** Nov 2026 plan, Stage 4: our Connect (K2–K7), against a stand-in for Connect. */

let db: TestDb;
let app: Express;
let prisma: PrismaClient;
let prismaWithDeleted: PrismaClient;
let hashPassword: (plaintext: string) => Promise<string>;
let resetUnreadCache: () => void;

const PW = 'Stage4Pass123!';
const ADMIN = 'admin@test.local';
const INBOUND = 'inbound-key-0123456789-0123456789-abcdef';

before(async () => {
  db = await startTestDb();
  process.env.DATABASE_URL = db.databaseUrl;
  process.env.JWT_SECRET = 'stage4-test-secret';
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
  process.env.CONNECT_URL = 'https://connect.test';
  process.env.CONNECT_API_KEY = 'brx_test_key';
  process.env.CONNECT_INBOUND_KEY = INBOUND;
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

/** A stand-in for our Connect: records every call; answers can be set per path. */
interface Sent {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}
let sent: Sent[] = [];
let answer: (s: Sent) => { status: number; body: unknown } | null = () => null;
let connectSettled: () => Promise<void>;

function fakeConnect(): typeof fetch {
  let n = 0;
  return (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const s: Sent = {
      method: init?.method ?? 'GET',
      path: url.pathname + url.search,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer brx_test_key');
    sent.push(s);
    const custom = answer(s);
    const reply = (status: number, b: unknown) =>
      new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (custom) return reply(custom.status, custom.body);
    n += 1;
    if (url.pathname === '/api/v1/bots/messages')
      return reply(201, { ok: true, conversationId: 'c1', messageId: `m${n}` });
    if (url.pathname === '/api/v1/bots/convenes' && s.method === 'POST')
      return reply(201, {
        call: {
          id: `cv${n}`,
          status: 'scheduled',
          joinUrl: `https://connect.test/dms?c=x&m=${n}`,
          skipped: [],
        },
      });
    if (url.pathname.startsWith('/api/v1/bots/convenes/'))
      return reply(200, {
        call: {
          id: 'cv',
          status: s.method === 'DELETE' ? 'cancelled' : 'scheduled',
          joinUrl: 'https://connect.test/dms?c=x&m=moved',
        },
      });
    if (url.pathname === '/api/v1/bots/calls')
      return reply(201, {
        call: {
          id: `call${n}`,
          status: 'ringing',
          joinUrl: 'https://connect.test/dms?c=r',
          skipped: [],
        },
      });
    if (url.pathname === '/api/v1/bots/groups')
      return reply(201, { conversation: { id: 'grp1' }, skipped: [] });
    if (url.pathname.startsWith('/api/v1/bots/groups/')) return reply(200, { ok: true });
    return reply(404, { error: 'Not found' });
  }) as typeof fetch;
}

before(async () => {
  const mod = await import('../src/services/connect.service.js');
  mod.__setConnectFetch(fakeConnect());
  connectSettled = (await import('../src/services/connect-notify.service.js')).connectSettled;
});
beforeEach(() => {
  sent = [];
  answer = () => null;
});

const at = (days: number, hour = 10) => {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  return new Date(d.getTime() + days * 86_400_000).toISOString();
};
const prefs = (token: string, body: Record<string, unknown>) =>
  request(app).put('/api/notifications/preferences').set(auth(token)).send(body);
const messages = () => sent.filter((s) => s.path === '/api/v1/bots/messages');

describe('Stage 4: task notices as Connect messages (K3)', () => {
  it('goes to those who turned Connect on for it, with a link back', async () => {
    const admin = await login(ADMIN);
    await seedUser('ana@test.local', 'Member');
    const ana = await login('ana@test.local');
    const anaId = (await prisma.user.findUniqueOrThrow({ where: { email: 'ana@test.local' } })).id;
    const t = await makeTask(admin, 'Restock shelf B', { assigneeId: anaId });
    await connectSettled();
    // Connect is off by default: nothing was sent for the assignment.
    assert.equal(messages().length, 0);

    assert.equal(
      (await prefs(ana, { matrix: { status: { connect: true }, comment: { connect: true } } }))
        .status,
      200,
    );
    const moved = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(admin))
      .send({ status: 'InProgress' });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    await connectSettled();
    const m = messages();
    assert.equal(m.length, 1);
    assert.equal(m[0]!.body!.to, 'ana@test.local');
    assert.match(String(m[0]!.body!.text), /HL Central:.*Restock shelf B/s);
    assert.match(String(m[0]!.body!.text), new RegExp(`/tasks/${t.id}`));
    assert.ok(m[0]!.body!.idempotencyKey);
  });

  it('assignments and reminders too, by their own settings', async () => {
    const admin = await login(ADMIN);
    await seedUser('bo@test.local', 'Member');
    const bo = await login('bo@test.local');
    const boId = (await prisma.user.findUniqueOrThrow({ where: { email: 'bo@test.local' } })).id;
    await prefs(bo, { matrix: { assigned: { connect: true }, reminder: { connect: true } } });
    const t = await makeTask(admin, 'Count pallets', { assigneeId: boId });
    await connectSettled();
    assert.match(String(messages()[0]?.body?.text), /assigned you “Count pallets”/);

    sent = [];
    const r = await request(app)
      .post(`/api/tasks/${t.id}/reminders`)
      .set(auth(bo))
      .send({ remindAt: at(1) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    await prisma.reminder.updateMany({ data: { remindAt: new Date(Date.now() - 60_000) } });
    const { dispatchDueReminderEmails } = await import('../src/services/notification.service.js');
    await dispatchDueReminderEmails(new Date());
    await dispatchDueReminderEmails(new Date());
    await connectSettled();
    const rem = messages();
    assert.equal(rem.length, 1, 'once');
    assert.match(String(rem[0]!.body!.text), /Reminder: “Count pallets”/);
  });
});

describe('Stage 4: Schedule call on a task (K2)', () => {
  async function setup() {
    const admin = await login(ADMIN);
    const ana = await seedUser('ana5@test.local', 'Member');
    const t = await makeTask(admin, 'Supplier contract');
    return { admin, ana, t };
  }

  it('books a Connect call at a time: a Call on the task and the calendar, with the join link', async () => {
    const { admin, ana, t } = await setup();
    const res = await request(app)
      .post(`/api/tasks/${t.id}/calls`)
      .set(auth(admin))
      .send({ when: at(2, 15), minutes: 30, participantIds: [ana.id] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.booked, true);
    assert.equal(res.body.event.kind, 'call');
    assert.equal(res.body.event.connect.kind, 'convene');
    assert.match(res.body.event.location, /^https:\/\/connect\.test\//);
    const book = sent.find((s) => s.path === '/api/v1/bots/convenes')!;
    assert.equal(book.body!.host, ADMIN);
    assert.deepEqual(book.body!.participants, ['ana5@test.local']);
    assert.equal(book.body!.externalRef, `hlcentral:event:${res.body.event.id}`);
    const onTask = (await request(app).get(`/api/tasks/${t.id}/events`).set(auth(admin))).body;
    assert.equal(onTask.length, 1);

    // Moving it moves the Connect call; canceling it cancels the call.
    const moved = await request(app)
      .patch(`/api/events/${res.body.event.id}`)
      .set(auth(admin))
      .send({
        kind: 'call',
        title: res.body.event.title,
        startAt: at(3, 15),
        endAt: at(3, 16),
        taskId: t.id,
        attendeeIds: [ana.id],
      });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const patch = sent.find((s) => s.method === 'PATCH')!;
    assert.equal(patch.body!.startAt, at(3, 15));
    await request(app).delete(`/api/events/${res.body.event.id}`).set(auth(admin));
    assert.ok(
      sent.some((s) => s.method === 'DELETE' && s.path.startsWith('/api/v1/bots/convenes/')),
    );
  });

  it('rings now', async () => {
    const { admin, ana, t } = await setup();
    const res = await request(app)
      .post(`/api/tasks/${t.id}/calls`)
      .set(auth(admin))
      .send({ when: 'now', minutes: 15, participantIds: [ana.id] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.event.connect.kind, 'ring');
    assert.ok(sent.some((s) => s.path === '/api/v1/bots/calls'));
  });

  it('when Connect can’t book it, it is saved as a meeting and says why', async () => {
    const { admin, ana, t } = await setup();
    answer = (s) =>
      s.path === '/api/v1/bots/convenes'
        ? {
            status: 400,
            body: { error: 'The host already has a scheduled call within 15 minutes of that time' },
          }
        : null;
    const res = await request(app)
      .post(`/api/tasks/${t.id}/calls`)
      .set(auth(admin))
      .send({ when: at(2, 15), minutes: 30, participantIds: [ana.id] });
    assert.equal(res.status, 201);
    assert.equal(res.body.booked, false);
    assert.equal(res.body.event.kind, 'meeting');
    assert.equal(res.body.event.connect, null);
    assert.match(res.body.reason, /already has a scheduled call/);
  });
});

describe('Stage 4: Discuss in Connect (K5)', () => {
  it('makes the task’s group chat with the assignee, creator and supervisor, then reopens it', async () => {
    const admin = await login(ADMIN);
    const mgr = await seedUser('mgr@test.local', 'Manager');
    const ana = await seedUser('ana6@test.local', 'Member', mgr.id);
    await seedUser('cy@test.local', 'Member');
    const cy = await login('cy@test.local');
    const t = await makeTask(admin, 'Fix the label printer', { assigneeId: ana.id });
    const first = await request(app).post(`/api/tasks/${t.id}/discuss`).set(auth(admin));
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.created, true);
    assert.equal(first.body.url, 'https://connect.test/dms?c=grp1');
    const group = sent.find((s) => s.path === '/api/v1/bots/groups')!;
    assert.deepEqual([...(group.body!.members as string[])].sort(), [
      'admin@test.local',
      'ana6@test.local',
      'mgr@test.local',
    ]);
    assert.match(String(group.body!.name), /Fix the label printer/);
    const hello = messages()[0]!;
    assert.equal(hello.body!.conversationId, 'grp1');
    assert.match(String(hello.body!.text), new RegExp(`/tasks/${t.id}`));

    sent = [];
    const again = await request(app).post(`/api/tasks/${t.id}/discuss`).set(auth(cy));
    assert.equal(again.body.created, false);
    assert.ok(!sent.some((s) => s.path === '/api/v1/bots/groups'));
    assert.deepEqual(sent[0]!.body, { members: ['cy@test.local'] });
  });
});

describe('Stage 4: what Connect calls on HL Central (K6, K7)', () => {
  const inbound = (method: 'get' | 'post', path: string, key = INBOUND) =>
    request(app)[method](`/api/integrations/connect${path}`).set('Authorization', `Bearer ${key}`);

  it('refuses without the key', async () => {
    assert.equal((await inbound('get', '/tasks?as=admin@test.local', 'wrong')).status, 401);
    assert.equal(
      (await request(app).get('/api/integrations/connect/tasks?as=admin@test.local')).status,
      401,
    );
  });

  it('makes a task from a chat as the person, lists their tasks, and runs their timer', async () => {
    await seedUser('ana7@test.local', 'Member');
    const made = await inbound('post', '/tasks').send({
      as: 'ana7@test.local',
      name: 'Order more boxes',
      text: 'We are down to <10 boxes',
      sourceUrl: 'https://connect.test/dms?c=1&m=2',
    });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.match(made.body.url, new RegExp(`/tasks/${made.body.id}$`));
    const task = await prisma.task.findUniqueOrThrow({ where: { id: made.body.id } });
    assert.match(task.description ?? '', /&lt;10 boxes/);
    assert.match(task.description ?? '', /From Connect: https:\/\/connect\.test/);

    const list = (await inbound('get', '/tasks?as=ana7@test.local')).body.tasks;
    assert.deepEqual(
      list.map((x: { name: string }) => x.name),
      ['Order more boxes'],
    );

    const started = await inbound('post', '/timer/start').send({
      as: 'ana7@test.local',
      taskId: made.body.id,
      replacing: null,
    });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.timer.taskId, made.body.id);
    const stopped = await inbound('post', '/timer/stop').send({
      as: 'ana7@test.local',
      taskId: made.body.id,
    });
    assert.equal(stopped.status, 200);
    assert.equal(stopped.body.timer, null);
    assert.equal(stopped.body.saved.minutes, 1);

    assert.equal((await inbound('get', '/tasks?as=nobody@test.local')).status, 404);
  });
});

describe('Stage 4: Connect calls on the calendar (K4)', () => {
  it('lists the reader’s own Connect calls, leaving out the ones HL Central booked', async () => {
    const admin = await login(ADMIN);
    // Until our Connect has the call, it says it isn't available.
    const none = (
      await request(app)
        .get(`/api/connect/calls?from=${at(0, 0)}&to=${at(7, 0)}`)
        .set(auth(admin))
    ).body;
    assert.deepEqual(none, { available: false, calls: [] });
    answer = (s) =>
      s.path.startsWith('/api/v1/bots/people/')
        ? {
            status: 200,
            body: {
              calls: [
                {
                  id: 'a',
                  title: 'Standup',
                  startAt: at(1, 9),
                  endAt: null,
                  status: 'scheduled',
                  joinUrl: 'https://connect.test/a',
                  host: ADMIN,
                  externalRef: null,
                },
                {
                  id: 'b',
                  title: 'From HL',
                  startAt: at(1, 9),
                  endAt: null,
                  status: 'scheduled',
                  joinUrl: 'x',
                  host: ADMIN,
                  externalRef: 'hlcentral:event:1',
                },
              ],
            },
          }
        : null;
    const res = (
      await request(app)
        .get(`/api/connect/calls?from=${at(0, 0)}&to=${at(7, 0)}`)
        .set(auth(admin))
    ).body;
    assert.equal(res.available, true);
    assert.deepEqual(
      res.calls.map((c: { title: string }) => c.title),
      ['Standup'],
    );
    assert.ok(
      sent.at(-1)!.path.startsWith(`/api/v1/bots/people/${encodeURIComponent(ADMIN)}/convenes?`),
    );
  });
});
