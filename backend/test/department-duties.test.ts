import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import ExcelJS from 'exceljs';
import type { Express } from 'express';
import type { PrismaClient, Role } from '@prisma/client';
import type { DepartmentDto, DutyDto } from '@healthy-tasks/shared';
import { startTestDb, type TestDb } from './db.js';

/**
 * Department Duties: Departments & Duties catalog, Organization (reporting
 * lines + duty assignments), the assignee ⇄ duty rule on tasks and templates,
 * time logging and Time Review. Same harness as integration.test.ts: a real
 * ephemeral Postgres with the project's migrations (and their triggers).
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
  process.env.JWT_SECRET = 'department-duties-test-secret';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.PASSWORD_RESET_EXPIRES_IN = '60m';
  process.env.FRONTEND_URL = 'http://localhost:5173';
  process.env.EMAIL_PROVIDER = 'console';
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
    'TRUNCATE TABLE "Task", "PasswordResetToken", "User", "SchedulerState", "AppSetting", "Department", "Duty" RESTART IDENTITY CASCADE',
  );
  resetUnreadCache();
  await seedUser({ email: ADMIN_EMAIL, role: 'Admin' });
});

// --- helpers ---------------------------------------------------------------

async function seedUser(opts: {
  email: string;
  role: Role;
  supervisorId?: string | null;
  firstName?: string;
  lastName?: string;
}) {
  return prisma.user.create({
    data: {
      email: opts.email,
      role: opts.role,
      firstName: opts.firstName ?? opts.email.split('@')[0]!,
      lastName: opts.lastName ?? 'Test',
      passwordHash: await hashPassword(PASSWORD),
      supervisorId: opts.supervisorId ?? null,
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

async function catalog(token: string): Promise<DepartmentDto[]> {
  const res = await request(app).get('/api/departments').set(auth(token));
  assert.equal(res.status, 200);
  return res.body;
}

async function makeDept(token: string, name: string): Promise<DepartmentDto> {
  const res = await request(app).post('/api/departments').set(auth(token)).send({ name });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return (res.body as DepartmentDto[]).find((d) => d.name === name)!;
}

async function makeDuty(
  token: string,
  deptId: string,
  name: string,
  description?: string,
): Promise<DutyDto> {
  const res = await request(app)
    .post(`/api/departments/${deptId}/duties`)
    .set(auth(token))
    .send({ name, description });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const dept = (res.body as DepartmentDto[]).find((d) => d.id === deptId)!;
  // Names come back normalized (trimmed, single-spaced).
  return dept.duties.find((u) => u.name === name.trim().replace(/\s+/g, ' '))!;
}

async function grant(userId: string, dutyId: string): Promise<void> {
  await prisma.userDuty.create({ data: { userId, dutyId } });
}

async function revoke(userId: string, dutyId: string): Promise<void> {
  await prisma.userDuty.delete({ where: { userId_dutyId: { userId, dutyId } } });
}

async function makeTask(token: string, body: Record<string, unknown>) {
  const res = await request(app).post('/api/tasks').set(auth(token)).send(body);
  assert.equal(res.status, 201, `create task failed: ${JSON.stringify(res.body)}`);
  return res.body as {
    id: number;
    dutyId: string | null;
    dutyMismatch: boolean;
    [k: string]: unknown;
  };
}

async function getTask(token: string, id: number) {
  const res = await request(app).get(`/api/tasks/${id}`).set(auth(token));
  assert.equal(res.status, 200);
  return res.body;
}

/** A small world: Finance (2 duties), Fulfillment (2 duties), a manager and two members. */
async function world() {
  const admin = await adminToken();
  const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  const fin = await makeDept(admin, 'Finance');
  const ful = await makeDept(admin, 'Fulfillment');
  const payables = await makeDuty(admin, fin.id, 'Accounts payable');
  const invoicing = await makeDuty(admin, fin.id, 'Invoicing');
  const packing = await makeDuty(admin, ful.id, 'Packing');
  const receiving = await makeDuty(admin, ful.id, 'Receiving');
  const mgr = await seedUser({
    email: 'dana@test.local',
    role: 'Manager',
    firstName: 'Dana',
    lastName: 'Levin',
  });
  const grace = await seedUser({
    email: 'grace@test.local',
    role: 'Member',
    supervisorId: mgr.id,
    firstName: 'Grace',
    lastName: 'Kim',
  });
  const tomas = await seedUser({
    email: 'tomas@test.local',
    role: 'Member',
    supervisorId: mgr.id,
    firstName: 'Tomas',
    lastName: 'Rivera',
  });
  const maria = await seedUser({
    email: 'maria@test.local',
    role: 'Member',
    firstName: 'Maria',
    lastName: 'Chen',
  });
  await grant(grace.id, packing.id);
  await grant(tomas.id, packing.id);
  await grant(tomas.id, receiving.id);
  await grant(maria.id, payables.id);
  return {
    admin,
    adminUser,
    fin,
    ful,
    payables,
    invoicing,
    packing,
    receiving,
    mgr,
    grace,
    tomas,
    maria,
  };
}

// --- Departments & Duties ---------------------------------------------------

