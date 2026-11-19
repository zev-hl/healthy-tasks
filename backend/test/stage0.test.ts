import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient, Role } from '@prisma/client';
import { startTestDb, type TestDb } from './db.js';
import { memoryStorage } from '../src/storage/memory.storage.js';

/**
 * Nov 2026 plan, Stage 0 (server groundwork): who can read tasks, task levels,
 * due-date rights, soft delete, last activity, duty pages and template
 * departments.
 */

let db: TestDb;
let app: Express;
let prisma: PrismaClient;
let prismaWithDeleted: PrismaClient;
let hashPassword: (plaintext: string) => Promise<string>;
let resetUnreadCache: () => void;

const PW = 'Stage0Pass123!';
const ADMIN = 'admin@test.local';

before(async () => {
  db = await startTestDb();
  process.env.DATABASE_URL = db.databaseUrl;
  process.env.JWT_SECRET = 'stage0-test-secret';
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

describe('Stage 0: everyone reads every non-private task', () => {
  it('an unrelated Member sees a task read-only (view): no edit, no comment', async () => {
    const admin = await login(ADMIN);
    const owner = await seedUser('owner@test.local', 'Member');
    await seedUser('out@test.local', 'Member');
    const out = await login('out@test.local');
    const t = await makeTask(admin, 'Open to all', { assigneeId: owner.id });

    const seen = await getTask(out, t.id);
    assert.equal(seen.status, 200);
    assert.equal(seen.body.access, 'view');
    assert.equal((await patch(out, t.id, { priority: 'High' })).status, 403);
    const comment = await request(app)
      .post(`/api/tasks/${t.id}/comments`)
      .set(auth(out))
      .send({ body: '<p>hi</p>' });
    assert.equal(comment.status, 403);

    const list = await request(app)
      .post('/api/tasks/query')
      .set(auth(out))
      .send({ includeReadOnly: true });
    assert.equal(list.status, 200);
    const row = list.body.rows.find((r: { id: number }) => r.id === t.id);
    assert.ok(row, 'listed for everyone');
    assert.equal(row.viewOnly, true);

    const own = await request(app)
      .post('/api/tasks/query')
      .set(auth(out))
      .send({ includeReadOnly: false });
    assert.ok(
      !own.body.rows.some((r: { id: number }) => r.id === t.id),
      'hidden without read-only',
    );
  });

  it('a private task stays hidden from everyone outside it', async () => {
    const admin = await login(ADMIN);
    const owner = await seedUser('owner@test.local', 'Member');
    await seedUser('out@test.local', 'Member');
    const out = await login('out@test.local');
    const t = await makeTask(admin, 'Private', { assigneeId: owner.id });
    assert.equal(
      (
        await request(app)
          .patch(`/api/tasks/${t.id}/private`)
          .set(auth(admin))
          .send({ isPrivate: true })
      ).status,
      200,
    );
    assert.equal((await getTask(out, t.id)).status, 404);
  });
});

describe('Stage 0: task levels (Project › Task › Sub-task)', () => {
  it('a project holds three levels, and refuses a fourth', async () => {
    const admin = await login(ADMIN);
    const p = await makeTask(admin, 'Project', { isProject: true });
    const t = await makeTask(admin, 'Task');
    const s = await makeTask(admin, 'Sub-task');
    const x = await makeTask(admin, 'Too deep');
    assert.equal((await setParent(admin, t.id, p.id)).status, 200);
    assert.equal((await setParent(admin, s.id, t.id)).status, 200);
    const deep = await setParent(admin, x.id, s.id);
    assert.equal(deep.status, 400);
    assert.match(deep.body.error, /fourth level/);
  });

  it('a plain task holds one level of sub-tasks', async () => {
    const admin = await login(ADMIN);
    const t = await makeTask(admin, 'Plain');
    const s = await makeTask(admin, 'Sub');
    const x = await makeTask(admin, 'Sub-sub');
    assert.equal((await setParent(admin, s.id, t.id)).status, 200);
    assert.equal((await setParent(admin, x.id, s.id)).status, 400);
    // Quick-add a sub-task under a sub-task is refused the same way.
    const quick = await request(app)
      .post(`/api/tasks/${s.id}/subtasks`)
      .set(auth(admin))
      .send({ name: 'quick' });
    assert.equal(quick.status, 400);
    // A task with its own sub-task can't go under another task.
    const other = await makeTask(admin, 'Other');
    assert.equal((await setParent(admin, t.id, other.id)).status, 400);
  });

  it('marking and unmarking a project follow the rules', async () => {
    const admin = await login(ADMIN);
    const p = await makeTask(admin, 'Proj');
    const t = await makeTask(admin, 'Task T');
    const s = await makeTask(admin, 'Sub S');
    assert.equal((await patch(admin, p.id, { isProject: true })).status, 200);
    await setParent(admin, t.id, p.id);
    await setParent(admin, s.id, t.id);
    // A task under something can't become a project.
    assert.equal((await patch(admin, t.id, { isProject: true })).status, 400);
    // Unmarking with three levels below is refused.
    assert.equal((await patch(admin, p.id, { isProject: false })).status, 400);
    // A project can't go under another task.
    const q = await makeTask(admin, 'Proj Q', { isProject: true });
    assert.equal((await setParent(admin, q.id, s.id)).status, 400);
    const detail = await getTask(admin, p.id);
    assert.equal(detail.body.isProject, true);
  });

  it('trees deeper than the rule, from before it, are left as they are', async () => {
    const admin = await login(ADMIN);
    const a = await makeTask(admin, 'Top A');
    const b = await makeTask(admin, 'Mid B');
    const c = await makeTask(admin, 'Low C');
    await prisma.task.update({ where: { id: b.id }, data: { parentId: a.id } });
    await prisma.task.update({ where: { id: c.id }, data: { parentId: b.id } });
    assert.equal((await patch(admin, c.id, { name: 'C renamed' })).status, 200);
  });
});

describe('Stage 0: task levels in templates', () => {
  const node = (key: string, parentKey: string | null) => ({ key, parentKey, name: `Node ${key}` });

  it('a template holds at most three levels', async () => {
    const admin = await login(ADMIN);
    const res = await request(app)
      .post('/api/templates')
      .set(auth(admin))
      .send({
        name: 'Too deep',
        nodes: [node('a', null), node('b', 'a'), node('c', 'b'), node('d', 'c')],
      });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /three levels/);
  });

  it('tasks made from a three-level template have a project on top', async () => {
    const admin = await login(ADMIN);
    const made = await request(app)
      .post('/api/templates')
      .set(auth(admin))
      .send({ name: 'Launch', nodes: [node('a', null), node('b', 'a'), node('c', 'b')] });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const inst = await request(app)
      .post(`/api/templates/${made.body.id}/instantiate`)
      .set(auth(admin))
      .send({ anchorStart: '2027-02-01' });
    assert.equal(inst.status, 201, JSON.stringify(inst.body));
    const tasks = await prisma.task.findMany({ orderBy: { id: 'asc' } });
    assert.equal(tasks.length, 3);
    assert.deepEqual(
      tasks.map((t) => t.isProject),
      [true, false, false],
    );

    const flat = await request(app)
      .post('/api/templates')
      .set(auth(admin))
      .send({ name: 'Flat', nodes: [node('a', null), node('b', 'a')] });
    await request(app)
      .post(`/api/templates/${flat.body.id}/instantiate`)
      .set(auth(admin))
      .send({ anchorStart: '2027-02-01' });
    const top = await prisma.task.findFirstOrThrow({ where: { name: 'Node a', isProject: false } });
    assert.equal(top.parentId, null, 'a two-level template makes a plain task');
  });

  it('a template saved before the rule with four levels makes nothing until edited', async () => {
    const admin = await login(ADMIN);
    const made = await request(app)
      .post('/api/templates')
      .set(auth(admin))
      .send({ name: 'Old', nodes: [node('a', null), node('b', 'a'), node('c', 'b')] });
    const tpl = await prisma.taskTemplate.findUniqueOrThrow({
      where: { id: made.body.id },
      include: { nodes: true },
    });
    const c = tpl.nodes.find((n) => n.name === 'Node c')!;
    await prisma.taskTemplateNode.create({
      data: { templateId: tpl.id, parentNodeId: c.id, name: 'Node d', orderIndex: 0 },
    });
    const inst = await request(app)
      .post(`/api/templates/${tpl.id}/instantiate`)
      .set(auth(admin))
      .send({ anchorStart: '2027-02-01' });
    assert.equal(inst.status, 400);
    assert.equal(await prisma.task.count(), 0);
  });

  it('a duplicate of a project is a project', async () => {
    const admin = await login(ADMIN);
    const p = await makeTask(admin, 'Proj', { isProject: true });
    const dup = await request(app)
      .post(`/api/tasks/${p.id}/duplicate`)
      .set(auth(admin))
      .send({ includeDescendants: true });
    assert.ok(dup.status === 200 || dup.status === 201, JSON.stringify(dup.body));
    const copies = await prisma.task.findMany({ where: { isProject: true } });
    assert.equal(copies.length, 2);
  });
});

describe('Stage 0: due date rights', () => {
  it('the creator, those above them, and an Admin may move it; the assignee may not', async () => {
    const boss = await seedUser('boss@test.local', 'Manager');
    const creator = await seedUser('creator@test.local', 'Manager', boss.id);
    const worker = await seedUser('worker@test.local', 'Member', creator.id);
    void worker;
    const creatorTok = await login('creator@test.local');
    const workerTok = await login('worker@test.local');
    const bossTok = await login('boss@test.local');
    const admin = await login(ADMIN);
    const t = await makeTask(creatorTok, 'Due rights', {
      assigneeId: (await prisma.user.findUniqueOrThrow({ where: { email: 'worker@test.local' } }))
        .id,
      dueAt: '2027-01-10T12:00:00.000Z',
    });

    const asWorker = await getTask(workerTok, t.id);
    assert.equal(asWorker.body.access, 'full');
    assert.equal(asWorker.body.canChangeDue, false);
    assert.equal((await patch(workerTok, t.id, { dueAt: '2027-01-12T12:00:00.000Z' })).status, 403);
    // Other fields stay editable for the assignee.
    assert.equal((await patch(workerTok, t.id, { priority: 'High' })).status, 200);

    assert.equal((await getTask(creatorTok, t.id)).body.canChangeDue, true);
    assert.equal(
      (await patch(creatorTok, t.id, { dueAt: '2027-01-12T12:00:00.000Z' })).status,
      200,
    );
    assert.equal((await patch(bossTok, t.id, { dueAt: '2027-01-13T12:00:00.000Z' })).status, 200);
    assert.equal((await patch(admin, t.id, { dueAt: '2027-01-14T12:00:00.000Z' })).status, 200);
  });
});

describe('Stage 0: soft delete and restore', () => {
  it('deleting hides a task and its sub-tasks; an Admin sees and restores them', async () => {
    const admin = await login(ADMIN);
    await seedUser('m@test.local', 'Member');
    const member = await login('m@test.local');
    const parent = await makeTask(admin, 'Parent');
    const child = await makeTask(admin, 'Child');
    await setParent(admin, child.id, parent.id);

    assert.equal(
      (await request(app).delete(`/api/tasks/${parent.id}`).set(auth(member))).status,
      403,
    );
    assert.equal(
      (await request(app).delete(`/api/tasks/${parent.id}`).set(auth(admin))).status,
      204,
    );
    assert.equal((await getTask(admin, parent.id)).status, 404);
    assert.equal((await getTask(admin, child.id)).status, 404);
    const rows = await prismaWithDeleted.task.findMany({ where: { deletedAt: { not: null } } });
    assert.equal(rows.length, 2, 'kept, only hidden');

    const list = await request(app).get('/api/tasks/deleted').set(auth(admin));
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].id, parent.id);
    assert.equal(list.body[0].subtaskCount, 1);
    assert.equal((await request(app).get('/api/tasks/deleted').set(auth(member))).status, 403);

    // A sub-task alone can't come back while its parent is deleted.
    assert.equal(
      (await request(app).post(`/api/tasks/${child.id}/restore`).set(auth(admin))).status,
      400,
    );
    assert.equal(
      (await request(app).post(`/api/tasks/${parent.id}/restore`).set(auth(admin))).status,
      204,
    );
    const back = await getTask(admin, parent.id);
    assert.equal(back.status, 200);
    assert.deepEqual(
      back.body.children.map((c: { id: number }) => c.id),
      [child.id],
    );
  });

  it('a deleted sub-task drops out of its parent', async () => {
    const admin = await login(ADMIN);
    const parent = await makeTask(admin, 'Parent');
    const child = await makeTask(admin, 'Child');
    await setParent(admin, child.id, parent.id);
    await request(app).delete(`/api/tasks/${child.id}`).set(auth(admin));
    const detail = await getTask(admin, parent.id);
    assert.deepEqual(detail.body.children, []);
  });
});

