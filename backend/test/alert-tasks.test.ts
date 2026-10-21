import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient, Role } from '@prisma/client';
import { startTestDb, type TestDb } from './db.js';

/**
 * HLAI-112: the Alert Tasks setup — per Exclusives alert type, a template and a
 * person per role. Reading and saving it, who may, the stale-save check, the
 * backstop checks behind the screen's own, and what a deleted template does.
 * Then the task maker's alert inputs: the group and type on every task, the
 * extra text on the top task, and the history line.
 * Same harness as integration.test.ts: a real ephemeral Postgres with the
 * project's migrations.
 */

let db: TestDb;
let app: Express;
let prisma: PrismaClient;
let hashPassword: (plaintext: string) => Promise<string>;
let resetUnreadCache: () => void;
type Generation = typeof import('../src/services/template-instantiation.service.js');
let generateOccurrence: Generation['generateOccurrence'];
let carryForwardAssignees: Generation['carryForwardAssignees'];
type AlertTasks = typeof import('../src/services/exclusives/alert-tasks.service.js');
let makeImmediateAlertTasks: AlertTasks['makeImmediateAlertTasks'];
let makeDailyAlertTasks: AlertTasks['makeDailyAlertTasks'];
type Scheduler = typeof import('../src/services/scheduler.service.js');
let runScheduler: Scheduler['runScheduler'];
let computeNextWakeAt: Scheduler['computeNextWakeAt'];
let runDetection: (typeof import('../src/services/exclusives/detection.service.js'))['runDetection'];

const PASSWORD = 'TestPass123!';
const ADMIN_EMAIL = 'admin@test.local';
const URL = '/api/exclusives/alert-tasks';

before(async () => {
  db = await startTestDb();
  process.env.DATABASE_URL = db.databaseUrl;
  process.env.JWT_SECRET = 'alert-tasks-test-secret';
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

  const [appMod, prismaMod, pwMod, cacheMod, genMod, alertTasksMod, detectionMod, schedMod] =
    await Promise.all([
      import('../src/app.js'),
      import('../src/db/prisma.js'),
      import('../src/utils/password.js'),
      import('../src/services/unread-cache.js'),
      import('../src/services/template-instantiation.service.js'),
      import('../src/services/exclusives/alert-tasks.service.js'),
      import('../src/services/exclusives/detection.service.js'),
      import('../src/services/scheduler.service.js'),
    ]);
  makeImmediateAlertTasks = alertTasksMod.makeImmediateAlertTasks;
  makeDailyAlertTasks = alertTasksMod.makeDailyAlertTasks;
  runScheduler = schedMod.runScheduler;
  computeNextWakeAt = schedMod.computeNextWakeAt;
  runDetection = detectionMod.runDetection;
  app = appMod.createApp();
  prisma = prismaMod.prisma;
  hashPassword = pwMod.hashPassword;
  resetUnreadCache = cacheMod.__resetUnreadCache;
  generateOccurrence = genMod.generateOccurrence;
  carryForwardAssignees = genMod.carryForwardAssignees;
});

after(async () => {
  await prisma?.$disconnect();
  await db?.stop();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Task", "PasswordResetToken", "User", "SchedulerState", "AppSetting", "Department", "AlertTaskSetting" RESTART IDENTITY CASCADE',
  );
  resetUnreadCache();
  await seedUser({ email: ADMIN_EMAIL, role: 'Admin' });
});

// --- helpers ---------------------------------------------------------------