describe('departments & duties catalog', () => {
  it('lets an Admin build the catalog and everyone read it; non-admins cannot write', async () => {
    const admin = await adminToken();
    const fin = await makeDept(admin, 'Finance');
    await makeDuty(admin, fin.id, 'Invoicing', 'Wholesale and B2B invoices');
    const member = await seedUser({ email: 'm@test.local', role: 'Member' });
    const mgr = await seedUser({ email: 'mg@test.local', role: 'Manager' });
    const memTok = await login(member.email);
    const mgrTok = await login(mgr.email);

    const list = await catalog(memTok);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.duties[0]!.name, 'Invoicing');
    assert.equal(list[0]!.duties[0]!.description, 'Wholesale and B2B invoices');
    assert.match(list[0]!.color, /^#[0-9a-f]{6}$/i, 'a palette color is assigned');

    for (const tok of [memTok, mgrTok]) {
      assert.equal(
        (await request(app).post('/api/departments').set(auth(tok)).send({ name: 'X' })).status,
        403,
      );
      assert.equal(
        (
          await request(app)
            .post(`/api/departments/${fin.id}/duties`)
            .set(auth(tok))
            .send({ name: 'Y' })
        ).status,
        403,
      );
      assert.equal(
        (await request(app).post(`/api/departments/${fin.id}/archive`).set(auth(tok))).status,
        403,
      );
    }
  });

  it('keeps duty names unique within a department, ignoring case and extra spaces', async () => {
    const admin = await adminToken();
    const fin = await makeDept(admin, 'Finance');
    const mkt = await makeDept(admin, 'Marketing');
    await makeDuty(admin, fin.id, 'Reporting');

    const dup = await request(app)
      .post(`/api/departments/${fin.id}/duties`)
      .set(auth(admin))
      .send({ name: '  reporting  ' });
    assert.equal(dup.status, 409);
    assert.match(dup.body.error, /already exists in Finance/);

    // The same name in another department is fine: duties read as Dept › Duty.
    await makeDuty(admin, mkt.id, 'Reporting');

    // Names are stored normalized.
    const spaced = await makeDuty(admin, fin.id, '  Month-end    close ');
    assert.equal(spaced.name, 'Month-end close');

    // Clashing with an archived duty points at Restore.
    await request(app)
      .post(`/api/departments/duties/${spaced.id}/archive`)
      .set(auth(admin))
      .expect(200);
    const again = await request(app)
      .post(`/api/departments/${fin.id}/duties`)
      .set(auth(admin))
      .send({ name: 'MONTH-END CLOSE' });
    assert.equal(again.status, 409);
    assert.match(again.body.error, /archived duty .* restore it instead/i);

    // Renaming into a clash is rejected too.
    const inv = await makeDuty(admin, fin.id, 'Invoicing');
    const rename = await request(app)
      .patch(`/api/departments/duties/${inv.id}`)
      .set(auth(admin))
      .send({ name: 'reporting' });
    assert.equal(rename.status, 409);
  });

  it('keeps department names unique (case-insensitive) and validates colors', async () => {
    const admin = await adminToken();
    await makeDept(admin, 'Finance');
    const dup = await request(app)
      .post('/api/departments')
      .set(auth(admin))
      .send({ name: 'finance ' });
    assert.equal(dup.status, 409);
    const badColor = await request(app)
      .post('/api/departments')
      .set(auth(admin))
      .send({ name: 'Ops', color: 'red' });
    assert.equal(badColor.status, 400);
    const ok = await request(app)
      .post('/api/departments')
      .set(auth(admin))
      .send({ name: 'Ops', color: '#2f7d4f' });
    assert.equal(ok.status, 201);
    assert.equal((ok.body as DepartmentDto[]).find((d) => d.name === 'Ops')!.color, '#2f7d4f');
  });

  it('deletes only never-used rows; anything used must be archived', async () => {
    const { admin, fin, payables, invoicing, maria } = await world();
    // Invoicing has never been used → delete.
    assert.equal(
      (await request(app).delete(`/api/departments/duties/${invoicing.id}`).set(auth(admin)))
        .status,
      200,
    );
    // Accounts payable is held by Maria → archive only.
    const held = await request(app)
      .delete(`/api/departments/duties/${payables.id}`)
      .set(auth(admin));
    assert.equal(held.status, 409);
    // A department with duties → archive only; an empty one → delete.
    assert.equal(
      (await request(app).delete(`/api/departments/${fin.id}`).set(auth(admin))).status,
      409,
    );
    const empty = await makeDept(admin, 'Facilities');
    assert.equal(empty.duties.length, 0);
    assert.equal(
      (await request(app).delete(`/api/departments/${empty.id}`).set(auth(admin))).status,
      200,
    );

    // Usage shows up in the counts.
    const list = await catalog(admin);
    const ap = list.find((d) => d.id === fin.id)!.duties.find((u) => u.id === payables.id)!;
    assert.equal(ap.inUse, true);
    assert.equal(ap.peopleCount, 1);
    assert.equal(list.find((d) => d.id === fin.id)!.peopleCount, 1);
    void maria;
  });

  it('archiving a department archives its duties; restoring it does not restore them', async () => {
    const { admin, ful, packing, receiving } = await world();
    await request(app).post(`/api/departments/${ful.id}/archive`).set(auth(admin)).expect(200);
    let dept = (await catalog(admin)).find((d) => d.id === ful.id)!;
    assert.equal(dept.archived, true);
    assert.ok(dept.duties.every((u) => u.archived));

    // A duty can't be restored while its department is archived.
    const early = await request(app)
      .post(`/api/departments/duties/${packing.id}/restore`)
      .set(auth(admin));
    assert.equal(early.status, 400);

    await request(app).post(`/api/departments/${ful.id}/restore`).set(auth(admin)).expect(200);
    dept = (await catalog(admin)).find((d) => d.id === ful.id)!;
    assert.equal(dept.archived, false);
    assert.ok(
      dept.duties.every((u) => u.archived),
      'duties are restored one by one',
    );

    await request(app)
      .post(`/api/departments/duties/${packing.id}/restore`)
      .set(auth(admin))
      .expect(200);
    dept = (await catalog(admin)).find((d) => d.id === ful.id)!;
    assert.equal(dept.duties.find((u) => u.id === packing.id)!.archived, false);
    assert.equal(dept.duties.find((u) => u.id === receiving.id)!.archived, true);
  });

  it('refuses to move a duty to another department at the database level', async () => {
    const { fin, packing } = await world();
    await assert.rejects(
      prisma.duty.update({ where: { id: packing.id }, data: { departmentId: fin.id } }),
      /cannot be moved/,
    );
  });

  it('reports who holds which duty to any signed-in user', async () => {
    const { grace, tomas, packing, receiving } = await world();
    const tok = await login(grace.email);
    const res = await request(app).get('/api/departments/holdings').set(auth(tok));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body[grace.id], [packing.id]);
    assert.deepEqual([...res.body[tomas.id]].sort(), [packing.id, receiving.id].sort());
  });
});

// --- Organization -------------------------------------------------------------