describe('Stage 0: last activity', () => {
  it('a comment counts as activity without changing the edit token', async () => {
    const admin = await login(ADMIN);
    const t = await makeTask(admin, 'Active');
    await prisma.task.update({
      where: { id: t.id },
      data: { lastActivityAt: new Date('2026-01-01T00:00:00Z') },
    });
    const before = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    const res = await request(app)
      .post(`/api/tasks/${t.id}/comments`)
      .set(auth(admin))
      .send({ body: '<p>news</p>' });
    assert.equal(res.status, 201);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    assert.ok(after.lastActivityAt > before.lastActivityAt);
    assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
  });
});

describe('Stage 0: duty pages and template departments', () => {
  async function department(admin: string, name: string) {
    const res = await request(app).post('/api/departments').set(auth(admin)).send({ name });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return (await prisma.department.findFirstOrThrow({ where: { name } })).id;
  }

  it('a duty keeps a sanitized SOP and a video link', async () => {
    const admin = await login(ADMIN);
    const dep = await department(admin, 'Ops');
    const res = await request(app).post(`/api/departments/${dep}/duties`).set(auth(admin)).send({
      name: 'Receiving',
      sop: '<p>Step one</p><script>alert(1)</script>',
      videoUrl: 'https://videos.example.com/receiving',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const duty = await prisma.duty.findFirstOrThrow({ where: { name: 'Receiving' } });
    assert.equal(duty.videoUrl, 'https://videos.example.com/receiving');
    assert.ok(duty.sop?.includes('Step one'));
    assert.ok(!duty.sop?.includes('script'));
    const bad = await request(app)
      .patch(`/api/departments/duties/${duty.id}`)
      .set(auth(admin))
      .send({ videoUrl: 'javascript:alert(1)' });
    assert.equal(bad.status, 400);
  });

  it('a template belongs to a department, or to the whole company', async () => {
    const admin = await login(ADMIN);
    const dep = await department(admin, 'Shipping');
    const node = { key: 'n1', parentKey: null, name: 'Pack' };
    const made = await request(app)
      .post('/api/templates')
      .set(auth(admin))
      .send({ name: 'Weekly pack', departmentId: dep, nodes: [node] });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.department.id, dep);
    const company = await request(app)
      .post('/api/templates')
      .set(auth(admin))
      .send({ name: 'All hands', nodes: [node] });
    assert.equal(company.body.department, null);
    const list = await request(app).get('/api/templates').set(auth(admin));
    const byName = Object.fromEntries(
      list.body.map((t: { name: string; department: { id: string } | null }) => [
        t.name,
        t.department,
      ]),
    );
    assert.equal(byName['Weekly pack'].id, dep);
    assert.equal(byName['All hands'], null);
  });
});

describe('Stage 1: levels, unread mentions and the parent picker on the task page', () => {
  it('tells a task where it sits in the three levels', async () => {
    const admin = await login(ADMIN);
    const p = await makeTask(admin, 'Project', { isProject: true });
    const t = await makeTask(admin, 'Task');
    const s = await makeTask(admin, 'Sub-task');
    await setParent(admin, t.id, p.id);
    await setParent(admin, s.id, t.id);
    assert.deepEqual((await getTask(admin, p.id)).body.levels, {
      depth: 0,
      topIsProject: true,
      below: 2,
    });
    assert.deepEqual((await getTask(admin, t.id)).body.levels, {
      depth: 1,
      topIsProject: true,
      below: 1,
    });
    assert.deepEqual((await getTask(admin, s.id)).body.levels, {
      depth: 2,
      topIsProject: true,
      below: 0,
    });
  });

  it("counts the reader's own unread mentions on a task", async () => {
    const admin = await login(ADMIN);
    const worker = await seedUser('worker@test.local', 'Member');
    const t = await makeTask(admin, 'Mentioned here');
    const me = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN } });
    await prisma.notification.createMany({
      data: [
        { userId: me.id, taskId: t.id, type: 'mentioned' },
        { userId: me.id, taskId: t.id, type: 'mentioned', readAt: new Date() },
        { userId: me.id, taskId: t.id, type: 'assigned', assignAction: 'added' },
        { userId: worker.id, taskId: t.id, type: 'mentioned' },
      ],
    });
    assert.equal((await getTask(admin, t.id)).body.unreadMentions, 1);
  });

  it('offers as parents only the tasks a task fits under', async () => {
    const admin = await login(ADMIN);
    const p = await makeTask(admin, 'Pick Project', { isProject: true });
    const plain = await makeTask(admin, 'Pick Plain');
    const t = await makeTask(admin, 'Pick Mover');
    const s = await makeTask(admin, 'Pick Child');
    await setParent(admin, s.id, t.id);
    const res = await request(app)
      .get(`/api/tasks/search?q=Pick&exclude=${t.id}&for=parent`)
      .set(auth(admin));
    assert.equal(res.status, 200);
    // With a sub-task of its own, it fits only under the project.
    assert.deepEqual(
      (res.body as { id: number }[]).map((r) => r.id),
      [p.id],
    );
    const all = await request(app).get(`/api/tasks/search?q=Pick&exclude=${t.id}`).set(auth(admin));
    assert.deepEqual(
      (all.body as { id: number }[]).map((r) => r.id).sort(),
      [p.id, plain.id, s.id].sort(),
    );
  });
});

