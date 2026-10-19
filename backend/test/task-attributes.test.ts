import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import ExcelJS from 'exceljs';
import type { Express } from 'express';
import type { PrismaClient, Role } from '@prisma/client';
import { startTestDb, type TestDb } from './db.js';

/**
 * HLAI-118: a task's special attributes — Alert Group and Alert Type. Setting,
 * changing and clearing them, History, what a deleted group does, Duplicate,
 * recurring tasks, the list filters and the Excel export. Same harness as
 * integration.test.ts: a real ephemeral Postgres with the project's migrations.
 */

let db: TestDb;
let app: Express;
let prisma: PrismaClient;
let hashPassword: (plaintext: string) => Promise<string>;
let resetUnreadCache: () => void;
let runScheduler: (now: Date) => Promise<number>;

const PASSWORD = 'TestPass123!';
const ADMIN_EMAIL = 'admin@test.local';

before(async () => {
  db = await startTestDb();
  process.env.DATABASE_URL = db.databaseUrl;
  process.env.JWT_SECRET = 'task-attributes-test-secret';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.PASSWORD_RESET_EXPIRES_IN = '60m';
  process.env.FRONTEND_URL = 'http://localhost:5173';
  process.env.EMAIL_PROVIDER = 'console';
  process.env.EMAIL_DELIVERY = 'direct';
  delete process.env.REDIS_URL;
  process.env.NODE_ENV = 'test';
  process.env.GOOGLE_CLIENT_ID = 'test-google-client.apps.googleusercontent.com';
  process.env.GOOGLE_ALLOWED_DOMAIN = '';
  process.env.STORAGE_DRIVER = 'memory';
  process.env.SP_API_CLIENT_ID = 'test-client';
  process.env.SP_API_CLIENT_SECRET = 'test-secret';
  process.env.SP_API_REFRESH_TOKEN = 'test-refresh';
  process.env.SP_API_MERCHANT_TOKEN = 'A1UWLDVGZSXGKG';
  process.env.EXCLUSIVES_SWEEP_ENABLED = 'false';

  const [appMod, prismaMod, pwMod, cacheMod, schedMod] = await Promise.all([
    import('../src/app.js'),
    import('../src/db/prisma.js'),
    import('../src/utils/password.js'),
    import('../src/services/unread-cache.js'),
    import('../src/services/scheduler.service.js'),
  ]);
  app = appMod.createApp();
  prisma = prismaMod.prisma;
  hashPassword = pwMod.hashPassword;
  resetUnreadCache = cacheMod.__resetUnreadCache;
  runScheduler = schedMod.runScheduler;
});

after(async () => {
  await prisma?.$disconnect();
  await db?.stop();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Task", "PasswordResetToken", "User", "SchedulerState", "AppSetting", "AlertGroup" RESTART IDENTITY CASCADE',
  );
  resetUnreadCache();
  await seedUser({ email: ADMIN_EMAIL, role: 'Admin' });
});

// --- helpers ---------------------------------------------------------------

async function seedUser(opts: { email: string; role: Role }) {
  return prisma.user.create({
    data: {
      email: opts.email,
      role: opts.role,
      firstName: opts.email.split('@')[0]!,
      lastName: 'Test',
      passwordHash: await hashPassword(PASSWORD),
    },
  });
}