describe('organization', () => {
  it('shows Admins everyone and Managers only themselves + their team; Members are refused', async () => {
    const { admin, mgr, grace, tomas, maria } = await world();
    const all = await request(app).get('/api/org').set(auth(admin));
    assert.equal(all.status, 200);
    assert.equal(all.body.scope, 'all');
    assert.equal(all.body.people.length, 5);

    const team = await request(app)
      .get('/api/org')
      .set(auth(await login(mgr.email)));
    assert.equal(team.body.scope, 'team');
    const ids = team.body.people.map((p: { id: string }) => p.id).sort();
    assert.deepEqual(ids, [mgr.id, grace.id, tomas.id].sort());
    const me = team.body.people.find((p: { id: string }) => p.id === mgr.id);
    assert.equal(me.canEditDuties, false, 'a Manager cannot edit their own duties');
    assert.equal(me.supervisorId, null, 'the tree roots at the Manager');
    assert.ok(!ids.includes(maria.id));

    assert.equal(
      (
        await request(app)
          .get('/api/org')
          .set(auth(await login(grace.email)))
      ).status,
      403,
    );
  });

  it('lets a Manager change duties only for their own team', async () => {
    const { mgr, grace, maria, receiving, packing } = await world();
    const tok = await login(mgr.email);
    const ok = await request(app)
      .put('/api/org')
      .set(auth(tok))
      .send({ dutyChanges: [{ userId: grace.id, add: [receiving.id], remove: [packing.id] }] });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const g = ok.body.people.find((p: { id: string }) => p.id === grace.id);
    assert.deepEqual(g.dutyIds, [receiving.id]);

    const outside = await request(app)
      .put('/api/org')
      .set(auth(tok))
      .send({ dutyChanges: [{ userId: maria.id, add: [receiving.id], remove: [] }] });
    assert.equal(outside.status, 403);
    const self = await request(app)
      .put('/api/org')
      .set(auth(tok))
      .send({ dutyChanges: [{ userId: mgr.id, add: [receiving.id], remove: [] }] });
    assert.equal(self.status, 403);
  });

  it('lets a Manager move people within their team but not out of it', async () => {
    const { admin, mgr, grace, tomas } = await world();
    const sub = await seedUser({ email: 'sub@test.local', role: 'Manager', supervisorId: mgr.id });
    const tok = await login(mgr.email);

    const within = await request(app)
      .put('/api/org')
      .set(auth(tok))
      .send({
        supervisorChanges: [
          { userId: grace.id, supervisorId: sub.id, expectedSupervisorId: mgr.id },
        ],
      });
    assert.equal(within.status, 200, JSON.stringify(within.body));
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: grace.id } })).supervisorId,
      sub.id,
    );

    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const out = await request(app)
      .put('/api/org')
      .set(auth(tok))
      .send({
        supervisorChanges: [
          { userId: tomas.id, supervisorId: adminUser.id, expectedSupervisorId: mgr.id },
        ],
      });
    assert.equal(out.status, 403);
    const top = await request(app)
      .put('/api/org')
      .set(auth(tok))
      .send({
        supervisorChanges: [{ userId: tomas.id, supervisorId: null, expectedSupervisorId: mgr.id }],
      });
    assert.equal(top.status, 403, 'only an Admin can take someone to the top level');

    // Admins can.
    const adminTop = await request(app)
      .put('/api/org')
      .set(auth(admin))
      .send({
        supervisorChanges: [{ userId: tomas.id, supervisorId: null, expectedSupervisorId: mgr.id }],
      });
    assert.equal(adminTop.status, 200);
  });

  it('rejects loops, non-supervisor roles and stale edits', async () => {
    const { admin, mgr, grace } = await world();
    const sub = await seedUser({ email: 'sub@test.local', role: 'Manager', supervisorId: mgr.id });

    const loop = await request(app)
      .put('/api/org')
      .set(auth(admin))
      .send({
        supervisorChanges: [{ userId: mgr.id, supervisorId: sub.id, expectedSupervisorId: null }],
      });
    assert.equal(loop.status, 400);
    assert.match(loop.body.error, /own subordinates/);

    const member = await request(app)
      .put('/api/org')
      .set(auth(admin))
      .send({
        supervisorChanges: [
          { userId: sub.id, supervisorId: grace.id, expectedSupervisorId: mgr.id },
        ],
      });
    assert.equal(member.status, 400);
    assert.match(member.body.error, /Manager or Admin/);

    const stale = await request(app)
      .put('/api/org')
      .set(auth(admin))
      .send({
        supervisorChanges: [{ userId: grace.id, supervisorId: sub.id, expectedSupervisorId: null }],
      });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.details.code, 'STALE_WRITE');

    // A whole batch is validated together: swapping two people is fine.
    const batch = await request(app)
      .put('/api/org')
      .set(auth(admin))
      .send({
        supervisorChanges: [
          { userId: sub.id, supervisorId: null, expectedSupervisorId: mgr.id },
          { userId: mgr.id, supervisorId: sub.id, expectedSupervisorId: null },
        ],
      });
    assert.equal(batch.status, 200, JSON.stringify(batch.body));
  });

  it('removing a duty that open tasks use only flags those tasks', async () => {
    const { admin, grace, packing } = await world();
    const task = await makeTask(admin, {
      name: 'Pack orders',
      assigneeId: grace.id,
      dutyId: packing.id,
    });
    assert.equal(task.dutyMismatch, false);

    const org = await request(app).get('/api/org').set(auth(admin));
    const g = org.body.people.find((p: { id: string }) => p.id === grace.id);
    assert.equal(g.openTaskCountByDuty[packing.id], 1, 'the screen can warn before saving');

    await request(app)
      .put('/api/org')
      .set(auth(admin))
      .send({ dutyChanges: [{ userId: grace.id, add: [], remove: [packing.id] }] })
      .expect(200);
    const after = await getTask(admin, task.id);
    assert.equal(after.dutyId, packing.id, 'the task is not changed');
    assert.equal(after.dutyMismatch, true, 'it is flagged ⚠');
  });

  it("won't hand out an archived duty", async () => {
    const { admin, grace, receiving } = await world();
    await request(app)
      .post(`/api/departments/duties/${receiving.id}/archive`)
      .set(auth(admin))
      .expect(200);
    const res = await request(app)
      .put('/api/org')
      .set(auth(admin))
      .send({ dutyChanges: [{ userId: grace.id, add: [receiving.id], remove: [] }] });
    assert.equal(res.status, 400);
  });

  it('"Give this duty": Admins anyone, Managers their team only', async () => {
    const { admin, mgr, grace, maria, receiving } = await world();
    const mgrTok = await login(mgr.email);
    assert.equal(
      (
        await request(app)
          .post(`/api/org/people/${grace.id}/duties/${receiving.id}`)
          .set(auth(mgrTok))
      ).status,
      204,
    );
    assert.equal(
      (
        await request(app)
          .post(`/api/org/people/${maria.id}/duties/${receiving.id}`)
          .set(auth(mgrTok))
      ).status,
      403,
    );
    assert.equal(
      (
        await request(app)
          .post(`/api/org/people/${maria.id}/duties/${receiving.id}`)
          .set(auth(admin))
      ).status,
      204,
    );
    const graceTok = await login(grace.email);
    assert.equal(
      (
        await request(app)
          .post(`/api/org/people/${grace.id}/duties/${receiving.id}`)
          .set(auth(graceTok))
      ).status,
      403,
    );
  });
});