async function seedUser(opts: { email: string; role: Role; isActive?: boolean }) {
  return prisma.user.create({
    data: {
      email: opts.email,
      role: opts.role,
      isActive: opts.isActive ?? true,
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

/** A template whose tasks carry these roles (and optionally a duty each). */
async function makeTemplate(
  token: string,
  name: string,
  nodes: { role: string | null; dutyId?: string }[],
): Promise<number> {
  const res = await request(app)
    .post('/api/templates')
    .set(auth(token))
    .send({
      name,
      nodes: nodes.map((n, i) => ({
        key: `n${i}`,
        parentKey: i === 0 ? null : 'n0',
        name: `Step ${i + 1}`,
        assigneeRole: n.role,
        dutyId: n.dutyId ?? null,
      })),
    });
  assert.equal(res.status, 201, `create template failed: ${JSON.stringify(res.body)}`);
  return res.body.id as number;
}

/** A duty in a new department, for the duty checks. */
async function makeDuty(token: string): Promise<string> {
  const dept = await request(app)
    .post('/api/departments')
    .set(auth(token))
    .send({ name: 'Pricing' });
  assert.equal(dept.status, 201, JSON.stringify(dept.body));
  const created = await prisma.department.findFirstOrThrow({ where: { name: 'Pricing' } });
  const duty = await request(app)
    .post(`/api/departments/${created.id}/duties`)
    .set(auth(token))
    .send({ name: 'Buy Box Recovery' });
  assert.equal(duty.status, 201, JSON.stringify(duty.body));
  return (await prisma.duty.findFirstOrThrow({ where: { name: 'Buy Box Recovery' } })).id;
}

type Setting = {
  alertType: string;
  templateId: number | null;
  roleAssignments: { role: string; assigneeId: string | null }[];
};
type Setup = { settings: Setting[]; updatedAt: string | null };

async function getSetup(token: string): Promise<Setup> {
  const res = await request(app).get(URL).set(auth(token));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as Setup;
}

function save(token: string, settings: Setting[], expectedUpdatedAt: string | null) {
  return request(app).put(URL).set(auth(token)).send({ settings, expectedUpdatedAt });
}

const row = (setup: Setup, alertType: string) =>
  setup.settings.find((s) => s.alertType === alertType)!;

// --- Reading and saving ----------------------------------------------------

describe('Alert Tasks setup', () => {
  it('starts with all 12 alert types empty and no version', async () => {
    const setup = await getSetup(await adminToken());
    assert.equal(setup.settings.length, 12);
    assert.equal(setup.settings[0]!.alertType, 'ListingSuppressed');
    assert.ok(setup.settings.every((s) => s.templateId === null && s.roleAssignments.length === 0));
    assert.equal(setup.updatedAt, null);
  });

  it('saves a template and people, and reads them back', async () => {
    const admin = await adminToken();
    const ana = await seedUser({ email: 'ana@test.local', role: 'Member' });
    const ben = await seedUser({ email: 'ben@test.local', role: 'Member' });
    const tpl = await makeTemplate(admin, 'Buy Box Recovery', [
      { role: 'Pricing Analyst' },
      { role: 'Pricing Manager' },
    ]);

    const res = await save(
      admin,
      [
        {
          alertType: 'BuyBoxLost',
          templateId: tpl,
          roleAssignments: [
            { role: 'Pricing Manager', assigneeId: ben.id },
            { role: 'Pricing Analyst', assigneeId: ana.id },
          ],
        },
      ],
      null,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const saved = res.body as Setup;
    assert.deepEqual(row(saved, 'BuyBoxLost'), {
      alertType: 'BuyBoxLost',
      templateId: tpl,
      // People only, by role.
      roleAssignments: [
        { role: 'Pricing Analyst', assigneeId: ana.id },
        { role: 'Pricing Manager', assigneeId: ben.id },
      ],
    });
    assert.ok(saved.updatedAt);
    assert.deepEqual(await getSetup(admin), saved);

    // Only the type with something in it got a row; it records who saved it.
    const rows = await prisma.alertTaskSetting.findMany();
    assert.equal(rows.length, 1);
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    assert.equal(rows[0]!.savedById, adminUser.id);
  });

  it('leaves a role unassigned when no one is picked for it', async () => {
    const admin = await adminToken();
    const ana = await seedUser({ email: 'ana@test.local', role: 'Member' });
    const tpl = await makeTemplate(admin, 'Review', [{ role: 'Analyst' }, { role: 'Approver' }]);
    const res = await save(
      admin,
      [
        {
          alertType: 'PriceChanged',
          templateId: tpl,
          roleAssignments: [
            { role: 'Analyst', assigneeId: ana.id },
            { role: 'Approver', assigneeId: null },
          ],
        },
      ],
      null,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(row(res.body as Setup, 'PriceChanged').roleAssignments, [
      { role: 'Analyst', assigneeId: ana.id },
    ]);
  });

  it('records each row’s saver, rewriting only the rows that changed', async () => {
    const admin = await adminToken();
    await seedUser({ email: 'second@test.local', role: 'Admin' });
    const second = await login('second@test.local');
    const tplA = await makeTemplate(admin, 'A', [{ role: null }]);
    const tplB = await makeTemplate(admin, 'B', [{ role: null }]);

    const first = (
      await save(
        admin,
        [
          { alertType: 'ListingSuppressed', templateId: tplA, roleAssignments: [] },
          { alertType: 'BuyBoxLost', templateId: tplA, roleAssignments: [] },
        ],
        null,
      )
    ).body as Setup;

    // The second Admin sends every row, changing only Buy Box Lost.
    const res = await save(
      second,
      first.settings.map((s) => (s.alertType === 'BuyBoxLost' ? { ...s, templateId: tplB } : s)),
      first.updatedAt,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const savers = Object.fromEntries(
      (await prisma.alertTaskSetting.findMany({ include: { savedBy: true } })).map((r) => [
        r.alertType,
        r.savedBy?.email,
      ]),
    );
    assert.deepEqual(savers, { ListingSuppressed: ADMIN_EMAIL, BuyBoxLost: 'second@test.local' });
  });

  it('keeps a cleared row, with no template and no people', async () => {
    const admin = await adminToken();
    const ana = await seedUser({ email: 'ana@test.local', role: 'Member' });
    const tpl = await makeTemplate(admin, 'A', [{ role: 'Analyst' }]);
    const first = (
      await save(
        admin,
        [
          {
            alertType: 'TitleChanged',
            templateId: tpl,
            roleAssignments: [{ role: 'Analyst', assigneeId: ana.id }],
          },
        ],
        null,
      )
    ).body as Setup;

    const res = await save(
      admin,
      [{ alertType: 'TitleChanged', templateId: null, roleAssignments: [] }],
      first.updatedAt,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(row(res.body as Setup, 'TitleChanged'), {
      alertType: 'TitleChanged',
      templateId: null,
      roleAssignments: [],
    });
  });

  it('empties a row whose template is deleted', async () => {
    const admin = await adminToken();
    const ana = await seedUser({ email: 'ana@test.local', role: 'Member' });
    const tpl = await makeTemplate(admin, 'Short-lived', [{ role: 'Analyst' }]);
    await save(
      admin,
      [
        {
          alertType: 'BrandChanged',
          templateId: tpl,
          roleAssignments: [{ role: 'Analyst', assigneeId: ana.id }],
        },
      ],
      null,
    );

    const del = await request(app).delete(`/api/templates/${tpl}`).set(auth(admin));
    assert.equal(del.status, 204, JSON.stringify(del.body));
    assert.deepEqual(row(await getSetup(admin), 'BrandChanged'), {
      alertType: 'BrandChanged',
      templateId: null,
      roleAssignments: [],
    });
  });
});

// --- Who may ---------------------------------------------------------------

describe('Alert Tasks setup — access', () => {
  it('is for Admins only', async () => {
    for (const role of ['Manager', 'Member'] as const) {
      const email = `${role.toLowerCase()}@test.local`;
      await seedUser({ email, role });
      const token = await login(email);
      assert.equal((await request(app).get(URL).set(auth(token))).status, 403, role);
      assert.equal((await save(token, [], null)).status, 403, role);
    }
    assert.equal((await request(app).get(URL)).status, 401);
  });
});

// --- Someone else saved first ----------------------------------------------

describe('Alert Tasks setup — stale saves', () => {
  it('refuses a save made from an older version', async () => {
    const admin = await adminToken();
    const tplA = await makeTemplate(admin, 'A', [{ role: null }]);
    const tplB = await makeTemplate(admin, 'B', [{ role: null }]);

    const v1 = (
      await save(admin, [{ alertType: 'BuyBoxWon', templateId: tplA, roleAssignments: [] }], null)
    ).body as Setup;

    // Opened before anything was saved.
    const fromEmpty = await save(
      admin,
      [{ alertType: 'BuyBoxWon', templateId: tplB, roleAssignments: [] }],
      null,
    );
    assert.equal(fromEmpty.status, 409);
    assert.equal(fromEmpty.body.details.code, 'STALE_WRITE');

    const v2 = (
      await save(
        admin,
        [{ alertType: 'BuyBoxWon', templateId: tplB, roleAssignments: [] }],
        v1.updatedAt,
      )
    ).body as Setup;
    assert.notEqual(v2.updatedAt, v1.updatedAt);

    // Opened at v1, saved after v2.
    const old = await save(
      admin,
      [{ alertType: 'BuyBoxWon', templateId: tplA, roleAssignments: [] }],
      v1.updatedAt,
    );
    assert.equal(old.status, 409);
    assert.equal(row(await getSetup(admin), 'BuyBoxWon').templateId, tplB);
  });
});

// --- The checks behind the screen's own ----------------------------------

describe('Alert Tasks setup — checks', () => {
  it('refuses a template that no longer exists', async () => {
    const res = await save(
      await adminToken(),
      [{ alertType: 'ListingSuppressed', templateId: 999, roleAssignments: [] }],
      null,
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /template picked for Listing Suppressed no longer exists/);
  });

  it('refuses a role the template does not have', async () => {
    const admin = await adminToken();
    const ana = await seedUser({ email: 'ana@test.local', role: 'Member' });
    const tpl = await makeTemplate(admin, 'A', [{ role: 'Analyst' }]);
    const res = await save(
      admin,
      [
        {
          alertType: 'PriceChanged',
          templateId: tpl,
          roleAssignments: [{ role: 'Reviewer', assigneeId: ana.id }],
        },
      ],
      null,
    );
    assert.equal(res.status, 400);
    assert.match(
      res.body.error,
      /“Reviewer” is not a role of the template picked for Price Changed/,
    );
  });

  it('refuses people with no template, and someone no longer active', async () => {
    const admin = await adminToken();
    const gone = await seedUser({ email: 'gone@test.local', role: 'Member', isActive: false });
    const tpl = await makeTemplate(admin, 'A', [{ role: 'Analyst' }]);

    const noTemplate = await save(
      admin,
      [
        {
          alertType: 'PriceChanged',
          templateId: null,
          roleAssignments: [{ role: 'Analyst', assigneeId: gone.id }],
        },
      ],
      null,
    );
    assert.equal(noTemplate.status, 400);
    assert.match(noTemplate.body.error, /Pick a template for Price Changed before choosing people/);

    const inactive = await save(
      admin,
      [
        {
          alertType: 'PriceChanged',
          templateId: tpl,
          roleAssignments: [{ role: 'Analyst', assigneeId: gone.id }],
        },
      ],
      null,
    );
    assert.equal(inactive.status, 400);
    assert.match(inactive.body.error, /Someone picked for Price Changed is no longer active/);
  });

  it('refuses someone missing a duty their role needs, then takes them once they hold it', async () => {
    const admin = await adminToken();
    const ana = await seedUser({ email: 'ana@test.local', role: 'Member' });
    const duty = await makeDuty(admin);
    const tpl = await makeTemplate(admin, 'Buy Box Recovery', [
      { role: 'Pricing Analyst', dutyId: duty },
    ]);
    const settings = [
      {
        alertType: 'BuyBoxLost',
        templateId: tpl,
        roleAssignments: [{ role: 'Pricing Analyst', assigneeId: ana.id }],
      },
    ];

    const refused = await save(admin, settings, null);
    assert.equal(refused.status, 422);
    assert.equal(refused.body.details.code, 'DUTY_NOT_HELD');
    assert.equal(refused.body.details.problems.length, 1);
    assert.equal(refused.body.details.problems[0].alertType, 'BuyBoxLost');
    assert.equal(refused.body.details.problems[0].userId, ana.id);
    assert.equal(await prisma.alertTaskSetting.count(), 0);

    await prisma.userDuty.create({ data: { userId: ana.id, dutyId: duty } });
    assert.equal((await save(admin, settings, null)).status, 200);
  });

  it('refuses the same alert type twice, and an unknown one', async () => {
    const admin = await adminToken();
    const twice = await save(
      admin,
      [
        { alertType: 'BuyBoxLost', templateId: null, roleAssignments: [] },
        { alertType: 'BuyBoxLost', templateId: null, roleAssignments: [] },
      ],
      null,
    );
    assert.equal(twice.status, 400);
    const unknown = await save(
      admin,
      [{ alertType: 'Nope', templateId: null, roleAssignments: [] }],
      null,
    );
    assert.equal(unknown.status, 400);
  });
});

// --- Step 6: the task maker's alert inputs ---------------------------------

describe('making tasks for an alert', () => {
  /** A template: a top task with this description, and two under it (one described). */
  async function treeTemplate(token: string, topDescription: string | null) {
    const res = await request(app)
      .post('/api/templates')
      .set(auth(token))
      .send({
        name: 'Buy Box Recovery',
        nodes: [
          {
            key: 'top',
            parentKey: null,
            name: 'Recover the Buy Box',
            description: topDescription,
            assigneeRole: 'Analyst',
          },
          {
            key: 'a',
            parentKey: 'top',
            name: 'Check the price',
            description: '<p>Look at the other sellers.</p>',
          },
          { key: 'b', parentKey: 'top', name: 'Propose a new price' },
        ],
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body as { id: number; nodes: { id: number; name: string }[] };
  }

  async function makeGroupRow(name: string) {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    return prisma.alertGroup.create({ data: { name, groupType: 'GROUP', createdById: admin.id } });
  }

  const LIST =
    '<ol><li><p>B0ABC12345: Wasif - US - Buy Box Won - Oct 19, 2026, 2:15 PM</p></li></ol>';

  async function makeForAlert(
    templateId: number,
    more: Partial<Parameters<typeof generateOccurrence>[0]>,
  ) {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    return generateOccurrence({
      templateId,
      seq: null,
      origin: 'alert',
      instanceLabel: 'WasiU_BW_262920830',
      anchorStart: new Date('2026-10-19T12:30:00Z'),
      assigneeByNodeId: new Map(),
      creatorId: admin.id,
      actorId: admin.id,
      ...more,
    });
  }

  it('puts the group and type on every task, the extra text on the top one, and says so in History', async () => {
    const admin = await adminToken();
    const tpl = await treeTemplate(admin, '<p>Fix the listing.</p>');
    const group = await makeGroupRow('Wasif - US');

    const gen = await makeForAlert(tpl.id, {
      alertGroupId: group.id,
      alertType: 'BuyBoxWon',
      rootDescriptionExtra: LIST,
    });

    const tasks = await prisma.task.findMany({ where: { id: { in: gen.taskIds } } });
    assert.equal(tasks.length, 3);
    for (const t of tasks) {
      assert.equal(t.alertGroupId, group.id, t.name);
      assert.equal(t.alertType, 'BuyBoxWon', t.name);
      assert.ok(t.name.startsWith('WasiU_BW_262920830: '), t.name);
    }

    // The template's own text first, then the list; the other tasks as in the template.
    const named = (end: string) => tasks.find((t) => t.name.endsWith(end))!;
    assert.equal(named('Recover the Buy Box').id, gen.rootTaskId);
    assert.equal(named('Recover the Buy Box').description, `<p>Fix the listing.</p>${LIST}`);
    assert.equal(named('Check the price').description, '<p>Look at the other sellers.</p>');
    assert.equal(named('Propose a new price').description, null);

    // Every task says it came from the alert; the top one also names the template.
    const history = await prisma.taskHistory.findMany({ where: { taskId: { in: gen.taskIds } } });
    for (const id of gen.taskIds) {
      assert.deepEqual(
        history
          .filter((h) => h.taskId === id && h.field === 'alert')
          .map((h) => [h.changeType, h.detail]),
        [['added', 'a Buy Box Won alert (Wasif - US)']],
      );
    }
    assert.ok(history.some((h) => h.taskId === gen.rootTaskId && h.field === 'template'));

    const occurrence = await prisma.templateOccurrence.findUniqueOrThrow({
      where: { id: gen.occurrenceId },
    });
    assert.equal(occurrence.origin, 'alert');

    // The task page shows them as the task's Alert Group and Alert Type.
    const res = await request(app).get(`/api/tasks/${gen.rootTaskId}`).set(auth(admin));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.alertGroup.name, 'Wasif - US');
    assert.equal(res.body.alertType, 'BuyBoxWon');
  });

  it('with no text in the template, the top task gets just the extra text', async () => {
    const admin = await adminToken();
    const tpl = await treeTemplate(admin, null);
    const group = await makeGroupRow('Wasif - CA');
    const gen = await makeForAlert(tpl.id, {
      alertGroupId: group.id,
      alertType: 'ListingSuppressed',
      rootDescriptionExtra: LIST,
    });
    const top = await prisma.task.findUniqueOrThrow({ where: { id: gen.rootTaskId } });
    assert.equal(top.description, LIST);
  });

  it('refuses a group that no longer exists, making nothing', async () => {
    const admin = await adminToken();
    const tpl = await treeTemplate(admin, null);
    await assert.rejects(
      makeForAlert(tpl.id, { alertGroupId: 999, alertType: 'BuyBoxLost' }),
      /Alert group not found/,
    );
    assert.equal(await prisma.task.count(), 0);
    assert.equal(await prisma.templateOccurrence.count(), 0);
  });

  it('leaves manual creation as it was: no group, no type, no alert line', async () => {
    const admin = await adminToken();
    const tpl = await treeTemplate(admin, '<p>Fix the listing.</p>');
    const res = await request(app)
      .post(`/api/templates/${tpl.id}/instantiate`)
      .set(auth(admin))
      .send({ instanceLabel: 'Batch 1', anchorStart: '2026-10-19', roleAssignments: [] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const tasks = await prisma.task.findMany({ where: { id: { in: res.body.taskIds } } });
    assert.ok(tasks.every((t) => t.alertGroupId === null && t.alertType === null));
    const top = tasks.find((t) => t.id === res.body.rootTaskId)!;
    assert.equal(top.description, '<p>Fix the listing.</p>');
    assert.equal(await prisma.taskHistory.count({ where: { field: 'alert' } }), 0);
    assert.equal(res.body.occurrence.origin, 'manual');
  });

  it('a schedule never takes its people from tasks made from alerts', async () => {
    const admin = await adminToken();
    const ana = await seedUser({ email: 'ana@test.local', role: 'Member' });
    const ben = await seedUser({ email: 'ben@test.local', role: 'Member' });
    const tpl = await treeTemplate(admin, null);
    const top = tpl.nodes.find((n) => n.name === 'Recover the Buy Box')!;

    // Made by hand for Ana, then from an alert for Ben.
    const manual = await request(app)
      .post(`/api/templates/${tpl.id}/instantiate`)
      .set(auth(admin))
      .send({
        anchorStart: '2026-10-19',
        roleAssignments: [{ role: 'Analyst', assigneeId: ana.id }],
      });
    assert.equal(manual.status, 201, JSON.stringify(manual.body));
    const group = await makeGroupRow('Wasif - US');
    await makeForAlert(tpl.id, {
      alertGroupId: group.id,
      alertType: 'BuyBoxLost',
      assigneeByNodeId: new Map([[top.id, ben.id]]),
    });

    assert.equal((await carryForwardAssignees(tpl.id)).get(top.id), ana.id);
  });
});

// --- Step 7: Immediate tasks ------------------------------------------------

describe('Immediate alert tasks', () => {
  // 19 Oct 2026, 08:30 in New York.
  const AT = new Date('2026-10-19T12:30:00Z');
  const run = () =>
    makeImmediateAlertTasks(
      () => {},
      () => AT,
    );

  /** A group watching these alert types, each on its mode. */
  async function watchingGroup(name: string, modes: Record<string, string>) {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    return prisma.alertGroup.create({
      data: {
        name,
        groupType: 'GROUP',
        createdById: admin.id,
        settings: {
          create: Object.entries(modes).map(([alertType, mode]) => ({ alertType, mode })),
        },
      },
    });
  }

  /** An alert as a check logs it. */
  function logAlert(
    group: { id: number; name: string } | null,
    alertType: string,
    asin = 'B0ABC12345',
  ) {
    return prisma.alertLog.create({
      data: {
        groupId: group?.id ?? null,
        groupName: group?.name ?? 'Gone',
        alertType,
        message: 'Something changed.',
        asin,
        marketplace: 'USA',
        title: 'Widget',
      },
    });
  }

  /** Alert Task Setup for one type, as if `saver` saved it. */
  function setUp(
    alertType: string,
    templateId: number,
    roleAssignments: { role: string; assigneeId: string }[],
    savedById: string | null,
  ) {
    return prisma.alertTaskSetting.create({
      data: { alertType, templateId, roleAssignments, savedById },
    });
  }

  const tasksOf = (alertLogId: number) =>
    prisma.alertLog.findUniqueOrThrow({ where: { id: alertLogId } }).then((a) =>
      a.taskId === null
        ? []
        : prisma.task.findUniqueOrThrow({ where: { id: a.taskId } }).then((top) =>
            prisma.task.findMany({
              where: { templateOccurrenceId: top.templateOccurrenceId },
              orderBy: { id: 'asc' },
            }),
          ),
    );

  it('a check’s Immediate alert makes its own task tree: labelled, tagged, assigned, created by the saver', async () => {
    const admin = await adminToken();
    const saver = await seedUser({ email: 'saver@test.local', role: 'Admin' });
    const ana = await seedUser({ email: 'ana@test.local', role: 'Member' });
    const tpl = await makeTemplate(admin, 'Price Review', [
      { role: 'Analyst' },
      { role: 'Reviewer' },
    ]);
    await setUp('PriceChanged', tpl, [{ role: 'Analyst', assigneeId: ana.id }], saver.id);

    // A real check: the saved price differs from Amazon's, so it logs PriceChanged.
    const group = await watchingGroup('Wasif - US', { PriceChanged: 'immediate' });
    const listing = await prisma.listing.create({
      data: {
        groupId: group.id,
        marketplace: 'USA',
        asin: 'B0IMMED001',
        sku: 'SKU-1',
        createdById: saver.id,
      },
    });
    await prisma.listingSnapshot.create({
      data: {
        listingId: listing.id,
        title: 'Widget',
        listedPrice: 34.99,
        currency: 'USD',
        bulletPoints: [],
      },
    });
    const detection = await runDetection([
      {
        listingId: listing.id,
        draft: {
          sku: 'SKU-1',
          marketplace: 'USA',
          asin: 'B0IMMED001',
          title: 'Widget',
          listedPrice: 31.49,
          currency: 'USD',
          bulletPoints: [],
          isSuppressed: false,
        },
      },
    ]);
    assert.equal(detection.alertsWritten, 1);

    assert.deepEqual(await run(), { made: 1, noTask: 0, failed: 0 });

    const alert = await prisma.alertLog.findFirstOrThrow({ where: { asin: 'B0IMMED001' } });
    assert.ok(alert.taskHandledAt);
    const tasks = await tasksOf(alert.id);
    assert.deepEqual(
      tasks.map((t) => [t.name, t.assigneeId, t.creatorId, t.alertGroupId, t.alertType]),
      [
        ['WasiU_PC_262920830: Step 1', ana.id, saver.id, group.id, 'PriceChanged'],
        ['WasiU_PC_262920830: Step 2', null, saver.id, group.id, 'PriceChanged'],
      ],
    );
    assert.equal(alert.taskId, tasks[0]!.id);
    const line = await prisma.taskHistory.findFirstOrThrow({
      where: { taskId: tasks[0]!.id, field: 'alert' },
    });
    assert.equal(line.detail, 'a Price Changed alert (Wasif - US)');
    assert.equal(line.userId, saver.id);

    // The next check makes nothing more for it.
    assert.deepEqual(await run(), { made: 0, noTask: 0, failed: 0 });
    assert.equal(await prisma.task.count(), 2);
  });

  it('gives every alert its own task, counting up when the label is taken', async () => {
    const admin = await adminToken();
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const tpl = await makeTemplate(admin, 'Check', [{ role: null }]);
    await setUp('BuyBoxLost', tpl, [], adminUser.id);
    const group = await watchingGroup('Wasif - CA', { BuyBoxLost: 'immediate' });
    for (const asin of ['B0000000A1', 'B0000000A2', 'B0000000A3']) {
      await logAlert(group, 'BuyBoxLost', asin);
    }

    assert.deepEqual(await run(), { made: 3, noTask: 0, failed: 0 });
    const names = (await prisma.task.findMany({ orderBy: { id: 'asc' } })).map((t) => t.name);
    assert.deepEqual(names, [
      'WasiC_BL_262920830: Step 1',
      'WasiC_BL_262920830_2: Step 1',
      'WasiC_BL_262920830_3: Step 1',
    ]);
  });

  it('leaves Daily alerts for 8:30, and makes nothing, ever, for alerts with no task due', async () => {
    const admin = await adminToken();
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const tpl = await makeTemplate(admin, 'Check', [{ role: null }]);
    await setUp('PriceChanged', tpl, [], adminUser.id);
    await setUp('BrandChanged', tpl, [], adminUser.id);
    const group = await watchingGroup('Wasif - US', {
      PriceChanged: 'daily',
      TitleChanged: 'immediate', // no template on Alert Task Setup
      BrandChanged: 'off', // switched off after the alert was logged
    });
    const daily = await logAlert(group, 'PriceChanged');
    const noTemplate = await logAlert(group, 'TitleChanged');
    const off = await logAlert(group, 'BrandChanged');
    const groupGone = await logAlert(null, 'PriceChanged');

    assert.deepEqual(await run(), { made: 0, noTask: 3, failed: 0 });
    const handled = async (id: number) =>
      (await prisma.alertLog.findUniqueOrThrow({ where: { id } })).taskHandledAt !== null;
    assert.equal(await handled(daily.id), false, 'the Daily task picks it up');
    assert.equal(await handled(noTemplate.id), true);
    assert.equal(await handled(off.id), true);
    assert.equal(await handled(groupGone.id), true);

    // A template picked later does not reach back to it.
    await setUp('TitleChanged', tpl, [], adminUser.id);
    assert.deepEqual(await run(), { made: 0, noTask: 0, failed: 0 });
    assert.equal(await prisma.task.count(), 0);
  });

  it('never makes a task for an alert from before go-live', async () => {
    const admin = await adminToken();
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const tpl = await makeTemplate(admin, 'Check', [{ role: null }]);
    await setUp('PriceChanged', tpl, [], adminUser.id);
    const group = await watchingGroup('Wasif - US', { PriceChanged: 'immediate' });
    // The go-live migration marked every alert already in the log as dealt with.
    const old = await logAlert(group, 'PriceChanged');
    await prisma.alertLog.update({
      where: { id: old.id },
      data: { taskHandledAt: new Date('2026-10-01') },
    });

    assert.deepEqual(await run(), { made: 0, noTask: 0, failed: 0 });
    assert.equal(await prisma.task.count(), 0);
  });

  it('leaves a deactivated person’s role unassigned, and still gives tasks to someone missing a duty', async () => {
    const admin = await adminToken();
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const gone = await seedUser({ email: 'gone@test.local', role: 'Member' });
    const ana = await seedUser({ email: 'ana@test.local', role: 'Member' });
    const duty = await makeDuty(admin);
    const tpl = await makeTemplate(admin, 'Recovery', [
      { role: 'Analyst', dutyId: duty },
      { role: 'Reviewer' },
    ]);
    await setUp(
      'BuyBoxLost',
      tpl,
      [
        { role: 'Analyst', assigneeId: ana.id }, // does not hold the duty
        { role: 'Reviewer', assigneeId: gone.id },
      ],
      adminUser.id,
    );
    await prisma.user.update({ where: { id: gone.id }, data: { isActive: false } });
    const group = await watchingGroup('Wasif - US', { BuyBoxLost: 'immediate' });
    const alert = await logAlert(group, 'BuyBoxLost');

    assert.deepEqual(await run(), { made: 1, noTask: 0, failed: 0 });
    assert.deepEqual(
      (await tasksOf(alert.id)).map((t) => t.assigneeId),
      [ana.id, null],
    );
  });

  it('tries a task that could not be made again on the next check', async () => {
    const admin = await adminToken();
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const tpl = await makeTemplate(admin, 'Check', [{ role: null }]);
    await setUp('PriceChanged', tpl, [], null); // nobody recorded as its creator
    const group = await watchingGroup('Wasif - US', { PriceChanged: 'immediate' });
    const alert = await logAlert(group, 'PriceChanged');

    const logged: string[] = [];
    const first = await makeImmediateAlertTasks(
      (m) => logged.push(m),
      () => AT,
    );
    assert.deepEqual(first, { made: 0, noTask: 0, failed: 1 });
    assert.match(logged.join('\n'), /task not made, trying again next check/);
    assert.equal(
      (await prisma.alertLog.findUniqueOrThrow({ where: { id: alert.id } })).taskHandledAt,
      null,
    );

    await prisma.alertTaskSetting.update({
      where: { alertType: 'PriceChanged' },
      data: { savedById: adminUser.id },
    });
    assert.deepEqual(await run(), { made: 1, noTask: 0, failed: 0 });
  });

  it('never makes two tasks for one alert', async () => {
    const admin = await adminToken();
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const tpl = await makeTemplate(admin, 'Check', [{ role: null }]);
    await setUp('PriceChanged', tpl, [], adminUser.id);
    const group = await watchingGroup('Wasif - US', { PriceChanged: 'immediate' });
    const alert = await logAlert(group, 'PriceChanged');
    assert.deepEqual(await run(), { made: 1, noTask: 0, failed: 0 });

    // Even asked directly, the task maker refuses an alert that has its task.
    await assert.rejects(
      generateOccurrence({
        templateId: tpl,
        seq: null,
        origin: 'alert',
        instanceLabel: 'again',
        anchorStart: AT,
        assigneeByNodeId: new Map(),
        creatorId: adminUser.id,
        actorId: adminUser.id,
        alertGroupId: group.id,
        alertType: 'PriceChanged',
        alertLogIds: [alert.id],
      }),
      /already have their task/,
    );
    assert.equal(await prisma.task.count(), 1);
  });
});

// --- Step 9: Daily tasks at 8:30 AM -------------------------------------------

describe('Daily alert tasks', () => {
  // New York is on EDT (UTC-4) in October 2026: 8:30 AM there is 12:30 UTC.
  const ny = (iso: string) => new Date(`${iso}-04:00`);

  async function watchingGroup(name: string, modes: Record<string, string>) {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    return prisma.alertGroup.create({
      data: {
        name,
        groupType: 'GROUP',
        createdById: admin.id,
        settings: {
          create: Object.entries(modes).map(([alertType, mode]) => ({ alertType, mode })),
        },
      },
    });
  }

  function logAlert(
    group: { id: number; name: string } | null,
    alertType: string,
    asin: string,
    createdAt: Date,
    message = 'Something changed.',
  ) {
    return prisma.alertLog.create({
      data: {
        groupId: group?.id ?? null,
        groupName: group?.name ?? 'Gone',
        alertType,
        message,
        asin,
        marketplace: 'USA',
        title: 'Widget',
        createdAt,
      },
    });
  }

  /** A template whose top task says `topText`, set up for `alertType`. */
  async function setUpDaily(alertType: string, topText: string | null = '<p>Fix it.</p>') {
    const admin = await adminToken();
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const res = await request(app)
      .post('/api/templates')
      .set(auth(admin))
      .send({
        name: `Daily ${alertType}`,
        nodes: [
          { key: 'top', parentKey: null, name: 'Work through the alerts', description: topText },
          { key: 'a', parentKey: 'top', name: 'Report back' },
        ],
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    await prisma.alertTaskSetting.create({
      data: { alertType, templateId: res.body.id, roleAssignments: [], savedById: adminUser.id },
    });
    return res.body.id as number;
  }

  const tops = () => prisma.task.findMany({ where: { parentId: null }, orderBy: { id: 'asc' } });
  const NONE = { made: 0, noTask: 0, failed: 0 };

  it('makes one task per group and type for the day that ended at 8:30, with its alerts in a table', async () => {
    await setUpDaily('ListingSuppressed');
    const group = await watchingGroup('Wasif - CA', { ListingSuppressed: 'daily' });
    const first = await logAlert(
      group,
      'ListingSuppressed',
      'B0DAILY001',
      ny('2026-10-18T15:00:00'),
    );
    const second = await logAlert(
      group,
      'ListingSuppressed',
      'B0DAILY002',
      ny('2026-10-19T08:00:00'),
    );
    const nextDay = await logAlert(
      group,
      'ListingSuppressed',
      'B0DAILY003',
      ny('2026-10-19T09:00:00'),
    );

    // Before 8:30 nothing is due; at 8:31 the day from 8:30 yesterday is.
    assert.deepEqual(await makeDailyAlertTasks(() => {}, ny('2026-10-19T08:29:00')), NONE);
    assert.deepEqual(await makeDailyAlertTasks(() => {}, ny('2026-10-19T08:31:00')), {
      made: 1,
      noTask: 0,
      failed: 0,
    });

    const [top] = await tops();
    assert.equal(top!.name, 'WasiC_LS_262920830: Work through the alerts');
    assert.equal(top!.alertGroupId, group.id);
    assert.equal(top!.alertType, 'ListingSuppressed');
    assert.equal(
      top!.description,
      '<p>Fix it.</p>' +
        '<table><tbody>' +
        '<tr><th><p>No.</p></th><th><p>ASIN</p></th><th><p>Group</p></th>' +
        '<th><p>Alert Type</p></th><th><p>Date &amp; time</p></th><th><p>Details</p></th></tr>' +
        '<tr><td><p>1</p></td><td><p>B0DAILY001</p></td><td><p>Wasif - CA</p></td>' +
        '<td><p>Listing Suppressed</p></td><td><p>Oct 18, 2026, 3:00 PM</p></td><td><p>Something changed.</p></td></tr>' +
        '<tr><td><p>2</p></td><td><p>B0DAILY002</p></td><td><p>Wasif - CA</p></td>' +
        '<td><p>Listing Suppressed</p></td><td><p>Oct 19, 2026, 8:00 AM</p></td><td><p>Something changed.</p></td></tr>' +
        '</tbody></table>' +
        '<p><a href="/exclusives/log?from=2026-10-18T12%3A30%3A00.000Z&amp;to=2026-10-19T12%3A30%3A00.000Z' +
        `&amp;type=ListingSuppressed&amp;group=${group.id}">View these alerts in the Alert Log</a></p>`,
    );

    // Both alerts point at the task; the next day's waits for tomorrow.
    const after = await prisma.alertLog.findMany({ orderBy: { id: 'asc' } });
    assert.deepEqual(
      after.map((a) => [a.id, a.taskId, a.taskHandledAt !== null]),
      [
        [first.id, top!.id, true],
        [second.id, top!.id, true],
        [nextDay.id, null, false],
      ],
    );

    // Running again makes nothing more.
    assert.deepEqual(await makeDailyAlertTasks(() => {}, ny('2026-10-19T10:00:00')), NONE);
  });

  it('catches up on days a missed 8:30 left behind, one task per day', async () => {
    await setUpDaily('BuyBoxLost');
    const group = await watchingGroup('Wasif -US', { BuyBoxLost: 'daily' });
    await logAlert(group, 'BuyBoxLost', 'B0DAILY011', ny('2026-10-17T20:00:00')); // day ends the 18th
    await logAlert(group, 'BuyBoxLost', 'B0DAILY012', ny('2026-10-18T20:00:00')); // day ends the 19th

    assert.deepEqual(await makeDailyAlertTasks(() => {}, ny('2026-10-20T10:00:00')), {
      made: 2,
      noTask: 0,
      failed: 0,
    });
    assert.deepEqual(
      (await tops()).map((t) => t.name),
      [
        'WasiU_BL_262910830: Work through the alerts',
        'WasiU_BL_262920830: Work through the alerts',
      ],
    );
  });

  it('keeps groups and alert types apart', async () => {
    await setUpDaily('ListingSuppressed');
    await setUpDaily('BuyBoxLost');
    const ca = await watchingGroup('Wasif - CA', {
      ListingSuppressed: 'daily',
      BuyBoxLost: 'daily',
    });
    const us = await watchingGroup('Wasif - US', { ListingSuppressed: 'daily' });
    const at = ny('2026-10-18T12:00:00');
    await logAlert(ca, 'ListingSuppressed', 'B0DAILY021', at);
    await logAlert(ca, 'BuyBoxLost', 'B0DAILY022', at);
    await logAlert(us, 'ListingSuppressed', 'B0DAILY023', at);
    await logAlert(us, 'ListingSuppressed', 'B0DAILY024', at);

    assert.deepEqual(await makeDailyAlertTasks(() => {}, ny('2026-10-19T08:30:00')), {
      made: 3,
      noTask: 0,
      failed: 0,
    });
    assert.deepEqual((await tops()).map((t) => t.name.split(':')[0]).sort(), [
      'WasiC_BL_262920830',
      'WasiC_LS_262920830',
      'WasiU_LS_262920830',
    ]);
  });

  it('from the third row on, Details links to that ASIN’s alerts in the Alert Log', async () => {
    await setUpDaily('ListingSuppressed');
    const group = await watchingGroup('Wasif - CA', { ListingSuppressed: 'daily' });
    const at = (h: number) => ny(`2026-10-18T${String(h).padStart(2, '0')}:00:00`);
    await logAlert(group, 'ListingSuppressed', 'B0ROW00001', at(10), 'First description');
    await logAlert(group, 'ListingSuppressed', 'B0ROW00002', at(11), 'Second description');
    await logAlert(group, 'ListingSuppressed', 'B0ROW00003', at(12), 'Third description');
    await logAlert(group, 'ListingSuppressed', 'B0ROW00004', at(13), 'Fourth description');

    assert.equal((await makeDailyAlertTasks(() => {}, ny('2026-10-19T08:30:00'))).made, 1);
    const [top] = await tops();
    const details = [
      ...top!.description!.matchAll(/<tr>(?:<td>.*?<\/td>){5}<td><p>(.*?)<\/p><\/td><\/tr>/g),
    ].map((m) => m[1]);
    const day =
      'from=2026-10-18T12%3A30%3A00.000Z&amp;to=2026-10-19T12%3A30%3A00.000Z' +
      `&amp;type=ListingSuppressed&amp;group=${group.id}`;
    assert.deepEqual(details, [
      'First description',
      'Second description',
      `<a href="/exclusives/log?${day}&amp;q=B0ROW00003">See log for details…</a>`,
      `<a href="/exclusives/log?${day}&amp;q=B0ROW00004">See log for details…</a>`,
    ]);
    assert.doesNotMatch(top!.description!, /Third description|Fourth description/);
    // The whole day's link stays under the table.
    assert.match(
      top!.description!,
      new RegExp(
        `</table><p><a href="/exclusives/log\\?${day}">View these alerts in the Alert Log</a></p>$`,
      ),
    );
  });

  it('lists at most 100 alerts, then says how many more', async () => {
    await setUpDaily('PriceChanged');
    const group = await watchingGroup('Wasif - US', { PriceChanged: 'daily' });
    const start = ny('2026-10-18T09:00:00').getTime();
    await prisma.alertLog.createMany({
      data: Array.from({ length: 105 }, (_, i) => ({
        groupId: group.id,
        groupName: group.name,
        alertType: 'PriceChanged',
        message: 'Price changed.',
        asin: `B0MANY${String(i).padStart(4, '0')}`,
        marketplace: 'USA',
        title: 'Widget',
        createdAt: new Date(start + i * 60_000),
      })),
    });

    assert.equal((await makeDailyAlertTasks(() => {}, ny('2026-10-19T08:30:00'))).made, 1);
    const [top] = await tops();
    assert.equal(top!.description!.match(/<tr>/g)!.length, 1 + 100); // the header, then 100
    assert.match(top!.description!, /B0MANY0099/);
    assert.doesNotMatch(top!.description!, /B0MANY0100/);
    assert.match(top!.description!, /<p>…and 5 more: see the Alert Log link<\/p>/);
    assert.equal(await prisma.alertLog.count({ where: { taskId: top!.id } }), 105);
  });

  it('lists fewer when the template text leaves less room, and still fits', async () => {
    await setUpDaily('TitleChanged', `<p>${'x'.repeat(9500)}</p>`);
    const group = await watchingGroup('Wasif - US', { TitleChanged: 'daily' });
    for (let i = 0; i < 20; i += 1) {
      const asin = `B0ROOM${String(i).padStart(4, '0')}`;
      await logAlert(group, 'TitleChanged', asin, ny('2026-10-18T10:00:00'));
    }

    assert.deepEqual(await makeDailyAlertTasks(() => {}, ny('2026-10-19T08:30:00')), {
      made: 1,
      noTask: 0,
      failed: 0,
    });
    const [top] = await tops();
    const listed = (top!.description!.match(/<tr>/g)?.length ?? 1) - 1; // less the header
    assert.ok(listed > 0 && listed < 20, `${listed} listed`);
    assert.match(top!.description!, new RegExp(`…and ${20 - listed} more`));
    assert.match(top!.description!, /View these alerts in the Alert Log/);
  });

  it('leaves Immediate alerts alone, and makes nothing for alerts with no task due', async () => {
    await setUpDaily('BrandChanged');
    await setUpDaily('PriceChanged');
    const group = await watchingGroup('Wasif - US', {
      BrandChanged: 'daily',
      PriceChanged: 'immediate',
      TitleChanged: 'daily', // no template
    });
    const at = ny('2026-10-18T12:00:00');
    await logAlert(group, 'BrandChanged', 'B0DAILY031', at);
    const immediate = await logAlert(group, 'PriceChanged', 'B0DAILY032', at);
    await logAlert(group, 'TitleChanged', 'B0DAILY033', at);
    await logAlert(null, 'BrandChanged', 'B0DAILY034', at); // its group was deleted

    assert.deepEqual(await makeDailyAlertTasks(() => {}, ny('2026-10-19T08:30:00')), {
      made: 1,
      noTask: 2,
      failed: 0,
    });
    const left = await prisma.alertLog.findUniqueOrThrow({ where: { id: immediate.id } });
    assert.equal(left.taskHandledAt, null, 'left for the Immediate tasks');
  });

  it('runs from the scheduler, which wakes at 8:30 while Daily is in use', async () => {
    const before = ny('2026-10-19T04:00:00');
    // Nothing on Daily yet: the scheduler sleeps its usual longest (6 hours).
    assert.equal(
      (await computeNextWakeAt(before)).toISOString(),
      new Date(before.getTime() + 6 * 3_600_000).toISOString(),
    );

    await setUpDaily('ListingSuppressed');
    const group = await watchingGroup('Wasif - CA', { ListingSuppressed: 'daily' });
    await logAlert(group, 'ListingSuppressed', 'B0DAILY041', ny('2026-10-18T15:00:00'));
    assert.equal(
      (await computeNextWakeAt(before)).toISOString(),
      ny('2026-10-19T08:30:00').toISOString(),
    );

    await runScheduler(ny('2026-10-19T08:30:05'));
    assert.deepEqual(
      (await tops()).map((t) => t.name),
      ['WasiC_LS_262920830: Work through the alerts'],
    );
  });
});

// --- Step 13: a duty Alert Task Setup needs can't be taken away ---------------------

describe('Organization: duties Alert Task Setup needs', () => {
  /** Ana holds both Pricing duties and is Pricing Analyst for Buy Box Lost, which needs one. */
  async function setUpPick() {
    const admin = await adminToken();
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const ana = await seedUser({ email: 'ana@test.local', role: 'Member' });
    const needed = await makeDuty(admin); // Pricing › Buy Box Recovery
    const dept = await prisma.department.findFirstOrThrow({ where: { name: 'Pricing' } });
    const other = await request(app)
      .post(`/api/departments/${dept.id}/duties`)
      .set(auth(admin))
      .send({ name: 'Price Monitoring' });
    assert.equal(other.status, 201, JSON.stringify(other.body));
    const spare = (await prisma.duty.findFirstOrThrow({ where: { name: 'Price Monitoring' } })).id;
    await prisma.userDuty.createMany({
      data: [
        { userId: ana.id, dutyId: needed },
        { userId: ana.id, dutyId: spare },
      ],
    });
    const tpl = await makeTemplate(admin, 'Buy Box Recovery', [
      { role: 'Pricing Analyst', dutyId: needed },
      { role: 'Pricing Manager' },
    ]);
    await prisma.alertTaskSetting.create({
      data: {
        alertType: 'BuyBoxLost',
        templateId: tpl,
        roleAssignments: [{ role: 'Pricing Analyst', assigneeId: ana.id }],
        savedById: adminUser.id,
      },
    });
    return { admin, ana, needed, spare };
  }

  const saveDuties = (token: string, userId: string, add: string[], remove: string[]) =>
    request(app)
      .put('/api/org')
      .set(auth(token))
      .send({ dutyChanges: [{ userId, add, remove }] });
  const holds = async (userId: string) =>
    (await prisma.userDuty.findMany({ where: { userId } })).map((d) => d.dutyId).sort();

  it('tells the Organization screen which duties each person’s Alert Task Setup role needs', async () => {
    const { admin, ana, needed } = await setUpPick();
    const res = await request(app).get('/api/org').set(auth(admin));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const person = (res.body.people as { id: string; alertTaskPicks: unknown }[]).find(
      (p) => p.id === ana.id,
    )!;
    assert.deepEqual(person.alertTaskPicks, [
      { alertType: 'BuyBoxLost', role: 'Pricing Analyst', dutyIds: [needed] },
    ]);
  });

  it('refuses to take away a duty the role needs, saying what to do first', async () => {
    const { admin, ana, needed, spare } = await setUpPick();
    const res = await saveDuties(admin, ana.id, [], [needed]);
    assert.equal(res.status, 422);
    assert.equal(res.body.details.code, 'ALERT_TASK_DUTY_NEEDED');
    assert.equal(
      res.body.error,
      'ana Test is needed as Pricing Analyst for Buy Box Lost on Alert Task Setup, which needs ' +
        'Pricing › Buy Box Recovery. Set that role to “Leave unassigned” on Alert Task Setup first.',
    );
    assert.deepEqual(await holds(ana.id), [needed, spare].sort(), 'nothing saved');
  });

  it('takes away a duty the role does not need, and lets anyone not picked lose it', async () => {
    const { admin, ana, needed, spare } = await setUpPick();
    assert.equal((await saveDuties(admin, ana.id, [], [spare])).status, 200);
    assert.deepEqual(await holds(ana.id), [needed]);

    const ben = await seedUser({ email: 'ben@test.local', role: 'Member' });
    await prisma.userDuty.create({ data: { userId: ben.id, dutyId: needed } });
    assert.equal((await saveDuties(admin, ben.id, [], [needed])).status, 200);
    assert.deepEqual(await holds(ben.id), []);
  });

  it('never blocks adding a duty', async () => {
    const { admin, ana, needed, spare } = await setUpPick();
    await prisma.userDuty.deleteMany({ where: { userId: ana.id, dutyId: spare } });
    assert.equal((await saveDuties(admin, ana.id, [spare], [])).status, 200);
    assert.deepEqual(await holds(ana.id), [needed, spare].sort());
  });

  it('lets the duty go once the role is set to “Leave unassigned” on Alert Task Setup', async () => {
    const { admin, ana, needed } = await setUpPick();
    const setup = await request(app).get(URL).set(auth(admin));
    const res = await request(app)
      .put(URL)
      .set(auth(admin))
      .send({
        settings: [
          {
            ...setup.body.settings.find((s: { alertType: string }) => s.alertType === 'BuyBoxLost'),
            roleAssignments: [],
          },
        ],
        expectedUpdatedAt: setup.body.updatedAt,
      });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await saveDuties(admin, ana.id, [], [needed])).status, 200);
    assert.ok(!(await holds(ana.id)).includes(needed));
  });

  it('tells a Manager an Admin has to change Alert Task Setup', async () => {
    const { ana, needed } = await setUpPick();
    const manager = await seedUser({ email: 'manager@test.local', role: 'Manager' });
    await prisma.user.update({ where: { id: ana.id }, data: { supervisorId: manager.id } });
    const res = await saveDuties(await login('manager@test.local'), ana.id, [], [needed]);
    assert.equal(res.status, 422);
    assert.match(res.body.error, /\(only an Admin can change Alert Task Setup\)\.$/);
  });
});