async function login(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const adminToken = () => login(ADMIN_EMAIL);

async function makeGroup(name: string): Promise<number> {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  const group = await prisma.alertGroup.create({
    data: { name, groupType: 'GROUP', createdById: admin.id },
  });
  return group.id;
}

async function makeTask(token: string, body: Record<string, unknown>): Promise<{ id: number }> {
  const res = await request(app).post('/api/tasks').set(auth(token)).send(body);
  assert.equal(res.status, 201, `create task failed: ${JSON.stringify(res.body)}`);
  return res.body as { id: number };
}

function patch(token: string, id: number, body: Record<string, unknown>) {
  return request(app).patch(`/api/tasks/${id}`).set(auth(token)).send(body);
}

async function getTask(token: string, id: number) {
  const res = await request(app).get(`/api/tasks/${id}`).set(auth(token));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as {
    alertGroup: { id: number; name: string; isActive: boolean } | null;
    alertType: string | null;
  };
}

async function history(token: string, id: number, field: string) {
  const res = await request(app).get(`/api/tasks/${id}/history`).set(auth(token));
  assert.equal(res.status, 200);
  return (res.body as { field: string; previousValue: string | null; newValue: string | null }[])
    .filter((h) => h.field === field)
    .map((h) => [h.previousValue, h.newValue])
    .reverse(); // History comes newest first; oldest first reads in order.
}

// --- On a task --------------------------------------------------------------

describe('task special attributes', () => {
  it('sets, changes and clears both, each change in History', async () => {
    const admin = await adminToken();
    const versure = await makeGroup('Versure Exclusives');
    const sports = await makeGroup('Sports Nutrition');
    const t = await makeTask(admin, { name: 'Coordinate cease and desist letter' });

    // A new task has neither.
    let task = await getTask(admin, t.id);
    assert.equal(task.alertGroup, null);
    assert.equal(task.alertType, null);

    const set = await patch(admin, t.id, { alertGroupId: versure, alertType: 'BuyBoxLost' });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.deepEqual(set.body.alertGroup, {
      id: versure,
      name: 'Versure Exclusives',
      isActive: true,
    });
    assert.equal(set.body.alertType, 'BuyBoxLost');

    // One at a time: the other stays.
    await patch(admin, t.id, { alertGroupId: sports }).expect(200);
    task = await getTask(admin, t.id);
    assert.deepEqual(task.alertGroup, { id: sports, name: 'Sports Nutrition', isActive: true });
    assert.equal(task.alertType, 'BuyBoxLost');

    // The same value again is no change.
    await patch(admin, t.id, { alertType: 'BuyBoxLost' }).expect(200);

    await patch(admin, t.id, { alertGroupId: null, alertType: null }).expect(200);
    task = await getTask(admin, t.id);
    assert.equal(task.alertGroup, null);
    assert.equal(task.alertType, null);

    assert.deepEqual(await history(admin, t.id, 'alertGroup'), [
      [null, 'Versure Exclusives'],
      ['Versure Exclusives', 'Sports Nutrition'],
      ['Sports Nutrition', null],
    ]);
    assert.deepEqual(await history(admin, t.id, 'alertType'), [
      [null, 'Buy Box Lost'],
      ['Buy Box Lost', null],
    ]);
  });

  it('refuses a group that does not exist and a type that is not one of the 12', async () => {
    const admin = await adminToken();
    const t = await makeTask(admin, { name: 'Task' });

    const noGroup = await patch(admin, t.id, { alertGroupId: 999, alertType: 'PriceChanged' });
    assert.equal(noGroup.status, 400);
    assert.match(noGroup.body.error, /no longer exists/);

    assert.equal((await patch(admin, t.id, { alertType: 'NotAType' })).status, 400);
    assert.equal((await patch(admin, t.id, { alertGroupId: 'abc' })).status, 400);

    // Nothing was saved, not even the valid half of the first request.
    const task = await getTask(admin, t.id);
    assert.equal(task.alertGroup, null);
    assert.equal(task.alertType, null);
  });

  it('an inactive Alert Group stays on its tasks, but cannot be picked', async () => {
    const admin = await adminToken();
    const versure = await makeGroup('Versure Exclusives');
    const sports = await makeGroup('Sports Nutrition');
    const t = await makeTask(admin, { name: 'Has it' });
    const other = await makeTask(admin, { name: 'Does not' });
    await patch(admin, t.id, { alertGroupId: versure, alertType: 'PriceChanged' }).expect(200);

    await prisma.alertGroup.update({ where: { id: versure }, data: { isActive: false } });

    // The task keeps it, marked inactive.
    assert.deepEqual((await getTask(admin, t.id)).alertGroup, {
      id: versure,
      name: 'Versure Exclusives',
      isActive: false,
    });
    // Saving the type alone, or the same group again, leaves it in place.
    await patch(admin, t.id, { alertType: 'BuyBoxLost' }).expect(200);
    await patch(admin, t.id, { alertGroupId: versure }).expect(200);
    assert.equal((await getTask(admin, t.id)).alertGroup?.id, versure);

    // Another task cannot pick it, and nothing of that request is saved.
    const refused = await patch(admin, other.id, {
      alertGroupId: versure,
      alertType: 'PriceChanged',
    });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /That Alert Group is inactive\. Pick another one\./);
    assert.equal((await getTask(admin, other.id)).alertGroup, null);
    assert.equal((await getTask(admin, other.id)).alertType, null);

    // Once changed, it cannot be picked back.
    await patch(admin, t.id, { alertGroupId: sports }).expect(200);
    assert.equal((await patch(admin, t.id, { alertGroupId: versure })).status, 400);
  });

  it('a deleted Alert Group empties the attribute on its tasks, and the type stays', async () => {
    const admin = await adminToken();
    const versure = await makeGroup('Versure Exclusives');
    const t = await makeTask(admin, { name: 'Task' });
    await patch(admin, t.id, { alertGroupId: versure, alertType: 'PriceChanged' }).expect(200);

    await request(app).delete(`/api/exclusives/groups/${versure}`).set(auth(admin)).expect(204);

    const task = await getTask(admin, t.id);
    assert.equal(task.alertGroup, null);
    assert.equal(task.alertType, 'PriceChanged');
  });

  it('only someone who may edit the task can set them', async () => {
    const admin = await adminToken();
    const versure = await makeGroup('Versure Exclusives');
    await seedUser({ email: 'member@test.local', role: 'Member' });
    const member = await login('member@test.local');
    const t = await makeTask(admin, { name: 'Not theirs' });

    const res = await patch(member, t.id, { alertGroupId: versure });
    assert.ok([403, 404].includes(res.status), `expected 403/404, got ${res.status}`);
    assert.equal((await getTask(admin, t.id)).alertGroup, null);
  });

  it('Duplicate copies both', async () => {
    const admin = await adminToken();
    const versure = await makeGroup('Versure Exclusives');
    const t = await makeTask(admin, { name: 'Task' });
    await patch(admin, t.id, { alertGroupId: versure, alertType: 'ListingSuppressed' }).expect(200);

    const dup = await request(app).post(`/api/tasks/${t.id}/duplicate`).set(auth(admin)).send({});
    assert.equal(dup.status, 201, JSON.stringify(dup.body));
    const copy = await getTask(admin, dup.body.id);
    assert.deepEqual(copy.alertGroup, { id: versure, name: 'Versure Exclusives', isActive: true });
    assert.equal(copy.alertType, 'ListingSuppressed');
  });

  it('a recurring task carries both to its next occurrence', async () => {
    const admin = await adminToken();
    const versure = await makeGroup('Versure Exclusives');
    await prisma.appSetting.upsert({
      where: { id: 1 },
      create: { id: 1, materializeLeadDays: 0 },
      update: { materializeLeadDays: 0 },
    });
    const t = await makeTask(admin, {
      name: 'Weekly price check',
      startAt: '2026-08-03T13:00:00.000Z',
      dueAt: '2026-08-03T20:00:00.000Z',
    });
    await patch(admin, t.id, { alertGroupId: versure, alertType: 'PriceChanged' }).expect(200);
    await request(app)
      .put(`/api/tasks/${t.id}/recurrence`)
      .set(auth(admin))
      .send({ recurrenceType: 'Fixed', intervalCount: 1, intervalUnit: 'Week' })
      .expect(200);

    await runScheduler(new Date('2026-08-10T14:00:00.000Z'));

    const occ = await prisma.task.findFirstOrThrow({ where: { recurrenceSourceId: t.id } });
    assert.equal(occ.alertGroupId, versure);
    assert.equal(occ.alertType, 'PriceChanged');
  });
});