// --- Tasks: the assignee ⇄ duty rule ---------------------------------------------

describe('task duty', () => {
  it('creates a task with a duty only when the assignee holds it', async () => {
    const { admin, grace, packing, receiving } = await world();
    const ok = await makeTask(admin, { name: 'Pack', assigneeId: grace.id, dutyId: packing.id });
    assert.equal(ok.dutyId, packing.id);
    const detail = await getTask(admin, ok.id);
    assert.equal(detail.duty.name, 'Packing');
    assert.equal(detail.duty.departmentName, 'Fulfillment');

    const bad = await request(app)
      .post('/api/tasks')
      .set(auth(admin))
      .send({ name: 'Receive', assigneeId: grace.id, dutyId: receiving.id });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.details.code, 'DUTY_NOT_HELD');
    assert.match(bad.body.error, /doesn't hold the duty Fulfillment › Receiving/);

    // No duty → no rule.
    await makeTask(admin, { name: 'Anything', assigneeId: grace.id });
  });

  it("defaults the assignee to the creator and checks the creator's duties", async () => {
    const { grace, packing, receiving } = await world();
    const tok = await login(grace.email);
    await makeTask(tok, { name: 'Mine', dutyId: packing.id });
    const bad = await request(app)
      .post('/api/tasks')
      .set(auth(tok))
      .send({ name: 'Not mine', dutyId: receiving.id });
    assert.equal(bad.status, 422);
  });

  it('runs the check whichever field changes, but lets existing mismatches save other edits', async () => {
    const { admin, grace, tomas, packing, receiving } = await world();
    const t = await makeTask(admin, { name: 'Pack', assigneeId: grace.id, dutyId: packing.id });

    // Duty → one Grace lacks.
    const dutyBad = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(admin))
      .send({ dutyId: receiving.id });
    assert.equal(dutyBad.status, 422);
    // Assignee + duty together to someone who holds it.
    const both = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(admin))
      .send({ assigneeId: tomas.id, dutyId: receiving.id });
    assert.equal(both.status, 200, JSON.stringify(both.body));
    // Assignee → someone lacking the current duty.
    const assigneeBad = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(admin))
      .send({ assigneeId: grace.id });
    assert.equal(assigneeBad.status, 422);

    // Legacy mismatch: take the duty away from Tomas after the fact.
    await revoke(tomas.id, receiving.id);
    const flagged = await getTask(admin, t.id);
    assert.equal(flagged.dutyMismatch, true);
    const rename = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(admin))
      .send({ name: 'Receive pallets' });
    assert.equal(rename.status, 200, 'unrelated edits still save');
    // Clearing the duty clears the flag.
    const cleared = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(admin))
      .send({ dutyId: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.dutyMismatch, false);
  });

  it("won't newly set an archived duty, but a task may keep one", async () => {
    const { admin, grace, tomas, packing } = await world();
    const t = await makeTask(admin, { name: 'Pack', assigneeId: grace.id, dutyId: packing.id });
    await request(app)
      .post(`/api/departments/duties/${packing.id}/archive`)
      .set(auth(admin))
      .expect(200);
    const keep = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(admin))
      .send({ name: 'Pack v2' });
    assert.equal(keep.status, 200);
    assert.equal(keep.body.duty.archived, true);
    const other = await makeTask(admin, { name: 'Other', assigneeId: tomas.id });
    const set = await request(app)
      .patch(`/api/tasks/${other.id}`)
      .set(auth(admin))
      .send({ dutyId: packing.id });
    assert.equal(set.status, 400);
  });

  it('exempts Review hand-offs and judges the flag against the prior assignee meanwhile', async () => {
    const { admin, adminUser, mgr, grace, packing } = await world();
    const t = await makeTask(admin, { name: 'Pack', assigneeId: grace.id, dutyId: packing.id });
    // Dana (Grace's supervisor) doesn't hold Packing but can review.
    const toReview = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(admin))
      .send({ status: 'Review', reviewerId: mgr.id });
    assert.equal(toReview.status, 200, JSON.stringify(toReview.body));
    assert.equal(toReview.body.assigneeId, mgr.id);
    assert.equal(toReview.body.dutyMismatch, false, 'the reviewer is exempt');

    const back = await request(app)
      .post(`/api/tasks/${t.id}/reviewed`)
      .set(auth(await login(mgr.email)));
    assert.equal(back.status, 200, JSON.stringify(back.body));
    assert.equal(back.body.assigneeId, grace.id);
    assert.equal(back.body.dutyMismatch, false);
    void adminUser;
  });

  it('records duty changes in History and keeps the duty on a duplicate', async () => {
    const { admin, grace, packing } = await world();
    const t = await makeTask(admin, { name: 'Pack', assigneeId: grace.id });
    await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(admin))
      .send({ dutyId: packing.id })
      .expect(200);
    const hist = await request(app).get(`/api/tasks/${t.id}/history`).set(auth(admin));
    const entry = hist.body.find((h: { field: string }) => h.field === 'duty');
    assert.ok(entry, 'a duty history entry exists');
    assert.equal(entry.previousValue, null);
    assert.equal(entry.newValue, 'Fulfillment › Packing');

    const dup = await request(app).post(`/api/tasks/${t.id}/duplicate`).set(auth(admin)).send({});
    assert.equal(dup.status, 201, JSON.stringify(dup.body));
    assert.equal(dup.body.dutyId, packing.id);
  });

  it('filters, sorts and exports by Department › Duty and the ⚠ flag', async () => {
    const { admin, grace, tomas, maria, ful, packing, receiving, payables } = await world();
    const a = await makeTask(admin, { name: 'A pack', assigneeId: grace.id, dutyId: packing.id });
    const b = await makeTask(admin, {
      name: 'B receive',
      assigneeId: tomas.id,
      dutyId: receiving.id,
    });
    const c = await makeTask(admin, { name: 'C pay', assigneeId: maria.id, dutyId: payables.id });
    await makeTask(admin, { name: 'D none', assigneeId: maria.id });
    await revoke(tomas.id, receiving.id); // b becomes a mismatch

    const q = async (body: Record<string, unknown>) => {
      const res = await request(app).post('/api/tasks/query').set(auth(admin)).send(body);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return res.body as {
        total: number;
        rows: { id: number; duty: { name: string } | null; dutyMismatch: boolean }[];
      };
    };
    assert.deepEqual(
      (await q({ filters: { departmentIds: [ful.id] } })).rows.map((r) => r.id).sort(),
      [a.id, b.id],
    );
    assert.deepEqual(
      (await q({ filters: { dutyIds: [payables.id] } })).rows.map((r) => r.id),
      [c.id],
    );
    const mis = await q({ filters: { dutyMismatch: true } });
    assert.deepEqual(
      mis.rows.map((r) => r.id),
      [b.id],
    );
    assert.equal(mis.rows[0]!.dutyMismatch, true);

    // Sorted by department then duty: Finance › Accounts payable, Fulfillment ›
    // Packing, Fulfillment › Receiving.
    const sorted = await q({
      sort: [{ field: 'duty', dir: 'asc' }],
      filters: { dutyIds: [packing.id, receiving.id, payables.id] },
    });
    assert.deepEqual(
      sorted.rows.map((r) => r.id),
      [c.id, a.id, b.id],
    );

    // The Due Date report takes the same filters.
    const report = await request(app)
      .post('/api/reports/due-date')
      .set(auth(admin))
      .send({ filters: { departmentIds: [ful.id] } });
    assert.equal(report.status, 200);
    assert.equal(report.body.total, 2);
    assert.ok(report.body.rows.every((r: { duty: unknown }) => r.duty));

    // Excel export carries the column.
    const xlsx = await request(app)
      .post('/api/tasks/export')
      .set(auth(admin))
      .send({ filters: { dutyIds: [receiving.id] } })
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
    assert.ok(headers.includes('Department › Duty'));
    const col = headers.indexOf('Department › Duty') + 1;
    assert.match(String(ws.getRow(2).getCell(col).value), /^Fulfillment › Receiving \(⚠/);
  });
});