describe('Stage 1: the Tasks list (My team, top task, repeat mark)', () => {
  const query = (token: string, body: Record<string, unknown>) =>
    request(app).post('/api/tasks/query').set(auth(token)).send(body);

  async function dutyIn(depName: string, dutyName: string) {
    const dep = await prisma.department.create({
      data: { name: depName, nameKey: depName.toLowerCase(), color: '#3366cc' },
    });
    return prisma.duty.create({
      data: { departmentId: dep.id, name: dutyName, nameKey: dutyName.toLowerCase() },
    });
  }

  it('My team is the people in my departments, for a Member too', async () => {
    const admin = await login(ADMIN);
    const me = await seedUser('member@test.local', 'Member');
    const mate = await seedUser('mate@test.local', 'Member');
    const stranger = await seedUser('stranger@test.local', 'Member');
    const ops = await dutyIn('Ops', 'Receiving');
    const ops2 = await prisma.duty.create({
      data: { departmentId: ops.departmentId, name: 'Shipping', nameKey: 'shipping' },
    });
    const sales = await dutyIn('Sales', 'Quotes');
    await prisma.userDuty.createMany({
      data: [
        { userId: me.id, dutyId: ops.id },
        { userId: mate.id, dutyId: ops2.id },
        { userId: stranger.id, dutyId: sales.id },
      ],
    });
    const mine = await makeTask(admin, 'Mine', { assigneeId: me.id });
    const mates = await makeTask(admin, 'Mates', { assigneeId: mate.id });
    await makeTask(admin, 'Strangers', { assigneeId: stranger.id });
    const tok = await login('member@test.local');
    const res = await query(tok, { filters: { myTeam: true } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(
      (res.body.rows as { id: number }[]).map((r) => r.id),
      [mates.id],
    );
    assert.notEqual(mine.id, mates.id);
  });

  it('each row carries its top task and whether it repeats', async () => {
    const admin = await login(ADMIN);
    const p = await makeTask(admin, 'Top Project', { isProject: true });
    const t = await makeTask(admin, 'Mid Task');
    const s = await makeTask(admin, 'Low Sub');
    await setParent(admin, t.id, p.id);
    await setParent(admin, s.id, t.id);
    await prisma.task.update({
      where: { id: s.id },
      data: { recurrenceSourceId: t.id, recurrenceSeq: 1 },
    });
    const res = await query(admin, { sort: [{ field: 'id', dir: 'asc' }] });
    const rows = res.body.rows as {
      id: number;
      top: { id: number; name: string; isProject: boolean } | null;
      repeats: boolean;
      isProject: boolean;
    }[];
    const by = new Map(rows.map((r) => [r.id, r]));
    assert.equal(by.get(p.id)!.top, null);
    assert.equal(by.get(p.id)!.isProject, true);
    assert.deepEqual(by.get(t.id)!.top, { id: p.id, name: 'Top Project', isProject: true });
    assert.deepEqual(by.get(s.id)!.top, { id: p.id, name: 'Top Project', isProject: true });
    assert.equal(by.get(s.id)!.repeats, true);
    assert.equal(by.get(t.id)!.repeats, false);
  });
});