// --- In the task list --------------------------------------------------------

describe('task list: attribute filters and export', () => {
  /** Four tasks: a (Versure, Buy Box Lost), b (Sports, Price Changed), c (Versure, —), d (—, —). */
  async function fourTasks() {
    const admin = await adminToken();
    const versure = await makeGroup('Versure Exclusives');
    const sports = await makeGroup('Sports Nutrition');
    const a = await makeTask(admin, { name: 'Task a' });
    const b = await makeTask(admin, { name: 'Task b' });
    const c = await makeTask(admin, { name: 'Task c' });
    const d = await makeTask(admin, { name: 'Task d' });
    await patch(admin, a.id, { alertGroupId: versure, alertType: 'BuyBoxLost' }).expect(200);
    await patch(admin, b.id, { alertGroupId: sports, alertType: 'PriceChanged' }).expect(200);
    await patch(admin, c.id, { alertGroupId: versure }).expect(200);
    return { admin, versure, sports, a: a.id, b: b.id, c: c.id, d: d.id };
  }

  async function query(token: string, filters: Record<string, unknown>) {
    const res = await request(app).post('/api/tasks/query').set(auth(token)).send({ filters });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body as {
      rows: {
        id: number;
        alertGroup: { id: number; name: string; isActive: boolean } | null;
        alertType: string | null;
      }[];
    };
  }
  const ids = async (token: string, filters: Record<string, unknown>) =>
    (await query(token, filters)).rows.map((r) => r.id).sort((x, y) => x - y);

  it('filters by some values, by "(not set)", and by both', async () => {
    const { admin, versure, sports, a, b, c, d } = await fourTasks();

    assert.deepEqual(await ids(admin, { alertGroupIds: [versure] }), [a, c]);
    assert.deepEqual(await ids(admin, { includeNoAlertGroup: true }), [d]);
    assert.deepEqual(await ids(admin, { alertGroupIds: [sports], includeNoAlertGroup: true }), [
      b,
      d,
    ]);
    // Every value: everything that has a group.
    assert.deepEqual(await ids(admin, { alertGroupIds: [versure, sports] }), [a, b, c]);

    assert.deepEqual(await ids(admin, { alertTypes: ['BuyBoxLost', 'PriceChanged'] }), [a, b]);
    assert.deepEqual(await ids(admin, { includeNoAlertType: true }), [c, d]);

    // Attributes combine with each other and with the other filters.
    assert.deepEqual(await ids(admin, { alertGroupIds: [versure], alertTypes: ['BuyBoxLost'] }), [
      a,
    ]);
    assert.deepEqual(await ids(admin, { alertGroupIds: [versure], includeNoAlertType: true }), [c]);
    assert.deepEqual(await ids(admin, { alertGroupIds: [versure], statuses: ['Completed'] }), []);
  });

  it('list rows carry the values', async () => {
    const { admin, versure, a, d } = await fourTasks();
    const rows = (await query(admin, {})).rows;
    const rowA = rows.find((r) => r.id === a)!;
    assert.deepEqual(rowA.alertGroup, { id: versure, name: 'Versure Exclusives', isActive: true });

    // A group switched off stays on the row, marked inactive.
    await prisma.alertGroup.update({ where: { id: versure }, data: { isActive: false } });
    const paused = (await query(admin, {})).rows.find((r) => r.id === a)!;
    assert.deepEqual(paused.alertGroup, {
      id: versure,
      name: 'Versure Exclusives',
      isActive: false,
    });
    assert.equal(rowA.alertType, 'BuyBoxLost');
    const rowD = rows.find((r) => r.id === d)!;
    assert.equal(rowD.alertGroup, null);
    assert.equal(rowD.alertType, null);
  });

  it('refuses a filter value that is not an alert type', async () => {
    const admin = await adminToken();
    const res = await request(app)
      .post('/api/tasks/query')
      .set(auth(admin))
      .send({ filters: { alertTypes: ['NotAType'] } });
    assert.equal(res.status, 400);
  });

  it('the Excel export has an Alert Group and an Alert Type column', async () => {
    const { admin, versure } = await fourTasks();
    const xlsx = await request(app)
      .post('/api/tasks/export')
      .set(auth(admin))
      .send({ filters: { alertGroupIds: [versure], alertTypes: ['BuyBoxLost'] } })
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    assert.equal(xlsx.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as Buffer);
    const ws = wb.getWorksheet('Tasks')!;
    const headers = (ws.getRow(1).values as unknown[]).filter(Boolean);
    const groupCol = headers.indexOf('Alert Group') + 1;
    const typeCol = headers.indexOf('Alert Type') + 1;
    assert.ok(groupCol > 0 && typeCol > 0, `headers: ${headers.join(', ')}`);
    assert.equal(ws.getRow(2).getCell(groupCol).value, 'Versure Exclusives');
    assert.equal(ws.getRow(2).getCell(typeCol).value, 'Buy Box Lost');
  });
});