// --- Templates -------------------------------------------------------------------

describe('template duties', () => {
  function body(dutyA: string | null, dutyB: string | null, recurrence?: Record<string, unknown>) {
    return {
      name: 'New supplier onboarding',
      nodes: [
        {
          key: 'root',
          parentKey: null,
          name: 'Collect W-9',
          assigneeRole: 'Buyer',
          dutyId: dutyA,
          startOffsetDays: 0,
          dueOffsetDays: 2,
        },
        {
          key: 'inv',
          parentKey: 'root',
          name: 'Verify first invoice',
          assigneeRole: 'Accountant',
          dutyId: dutyB,
          startOffsetDays: 2,
          dueOffsetDays: 4,
        },
      ],
      ...(recurrence ? { recurrence } : {}),
    };
  }

  it('stores a duty per template task and returns it', async () => {
    const { admin, receiving, invoicing } = await world();
    const res = await request(app)
      .post('/api/templates')
      .set(auth(admin))
      .send(body(receiving.id, invoicing.id));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const root = res.body.nodes.find(
      (n: { parentNodeId: number | null }) => n.parentNodeId === null,
    );
    assert.equal(root.dutyId, receiving.id);
    assert.equal(root.duty.name, 'Receiving');
  });

  it('checks every role filler up front and refuses to create until each duty is held', async () => {
    const { admin, tomas, maria, grace, receiving, invoicing } = await world();
    const tpl = (
      await request(app)
        .post('/api/templates')
        .set(auth(admin))
        .send(body(receiving.id, invoicing.id))
    ).body;
    const roles = [
      { role: 'Buyer', assigneeId: grace.id }, // lacks Receiving
      { role: 'Accountant', assigneeId: maria.id }, // lacks Invoicing
    ];

    const check = await request(app)
      .post(`/api/templates/${tpl.id}/duty-check`)
      .set(auth(admin))
      .send({ roleAssignments: roles });
    assert.equal(check.status, 200);
    assert.equal(check.body.problems.length, 2);

    const blocked = await request(app)
      .post(`/api/templates/${tpl.id}/instantiate`)
      .set(auth(admin))
      .send({ anchorStart: '2026-09-28', roleAssignments: roles });
    assert.equal(blocked.status, 422);
    assert.equal(blocked.body.details.code, 'DUTY_NOT_HELD');
    assert.equal(blocked.body.details.problems.length, 2);
    assert.equal(await prisma.task.count(), 0, 'nothing is created');

    // Fix one by changing the person, the other by granting the duty.
    await grant(maria.id, invoicing.id);
    const fixed = [
      { role: 'Buyer', assigneeId: tomas.id },
      { role: 'Accountant', assigneeId: maria.id },
    ];
    const recheck = await request(app)
      .post(`/api/templates/${tpl.id}/duty-check`)
      .set(auth(admin))
      .send({ roleAssignments: fixed });
    assert.equal(recheck.body.problems.length, 0);
    const created = await request(app)
      .post(`/api/templates/${tpl.id}/instantiate`)
      .set(auth(admin))
      .send({ anchorStart: '2026-09-28', roleAssignments: fixed });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const root = await getTask(admin, created.body.rootTaskId);
    assert.equal(root.dutyId, receiving.id);
    assert.equal(root.dutyMismatch, false);

    // Unfilled roles don't need anyone's duties.
    const unfilled = await request(app)
      .post(`/api/templates/${tpl.id}/instantiate`)
      .set(auth(admin))
      .send({ anchorStart: '2026-09-28' });
    assert.equal(unfilled.status, 201);
  });

  it('creates scheduled occurrences anyway, flags them and tells the template owner', async () => {
    const { admin, tomas, receiving } = await world();
    await prisma.appSetting.upsert({
      where: { id: 1 },
      create: { id: 1, materializeLeadDays: 0 },
      update: { materializeLeadDays: 0 },
    });
    const tpl = (
      await request(app)
        .post('/api/templates')
        .set(auth(admin))
        .send(
          body(receiving.id, null, {
            recurrenceType: 'Fixed',
            intervalCount: 1,
            intervalUnit: 'Week',
            anchorDate: '2026-08-01T00:00:00.000Z',
          }),
        )
    ).body;
    // A manual run seeds the carried-forward assignees (Tomas as Buyer).
    await request(app)
      .post(`/api/templates/${tpl.id}/instantiate`)
      .set(auth(admin))
      .send({
        anchorStart: '2026-07-25',
        roleAssignments: [{ role: 'Buyer', assigneeId: tomas.id }],
      })
      .expect(201);

    await revoke(tomas.id, receiving.id);
    await runScheduler(new Date('2026-08-01T00:00:00.000Z'));
    const scheduled = await prisma.task.findFirstOrThrow({
      where: { templateOccurrence: { origin: 'scheduled' }, parentId: null },
    });
    assert.equal(scheduled.assigneeId, tomas.id);
    assert.equal(scheduled.dutyId, receiving.id);
    assert.equal((await getTask(admin, scheduled.id)).dutyMismatch, true);

    const notifs = await request(app).get('/api/notifications').set(auth(admin));
    const row = notifs.body.assigned.find((n: { taskId: number }) => n.taskId === scheduled.id);
    assert.ok(row, 'the template owner is notified');
    assert.equal(row.dutyMismatch.duty.name, 'Receiving');
    assert.equal(row.dutyMismatch.assignee.id, tomas.id);
    const unread = await request(app).get('/api/notifications/unread-count').set(auth(admin));
    assert.ok(unread.body.assigned >= 1);
  });

  it('re-syncs the duty to future occurrences ("this and following")', async () => {
    const { admin, tomas, receiving, packing } = await world();
    const tpl = (
      await request(app).post('/api/templates').set(auth(admin)).send(body(receiving.id, null))
    ).body;
    const occ = (
      await request(app)
        .post(`/api/templates/${tpl.id}/instantiate`)
        .set(auth(admin))
        .send({
          anchorStart: '2099-01-05',
          roleAssignments: [{ role: 'Buyer', assigneeId: tomas.id }],
        })
    ).body;
    const nodes = tpl.nodes.map((n: Record<string, unknown>) => ({
      id: n.id,
      key: String(n.id),
      parentKey: n.parentNodeId === null ? null : String(n.parentNodeId),
      name: n.name,
      assigneeRole: n.assigneeRole,
      dutyId: n.parentNodeId === null ? packing.id : null,
      startOffsetDays: n.startOffsetDays,
      dueOffsetDays: n.dueOffsetDays,
    }));
    await request(app)
      .patch(`/api/templates/${tpl.id}`)
      .set(auth(admin))
      .send({ nodes })
      .expect(200);
    const applied = await request(app)
      .post(`/api/templates/${tpl.id}/apply-to-future`)
      .set(auth(admin))
      .send({ occurrenceIds: [occ.occurrence.id] });
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    const root = await getTask(admin, occ.rootTaskId);
    assert.equal(root.dutyId, packing.id);
    assert.equal(root.dutyMismatch, false, 'Tomas holds Packing');
  });
});

describe('recurring task duty', () => {
  it('copies the duty to each occurrence and flags + notifies on a mismatch', async () => {
    const { admin, grace, packing } = await world();
    await prisma.appSetting.upsert({
      where: { id: 1 },
      create: { id: 1, materializeLeadDays: 0 },
      update: { materializeLeadDays: 0 },
    });
    const t = await makeTask(admin, {
      name: 'Weekly pack-station clean',
      assigneeId: grace.id,
      dutyId: packing.id,
      startAt: '2026-08-03T13:00:00.000Z',
      dueAt: '2026-08-03T20:00:00.000Z',
    });
    await request(app)
      .put(`/api/tasks/${t.id}/recurrence`)
      .set(auth(admin))
      .send({ recurrenceType: 'Fixed', intervalCount: 1, intervalUnit: 'Week' })
      .expect(200);
    await revoke(grace.id, packing.id);
    await runScheduler(new Date('2026-08-10T14:00:00.000Z'));
    const occ = await prisma.task.findFirstOrThrow({ where: { recurrenceSourceId: t.id } });
    assert.equal(occ.dutyId, packing.id);
    assert.equal((await getTask(admin, occ.id)).dutyMismatch, true);
    const notifs = await request(app).get('/api/notifications').set(auth(admin));
    assert.ok(
      notifs.body.assigned.some(
        (n: { taskId: number; dutyMismatch: unknown }) => n.taskId === occ.id && n.dutyMismatch,
      ),
    );
  });
});

// --- Time logging -----------------------------------------------------------------

describe('time logging', () => {
  const DAY = '2026-09-21';

  // Not async: callers either await it or chain supertest's `.expect`.
  function save(tok: string, date: string, body: Record<string, unknown>) {
    return request(app).put(`/api/time/days/${date}`).set(auth(tok)).send(body);
  }

  it('logs minutes against held duties and reads them back', async () => {
    const { tomas, packing, receiving } = await world();
    const tok = await login(tomas.email);
    const res = await save(tok, DAY, {
      entries: [
        { dutyId: packing.id, minutes: 105 },
        { dutyId: receiving.id, minutes: 60 },
      ],
      note: 'Covered phones in the afternoon',
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.entries.length, 2);
    assert.equal(res.body.note, 'Covered phones in the afternoon');
    assert.equal(res.body.completed, false);

    const list = await request(app)
      .get(`/api/time/days?from=2026-09-20&to=2026-09-26`)
      .set(auth(tok));
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].date, DAY);
    assert.equal(
      list.body[0].entries.reduce((s: number, e: { minutes: number }) => s + e.minutes, 0),
      165,
    );

    // Replacing the day drops entries that aren't sent (and zero entries).
    const replaced = await save(tok, DAY, {
      entries: [
        { dutyId: packing.id, minutes: 30 },
        { dutyId: receiving.id, minutes: 0 },
      ],
      expectedUpdatedAt: res.body.updatedAt,
    });
    assert.equal(replaced.status, 200);
    assert.deepEqual(replaced.body.entries, [{ dutyId: packing.id, minutes: 30 }]);
  });

  it('only allows held, active duties, at most 24h, and never a future day', async () => {
    const { admin, grace, packing, receiving } = await world();
    const tok = await login(grace.email);
    assert.equal(
      (await save(tok, DAY, { entries: [{ dutyId: receiving.id, minutes: 30 }] })).status,
      400,
    );
    assert.equal(
      (await save(tok, DAY, { entries: [{ dutyId: packing.id, minutes: 1441 }] })).status,
      400,
    );
    assert.equal(
      (await save(tok, '2099-01-01', { entries: [{ dutyId: packing.id, minutes: 30 }] })).status,
      400,
    );
    assert.equal((await save(tok, 'not-a-date', { entries: [] })).status, 400);
    const dup = await save(tok, DAY, {
      entries: [
        { dutyId: packing.id, minutes: 30 },
        { dutyId: packing.id, minutes: 30 },
      ],
    });
    assert.equal(dup.status, 400);

    // Archived duties can't take new time.
    await request(app)
      .post(`/api/departments/duties/${packing.id}/archive`)
      .set(auth(admin))
      .expect(200);
    assert.equal(
      (await save(tok, DAY, { entries: [{ dutyId: packing.id, minutes: 30 }] })).status,
      400,
    );
  });

  it('lets an entry on a duty no longer held be lowered or cleared, never raised', async () => {
    const { grace, packing } = await world();
    const tok = await login(grace.email);
    await save(tok, DAY, { entries: [{ dutyId: packing.id, minutes: 120 }] }).expect(200);
    await revoke(grace.id, packing.id);
    const raise = await save(tok, DAY, { entries: [{ dutyId: packing.id, minutes: 150 }] });
    assert.equal(raise.status, 400);
    assert.match(raise.body.error, /no longer hold Fulfillment › Packing/);
    assert.equal(
      (await save(tok, DAY, { entries: [{ dutyId: packing.id, minutes: 90 }] })).status,
      200,
    );
    const cleared = await save(tok, DAY, { entries: [] });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.entries.length, 0);
  });

  it('locks a Completed day until its owner reopens it', async () => {
    const { grace, packing } = await world();
    const tok = await login(grace.email);
    const saved = await save(tok, DAY, {
      entries: [{ dutyId: packing.id, minutes: 60 }],
      completed: true,
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.completed, true);

    const locked = await save(tok, DAY, { entries: [{ dutyId: packing.id, minutes: 90 }] });
    assert.equal(locked.status, 409);
    assert.match(locked.body.error, /Reopen it/);

    const reopened = await request(app)
      .post(`/api/time/days/${DAY}/complete`)
      .set(auth(tok))
      .send({ completed: false });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.completed, false);
    assert.equal(
      (await save(tok, DAY, { entries: [{ dutyId: packing.id, minutes: 90 }] })).status,
      200,
    );

    // An empty weekday off can be completed, and completing a future day can't.
    const empty = await request(app)
      .post('/api/time/days/2026-09-22/complete')
      .set(auth(tok))
      .send({ completed: true });
    assert.equal(empty.status, 200);
    assert.equal(empty.body.completed, true);
    assert.equal(empty.body.entries.length, 0);
    const future = await request(app)
      .post('/api/time/days/2099-01-01/complete')
      .set(auth(tok))
      .send({ completed: true });
    assert.equal(future.status, 400);
  });

  it('rejects a stale save from another tab', async () => {
    const { grace, packing } = await world();
    const tok = await login(grace.email);
    const first = await save(tok, DAY, { entries: [{ dutyId: packing.id, minutes: 60 }] });
    await save(tok, DAY, {
      entries: [{ dutyId: packing.id, minutes: 75 }],
      expectedUpdatedAt: first.body.updatedAt,
    }).expect(200);
    const stale = await save(tok, DAY, {
      entries: [{ dutyId: packing.id, minutes: 90 }],
      expectedUpdatedAt: first.body.updatedAt,
    });
    assert.equal(stale.status, 409);
    // Opening a never-saved day and saving with "no prior version" also guards.
    const fresh = await save(tok, '2026-09-23', {
      entries: [{ dutyId: packing.id, minutes: 15 }],
      expectedUpdatedAt: null,
    });
    assert.equal(fresh.status, 200);
  });

  it("shows someone's days only to themselves, their supervisors and Admins", async () => {
    const { admin, mgr, grace, tomas, maria, packing } = await world();
    await save(await login(grace.email), DAY, {
      entries: [{ dutyId: packing.id, minutes: 60 }],
    }).expect(200);
    const q = `/api/time/days?userId=${grace.id}&from=${DAY}&to=${DAY}`;
    assert.equal(
      (
        await request(app)
          .get(q)
          .set(auth(await login(mgr.email)))
      ).status,
      200,
    );
    assert.equal((await request(app).get(q).set(auth(admin))).status, 200);
    assert.equal(
      (
        await request(app)
          .get(q)
          .set(auth(await login(tomas.email)))
      ).status,
      403,
    );
    assert.equal(
      (
        await request(app)
          .get(q)
          .set(auth(await login(maria.email)))
      ).status,
      403,
    );
    // Ranges are bounded.
    const long = await request(app)
      .get(`/api/time/days?from=2026-01-01&to=2026-12-31`)
      .set(auth(admin));
    assert.equal(long.status, 400);
  });
});

describe('time review', () => {
  async function logDay(
    email: string,
    date: string,
    entries: { dutyId: string; minutes: number }[],
    completed = false,
  ) {
    const res = await request(app)
      .put(`/api/time/days/${date}`)
      .set(auth(await login(email)))
      .send({ entries, completed });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }

  it('rolls up the team by scope, department and duty, with related tasks', async () => {
    const { admin, mgr, grace, tomas, maria, ful, packing, receiving, payables } = await world();
    await logDay(grace.email, '2026-09-21', [{ dutyId: packing.id, minutes: 240 }], true);
    await logDay(tomas.email, '2026-09-21', [
      { dutyId: packing.id, minutes: 120 },
      { dutyId: receiving.id, minutes: 180 },
    ]);
    await logDay(tomas.email, '2026-09-28', [{ dutyId: receiving.id, minutes: 60 }]); // outside the week
    await logDay(maria.email, '2026-09-21', [{ dutyId: payables.id, minutes: 300 }]); // not Dana's team

    // Related: across the week, inside it, before it, and an undated one.
    const across = await makeTask(admin, {
      name: 'Across',
      assigneeId: tomas.id,
      dutyId: receiving.id,
      startAt: '2026-09-01T12:00:00Z',
      dueAt: '2026-10-15T12:00:00Z',
    });
    const inside = await makeTask(admin, {
      name: 'Inside',
      assigneeId: grace.id,
      dutyId: packing.id,
      startAt: '2026-09-22T12:00:00Z',
      dueAt: '2026-09-24T12:00:00Z',
    });
    await makeTask(admin, {
      name: 'Before',
      assigneeId: grace.id,
      dutyId: packing.id,
      startAt: '2026-08-01T12:00:00Z',
      dueAt: '2026-08-05T12:00:00Z',
    });
    const undated = await makeTask(admin, {
      name: 'Undated',
      assigneeId: tomas.id,
      dutyId: packing.id,
    });
    await makeTask(admin, { name: 'No duty', assigneeId: tomas.id });

    const tok = await login(mgr.email);
    const review = async (body: Record<string, unknown>) => {
      const res = await request(app)
        .post('/api/time/review')
        .set(auth(tok))
        .send({ from: '2026-09-20', to: '2026-09-26', ...body });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return res.body;
    };

    const team = await review({ scope: 'team' });
    assert.deepEqual(
      team.people.map((p: { id: string }) => p.id).sort(),
      [grace.id, tomas.id].sort(),
    );
    assert.equal(
      team.records.reduce((s: number, r: { minutes: number }) => s + r.minutes, 0),
      540,
    );
    const graceDay = team.days.find((d: { userId: string }) => d.userId === grace.id);
    assert.deepEqual(graceDay, {
      userId: grace.id,
      date: '2026-09-21',
      minutes: 240,
      completed: true,
    });
    assert.deepEqual(
      team.relatedTasks.map((t: { id: number }) => t.id).sort(),
      [across.id, inside.id, undated.id].sort(),
    );
    assert.ok(team.duties.some((d: { id: string }) => d.id === receiving.id));

    const recv = await review({ scope: 'team', dutyId: receiving.id });
    assert.equal(recv.records.length, 1);
    assert.deepEqual(
      recv.relatedTasks.map((t: { id: number }) => t.id),
      [across.id],
    );
    const byDept = await review({ scope: 'team', departmentId: ful.id });
    assert.equal(byDept.records.length, 3);
    // Day totals ignore the duty filter (they describe the whole day).
    assert.equal(recv.days.find((d: { userId: string }) => d.userId === tomas.id).minutes, 300);

    const one = await review({ scope: `user:${grace.id}` });
    assert.deepEqual(
      one.people.map((p: { id: string }) => p.id),
      [grace.id],
    );
    const withMe = await review({ scope: 'withme' });
    assert.equal(withMe.people.length, 3);

    // Outside the team, and "everyone", are Admin-only.
    assert.equal(
      (
        await request(app)
          .post('/api/time/review')
          .set(auth(tok))
          .send({ from: '2026-09-20', to: '2026-09-26', scope: `user:${maria.id}` })
      ).status,
      403,
    );
    assert.equal(
      (
        await request(app)
          .post('/api/time/review')
          .set(auth(tok))
          .send({ from: '2026-09-20', to: '2026-09-26', scope: 'all' })
      ).status,
      403,
    );
    const all = await request(app)
      .post('/api/time/review')
      .set(auth(admin))
      .send({ from: '2026-09-20', to: '2026-09-26', scope: 'all' });
    assert.equal(all.status, 200);
    assert.equal(
      all.body.records.reduce((s: number, r: { minutes: number }) => s + r.minutes, 0),
      840,
    );

    // Members can't review at all.
    assert.equal(
      (
        await request(app)
          .post('/api/time/review')
          .set(auth(await login(grace.email)))
          .send({ from: '2026-09-20', to: '2026-09-26', scope: 'team' })
      ).status,
      403,
    );

    // The People picker.
    const people = await request(app).get('/api/time/review/people').set(auth(tok));
    assert.equal(people.status, 200);
    assert.equal(people.body.me.id, mgr.id);
    assert.deepEqual([...people.body.directIds].sort(), [grace.id, tomas.id].sort());
    assert.equal(people.body.isAdmin, false);
  });

  it("lists a person's related tasks for their day editor", async () => {
    const { admin, grace, packing } = await world();
    const t = await makeTask(admin, {
      name: 'Inside',
      assigneeId: grace.id,
      dutyId: packing.id,
      startAt: '2026-09-21T12:00:00Z',
      dueAt: '2026-09-22T12:00:00Z',
    });
    const res = await request(app)
      .get('/api/time/related?from=2026-09-21&to=2026-09-21')
      .set(auth(await login(grace.email)));
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.map((r: { id: number }) => r.id),
      [t.id],
    );
    assert.equal(res.body[0].duty.name, 'Packing');
  });
});

// --- Merging users & preferences ------------------------------------------------------

describe('department duties & account merge', () => {
  it("carries the merged account's duties and time to the survivor", async () => {
    const { admin, grace, tomas, packing, receiving } = await world();
    await request(app)
      .put('/api/time/days/2026-09-21')
      .set(auth(await login(grace.email)))
      .send({ entries: [{ dutyId: packing.id, minutes: 100 }], completed: true })
      .expect(200);
    await request(app)
      .put('/api/time/days/2026-09-21')
      .set(auth(await login(tomas.email)))
      .send({
        entries: [
          { dutyId: packing.id, minutes: 50 },
          { dutyId: receiving.id, minutes: 30 },
        ],
      })
      .expect(200);

    const res = await request(app)
      .post('/api/users/merge')
      .set(auth(admin))
      .send({
        survivingId: grace.id,
        mergedId: tomas.id,
        confirmEmail: tomas.email,
        fieldChoices: {
          firstName: 'Grace',
          lastName: 'Kim',
          title: null,
          jobDescription: null,
          role: 'Member',
          supervisorId: grace.supervisorId,
        },
      });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const duties = await prisma.userDuty.findMany({ where: { userId: grace.id } });
    assert.deepEqual(duties.map((d) => d.dutyId).sort(), [packing.id, receiving.id].sort());
    const entries = await prisma.timeEntry.findMany({ where: { userId: grace.id } });
    assert.equal(entries.find((e) => e.dutyId === packing.id)!.minutes, 150);
    assert.equal(entries.find((e) => e.dutyId === receiving.id)!.minutes, 30);
    const day = await prisma.timeDay.findFirstOrThrow({ where: { userId: grace.id } });
    assert.ok(day.completedAt, 'a day completed on either account stays completed');
    assert.equal(await prisma.timeEntry.count({ where: { userId: tomas.id } }), 0);
  });

  it('remembers per-user screen state for the new screens', async () => {
    const { grace } = await world();
    const tok = await login(grace.email);
    for (const screen of ['departments', 'organization', 'my-time', 'time-review']) {
      await request(app)
        .put(`/api/preferences/${screen}`)
        .set(auth(tok))
        .send({ state: { hideWeekends: true } })
        .expect(200);
      const got = await request(app).get(`/api/preferences/${screen}`).set(auth(tok));
      assert.deepEqual(got.body.state, { hideWeekends: true });
    }
  });
});
