import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient, Role } from '@prisma/client';
import { startTestDb, type TestDb } from './db.js';
import { memoryStorage } from '../src/storage/memory.storage.js';
import { moveTemplateNode, templateSubtreeKeys } from '@healthy-tasks/shared';

let db: TestDb;
let app: Express;
let prisma: PrismaClient;
let hashPassword: (plaintext: string) => Promise<string>;

const ADMIN_EMAIL = 'admin@test.local';
const ADMIN_PASSWORD = 'AdminPass123!';
const MEMBER_PASSWORD = 'MemberPass123!';

before(async () => {
  db = await startTestDb();

  // Configure env BEFORE importing modules that read it at load time.
  process.env.DATABASE_URL = db.databaseUrl;
  process.env.JWT_SECRET = 'integration-test-secret';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.PASSWORD_RESET_EXPIRES_IN = '60m';
  process.env.FRONTEND_URL = 'http://localhost:5173';
  process.env.EMAIL_PROVIDER = 'console';
  process.env.NODE_ENV = 'test';
  // Use the in-memory storage fake so attachment tests need no MinIO/S3.
  process.env.STORAGE_DRIVER = 'memory';

  const [appMod, prismaMod, pwMod] = await Promise.all([
    import('../src/app.js'),
    import('../src/db/prisma.js'),
    import('../src/utils/password.js'),
  ]);
  app = appMod.createApp();
  prisma = prismaMod.prisma;
  hashPassword = pwMod.hashPassword;
});

after(async () => {
  await prisma?.$disconnect();
  await db?.stop();
});

beforeEach(async () => {
  // Fresh state for every test. RESTART IDENTITY resets the Task id sequence so
  // sequential-id assertions are deterministic (first task id = 1).
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Task", "PasswordResetToken", "User", "SchedulerState", "AppSetting" RESTART IDENTITY CASCADE',
  );
  // CASCADE also clears Comment/Attachment/CommentMention/MentionEvent and the
  // Phase 11 template tables (TaskTemplate cascades from User; occurrences +
  // generated tasks cascade from Task). SchedulerState is unlinked, so it is
  // truncated explicitly to isolate the scheduler tests.
  memoryStorage.__reset();
  await seedUser({ email: ADMIN_EMAIL, role: 'Admin', password: ADMIN_PASSWORD });
});

// --- helpers ---------------------------------------------------------------

async function seedUser(opts: {
  email: string;
  role: Role;
  password?: string;
  supervisorId?: string | null;
  isActive?: boolean;
  title?: string | null;
}) {
  const passwordHash = await hashPassword(opts.password ?? 'placeholder-unusable');
  return prisma.user.create({
    data: {
      // The API always lowercases email on write; mirror that here so lookups
      // (which lowercase the input) match seeded rows.
      email: opts.email.toLowerCase(),
      role: opts.role,
      passwordHash,
      supervisorId: opts.supervisorId ?? null,
      isActive: opts.isActive ?? true,
      title: opts.title ?? null,
    },
  });
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}

const adminToken = () => login(ADMIN_EMAIL, ADMIN_PASSWORD);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// Create a task via the API and return its body (asserts success).
async function makeTask(
  token: string,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: number; [k: string]: unknown }> {
  const res = await request(app)
    .post('/api/tasks')
    .set(auth(token))
    .send({ name, ...extra });
  assert.equal(res.status, 201, `create task failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

function tokenFromResetLink(link: string): string {
  return new URL(link).searchParams.get('token') ?? '';
}

/** Set the single global recurrence materialization lead time (AppSetting id=1).
 * Lead is no longer per-template/per-task, so tests set it here. */
async function setLeadDays(days: number): Promise<void> {
  await prisma.appSetting.upsert({
    where: { id: 1 },
    create: { id: 1, materializeLeadDays: days },
    update: { materializeLeadDays: days },
  });
}

// --- tests -----------------------------------------------------------------

describe('health', () => {
  it('responds ok', async () => {
    const res = await request(app).get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });
});

describe('auth: login', () => {
  it('logs in an admin with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.user.email, ADMIN_EMAIL);
    assert.equal(res.body.user.role, 'Admin');
    assert.equal('passwordHash' in res.body.user, false, 'DTO must not leak passwordHash');
  });

  it('rejects a wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'nope' });
    assert.equal(res.status, 401);
  });

  it('rejects an unknown email with 401 (no user enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@test.local', password: ADMIN_PASSWORD });
    assert.equal(res.status, 401);
  });

  it('rejects a deactivated user with 403', async () => {
    await seedUser({
      email: 'gone@test.local',
      role: 'Member',
      password: 'Secret123!',
      isActive: false,
    });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'gone@test.local', password: 'Secret123!' });
    assert.equal(res.status, 403);
  });

  it('returns validation errors for malformed input', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'notanemail', password: '' });
    assert.equal(res.status, 400);
    assert.ok(res.body.details.email);
  });
});

describe('admin user management', () => {
  it('creates a user, lists it, and returns a reset link', async () => {
    const token = await adminToken();
    const create = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'newbie@test.local',
        firstName: 'New',
        lastName: 'Bie',
        role: 'Member',
        title: 'Analyst',
      });

    assert.equal(create.status, 201);
    assert.equal(create.body.user.email, 'newbie@test.local');
    assert.ok(create.body.resetLink.includes('/reset-password?token='));

    const list = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
    assert.equal(list.status, 200);
    assert.ok(list.body.some((u: { email: string }) => u.email === 'newbie@test.local'));
  });

  it('deactivates a user (soft delete, never removed)', async () => {
    const token = await adminToken();
    const target = await seedUser({ email: 'target@test.local', role: 'Member' });

    const res = await request(app)
      .post(`/api/users/${target.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.isActive, false);

    const stillThere = await prisma.user.findUnique({ where: { id: target.id } });
    assert.ok(stillThere, 'user must still exist after deactivation');
    assert.equal(stillThere?.isActive, false);
  });

  it('lists only active Managers and Admins as eligible supervisors', async () => {
    const token = await adminToken();
    await seedUser({ email: 'mgr@test.local', role: 'Manager' });
    await seedUser({ email: 'member@test.local', role: 'Member' });
    await seedUser({ email: 'exmgr@test.local', role: 'Manager', isActive: false });

    const res = await request(app)
      .get('/api/users/supervisors')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    const emails = res.body.map((u: { email: string }) => u.email).sort();
    assert.deepEqual(emails, [ADMIN_EMAIL, 'mgr@test.local']);
  });
});

describe('supervisor role rule', () => {
  it('rejects setting a Member as supervisor with a clear 400 (application layer)', async () => {
    const token = await adminToken();
    const member = await seedUser({ email: 'plain@test.local', role: 'Member' });

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'report@test.local',
        firstName: 'Rep',
        lastName: 'Ort',
        role: 'Member',
        supervisorId: member.id,
      });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /Manager or Admin/);
  });

  it('allows a Manager as supervisor', async () => {
    const token = await adminToken();
    const mgr = await seedUser({ email: 'boss@test.local', role: 'Manager' });

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'report2@test.local',
        firstName: 'Rep',
        lastName: 'Two',
        role: 'Member',
        supervisorId: mgr.id,
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.user.supervisorId, mgr.id);
  });

  it('is enforced at the database layer too (trigger blocks direct writes)', async () => {
    const member = await seedUser({ email: 'dbplain@test.local', role: 'Member' });
    const victim = await seedUser({ email: 'dbreport@test.local', role: 'Member' });

    await assert.rejects(
      () => prisma.user.update({ where: { id: victim.id }, data: { supervisorId: member.id } }),
      /Manager or Admin/,
      'DB trigger should reject a Member supervisor even via direct Prisma write',
    );
  });

  it('database trigger blocks self-supervision', async () => {
    const mgr = await seedUser({ email: 'selfmgr@test.local', role: 'Manager' });
    await assert.rejects(
      () => prisma.user.update({ where: { id: mgr.id }, data: { supervisorId: mgr.id } }),
      /own supervisor/,
    );
  });

  it('blocks demoting a supervisor who still has reports', async () => {
    const token = await adminToken();
    const mgr = await seedUser({ email: 'demote@test.local', role: 'Manager' });
    await seedUser({ email: 'hasboss@test.local', role: 'Member', supervisorId: mgr.id });

    const res = await request(app)
      .patch(`/api/users/${mgr.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'Member' });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /supervisor of/);
  });
});

describe('authorization', () => {
  it('blocks unauthenticated access to user management', async () => {
    const res = await request(app).get('/api/users');
    assert.equal(res.status, 401);
  });

  for (const role of ['Manager', 'Member'] as const) {
    it(`forbids a ${role} from user management (403)`, async () => {
      await seedUser({ email: `${role}@test.local`, role, password: 'Secret123!' });
      const token = await login(`${role}@test.local`, 'Secret123!');
      const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
      assert.equal(res.status, 403);
    });
  }
});

describe('password reset flow (end-to-end)', () => {
  it('creates a user, sets a password via the reset link, and logs in', async () => {
    const token = await adminToken();
    const create = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'reset@test.local', firstName: 'Re', lastName: 'Set', role: 'Member' });
    assert.equal(create.status, 201);

    const resetToken = tokenFromResetLink(create.body.resetLink);
    assert.ok(resetToken);

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: 'BrandNew123!' });
    assert.equal(reset.status, 200);

    // The new password now works.
    const good = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset@test.local', password: 'BrandNew123!' });
    assert.equal(good.status, 200);
  });

  it('rejects reusing a reset token', async () => {
    const token = await adminToken();
    const create = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'once@test.local', firstName: 'On', lastName: 'Ce', role: 'Member' });
    const resetToken = tokenFromResetLink(create.body.resetLink);

    const first = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: 'FirstUse123!' });
    assert.equal(first.status, 200);

    const second = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: 'SecondUse123!' });
    assert.equal(second.status, 400);
  });

  it('forgot-password returns a generic response for unknown emails', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@test.local' });
    assert.equal(res.status, 200);
    assert.match(res.body.message, /If that email/);
  });
});

describe('JWT revocation via tokenVersion', () => {
  it("invalidates a user's token when they are deactivated", async () => {
    const adminTok = await adminToken();
    await seedUser({ email: 'revoke@test.local', role: 'Member', password: 'Secret123!' });
    const userTok = await login('revoke@test.local', 'Secret123!');

    // Token works before deactivation.
    const before = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userTok}`);
    assert.equal(before.status, 200);

    const target = await prisma.user.findUniqueOrThrow({ where: { email: 'revoke@test.local' } });
    await request(app)
      .post(`/api/users/${target.id}/deactivate`)
      .set('Authorization', `Bearer ${adminTok}`);

    // Same token is now rejected.
    const afterRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${userTok}`);
    assert.equal(afterRes.status, 401);
  });

  it("invalidates a user's token after a password reset", async () => {
    await seedUser({ email: 'pwchange@test.local', role: 'Member', password: 'Secret123!' });
    const userTok = await login('pwchange@test.local', 'Secret123!');

    const adminTok = await adminToken();
    const target = await prisma.user.findUniqueOrThrow({ where: { email: 'pwchange@test.local' } });
    const reset = await request(app)
      .post(`/api/users/${target.id}/reset-password`)
      .set('Authorization', `Bearer ${adminTok}`);
    const resetToken = tokenFromResetLink(reset.body.resetLink);
    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: 'Rotated123!' });

    const afterRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${userTok}`);
    assert.equal(afterRes.status, 401);
  });
});

describe('active users endpoint', () => {
  it('is available to any authenticated user and returns minimal refs', async () => {
    await seedUser({ email: 'member1@test.local', role: 'Member', password: 'Secret123!' });
    const tok = await login('member1@test.local', 'Secret123!');

    const res = await request(app).get('/api/users/active').set(auth(tok));
    assert.equal(res.status, 200);
    assert.ok(res.body.some((u: { email: string }) => u.email === ADMIN_EMAIL));
    // Directory-ref shape (Phase 9): includes role + supervisorId (the My Day
    // team strip needs supervisorId), but never leaks credentials.
    assert.equal('role' in res.body[0], true);
    assert.equal('supervisorId' in res.body[0], true);
    assert.equal('passwordHash' in res.body[0], false);
  });

  it('excludes inactive users', async () => {
    await seedUser({ email: 'ghost@test.local', role: 'Member', isActive: false });
    const tok = await adminToken();
    const res = await request(app).get('/api/users/active').set(auth(tok));
    assert.equal(
      res.body.some((u: { email: string }) => u.email === 'ghost@test.local'),
      false,
    );
  });
});

describe('tasks', () => {
  it('creates a task with just a name: sequential id, creator, and defaults', async () => {
    await seedUser({ email: 'creator@test.local', role: 'Member', password: 'Secret123!' });
    const tok = await login('creator@test.local', 'Secret123!');

    const res = await request(app)
      .post('/api/tasks')
      .set(auth(tok))
      .send({ name: 'My first task' });
    assert.equal(res.status, 201);
    assert.equal(res.body.id, 1); // first task, ids reset per test
    assert.equal(res.body.priority, 'Medium'); // default
    assert.equal(res.body.status, 'Open'); // default
    assert.equal(res.body.statusChangedAt, null); // blank until first change
    assert.equal(res.body.creator.email, 'creator@test.local');
    assert.ok(res.body.createdAt);
  });

  it('rejects a name under 2 characters with a clear error', async () => {
    const tok = await adminToken();
    const res = await request(app).post('/api/tasks').set(auth(tok)).send({ name: 'a' });
    assert.equal(res.status, 400);
    assert.ok(res.body.details.name);
  });

  it('assigns sequential ids', async () => {
    const tok = await adminToken();
    const a = await request(app).post('/api/tasks').set(auth(tok)).send({ name: 'Task A' });
    const b = await request(app).post('/api/tasks').set(auth(tok)).send({ name: 'Task B' });
    assert.equal(b.body.id, a.body.id + 1);
  });

  it('sets statusChangedAt only on the first status change', async () => {
    const tok = await adminToken();
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(tok))
      .send({ name: 'Status task' });
    assert.equal(created.body.statusChangedAt, null);

    // Non-status edit leaves it null.
    const noStatus = await request(app)
      .patch(`/api/tasks/${created.body.id}`)
      .set(auth(tok))
      .send({ priority: 'High' });
    assert.equal(noStatus.body.statusChangedAt, null);

    // First status change sets it.
    const changed = await request(app)
      .patch(`/api/tasks/${created.body.id}`)
      .set(auth(tok))
      .send({ status: 'InProgress' });
    assert.equal(changed.body.status, 'InProgress');
    assert.ok(changed.body.statusChangedAt);
  });

  it('does not bump statusChangedAt when status is set to its current value', async () => {
    const tok = await adminToken();
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(tok))
      .send({ name: 'Same status', status: 'Open' });
    const same = await request(app)
      .patch(`/api/tasks/${created.body.id}`)
      .set(auth(tok))
      .send({ status: 'Open' });
    assert.equal(same.body.statusChangedAt, null);
  });

  it('adds and removes tags', async () => {
    const tok = await adminToken();
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(tok))
      .send({ name: 'Tag task', tags: ['alpha', 'beta'] });
    assert.deepEqual(created.body.tags, ['alpha', 'beta']);

    const updated = await request(app)
      .patch(`/api/tasks/${created.body.id}`)
      .set(auth(tok))
      .send({ tags: ['beta', 'gamma'] });
    assert.deepEqual(updated.body.tags, ['beta', 'gamma']);
  });

  it('accepts a task when Start is before Due', async () => {
    const tok = await adminToken();
    const res = await request(app)
      .post('/api/tasks')
      .set(auth(tok))
      .send({ name: 'Good dates', startAt: '2026-08-01T09:00:00Z', dueAt: '2026-08-01T17:00:00Z' });
    assert.equal(res.status, 201);
  });

  it('rejects a task when Start is not before Due', async () => {
    const tok = await adminToken();
    const res = await request(app)
      .post('/api/tasks')
      .set(auth(tok))
      .send({ name: 'Bad dates', startAt: '2026-08-01T17:00:00Z', dueAt: '2026-08-01T09:00:00Z' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /earlier than Due/);
  });

  it('rejects a PATCH that would make Due earlier than the existing Start', async () => {
    const tok = await adminToken();
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(tok))
      .send({ name: 'Patch dates', startAt: '2026-08-01T09:00:00Z' });
    const res = await request(app)
      .patch(`/api/tasks/${created.body.id}`)
      .set(auth(tok))
      .send({ dueAt: '2026-08-01T08:00:00Z' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /earlier than Due/);
  });

  it('keeps id, creator, and createdAt immutable across edits by another user', async () => {
    await seedUser({ email: 'owner@test.local', role: 'Member', password: 'Secret123!' });
    const ownerTok = await login('owner@test.local', 'Secret123!');
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(ownerTok))
      .send({ name: 'Owned task' });
    const { creatorId, createdAt } = created.body;

    // A different user (admin) edits — allowed in Phase 2 — and tries to spoof
    // immutable fields, which must be ignored.
    const adminTok = await adminToken();
    const updated = await request(app)
      .patch(`/api/tasks/${created.body.id}`)
      .set(auth(adminTok))
      .send({ name: 'Edited by admin', creatorId: 'spoof', createdAt: '2000-01-01T00:00:00Z' });

    assert.equal(updated.status, 200);
    assert.equal(updated.body.name, 'Edited by admin');
    assert.equal(updated.body.creatorId, creatorId);
    assert.equal(updated.body.createdAt, createdAt);
  });

  it('assigns to an active user and rejects an inactive assignee', async () => {
    const tok = await adminToken();
    const active = await seedUser({ email: 'active-assignee@test.local', role: 'Member' });
    const ok = await request(app)
      .post('/api/tasks')
      .set(auth(tok))
      .send({ name: 'Assigned', assigneeId: active.id });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.assignee.email, 'active-assignee@test.local');

    const inactive = await seedUser({
      email: 'inactive-assignee@test.local',
      role: 'Member',
      isActive: false,
    });
    const bad = await request(app)
      .post('/api/tasks')
      .set(auth(tok))
      .send({ name: 'Bad assign', assigneeId: inactive.id });
    assert.equal(bad.status, 400);
  });

  it('leaves assignee unchanged on a partial update that omits it', async () => {
    const tok = await adminToken();
    const assignee = await seedUser({ email: 'keep@test.local', role: 'Member' });
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(tok))
      .send({ name: 'Keep assignee', assigneeId: assignee.id });
    assert.equal(created.body.assigneeId, assignee.id);

    const updated = await request(app)
      .patch(`/api/tasks/${created.body.id}`)
      .set(auth(tok))
      .send({ name: 'Renamed' }); // assigneeId omitted → must stay
    assert.equal(updated.body.assigneeId, assignee.id);
  });

  it('clears assignee when explicitly set to null', async () => {
    const tok = await adminToken();
    const assignee = await seedUser({ email: 'clearme@test.local', role: 'Member' });
    const created = await request(app)
      .post('/api/tasks')
      .set(auth(tok))
      .send({ name: 'Clear assignee', assigneeId: assignee.id });

    const updated = await request(app)
      .patch(`/api/tasks/${created.body.id}`)
      .set(auth(tok))
      .send({ assigneeId: null });
    assert.equal(updated.body.assigneeId, null);
  });

  it('lists all tasks and fetches one by id', async () => {
    const tok = await adminToken();
    await request(app).post('/api/tasks').set(auth(tok)).send({ name: 'List one' });
    await request(app).post('/api/tasks').set(auth(tok)).send({ name: 'List two' });

    const list = await request(app).get('/api/tasks').set(auth(tok));
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 2);

    const one = await request(app).get(`/api/tasks/${list.body[0].id}`).set(auth(tok));
    assert.equal(one.status, 200);
    assert.equal(one.body.id, list.body[0].id);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/tasks');
    assert.equal(res.status, 401);
  });

  it('returns 404 for a missing task', async () => {
    const tok = await adminToken();
    const res = await request(app).get('/api/tasks/999999').set(auth(tok));
    assert.equal(res.status, 404);
  });
});

describe('task hierarchy (parent/child)', () => {
  it('sets a parent, derives children, and clears it', async () => {
    const tok = await adminToken();
    const parent = await makeTask(tok, 'Parent task');
    const child = await makeTask(tok, 'Child task');

    const set = await request(app)
      .put(`/api/tasks/${child.id}/parent`)
      .set(auth(tok))
      .send({ parentId: parent.id });
    assert.equal(set.status, 200);
    assert.equal(set.body.parent.id, parent.id);
    assert.equal(set.body.parentId, parent.id);

    // Parent's detail derives the child.
    const parentDetail = await request(app).get(`/api/tasks/${parent.id}`).set(auth(tok));
    assert.ok(parentDetail.body.children.some((c: { id: number }) => c.id === child.id));

    const cleared = await request(app).delete(`/api/tasks/${child.id}/parent`).set(auth(tok));
    assert.equal(cleared.body.parent, null);
  });

  it('rejects a task being its own parent', async () => {
    const tok = await adminToken();
    const t = await makeTask(tok, 'Self parent');
    const res = await request(app)
      .put(`/api/tasks/${t.id}/parent`)
      .set(auth(tok))
      .send({ parentId: t.id });
    assert.equal(res.status, 400);
  });

  it('rejects setting a parent to one of its own descendants (transitive cycle)', async () => {
    const tok = await adminToken();
    const a = await makeTask(tok, 'Task A');
    const b = await makeTask(tok, 'Task B');
    const c = await makeTask(tok, 'Task C');
    // Build a → b → c (b's parent a, c's parent b).
    await request(app).put(`/api/tasks/${b.id}/parent`).set(auth(tok)).send({ parentId: a.id });
    await request(app).put(`/api/tasks/${c.id}/parent`).set(auth(tok)).send({ parentId: b.id });

    // Setting a's parent to c would make a its own ancestor.
    const res = await request(app)
      .put(`/api/tasks/${a.id}/parent`)
      .set(auth(tok))
      .send({ parentId: c.id });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /ancestor|circular/i);
  });
});

describe('task dependencies (blocks / is blocked by)', () => {
  it('adds and removes a Blocks edge, reflected on both tasks', async () => {
    const tok = await adminToken();
    const a = await makeTask(tok, 'Blocker');
    const b = await makeTask(tok, 'Blocked');

    const add = await request(app)
      .post(`/api/tasks/${a.id}/dependencies`)
      .set(auth(tok))
      .send({ type: 'blocks', otherTaskId: b.id });
    assert.equal(add.status, 201);
    assert.ok(add.body.blocks.some((t: { id: number }) => t.id === b.id));

    const bDetail = await request(app).get(`/api/tasks/${b.id}`).set(auth(tok));
    assert.ok(bDetail.body.isBlockedBy.some((t: { id: number }) => t.id === a.id));

    const rm = await request(app)
      .delete(`/api/tasks/${a.id}/dependencies`)
      .set(auth(tok))
      .send({ type: 'blocks', otherTaskId: b.id });
    assert.equal(rm.body.blocks.length, 0);
  });

  it('adds a predecessor via the blockedBy side', async () => {
    const tok = await adminToken();
    const pred = await makeTask(tok, 'Pred');
    const succ = await makeTask(tok, 'Succ');

    const add = await request(app)
      .post(`/api/tasks/${succ.id}/dependencies`)
      .set(auth(tok))
      .send({ type: 'blockedBy', otherTaskId: pred.id });
    assert.ok(add.body.isBlockedBy.some((t: { id: number }) => t.id === pred.id));

    const predDetail = await request(app).get(`/api/tasks/${pred.id}`).set(auth(tok));
    assert.ok(predDetail.body.blocks.some((t: { id: number }) => t.id === succ.id));
  });

  it('rejects a self-dependency', async () => {
    const tok = await adminToken();
    const a = await makeTask(tok, 'Solo');
    const res = await request(app)
      .post(`/api/tasks/${a.id}/dependencies`)
      .set(auth(tok))
      .send({ type: 'blocks', otherTaskId: a.id });
    assert.equal(res.status, 400);
  });

  it('rejects a direct dependency cycle', async () => {
    const tok = await adminToken();
    const a = await makeTask(tok, 'Task A');
    const b = await makeTask(tok, 'Task B');
    await request(app)
      .post(`/api/tasks/${a.id}/dependencies`)
      .set(auth(tok))
      .send({ type: 'blocks', otherTaskId: b.id });
    const res = await request(app)
      .post(`/api/tasks/${b.id}/dependencies`)
      .set(auth(tok))
      .send({ type: 'blocks', otherTaskId: a.id });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /circular/i);
  });

  it('rejects a longer (transitive) dependency cycle', async () => {
    const tok = await adminToken();
    const a = await makeTask(tok, 'Task A');
    const b = await makeTask(tok, 'Task B');
    const c = await makeTask(tok, 'Task C');
    await request(app)
      .post(`/api/tasks/${a.id}/dependencies`)
      .set(auth(tok))
      .send({ type: 'blocks', otherTaskId: b.id }); // a → b
    await request(app)
      .post(`/api/tasks/${b.id}/dependencies`)
      .set(auth(tok))
      .send({ type: 'blocks', otherTaskId: c.id }); // b → c
    const res = await request(app)
      .post(`/api/tasks/${c.id}/dependencies`)
      .set(auth(tok))
      .send({ type: 'blocks', otherTaskId: a.id }); // c → a would close the loop
    assert.equal(res.status, 400);
  });
});

describe('relationship concurrency (advisory lock)', () => {
  // These fire two mutually-cyclic mutations at the same time. Before the
  // advisory lock, each request's read-then-write cycle check could pass
  // independently and the two writes would jointly form a cycle (TOCTOU). The
  // lock serializes them: the first wins, the second sees the new edge and is
  // rejected. We assert exactly one success AND that no cycle materialized.

  it('serializes concurrent cycle-forming dependency adds', async () => {
    const tok = await adminToken();
    const a = await makeTask(tok, 'Task A');
    const b = await makeTask(tok, 'Task B');

    // A→B and B→A issued together; only one may survive.
    const [r1, r2] = await Promise.all([
      request(app)
        .post(`/api/tasks/${a.id}/dependencies`)
        .set(auth(tok))
        .send({ type: 'blocks', otherTaskId: b.id }),
      request(app)
        .post(`/api/tasks/${b.id}/dependencies`)
        .set(auth(tok))
        .send({ type: 'blocks', otherTaskId: a.id }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(
      statuses,
      [201, 400],
      `expected one success + one rejection, got ${JSON.stringify(statuses)}`,
    );

    // The decisive check: exactly one edge exists, so no cycle was created.
    const edges = await prisma.taskDependency.count();
    assert.equal(edges, 1, 'exactly one dependency edge should exist (no cycle)');

    const rejected = [r1, r2].find((r) => r.status === 400)!;
    assert.match(rejected.body.error, /circular/i);
  });

  it('serializes concurrent cycle-forming parent assignments', async () => {
    const tok = await adminToken();
    const a = await makeTask(tok, 'Task A');
    const b = await makeTask(tok, 'Task B');

    // A.parent=B and B.parent=A issued together; only one may survive.
    const [r1, r2] = await Promise.all([
      request(app).put(`/api/tasks/${a.id}/parent`).set(auth(tok)).send({ parentId: b.id }),
      request(app).put(`/api/tasks/${b.id}/parent`).set(auth(tok)).send({ parentId: a.id }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(
      statuses,
      [200, 400],
      `expected one success + one rejection, got ${JSON.stringify(statuses)}`,
    );

    // Exactly one task ended up with a parent — the mutual-parent cycle was blocked.
    const withParent = await prisma.task.count({ where: { parentId: { not: null } } });
    assert.equal(withParent, 1, 'exactly one parent link should exist (no cycle)');

    const rejected = [r1, r2].find((r) => r.status === 400)!;
    assert.match(rejected.body.error, /ancestor|circular/i);
  });
});

describe('blocked-status rule', () => {
  async function taskBlockedBy(tok: string) {
    const pred = await makeTask(tok, 'Predecessor');
    const task = await makeTask(tok, 'Dependent');
    await request(app)
      .post(`/api/tasks/${task.id}/dependencies`)
      .set(auth(tok))
      .send({ type: 'blockedBy', otherTaskId: pred.id });
    return { pred, task };
  }

  it('forbids Review/Completed while a predecessor is incomplete, naming it', async () => {
    const tok = await adminToken();
    const { pred, task } = await taskBlockedBy(tok);

    for (const status of ['Review', 'Completed']) {
      const res = await request(app).patch(`/api/tasks/${task.id}`).set(auth(tok)).send({ status });
      assert.equal(res.status, 400, `${status} should be blocked`);
      assert.match(res.body.error, new RegExp(`#${pred.id}`));
    }
  });

  it('allows Open/In Progress/On Hold/Canceled while blocked', async () => {
    const tok = await adminToken();
    const { task } = await taskBlockedBy(tok);
    for (const status of ['InProgress', 'OnHold', 'Canceled', 'Open']) {
      const res = await request(app).patch(`/api/tasks/${task.id}`).set(auth(tok)).send({ status });
      assert.equal(res.status, 200, `${status} should be allowed`);
    }
  });

  it('allows Review/Completed once every predecessor is terminal', async () => {
    const tok = await adminToken();
    // Reviewer must be in the task's reviewer pool (Phase 13): the task is admin-
    // assigned, so an Admin reviewer qualifies.
    const reviewer = await seedUser({ email: 'rev-blocked@test.local', role: 'Admin' });
    const { pred, task } = await taskBlockedBy(tok);

    const done = await request(app)
      .patch(`/api/tasks/${pred.id}`)
      .set(auth(tok))
      .send({ status: 'Completed' });
    assert.equal(done.status, 200);

    // Completed is allowed now the predecessor is terminal.
    const completed = await request(app)
      .patch(`/api/tasks/${task.id}`)
      .set(auth(tok))
      .send({ status: 'Completed' });
    assert.equal(completed.status, 200);

    // Reopen first: Phase 13 assignee-locking freezes the assignee while a task
    // is Completed, and entering Review reassigns to the reviewer.
    await request(app).patch(`/api/tasks/${task.id}`).set(auth(tok)).send({ status: 'Open' });

    // Review is allowed too — entering Review now requires a reviewer (Phase 10).
    const review = await request(app)
      .patch(`/api/tasks/${task.id}`)
      .set(auth(tok))
      .send({ status: 'Review', reviewerId: reviewer.id });
    assert.equal(review.status, 200, JSON.stringify(review.body));
  });
});

describe('task search', () => {
  it('matches by partial name and by id, and can exclude a task', async () => {
    const tok = await adminToken();
    const t = await makeTask(tok, 'Searchable Widget');

    const byName = await request(app).get('/api/tasks/search?q=widget').set(auth(tok));
    assert.equal(byName.status, 200);
    assert.ok(byName.body.some((r: { id: number }) => r.id === t.id));

    const byId = await request(app).get(`/api/tasks/search?q=${t.id}`).set(auth(tok));
    assert.ok(byId.body.some((r: { id: number }) => r.id === t.id));

    const excluded = await request(app)
      .get(`/api/tasks/search?q=widget&exclude=${t.id}`)
      .set(auth(tok));
    assert.equal(
      excluded.body.some((r: { id: number }) => r.id === t.id),
      false,
    );
  });
});

// --- Phase 4: rich text, attachments, comments, mentions -------------------

/** Upload an attachment to a task (presign → confirm; bytes are skipped in tests). */
async function attachToTask(
  token: string,
  taskId: number,
  opts: { filename?: string; contentType?: string; size?: number } = {},
) {
  const meta = {
    filename: opts.filename ?? 'file.png',
    contentType: opts.contentType ?? 'image/png',
    size: opts.size ?? 1024,
  };
  const presign = await request(app)
    .post(`/api/tasks/${taskId}/attachments/presign`)
    .set(auth(token))
    .send(meta);
  assert.equal(presign.status, 201, `presign failed: ${JSON.stringify(presign.body)}`);
  return request(app)
    .post(`/api/tasks/${taskId}/attachments`)
    .set(auth(token))
    .send({ ...meta, storageKey: presign.body.storageKey });
}

function mention(userId: string, label = 'user'): string {
  return `<span data-type="mention" data-id="${userId}">@${label}</span>`;
}

describe('rich-text description (Phase 4)', () => {
  it('persists bold/italic/underline and strips scripts', async () => {
    const tok = await adminToken();
    const t = await makeTask(tok, 'Desc task');
    const res = await request(app).patch(`/api/tasks/${t.id}`).set(auth(tok)).send({
      description: '<p><strong>Bold</strong> <em>it</em> <u>u</u></p><script>alert(1)</script>',
    });
    assert.equal(res.status, 200);
    assert.match(res.body.description, /<strong>Bold<\/strong>/);
    assert.match(res.body.description, /<u>u<\/u>/);
    assert.equal(/script/i.test(res.body.description), false);
  });

  it('rejects a description over the character limit with a clear message', async () => {
    const tok = await adminToken();
    const t = await makeTask(tok, 'Big desc');
    const huge = `<p>${'a'.repeat(10001)}</p>`;
    const res = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ description: huge });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /too long|limit/i);
  });
});

describe('task attachments (Phase 4)', () => {
  it('rejects an unsupported file type at presign', async () => {
    const tok = await adminToken();
    const t = await makeTask(tok, 'Attach A');
    const res = await request(app)
      .post(`/api/tasks/${t.id}/attachments/presign`)
      .set(auth(tok))
      .send({ filename: 'x.exe', contentType: 'application/x-msdownload', size: 1000 });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /not allowed/i);
  });

  it('rejects a file over 25MB at presign', async () => {
    const tok = await adminToken();
    const t = await makeTask(tok, 'Attach B');
    const res = await request(app)
      .post(`/api/tasks/${t.id}/attachments/presign`)
      .set(auth(tok))
      .send({ filename: 'big.png', contentType: 'image/png', size: 26 * 1024 * 1024 });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /too large|maximum/i);
  });

  it('uploads, lists on the task, and deletes both the row and the storage object', async () => {
    const tok = await adminToken();
    const t = await makeTask(tok, 'Attach C');
    const confirm = await attachToTask(tok, t.id, { filename: 'pic.png' });
    assert.equal(confirm.status, 201);
    assert.equal(confirm.body.attachments.length, 1);
    const att = confirm.body.attachments[0];
    assert.equal(att.filename, 'pic.png');

    const del = await request(app).delete(`/api/attachments/${att.id}`).set(auth(tok));
    assert.equal(del.status, 200);
    assert.equal(del.body.attachments.length, 0);
    assert.ok(
      memoryStorage.__deleted.length >= 1,
      'the storage object should have been deleted too',
    );
  });

  it('enforces the delete permission matrix (uploader / org-superior / admin allow; others 403)', async () => {
    const admin = await adminToken();
    const manager = await seedUser({
      email: 'mgrA@test.local',
      role: 'Manager',
      password: MEMBER_PASSWORD,
    });
    const memB = await seedUser({
      email: 'memB@test.local',
      role: 'Member',
      password: MEMBER_PASSWORD,
      supervisorId: manager.id,
    });
    await seedUser({ email: 'memC@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const memberTok = await login('memB@test.local', MEMBER_PASSWORD);
    const outsiderTok = await login('memC@test.local', MEMBER_PASSWORD);
    const managerTok = await login('mgrA@test.local', MEMBER_PASSWORD);
    // Phase 13: assign to memB so the uploader (and their supervisor) have full
    // access to upload/delete; memC stays an outsider with no access.
    const t = await makeTask(admin, 'Perm', { assigneeId: memB.id });

    const makeAtt = async (): Promise<string> => {
      const c = await attachToTask(memberTok, t.id, { filename: 'm.png' });
      const list = c.body.attachments as { id: string }[];
      return list[list.length - 1].id;
    };

    // Unrelated member: forbidden.
    let attId = await makeAtt();
    let res = await request(app).delete(`/api/attachments/${attId}`).set(auth(outsiderTok));
    assert.equal(res.status, 403);
    // Org-superior of the uploader: allowed.
    res = await request(app).delete(`/api/attachments/${attId}`).set(auth(managerTok));
    assert.equal(res.status, 200);
    // Admin: allowed.
    attId = await makeAtt();
    res = await request(app).delete(`/api/attachments/${attId}`).set(auth(admin));
    assert.equal(res.status, 200);
    // Uploader: allowed.
    attId = await makeAtt();
    res = await request(app).delete(`/api/attachments/${attId}`).set(auth(memberTok));
    assert.equal(res.status, 200);
  });
});

describe('task comments (Phase 4)', () => {
  it('adds, edits (sets edited), and blocks non-author edit/delete', async () => {
    const admin = await adminToken();
    const author = await seedUser({ email: 'author@test.local', role: 'Member', password: MEMBER_PASSWORD });
    await seedUser({ email: 'other@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const authorTok = await login('author@test.local', MEMBER_PASSWORD);
    const otherTok = await login('other@test.local', MEMBER_PASSWORD);
    // Phase 13: the author is the assignee, so they have access to comment; the
    // "non-author" (other) is blocked by the author-only check regardless.
    const t = await makeTask(admin, 'Commented', { assigneeId: author.id });

    const add = await request(app)
      .post(`/api/tasks/${t.id}/comments`)
      .set(auth(authorTok))
      .send({ body: '<p>Hello</p>' });
    assert.equal(add.status, 201);
    assert.equal(add.body.comments.length, 1);
    const c = add.body.comments[0];
    assert.equal(c.editedAt, null);

    // Non-author cannot edit or delete.
    let res = await request(app)
      .patch(`/api/comments/${c.id}`)
      .set(auth(otherTok))
      .send({ body: '<p>Hacked</p>' });
    assert.equal(res.status, 403);
    res = await request(app).delete(`/api/comments/${c.id}`).set(auth(otherTok));
    assert.equal(res.status, 403);

    // Author edits → editedAt set, body updated.
    res = await request(app)
      .patch(`/api/comments/${c.id}`)
      .set(auth(authorTok))
      .send({ body: '<p>Edited</p>' });
    assert.equal(res.status, 200);
    const edited = (
      res.body.comments as { id: string; editedAt: string | null; body: string }[]
    ).find((x) => x.id === c.id)!;
    assert.ok(edited.editedAt, 'editedAt should be set after an edit');
    assert.match(edited.body, /Edited/);

    // Author deletes.
    res = await request(app).delete(`/api/comments/${c.id}`).set(auth(authorTok));
    assert.equal(res.status, 200);
    assert.equal(res.body.comments.length, 0);
  });

  it('restricts comment attachments to the comment author', async () => {
    const admin = await adminToken();
    const ca = await seedUser({ email: 'ca@test.local', role: 'Member', password: MEMBER_PASSWORD });
    await seedUser({ email: 'cb@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const aTok = await login('ca@test.local', MEMBER_PASSWORD);
    const bTok = await login('cb@test.local', MEMBER_PASSWORD);
    const t = await makeTask(admin, 'CommentAtt', { assigneeId: ca.id });
    const add = await request(app)
      .post(`/api/tasks/${t.id}/comments`)
      .set(auth(aTok))
      .send({ body: '<p>hi</p>' });
    const c = add.body.comments[0];
    const meta = { filename: 'x.png', contentType: 'image/png', size: 100 };

    // Non-author cannot presign a comment attachment.
    let res = await request(app)
      .post(`/api/comments/${c.id}/attachments/presign`)
      .set(auth(bTok))
      .send(meta);
    assert.equal(res.status, 403);

    // Author can presign + confirm.
    res = await request(app)
      .post(`/api/comments/${c.id}/attachments/presign`)
      .set(auth(aTok))
      .send(meta);
    assert.equal(res.status, 201);
    const confirm = await request(app)
      .post(`/api/comments/${c.id}/attachments`)
      .set(auth(aTok))
      .send({ ...meta, storageKey: res.body.storageKey });
    assert.equal(confirm.status, 201);
    const cc = (confirm.body.comments as { id: string; attachments: unknown[] }[]).find(
      (x) => x.id === c.id,
    )!;
    assert.equal(cc.attachments.length, 1);
  });
});

describe('comment @mentions and mention events (Phase 4)', () => {
  it('writes an event for a new mention and gates retained mentions by 15 minutes', async () => {
    const admin = await adminToken();
    const mentioned = await seedUser({
      email: 'mentioned@test.local',
      role: 'Member',
      password: MEMBER_PASSWORD,
    });
    const mauthor = await seedUser({ email: 'mauthor@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const authorTok = await login('mauthor@test.local', MEMBER_PASSWORD);
    const t = await makeTask(admin, 'Mentions', { assigneeId: mauthor.id });
    const span = mention(mentioned.id, 'mentioned');

    // New mention → one event and one CommentMention row.
    const add = await request(app)
      .post(`/api/tasks/${t.id}/comments`)
      .set(auth(authorTok))
      .send({ body: `<p>hey ${span}</p>` });
    assert.equal(add.status, 201);
    const c = add.body.comments[0];
    assert.equal(
      await prisma.mentionEvent.count({ where: { userId: mentioned.id, commentId: c.id } }),
      1,
    );
    assert.equal(await prisma.commentMention.count({ where: { commentId: c.id } }), 1);

    // Edit keeping the same mention within 15 min → NO new event.
    let res = await request(app)
      .patch(`/api/comments/${c.id}`)
      .set(auth(authorTok))
      .send({ body: `<p>updated ${span}</p>` });
    assert.equal(res.status, 200);
    assert.equal(
      await prisma.mentionEvent.count({ where: { userId: mentioned.id, commentId: c.id } }),
      1,
      'retained mention within 15 min should not add an event',
    );

    // Back-date the last event past the window, then edit again → new event.
    await prisma.mentionEvent.updateMany({
      where: { commentId: c.id, userId: mentioned.id },
      data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) },
    });
    res = await request(app)
      .patch(`/api/comments/${c.id}`)
      .set(auth(authorTok))
      .send({ body: `<p>again ${span}</p>` });
    assert.equal(res.status, 200);
    assert.equal(
      await prisma.mentionEvent.count({ where: { userId: mentioned.id, commentId: c.id } }),
      2,
      'retained mention after 15 min should add a new event',
    );
  });

  it('always creates an event for a newly added mention on edit', async () => {
    const admin = await adminToken();
    const u1 = await seedUser({
      email: 'm1@test.local',
      role: 'Member',
      password: MEMBER_PASSWORD,
    });
    const u2 = await seedUser({
      email: 'm2@test.local',
      role: 'Member',
      password: MEMBER_PASSWORD,
    });
    const m3 = await seedUser({ email: 'm3@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const authorTok = await login('m3@test.local', MEMBER_PASSWORD);
    const t = await makeTask(admin, 'MentionsAdd', { assigneeId: m3.id });

    const add = await request(app)
      .post(`/api/tasks/${t.id}/comments`)
      .set(auth(authorTok))
      .send({ body: `<p>${mention(u1.id, 'one')}</p>` });
    const c = add.body.comments[0];

    // Add u2 as a new mention (u1 retained within 15 min).
    await request(app)
      .patch(`/api/comments/${c.id}`)
      .set(auth(authorTok))
      .send({ body: `<p>${mention(u1.id, 'one')} ${mention(u2.id, 'two')}</p>` });

    assert.equal(
      await prisma.mentionEvent.count({ where: { userId: u2.id, commentId: c.id } }),
      1,
      'newly added mention always creates an event',
    );
    assert.equal(
      await prisma.mentionEvent.count({ where: { userId: u1.id, commentId: c.id } }),
      1,
      'retained mention within 15 min stays at its single event',
    );
  });
});

describe('task deletion (Phase 4, admin-only)', () => {
  it('forbids non-admins; admin deletes, cascading rows and removing storage objects', async () => {
    const admin = await adminToken();
    await seedUser({ email: 'nd@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const memberTok = await login('nd@test.local', MEMBER_PASSWORD);
    const t = await makeTask(admin, 'ToDelete');

    // A task attachment and a comment with its own attachment.
    await attachToTask(admin, t.id, { filename: 'ta.png' });
    const cadd = await request(app)
      .post(`/api/tasks/${t.id}/comments`)
      .set(auth(admin))
      .send({ body: '<p>c</p>' });
    const c = cadd.body.comments[0];
    const meta = { filename: 'ca.png', contentType: 'image/png', size: 100 };
    const presign = await request(app)
      .post(`/api/comments/${c.id}/attachments/presign`)
      .set(auth(admin))
      .send(meta);
    await request(app)
      .post(`/api/comments/${c.id}/attachments`)
      .set(auth(admin))
      .send({ ...meta, storageKey: presign.body.storageKey });

    // Non-admin cannot delete.
    let res = await request(app).delete(`/api/tasks/${t.id}`).set(auth(memberTok));
    assert.equal(res.status, 403);

    // Admin deletes; both storage objects removed, rows cascaded.
    const before = memoryStorage.__deleted.length;
    res = await request(app).delete(`/api/tasks/${t.id}`).set(auth(admin));
    assert.equal(res.status, 204);

    res = await request(app).get(`/api/tasks/${t.id}`).set(auth(admin));
    assert.equal(res.status, 404);
    assert.ok(
      memoryStorage.__deleted.length - before >= 2,
      'both attachment objects should be deleted from storage',
    );
    assert.equal(await prisma.comment.count({ where: { taskId: t.id } }), 0);
  });
});

describe('task tags list (Phase 4)', () => {
  it('lists distinct in-use tags alphabetically and drops tags no longer used', async () => {
    const tok = await adminToken();
    const t1 = await makeTask(tok, 'Tagged one', { tags: ['zebra', 'apple'] });
    await makeTask(tok, 'Tagged two', { tags: ['Mango', 'apple'] });

    let tags = await request(app).get('/api/tasks/tags').set(auth(tok));
    assert.equal(tags.status, 200);
    // Case-insensitive alphabetical, distinct across tasks.
    assert.deepEqual(tags.body, ['apple', 'Mango', 'zebra']);

    // 'zebra' is only on t1; removing it there drops it from the list entirely.
    await request(app)
      .patch(`/api/tasks/${t1.id}`)
      .set(auth(tok))
      .send({ tags: ['apple'] });
    tags = await request(app).get('/api/tasks/tags').set(auth(tok));
    assert.deepEqual(tags.body, ['apple', 'Mango']);
  });
});

// --- Phase 5: change history -----------------------------------------------

/** Fetch a task's history (newest first). */
async function history(token: string, taskId: number) {
  const res = await request(app).get(`/api/tasks/${taskId}/history`).set(auth(token));
  assert.equal(res.status, 200, `history failed: ${JSON.stringify(res.body)}`);
  return res.body as {
    field: string;
    changeType: string;
    previousValue: string | null;
    newValue: string | null;
    detail: string | null;
    changedAt: string;
    user: { email: string } | null;
  }[];
}

describe('task change history (Phase 5)', () => {
  it('records scalar field changes with previous+new, actor, and timestamp', async () => {
    const tok = await adminToken();
    const assignee = await seedUser({ email: 'asg@test.local', role: 'Member' });
    const t = await makeTask(tok, 'Hist task');

    await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({
        status: 'InProgress',
        priority: 'High',
        assigneeId: assignee.id,
        dueAt: '2026-09-01T10:00:00Z',
      });

    const entries = await history(tok, t.id);
    const byField = Object.fromEntries(entries.map((e) => [e.field, e]));
    assert.equal(byField.status.changeType, 'updated');
    assert.equal(byField.status.previousValue, 'Open');
    assert.equal(byField.status.newValue, 'InProgress');
    assert.equal(byField.priority.newValue, 'High');
    assert.equal(byField.assignee.newValue, 'asg@test.local');
    assert.ok(byField.dueAt.newValue, 'dueAt entry should carry the new ISO value');
    assert.equal(byField.status.user?.email, ADMIN_EMAIL);
    assert.ok(byField.status.changedAt);
  });

  it('logs a description change without storing the text', async () => {
    const tok = await adminToken();
    const t = await makeTask(tok, 'Desc hist');
    await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ description: '<p>a secret description</p>' });

    const desc = (await history(tok, t.id)).find((e) => e.field === 'description');
    assert.ok(desc, 'a description entry should exist');
    assert.equal(desc?.changeType, 'updated');
    assert.equal(desc?.previousValue, null);
    assert.equal(desc?.newValue, null);
  });

  it('sorts entries most-recent-first', async () => {
    const tok = await adminToken();
    const t = await makeTask(tok, 'Order');
    await request(app).patch(`/api/tasks/${t.id}`).set(auth(tok)).send({ priority: 'High' });
    await request(app).patch(`/api/tasks/${t.id}`).set(auth(tok)).send({ priority: 'Low' });
    const entries = (await history(tok, t.id)).filter((e) => e.field === 'priority');
    assert.equal(entries.length, 2);
    assert.equal(entries[0].newValue, 'Low', 'newest change first');
    assert.equal(entries[1].newValue, 'High');
  });

  it('logs parent add/remove as added/removed with the other task ref (no value pair)', async () => {
    const tok = await adminToken();
    const parent = await makeTask(tok, 'Parent task');
    const child = await makeTask(tok, 'Child task');
    await request(app)
      .put(`/api/tasks/${child.id}/parent`)
      .set(auth(tok))
      .send({ parentId: parent.id });
    await request(app).delete(`/api/tasks/${child.id}/parent`).set(auth(tok));

    const parentEntries = (await history(tok, child.id)).filter((e) => e.field === 'parentTask');
    assert.equal(parentEntries.length, 2);
    assert.deepEqual(parentEntries.map((e) => e.changeType).sort(), ['added', 'removed']);
    assert.ok(parentEntries.every((e) => e.detail?.includes(`#${parent.id}`)));
    assert.ok(parentEntries.every((e) => e.previousValue === null && e.newValue === null));
  });

  it('logs a dependency on both endpoints with the correct grouping', async () => {
    const tok = await adminToken();
    const a = await makeTask(tok, 'Blocker');
    const b = await makeTask(tok, 'Blocked');
    await request(app)
      .post(`/api/tasks/${a.id}/dependencies`)
      .set(auth(tok))
      .send({ type: 'blocks', otherTaskId: b.id });

    const aEntry = (await history(tok, a.id)).find((e) => e.field === 'dependency:blocks');
    const bEntry = (await history(tok, b.id)).find((e) => e.field === 'dependency:isBlockedBy');
    assert.equal(aEntry?.changeType, 'added');
    assert.ok(aEntry?.detail?.includes(`#${b.id}`));
    assert.equal(bEntry?.changeType, 'added');
    assert.ok(bEntry?.detail?.includes(`#${a.id}`));
  });

  it('logs attachment add and remove with the filename', async () => {
    const tok = await adminToken();
    const t = await makeTask(tok, 'Att hist');
    const confirm = await attachToTask(tok, t.id, {
      filename: 'report.pdf',
      contentType: 'application/pdf',
    });
    const attId = (confirm.body.attachments as { id: string }[])[0].id;
    await request(app).delete(`/api/attachments/${attId}`).set(auth(tok));

    const attEntries = (await history(tok, t.id)).filter((e) => e.field === 'attachment');
    assert.equal(attEntries.length, 2);
    assert.ok(attEntries.every((e) => e.detail === 'report.pdf'));
    assert.deepEqual(attEntries.map((e) => e.changeType).sort(), ['added', 'removed']);
  });

  it('logs comment add/edit/delete (by the author) without storing the text', async () => {
    const admin = await adminToken();
    const cauth = await seedUser({ email: 'cauth@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const authorTok = await login('cauth@test.local', MEMBER_PASSWORD);
    const t = await makeTask(admin, 'Cmt hist', { assigneeId: cauth.id });

    const add = await request(app)
      .post(`/api/tasks/${t.id}/comments`)
      .set(auth(authorTok))
      .send({ body: '<p>hi</p>' });
    const cid = add.body.comments[0].id as string;
    await request(app)
      .patch(`/api/comments/${cid}`)
      .set(auth(authorTok))
      .send({ body: '<p>edited</p>' });
    await request(app).delete(`/api/comments/${cid}`).set(auth(authorTok));

    const cmt = (await history(admin, t.id)).filter((e) => e.field === 'comment');
    assert.deepEqual(cmt.map((e) => e.changeType).sort(), ['added', 'removed', 'updated']);
    assert.ok(
      cmt.every((e) => e.previousValue === null && e.newValue === null && e.detail === null),
    );
    assert.ok(cmt.every((e) => e.user?.email === 'cauth@test.local'));
  });

  it('is visible to any authenticated user with access to the task', async () => {
    const admin = await adminToken();
    const viewer = await seedUser({ email: 'viewer@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const viewerTok = await login('viewer@test.local', MEMBER_PASSWORD);
    // Phase 13: the viewer needs access — make them the assignee (Admin still edits).
    const t = await makeTask(admin, 'Shared', { assigneeId: viewer.id });
    await request(app).patch(`/api/tasks/${t.id}`).set(auth(admin)).send({ status: 'InProgress' });
    const res = await request(app).get(`/api/tasks/${t.id}/history`).set(auth(viewerTok));
    assert.equal(res.status, 200);
    assert.ok(res.body.some((e: { field: string }) => e.field === 'status'));
  });
});

// --- Phase 5: user edit (email, names, status) -----------------------------

describe('admin user edit in place (Phase 5)', () => {
  it('changes first/last name, title, role, and status', async () => {
    const tok = await adminToken();
    const u = await seedUser({ email: 'edit@test.local', role: 'Member' });
    const res = await request(app)
      .patch(`/api/users/${u.id}`)
      .set(auth(tok))
      .send({
        firstName: 'Jane',
        lastName: 'Doe',
        title: 'Lead',
        role: 'Manager',
        isActive: false,
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.firstName, 'Jane');
    assert.equal(res.body.lastName, 'Doe');
    assert.equal(res.body.title, 'Lead');
    assert.equal(res.body.role, 'Manager');
    assert.equal(res.body.isActive, false);
  });

  it('changes an email in place', async () => {
    const tok = await adminToken();
    const u = await seedUser({ email: 'before@test.local', role: 'Member' });
    const res = await request(app)
      .patch(`/api/users/${u.id}`)
      .set(auth(tok))
      .send({ email: 'after@test.local' });
    assert.equal(res.status, 200);
    assert.equal(res.body.email, 'after@test.local');
  });

  it('rejects an email already used by another account', async () => {
    const tok = await adminToken();
    await seedUser({ email: 'taken@test.local', role: 'Member' });
    const u = await seedUser({ email: 'mover@test.local', role: 'Member' });
    const res = await request(app)
      .patch(`/api/users/${u.id}`)
      .set(auth(tok))
      .send({ email: 'taken@test.local' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /already in use/i);
  });
});

// --- Phase 5: account merge ------------------------------------------------

describe('account merge (Phase 5)', () => {
  const baseChoices = {
    firstName: 'Sur',
    lastName: 'Vivor',
    title: 'Keeper',
    jobDescription: null,
    role: 'Manager' as const,
    supervisorId: null,
  };

  it('reassigns references, repoints supervisees, deactivates + flags, and logs history', async () => {
    const adminTok = await adminToken();
    const survivor = await seedUser({ email: 'survivor@test.local', role: 'Manager' });
    const dup = await seedUser({
      email: 'dup@test.local',
      role: 'Manager',
      password: MEMBER_PASSWORD,
    });
    const report = await seedUser({
      email: 'report3@test.local',
      role: 'Member',
      supervisorId: dup.id,
    });

    // A task created by the duplicate, and a task assigned to the duplicate.
    const dupTok = await login('dup@test.local', MEMBER_PASSWORD);
    const created = await makeTask(dupTok, 'By dup');
    const assigned = await makeTask(adminTok, 'Assigned to dup');
    await request(app)
      .patch(`/api/tasks/${assigned.id}`)
      .set(auth(adminTok))
      .send({ assigneeId: dup.id });

    const merge = await request(app).post('/api/users/merge').set(auth(adminTok)).send({
      survivingId: survivor.id,
      mergedId: dup.id,
      confirmEmail: 'dup@test.local',
      fieldChoices: baseChoices,
    });
    assert.equal(merge.status, 200, JSON.stringify(merge.body));
    assert.equal(merge.body.id, survivor.id);
    assert.equal(merge.body.title, 'Keeper');
    assert.equal(merge.body.firstName, 'Sur');

    // Merged account: deactivated and flagged.
    const dupAfter = await prisma.user.findUniqueOrThrow({ where: { id: dup.id } });
    assert.equal(dupAfter.isActive, false);
    assert.equal(dupAfter.mergedIntoId, survivor.id);

    // Supervisee repointed; tasks reassigned.
    const repAfter = await prisma.user.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(repAfter.supervisorId, survivor.id);
    const createdAfter = await prisma.task.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(createdAfter.creatorId, survivor.id);
    const assignedAfter = await prisma.task.findUniqueOrThrow({ where: { id: assigned.id } });
    assert.equal(assignedAfter.assigneeId, survivor.id);

    // Merge logged on affected tasks.
    const hist = await history(adminTok, created.id);
    const mergeEntry = hist.find((e) => e.field === 'merge');
    assert.ok(mergeEntry, 'affected task should have a merge history entry');
    assert.equal(mergeEntry?.previousValue, 'dup@test.local');
    assert.equal(mergeEntry?.newValue, 'survivor@test.local');
  });

  it('requires the confirmation email to match the merged account', async () => {
    const adminTok = await adminToken();
    const survivor = await seedUser({ email: 'surv2@test.local', role: 'Manager' });
    const dup = await seedUser({ email: 'dup2@test.local', role: 'Member' });
    const res = await request(app).post('/api/users/merge').set(auth(adminTok)).send({
      survivingId: survivor.id,
      mergedId: dup.id,
      confirmEmail: 'wrong@test.local',
      fieldChoices: baseChoices,
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /confirmation/i);
  });

  it('rejects a merge whose surviving role cannot supervise inherited reports', async () => {
    const adminTok = await adminToken();
    const survivor = await seedUser({ email: 'surv3@test.local', role: 'Manager' });
    const dup = await seedUser({ email: 'dup3@test.local', role: 'Manager' });
    await seedUser({ email: 'rep3@test.local', role: 'Member', supervisorId: dup.id });
    const res = await request(app)
      .post('/api/users/merge')
      .set(auth(adminTok))
      .send({
        survivingId: survivor.id,
        mergedId: dup.id,
        confirmEmail: 'dup3@test.local',
        fieldChoices: { ...baseChoices, role: 'Member' },
      });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /supervise|Manager or Admin/i);
  });

  it('forbids non-admins from merging', async () => {
    const adminTok = await adminToken();
    await seedUser({ email: 'plain5@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const memberTok = await login('plain5@test.local', MEMBER_PASSWORD);
    const survivor = await seedUser({ email: 'surv5@test.local', role: 'Manager' });
    const dup = await seedUser({ email: 'dup5@test.local', role: 'Member' });
    const res = await request(app).post('/api/users/merge').set(auth(memberTok)).send({
      survivingId: survivor.id,
      mergedId: dup.id,
      confirmEmail: 'dup5@test.local',
      fieldChoices: baseChoices,
    });
    assert.equal(res.status, 403);
    void adminTok;
  });
});

// --- Phase 6: search, filters, sorting, pagination, export, preferences ----

interface QueryRow {
  id: number;
  name: string;
  status: string;
  priority: string;
  assignee: { email: string } | null;
  parentId: number | null;
  childrenCount: number;
  tags: string[];
}
async function queryTasks(token: string, body: Record<string, unknown>) {
  const res = await request(app).post('/api/tasks/query').set(auth(token)).send(body);
  assert.equal(res.status, 200, `query failed: ${JSON.stringify(res.body)}`);
  return res.body as { rows: QueryRow[]; total: number; page: number; pageSize: number };
}

describe('task search / query (Phase 6)', () => {
  it('filters by status and paginates with total', async () => {
    const tok = await adminToken();
    await makeTask(tok, 'Alpha', { status: 'Open' });
    await makeTask(tok, 'Beta', { status: 'InProgress' });
    await makeTask(tok, 'Gamma', { status: 'Open' });

    const open = await queryTasks(tok, { filters: { statuses: ['Open'] } });
    assert.equal(open.total, 2);
    assert.ok(open.rows.every((r) => r.status === 'Open'));

    const paged = await queryTasks(tok, { pageSize: 2, page: 1 });
    assert.equal(paged.rows.length, 2);
    assert.equal(paged.total, 3);
    assert.equal(paged.pageSize, 2);
  });

  it('free-text matches Name, Tags, and exact Id', async () => {
    const tok = await adminToken();
    const t = await makeTask(tok, 'Findable Widget', { tags: ['special', 'alpha'] });
    await makeTask(tok, 'Other thing', { tags: ['beta'] });

    assert.ok((await queryTasks(tok, { text: 'widget' })).rows.some((r) => r.id === t.id));
    assert.ok((await queryTasks(tok, { text: 'speci' })).rows.some((r) => r.id === t.id));
    const byId = await queryTasks(tok, { text: String(t.id) });
    assert.ok(byId.rows.some((r) => r.id === t.id));
  });

  it('filters by assignee, Unassigned, and tags', async () => {
    const tok = await adminToken();
    const u = await seedUser({ email: 'asg6@test.local', role: 'Member' });
    await makeTask(tok, 'Assigned', { assigneeId: u.id, tags: ['x'] });
    await makeTask(tok, 'Unassigned one', { tags: ['y'] });

    const byAssignee = await queryTasks(tok, { filters: { assigneeIds: [u.id] } });
    assert.equal(byAssignee.total, 1);
    assert.equal(byAssignee.rows[0]?.assignee?.email, 'asg6@test.local');

    const unassigned = await queryTasks(tok, { filters: { includeUnassigned: true } });
    assert.ok(unassigned.rows.every((r) => r.assignee === null));

    const byTag = await queryTasks(tok, { filters: { tags: ['x'] } });
    assert.equal(byTag.total, 1);
  });

  it('filters by Team Hierarchy (assignee IN the selected downline)', async () => {
    const tok = await adminToken();
    const a = await seedUser({ email: 'hier-a@test.local', role: 'Member' });
    const b = await seedUser({ email: 'hier-b@test.local', role: 'Member' });
    await makeTask(tok, 'A task', { assigneeId: a.id });
    await makeTask(tok, 'B task', { assigneeId: b.id });

    const onlyA = await queryTasks(tok, { filters: { hierarchyUserIds: [a.id] } });
    assert.equal(onlyA.total, 1);
    assert.equal(onlyA.rows[0]?.assignee?.email, 'hier-a@test.local');

    const both = await queryTasks(tok, { filters: { hierarchyUserIds: [a.id, b.id] } });
    assert.equal(both.total, 2, 'selecting both members returns both their tasks');
  });

  it('due-date range respects the include-no-due toggle', async () => {
    const tok = await adminToken();
    await makeTask(tok, 'Has due', { dueAt: '2026-09-15T12:00:00Z' });
    await makeTask(tok, 'No due');

    const withNoDue = await queryTasks(tok, {
      filters: { dueFrom: '2026-09-01T00:00:00Z', dueTo: '2026-09-30T23:59:59Z' },
    });
    assert.equal(withNoDue.total, 2, 'no-due task included by default');

    const excluded = await queryTasks(tok, {
      filters: {
        dueFrom: '2026-09-01T00:00:00Z',
        dueTo: '2026-09-30T23:59:59Z',
        includeNoDue: false,
      },
    });
    assert.equal(excluded.total, 1);
    assert.equal(excluded.rows[0]?.name, 'Has due');
  });

  it('due "to" is an inclusive instant — a task due after it (e.g. the next day) is excluded', async () => {
    const tok = await adminToken();
    // The browser sends a precise local end-of-day instant as `dueTo`; the
    // backend must NOT re-expand it (previously a stray +24h pulled in the next
    // day, so a task due tomorrow leaked into a "due today" list).
    const todayLate = await makeTask(tok, 'today 8pm', { dueAt: '2026-09-03T20:00:00Z' });
    const nextDay = await makeTask(tok, 'tomorrow 7pm', { dueAt: '2026-09-04T19:00:00Z' });

    const res = await queryTasks(tok, {
      filters: { dueTo: '2026-09-03T23:59:59.999Z', includeNoDue: false },
    });
    const ids = res.rows.map((r) => r.id);
    assert.ok(ids.includes(todayLate.id), 'due earlier that day is included');
    assert.equal(ids.includes(nextDay.id), false, 'due the next day is NOT included (no +24h expansion)');
  });

  it('defaults to Due ascending with no-due tasks pinned to the top', async () => {
    const tok = await adminToken();
    const noDue = await makeTask(tok, 'ZZ no due');
    const early = await makeTask(tok, 'early', { dueAt: '2026-08-01T00:00:00Z' });
    const late = await makeTask(tok, 'late', { dueAt: '2026-12-01T00:00:00Z' });

    const ids = (await queryTasks(tok, {})).rows.map((r) => r.id);
    assert.equal(ids[0], noDue.id, 'no-due pinned to top');
    assert.ok(ids.indexOf(early.id) < ids.indexOf(late.id), 'earlier due before later');
  });

  it('supports multi-column sort (priority asc, then name desc)', async () => {
    const tok = await adminToken();
    await makeTask(tok, 'BB', { priority: 'High' });
    await makeTask(tok, 'AA', { priority: 'High' });
    await makeTask(tok, 'CC', { priority: 'Low' });
    const names = (
      await queryTasks(tok, {
        sort: [
          { field: 'priority', dir: 'asc' },
          { field: 'name', dir: 'desc' },
        ],
      })
    ).rows.map((r) => r.name);
    // High before Low (enum order); within High, name desc → BB before AA.
    assert.deepEqual(names, ['BB', 'AA', 'CC']);
  });

  it('reports parentId and childrenCount per row', async () => {
    const tok = await adminToken();
    const parent = await makeTask(tok, 'Parent6');
    const child = await makeTask(tok, 'Child6');
    await request(app)
      .put(`/api/tasks/${child.id}/parent`)
      .set(auth(tok))
      .send({ parentId: parent.id });

    const rows = (await queryTasks(tok, { sort: [{ field: 'id', dir: 'asc' }] })).rows;
    assert.equal(rows.find((r) => r.id === parent.id)?.childrenCount, 1);
    assert.equal(rows.find((r) => r.id === child.id)?.parentId, parent.id);
  });

  it('nests children under parents across the whole set, per-layer sorted, and paginates the tree', async () => {
    const tok = await adminToken();
    const p1 = await makeTask(tok, 'Parent One', { dueAt: '2026-11-01T00:00:00Z' });
    const p2 = await makeTask(tok, 'Parent Two', { dueAt: '2026-12-01T00:00:00Z' });
    const cB = await makeTask(tok, 'Child B', { dueAt: '2026-10-02T00:00:00Z' });
    const cA = await makeTask(tok, 'Child A', { dueAt: '2026-10-01T00:00:00Z' });
    await request(app).put(`/api/tasks/${cB.id}/parent`).set(auth(tok)).send({ parentId: p1.id });
    await request(app).put(`/api/tasks/${cA.id}/parent`).set(auth(tok)).send({ parentId: p1.id });

    // Nested + Due asc: roots by due (p1 then p2); p1's children by due (cA then cB).
    const nested = await queryTasks(tok, { nest: true, sort: [{ field: 'dueAt', dir: 'asc' }] });
    assert.equal(nested.total, 4, 'every matching task appears once');
    assert.deepEqual(
      nested.rows.map((r) => ({ id: r.id, depth: (r as { depth?: number }).depth })),
      [
        { id: p1.id, depth: 0 },
        { id: cA.id, depth: 1 },
        { id: cB.id, depth: 1 },
        { id: p2.id, depth: 0 },
      ],
    );

    // Pagination slices the nested sequence.
    const firstPage = await queryTasks(tok, {
      nest: true,
      sort: [{ field: 'dueAt', dir: 'asc' }],
      pageSize: 2,
      page: 1,
    });
    assert.equal(firstPage.total, 4);
    assert.deepEqual(
      firstPage.rows.map((r) => r.id),
      [p1.id, cA.id],
    );
  });
});

// --- Phase 7: search dashboard counts --------------------------------------

interface DashboardShape {
  total: number;
  parent: number;
  child: number;
  standalone: number;
  byStatus: Record<string, number>;
  overdue: number;
  completedToday: number;
}

/** Local-day clock context matching what the browser sends. */
function clockContext(): { now: string; todayStart: string; todayEnd: string } {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  return {
    now: now.toISOString(),
    todayStart: todayStart.toISOString(),
    todayEnd: todayEnd.toISOString(),
  };
}

async function dashboard(token: string, body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/tasks/dashboard')
    .set(auth(token))
    .send({ ...clockContext(), ...body });
  assert.equal(res.status, 200, `dashboard failed: ${JSON.stringify(res.body)}`);
  return res.body as DashboardShape;
}

async function setStatus(token: string, id: number, status: string) {
  const res = await request(app).patch(`/api/tasks/${id}`).set(auth(token)).send({ status });
  assert.equal(res.status, 200, `set status failed: ${JSON.stringify(res.body)}`);
}

async function setParent(token: string, id: number, parentId: number) {
  const res = await request(app).put(`/api/tasks/${id}/parent`).set(auth(token)).send({ parentId });
  assert.equal(res.status, 200, `set parent failed: ${JSON.stringify(res.body)}`);
}

describe('task search dashboard (Phase 7)', () => {
  it('tallies per-status counts that sum to the total and honor active filters', async () => {
    const tok = await adminToken();
    await makeTask(tok, 'Task A', { status: 'Open' });
    await makeTask(tok, 'Task B', { status: 'Open' });
    await makeTask(tok, 'Task C', { status: 'InProgress' });

    const all = await dashboard(tok);
    assert.equal(all.total, 3);
    assert.equal(all.byStatus.Open, 2);
    assert.equal(all.byStatus.InProgress, 1);
    // Every status key is present, even at zero.
    assert.equal(all.byStatus.Completed, 0);
    const statusSum = Object.values(all.byStatus).reduce((a, b) => a + b, 0);
    assert.equal(statusSum, all.total);

    // Counts reflect the active filter: restricting to Open drops the total.
    const open = await dashboard(tok, { filters: { statuses: ['Open'] } });
    assert.equal(open.total, 2);
    assert.equal(open.byStatus.Open, 2);
    assert.equal(open.byStatus.InProgress, 0);
  });

  it('partitions parent / child / standalone so they sum to the total', async () => {
    const tok = await adminToken();
    const p = await makeTask(tok, 'Parent');
    const c = await makeTask(tok, 'Child');
    const g = await makeTask(tok, 'Grandchild');
    await makeTask(tok, 'Standalone');
    await setParent(tok, c.id, p.id);
    await setParent(tok, g.id, c.id);

    const d = await dashboard(tok);
    assert.equal(d.total, 4);
    // child = anything with a parent (c, g); parent = a root with children (p);
    // standalone = no parent and no children.
    assert.equal(d.child, 2);
    assert.equal(d.parent, 1);
    assert.equal(d.standalone, 1);
    assert.equal(d.child + d.parent + d.standalone, d.total);

    // The `relation` quick-filter on the grid matches the standalone bucket.
    const standaloneRows = await queryTasks(tok, { filters: { relation: 'standalone' } });
    assert.equal(standaloneRows.total, 1);
    assert.equal(standaloneRows.rows[0]?.name, 'Standalone');
  });

  it('overdue excludes completed/canceled and future due dates, and its filter matches', async () => {
    const tok = await adminToken();
    const overdue = await makeTask(tok, 'Overdue', { dueAt: '2020-01-01T00:00:00Z' });
    const doneButPast = await makeTask(tok, 'Done past', { dueAt: '2020-01-01T00:00:00Z' });
    await setStatus(tok, doneButPast.id, 'Completed');
    await makeTask(tok, 'Future', { dueAt: '2999-01-01T00:00:00Z' });
    await makeTask(tok, 'No due'); // null due date never counts

    const d = await dashboard(tok);
    assert.equal(d.overdue, 1);

    // Clicking Overdue filters the grid to exactly that task.
    const rows = await queryTasks(tok, { filters: { overdue: true }, ...clockContext() });
    assert.equal(rows.total, 1);
    assert.equal(rows.rows[0]?.id, overdue.id);
  });

  it('completed-today counts only completions within the local calendar day', async () => {
    const tok = await adminToken();
    const fresh = await makeTask(tok, 'Fresh done');
    await setStatus(tok, fresh.id, 'Completed'); // statusChangedAt ~ now

    const old = await makeTask(tok, 'Old done');
    await setStatus(tok, old.id, 'Completed');
    // Backdate the completion to a prior day (can't be done through the API).
    await prisma.task.update({
      where: { id: old.id },
      data: { statusChangedAt: new Date('2020-05-01T12:00:00Z') },
    });

    const today = await dashboard(tok);
    assert.equal(today.completedToday, 1, 'only the fresh completion counts today');

    // A window entirely in the past excludes the fresh completion too.
    const past = await dashboard(tok, {
      todayStart: '2019-01-01T00:00:00Z',
      todayEnd: '2019-01-02T00:00:00Z',
    });
    assert.equal(past.completedToday, 0);
  });

  it('clears to a full snapshot when no filters are set', async () => {
    const tok = await adminToken();
    await makeTask(tok, 'Only one');
    const d = await dashboard(tok);
    assert.equal(d.total, 1);
    assert.equal(d.overdue, 0);
    assert.equal(d.completedToday, 0);
  });
});

describe('task export (Phase 6)', () => {
  it('returns an .xlsx attachment', async () => {
    const tok = await adminToken();
    await makeTask(tok, 'Exportable');
    const res = await request(app).post('/api/tasks/export').set(auth(tok)).send({});
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /spreadsheetml/);
    assert.match(res.headers['content-disposition'], /tasks\.xlsx/);
  });
});

describe('users search (Phase 6)', () => {
  async function makeUser(
    token: string,
    email: string,
    firstName: string,
    lastName: string,
    extra: Record<string, unknown> = {},
  ) {
    const res = await request(app)
      .post('/api/users')
      .set(auth(token))
      .send({ email, firstName, lastName, role: 'Member', ...extra });
    assert.equal(res.status, 201, `create user failed: ${JSON.stringify(res.body)}`);
    return res.body.user as { id: string };
  }

  it('defaults to Last Name order and filters per column', async () => {
    const tok = await adminToken();
    await makeUser(tok, 'zoe@test.local', 'Zoe', 'Adams');
    await makeUser(tok, 'bob@test.local', 'Bob', 'Baker');
    await makeUser(tok, 'amy@test.local', 'Amy', 'Carter');

    const all = await request(app).post('/api/users/search').set(auth(tok)).send({});
    assert.equal(all.status, 200);
    const lastNames = (all.body.rows as { lastName: string }[]).map((r) => r.lastName);
    assert.ok(
      lastNames.indexOf('Adams') < lastNames.indexOf('Baker') &&
        lastNames.indexOf('Baker') < lastNames.indexOf('Carter'),
      `expected Adams<Baker<Carter, got ${JSON.stringify(lastNames)}`,
    );

    // Text-like columns filter by an exact multi-select of distinct values.
    const filtered = await request(app)
      .post('/api/users/search')
      .set(auth(tok))
      .send({ filters: { lastName: ['Baker'] } });
    assert.equal(filtered.body.total, 1);
    assert.equal(filtered.body.rows[0].lastName, 'Baker');

    // Distinct filter options include the created names.
    const opts = await request(app).get('/api/users/filter-options').set(auth(tok));
    assert.equal(opts.status, 200);
    assert.ok(opts.body.lastName.includes('Baker'));
    assert.ok(opts.body.email.includes('bob@test.local'));
  });

  it('supports multi-column sort and pagination, and is admin-only', async () => {
    const tok = await adminToken();
    await makeUser(tok, 'p1@test.local', 'Pat', 'Zephyr', { title: 'B' });
    await makeUser(tok, 'p2@test.local', 'Pat', 'Yang', { title: 'A' });

    const sorted = await request(app)
      .post('/api/users/search')
      .set(auth(tok))
      .send({
        sort: [
          { field: 'firstName', dir: 'asc' },
          { field: 'lastName', dir: 'asc' },
        ],
        pageSize: 2,
        page: 1,
      });
    assert.equal(sorted.status, 200);
    assert.equal(sorted.body.pageSize, 2);
    assert.equal(sorted.body.rows.length, 2);

    await seedUser({ email: 'plain6@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const memberTok = await login('plain6@test.local', MEMBER_PASSWORD);
    const forbidden = await request(app).post('/api/users/search').set(auth(memberTok)).send({});
    assert.equal(forbidden.status, 403);
  });
});

describe('screen preferences (Phase 6)', () => {
  it('round-trips per-user state, isolates users, and rejects unknown screens', async () => {
    const adminTok = await adminToken();

    const empty = await request(app).get('/api/preferences/task-search').set(auth(adminTok));
    assert.equal(empty.status, 200);
    assert.equal(empty.body.state, null);

    const put = await request(app)
      .put('/api/preferences/task-search')
      .set(auth(adminTok))
      .send({ state: { pageSize: 100, text: 'hi' } });
    assert.equal(put.status, 200);

    const get = await request(app).get('/api/preferences/task-search').set(auth(adminTok));
    assert.deepEqual(get.body.state, { pageSize: 100, text: 'hi' });

    await seedUser({ email: 'pref6@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const otherTok = await login('pref6@test.local', MEMBER_PASSWORD);
    const otherGet = await request(app).get('/api/preferences/task-search').set(auth(otherTok));
    assert.equal(otherGet.body.state, null, "another user's state is independent");

    const bad = await request(app).get('/api/preferences/nonsense').set(auth(adminTok));
    assert.equal(bad.status, 400);
  });
});

// --- Phase 8: notifications, reminders, preferences ------------------------

interface NotifShape {
  mentioned: {
    id: string;
    taskId: number;
    taskName: string;
    commentAt: string;
    commenter: { email: string };
    commentHtml: string;
    read: boolean;
  }[];
  reminders: {
    id: string;
    taskId: number;
    startAt: string | null;
    priority: string;
    leadMinutes: number;
    read: boolean;
    kind: 'due' | 'canceled';
    canceledReason: string | null;
    canceledAt: string | null;
  }[];
  assigned: {
    id: string;
    taskId: number;
    startAt: string | null;
    priority: string;
    action: string;
    read: boolean;
  }[];
}

async function getNotifs(token: string, filter?: string): Promise<NotifShape> {
  const url = filter ? `/api/notifications?filter=${filter}` : '/api/notifications';
  const res = await request(app).get(url).set(auth(token));
  assert.equal(res.status, 200, `notifications failed: ${JSON.stringify(res.body)}`);
  return res.body as NotifShape;
}

async function unread(token: string) {
  const res = await request(app).get('/api/notifications/unread-count').set(auth(token));
  assert.equal(res.status, 200, `unread failed: ${JSON.stringify(res.body)}`);
  return res.body as { total: number; mentioned: number; reminders: number; assigned: number };
}

async function setPrefs(token: string, patch: Record<string, boolean>) {
  const res = await request(app).put('/api/notifications/preferences').set(auth(token)).send(patch);
  assert.equal(res.status, 200, `prefs failed: ${JSON.stringify(res.body)}`);
  return res.body as Record<string, boolean>;
}

async function addComment(token: string, taskId: number, body: string) {
  const res = await request(app)
    .post(`/api/tasks/${taskId}/comments`)
    .set(auth(token))
    .send({ body });
  assert.equal(res.status, 201, `comment failed: ${JSON.stringify(res.body)}`);
  return res.body as { comments: { id: string }[] };
}

/** Capture console output while running fn (the dev mailer prints emails there). */
async function captureConsole(fn: () => Promise<void>): Promise<string> {
  const orig = console.log;
  const lines: string[] = [];
  // eslint-disable-next-line no-console
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(' '));
  };
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return lines.join('\n');
}

describe('notifications: Mentioned (Phase 8)', () => {
  it('creates a notification, lists/counts it, marks read, and filters by state', async () => {
    const admin = await adminToken();
    const u = await seedUser({ email: 'm8@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const uTok = await login('m8@test.local', MEMBER_PASSWORD);
    const t = await makeTask(admin, 'Mention task');
    await addComment(admin, t.id, `<p>hi ${mention(u.id, 'm8')}</p>`);

    const list = await getNotifs(uTok);
    assert.equal(list.mentioned.length, 1);
    assert.equal(list.mentioned[0]?.taskId, t.id);
    assert.equal(list.mentioned[0]?.read, false);
    assert.equal((await unread(uTok)).mentioned, 1);
    assert.equal((await unread(uTok)).total, 1);

    const nid = list.mentioned[0]!.id;
    const mr = await request(app).post(`/api/notifications/${nid}/read`).set(auth(uTok));
    assert.equal(mr.status, 204);
    assert.equal((await unread(uTok)).mentioned, 0);

    assert.equal((await getNotifs(uTok, 'unread')).mentioned.length, 0);
    assert.equal((await getNotifs(uTok, 'read')).mentioned.length, 1);
    assert.equal((await getNotifs(uTok, 'all')).mentioned.length, 1);
  });

  it('does not notify the comment author for their own mention', async () => {
    const admin = await adminToken();
    const adminUser = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
    const t = await makeTask(admin, 'Self mention');
    await addComment(admin, t.id, `<p>note ${mention(adminUser!.id, 'me')}</p>`);
    assert.equal((await getNotifs(admin)).mentioned.length, 0);
  });

  it('respects the 15-minute gate end-to-end (no duplicate within the window)', async () => {
    const admin = await adminToken();
    const u = await seedUser({
      email: 'gate8@test.local',
      role: 'Member',
      password: MEMBER_PASSWORD,
    });
    const uTok = await login('gate8@test.local', MEMBER_PASSWORD);
    const t = await makeTask(admin, 'Gate');
    const span = mention(u.id, 'g');
    const detail = await addComment(admin, t.id, `<p>hi ${span}</p>`);
    const commentId = detail.comments[0]!.id;

    await request(app)
      .patch(`/api/comments/${commentId}`)
      .set(auth(admin))
      .send({ body: `<p>edit ${span}</p>` });
    assert.equal((await getNotifs(uTok)).mentioned.length, 1, 'no duplicate within 15 min');

    // Back-date the underlying event past the window, then edit again.
    await prisma.mentionEvent.updateMany({
      where: { commentId, userId: u.id },
      data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) },
    });
    await request(app)
      .patch(`/api/comments/${commentId}`)
      .set(auth(admin))
      .send({ body: `<p>again ${span}</p>` });
    assert.equal((await getNotifs(uTok)).mentioned.length, 2, 'new notification after the window');
  });
});

describe('notifications: Assigned (Phase 8)', () => {
  it('notifies on assign and unassign, but skips self-assignment', async () => {
    const admin = await adminToken();
    const u = await seedUser({
      email: 'asg8@test.local',
      role: 'Member',
      password: MEMBER_PASSWORD,
    });
    const uTok = await login('asg8@test.local', MEMBER_PASSWORD);

    const t = await makeTask(admin, 'Assign8', { assigneeId: u.id });
    let list = await getNotifs(uTok);
    assert.equal(list.assigned.length, 1);
    assert.equal(list.assigned[0]?.action, 'added');
    assert.equal(list.assigned[0]?.taskId, t.id);

    await request(app).patch(`/api/tasks/${t.id}`).set(auth(admin)).send({ assigneeId: null });
    list = await getNotifs(uTok);
    assert.equal(list.assigned.length, 2);
    assert.equal(list.assigned[0]?.action, 'removed', 'newest first');

    const adminUser = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
    const t2 = await makeTask(admin, 'SelfAssign');
    await request(app)
      .patch(`/api/tasks/${t2.id}`)
      .set(auth(admin))
      .send({ assigneeId: adminUser!.id });
    assert.equal((await getNotifs(admin)).assigned.length, 0, 'self-assignment not notified');
  });
});

describe('notifications: Reminders (Phase 8)', () => {
  it('surfaces only when due and hides reminders on tasks with no Start', async () => {
    const admin = await adminToken();
    const startSoon = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // +30 min
    const t = await makeTask(admin, 'Reminder task', { startAt: startSoon });

    // 15-min lead surfaces at start-15m (= +15 min): not due yet.
    const r15 = await request(app)
      .post(`/api/tasks/${t.id}/reminders`)
      .set(auth(admin))
      .send({ leadMinutes: 15 });
    assert.equal(r15.status, 201);
    // 60-min lead surfaces at start-60m (= -30 min): due now.
    const r60 = await request(app)
      .post(`/api/tasks/${t.id}/reminders`)
      .set(auth(admin))
      .send({ leadMinutes: 60 });
    assert.equal(r60.status, 201);

    // A task with no Start never surfaces its reminder.
    const t2 = await makeTask(admin, 'No start');
    await request(app)
      .post(`/api/tasks/${t2.id}/reminders`)
      .set(auth(admin))
      .send({ leadMinutes: 0 });

    const list = await getNotifs(admin);
    assert.equal(list.reminders.length, 1, 'only the due (60-min lead) reminder surfaces');
    assert.equal(list.reminders[0]?.id, r60.body.id);
    assert.equal((await unread(admin)).reminders, 1);

    // Task detail shows all of the user's reminders on the task (management view).
    const onTask = await request(app).get(`/api/tasks/${t.id}/reminders`).set(auth(admin));
    assert.equal(onTask.body.length, 2);

    // Mark read → drops from the unread count but stays in the list.
    await request(app).post(`/api/reminders/${r60.body.id}/read`).set(auth(admin));
    assert.equal((await unread(admin)).reminders, 0);
    assert.equal((await getNotifs(admin)).reminders[0]?.read, true);

    // Remove → gone from both the Reminders list and the task's reminders.
    const del = await request(app).delete(`/api/reminders/${r60.body.id}`).set(auth(admin));
    assert.equal(del.status, 204);
    assert.equal((await getNotifs(admin)).reminders.length, 0);
    const onTaskAfter = await request(app).get(`/api/tasks/${t.id}/reminders`).set(auth(admin));
    assert.equal(onTaskAfter.body.length, 1);
  });
});

describe('notifications: preferences (Phase 8)', () => {
  it('opting out stops new notifications but keeps existing ones', async () => {
    const admin = await adminToken();
    const u = await seedUser({
      email: 'opt8@test.local',
      role: 'Member',
      password: MEMBER_PASSWORD,
    });
    const uTok = await login('opt8@test.local', MEMBER_PASSWORD);
    const t = await makeTask(admin, 'Opt task');

    await addComment(admin, t.id, `<p>a ${mention(u.id, 'u')}</p>`);
    assert.equal((await getNotifs(uTok)).mentioned.length, 1);

    await setPrefs(uTok, { mentionedInApp: false });
    await addComment(admin, t.id, `<p>b ${mention(u.id, 'u')}</p>`);
    assert.equal(
      (await getNotifs(uTok)).mentioned.length,
      1,
      'no new notification while opted out; the existing one remains',
    );
  });

  it('opting out of Reminders suppresses the live list and count', async () => {
    const admin = await adminToken();
    // Future Start (so Add is allowed) + a lead already elapsed => due now.
    const t = await makeTask(admin, 'Rem opt', {
      startAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    await request(app)
      .post(`/api/tasks/${t.id}/reminders`)
      .set(auth(admin))
      .send({ leadMinutes: 60 });
    assert.equal((await getNotifs(admin)).reminders.length, 1);

    await setPrefs(admin, { remindersInApp: false });
    assert.equal((await getNotifs(admin)).reminders.length, 0);
    assert.equal((await unread(admin)).reminders, 0);
  });

  it('sends (logs) an email when "also email me" is enabled', async () => {
    const admin = await adminToken();
    const u = await seedUser({
      email: 'email8@test.local',
      role: 'Member',
      password: MEMBER_PASSWORD,
    });
    const uTok = await login('email8@test.local', MEMBER_PASSWORD);
    await setPrefs(uTok, { mentionedEmail: true });
    const t = await makeTask(admin, 'Email task');

    const out = await captureConsole(async () => {
      await addComment(admin, t.id, `<p>ping ${mention(u.id, 'e')}</p>`);
    });
    assert.match(out, /email8@test\.local/);
    assert.match(out, /mentioned/i);

    // Reminder email fires on the polling heartbeat (unread-count).
    await setPrefs(admin, { remindersEmail: true });
    const t2 = await makeTask(admin, 'Rem email', {
      startAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    await request(app)
      .post(`/api/tasks/${t2.id}/reminders`)
      .set(auth(admin))
      .send({ leadMinutes: 60 });
    const out2 = await captureConsole(async () => {
      await unread(admin);
    });
    assert.match(out2, /Reminder:/);
  });
});

// --- Phase 10: review workflow --------------------------------------------

/** Fetch a task's full detail (includes the Phase 10 review fields). */
async function detail(token: string, taskId: number) {
  const res = await request(app).get(`/api/tasks/${taskId}`).set(auth(token));
  assert.equal(res.status, 200, `detail failed: ${JSON.stringify(res.body)}`);
  return res.body as {
    status: string;
    assigneeId: string | null;
    reviewInitiatorId: string | null;
    priorAssigneeId: string | null;
    priorStatus: string | null;
  };
}

describe('review workflow (Phase 10)', () => {
  it('sends a task to Review: reviewer becomes assignee; prior values stored', async () => {
    const tok = await adminToken();
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    // Phase 13: the reviewer must be in the assignee's supervisor chain (or Admin).
    const reviewer = await seedUser({ email: 'rw-reviewer@test.local', role: 'Manager' });
    const assignee = await seedUser({
      email: 'rw-assignee@test.local',
      role: 'Member',
      supervisorId: reviewer.id,
    });
    const t = await makeTask(tok, 'Needs review', {
      assigneeId: assignee.id,
      status: 'InProgress',
    });

    const res = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ status: 'Review', reviewerId: reviewer.id });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const d = await detail(tok, t.id);
    assert.equal(d.status, 'Review');
    assert.equal(d.assigneeId, reviewer.id, 'reviewer becomes the temporary assignee');
    assert.equal(d.priorAssigneeId, assignee.id);
    assert.equal(d.priorStatus, 'InProgress');
    assert.equal(d.reviewInitiatorId, admin.id);

    // The status + assignee changes are logged like a normal edit.
    const entries = await history(tok, t.id);
    const status = entries.find((e) => e.field === 'status');
    const asg = entries.find((e) => e.field === 'assignee');
    assert.equal(status?.newValue, 'Review');
    assert.equal(asg?.newValue, 'rw-reviewer@test.local');
  });

  it('rejects sending to Review without a reviewer', async () => {
    const tok = await adminToken();
    const t = await makeTask(tok, 'No reviewer');
    const res = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ status: 'Review' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /reviewer/i);
  });

  it('locks Status and Assignee while in Review (other fields still editable)', async () => {
    const tok = await adminToken();
    // Admin-assigned task → reviewer pool is the admins; use an Admin reviewer.
    const reviewer = await seedUser({ email: 'lock-reviewer@test.local', role: 'Admin' });
    const other = await seedUser({ email: 'lock-other@test.local', role: 'Member' });
    const t = await makeTask(tok, 'Locked task');
    await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ status: 'Review', reviewerId: reviewer.id });

    const badStatus = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ status: 'Completed' });
    assert.equal(badStatus.status, 400);
    assert.match(badStatus.body.error, /Review/);

    const badAssign = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ assigneeId: other.id });
    assert.equal(badAssign.status, 400);

    const okPriority = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ priority: 'High' });
    assert.equal(okPriority.status, 200, 'non-locked fields still save while in Review');
  });

  it('Reviewed restores prior assignee + status and clears review fields (detail "Reviewed")', async () => {
    const tok = await adminToken();
    const reviewer = await seedUser({ email: 'rev-who@test.local', role: 'Manager' });
    const assignee = await seedUser({
      email: 'rev-restore@test.local',
      role: 'Member',
      supervisorId: reviewer.id,
    });
    const t = await makeTask(tok, 'To review', { assigneeId: assignee.id, status: 'OnHold' });
    await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ status: 'Review', reviewerId: reviewer.id });

    const res = await request(app).post(`/api/tasks/${t.id}/reviewed`).set(auth(tok));
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const d = await detail(tok, t.id);
    assert.equal(d.status, 'OnHold', 'restores prior status');
    assert.equal(d.assigneeId, assignee.id, 'restores prior assignee');
    assert.equal(d.priorAssigneeId, null);
    assert.equal(d.priorStatus, null);
    assert.equal(d.reviewInitiatorId, null);

    const status = (await history(tok, t.id)).find(
      (e) => e.field === 'status' && e.newValue === 'OnHold',
    );
    assert.equal(status?.detail, 'Reviewed');
  });

  it('Reviewed permission: reviewer (current assignee) ok; unrelated member 403', async () => {
    const tok = await adminToken();
    // Reviewer is the assignee's supervisor (so they're in the reviewer pool);
    // once in Review they become the current assignee and may click Reviewed.
    const reviewer = await seedUser({
      email: 'perm-reviewer@test.local',
      role: 'Manager',
      password: MEMBER_PASSWORD,
    });
    const worker = await seedUser({
      email: 'perm-worker@test.local',
      role: 'Member',
      password: MEMBER_PASSWORD,
      supervisorId: reviewer.id,
    });
    const outsider = await seedUser({
      email: 'perm-out@test.local',
      role: 'Member',
      password: MEMBER_PASSWORD,
    });
    const t = await makeTask(tok, 'Perm task', { assigneeId: worker.id });
    await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ status: 'Review', reviewerId: reviewer.id });

    const outsiderTok = await login(outsider.email, MEMBER_PASSWORD);
    const denied = await request(app).post(`/api/tasks/${t.id}/reviewed`).set(auth(outsiderTok));
    assert.equal(denied.status, 403);

    const reviewerTok = await login(reviewer.email, MEMBER_PASSWORD);
    const ok = await request(app).post(`/api/tasks/${t.id}/reviewed`).set(auth(reviewerTok));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  it('Reviewed permission: a supervisor above the assignee at any level can', async () => {
    const tok = await adminToken();
    const top = await seedUser({
      email: 'sup-top@test.local',
      role: 'Manager',
      password: MEMBER_PASSWORD,
    });
    const mid = await seedUser({
      email: 'sup-mid@test.local',
      role: 'Manager',
      supervisorId: top.id,
    });
    // The reviewer (current assignee during review) reports to mid → top, and in
    // turn supervises the worker who holds the task, so the reviewer is a valid
    // pick (in the worker's supervisor chain).
    const reviewer = await seedUser({
      email: 'sup-reviewer@test.local',
      role: 'Manager',
      supervisorId: mid.id,
    });
    const worker = await seedUser({
      email: 'sup-worker@test.local',
      role: 'Member',
      supervisorId: reviewer.id,
    });
    const t = await makeTask(tok, 'Chain task', { assigneeId: worker.id });
    await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ status: 'Review', reviewerId: reviewer.id });

    const topTok = await login(top.email, MEMBER_PASSWORD);
    const ok = await request(app).post(`/api/tasks/${t.id}/reviewed`).set(auth(topTok));
    assert.equal(
      ok.status,
      200,
      `two-levels-up supervisor should be allowed: ${JSON.stringify(ok.body)}`,
    );
  });

  it('Recall restores like Reviewed but logs "Recalled from review"; initiator/prior-assignee only', async () => {
    const tok = await adminToken();
    const assignee = await seedUser({
      email: 'rec-prior@test.local',
      role: 'Member',
      password: MEMBER_PASSWORD,
    });
    // Admin-assigned pool → Admin reviewer; recall permission is about the
    // initiator / prior assignee, not the reviewer's role.
    const reviewer = await seedUser({ email: 'rec-reviewer@test.local', role: 'Admin' });
    const outsider = await seedUser({
      email: 'rec-out@test.local',
      role: 'Member',
      password: MEMBER_PASSWORD,
    });
    const t = await makeTask(tok, 'Recall task', { assigneeId: assignee.id, status: 'InProgress' });
    await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ status: 'Review', reviewerId: reviewer.id });

    // An unrelated member cannot recall.
    const outTok = await login(outsider.email, MEMBER_PASSWORD);
    const denied = await request(app).post(`/api/tasks/${t.id}/recall-review`).set(auth(outTok));
    assert.equal(denied.status, 403);

    // The prior assignee (assignee at time of review) can recall.
    const priorTok = await login(assignee.email, MEMBER_PASSWORD);
    const ok = await request(app).post(`/api/tasks/${t.id}/recall-review`).set(auth(priorTok));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));

    const d = await detail(tok, t.id);
    assert.equal(d.status, 'InProgress');
    assert.equal(d.assigneeId, assignee.id);
    const status = (await history(tok, t.id)).find(
      (e) => e.field === 'status' && e.newValue === 'InProgress',
    );
    assert.equal(status?.detail, 'Recalled from review');
  });

  it('the Review initiator can also recall', async () => {
    const tok = await adminToken();
    const reviewer = await seedUser({ email: 'rec2-reviewer@test.local', role: 'Admin' });
    const t = await makeTask(tok, 'Initiator recall', { status: 'InProgress' });
    await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ status: 'Review', reviewerId: reviewer.id });
    // admin (the initiator) recalls.
    const ok = await request(app).post(`/api/tasks/${t.id}/recall-review`).set(auth(tok));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await detail(tok, t.id)).status, 'InProgress');
  });

  it('Reviewed/Recall on a task not in Review is a 400', async () => {
    const tok = await adminToken();
    const t = await makeTask(tok, 'Not in review');
    const r1 = await request(app).post(`/api/tasks/${t.id}/reviewed`).set(auth(tok));
    assert.equal(r1.status, 400);
    const r2 = await request(app).post(`/api/tasks/${t.id}/recall-review`).set(auth(tok));
    assert.equal(r2.status, 400);
  });

  it('rejects a Kanban-style drag of a blocked task into Review with "blocked by #X"', async () => {
    const tok = await adminToken();
    const reviewer = await seedUser({ email: 'blk-reviewer@test.local', role: 'Member' });
    const pred = await makeTask(tok, 'Predecessor');
    const task = await makeTask(tok, 'Blocked dependent');
    await request(app)
      .post(`/api/tasks/${task.id}/dependencies`)
      .set(auth(tok))
      .send({ type: 'blockedBy', otherTaskId: pred.id });

    const res = await request(app)
      .patch(`/api/tasks/${task.id}`)
      .set(auth(tok))
      .send({ status: 'Review', reviewerId: reviewer.id });
    assert.equal(res.status, 400);
    assert.match(res.body.error, new RegExp(`#${pred.id}`));
  });
});

// --- Phase 10: Gantt drag History coalescing -------------------------------

describe('gantt date coalescing (Phase 10)', () => {
  const D0 = '2026-09-01T10:00:00.000Z';
  const D1 = '2026-09-05T10:00:00.000Z';
  const D2 = '2026-09-09T10:00:00.000Z';

  it('coalesces repeated same-field date edits within 60s into one entry', async () => {
    const tok = await adminToken();
    const t = await makeTask(tok, 'Gantt task', { dueAt: D0 });

    await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ dueAt: D1, coalesceHistory: true });
    await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ dueAt: D2, coalesceHistory: true });

    const dueEntries = (await history(tok, t.id)).filter((e) => e.field === 'dueAt');
    assert.equal(dueEntries.length, 1, 'the two drags collapse into a single entry');
    assert.equal(
      dueEntries[0]!.previousValue,
      new Date(D0).toISOString(),
      'keeps the true before value',
    );
    assert.equal(dueEntries[0]!.newValue, new Date(D2).toISOString(), 'reflects the latest value');
  });

  it('does not coalesce across different fields', async () => {
    const tok = await adminToken();
    const t = await makeTask(tok, 'Gantt two fields', { dueAt: D2 });
    await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ dueAt: D1, coalesceHistory: true });
    await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ startAt: D0, coalesceHistory: true });

    const entries = await history(tok, t.id);
    assert.equal(entries.filter((e) => e.field === 'dueAt').length, 1);
    assert.equal(entries.filter((e) => e.field === 'startAt').length, 1);
  });

  it('starts a fresh entry once the prior one is older than 60s', async () => {
    const tok = await adminToken();
    const t = await makeTask(tok, 'Gantt stale', { dueAt: D0 });
    await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ dueAt: D1, coalesceHistory: true });

    // Backdate the existing dueAt entry beyond the 60s window.
    await prisma.taskHistory.updateMany({
      where: { taskId: t.id, field: 'dueAt' },
      data: { changedAt: new Date(Date.now() - 120_000) },
    });

    await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({ dueAt: D2, coalesceHistory: true });
    const dueEntries = (await history(tok, t.id)).filter((e) => e.field === 'dueAt');
    assert.equal(dueEntries.length, 2, 'a drag past the window starts a new entry');
  });
});

describe('task templates / recurring tasks (Phase 11)', () => {
  // Drive the scheduler deterministically instead of relying on the background
  // timer (which only runs from server.ts, never under tests).
  let runScheduler: (now: Date) => Promise<number>;
  before(async () => {
    ({ runScheduler } = await import('../src/services/scheduler.service.js'));
  });

  const MGR_EMAIL = 'tmgr@test.local';
  const MEM_EMAIL = 'tmem@test.local';
  async function managerToken(): Promise<string> {
    await seedUser({ email: MGR_EMAIL, role: 'Manager', password: MEMBER_PASSWORD });
    return login(MGR_EMAIL, MEMBER_PASSWORD);
  }
  async function memberToken(): Promise<string> {
    await seedUser({ email: MEM_EMAIL, role: 'Member', password: MEMBER_PASSWORD });
    return login(MEM_EMAIL, MEMBER_PASSWORD);
  }

  // A simple two-level template: root "Inspect" (role Inspector) blocks child
  // "Pack" (role Packer); relative offsets in days from the instantiation anchor.
  function twoLevelBody(extra: Record<string, unknown> = {}) {
    return {
      name: 'Shipment intake',
      nodes: [
        {
          key: 'root',
          parentKey: null,
          name: 'Inspect',
          defaultPriority: 'High',
          startOffsetDays: 0,
          dueOffsetDays: 2,
          assigneeRole: 'Inspector',
        },
        {
          key: 'pack',
          parentKey: 'root',
          name: 'Pack',
          startOffsetDays: 2,
          dueOffsetDays: 4,
          assigneeRole: 'Packer',
        },
      ],
      dependencies: [{ blockerKey: 'root', blockedKey: 'pack' }],
      ...extra,
    };
  }

  async function createTemplate(token: string, body: Record<string, unknown>) {
    const res = await request(app).post('/api/templates').set(auth(token)).send(body);
    assert.equal(res.status, 201, `create template failed: ${JSON.stringify(res.body)}`);
    return res.body;
  }

  it('forbids Members from all template management (list/create/instantiate)', async () => {
    const admin = await adminToken();
    const tpl = await createTemplate(admin, twoLevelBody());
    const mem = await memberToken();

    for (const call of [
      request(app).get('/api/templates').set(auth(mem)),
      request(app).post('/api/templates').set(auth(mem)).send(twoLevelBody()),
      request(app).get(`/api/templates/${tpl.id}`).set(auth(mem)),
      request(app)
        .post(`/api/templates/${tpl.id}/instantiate`)
        .set(auth(mem))
        .send({ anchorStart: '2026-08-10T00:00:00.000Z' }),
    ]) {
      const res = await call;
      assert.equal(res.status, 403, 'Members must not access template management');
    }
  });

  it('lets a Manager create a multi-level template with roles and dependencies', async () => {
    const mgr = await managerToken();
    const tpl = await createTemplate(mgr, twoLevelBody());

    const res = await request(app).get(`/api/templates/${tpl.id}`).set(auth(mgr));
    assert.equal(res.status, 200);
    assert.equal(res.body.nodes.length, 2);
    assert.equal(res.body.dependencies.length, 1);
    assert.deepEqual([...res.body.roles].sort(), ['Inspector', 'Packer']);
    const root = res.body.nodes.find((n: { parentNodeId: number | null }) => n.parentNodeId === null);
    assert.ok(root, 'has exactly one root node');
    assert.equal(root.defaultPriority, 'High');
  });

  it('rejects an invalid tree (two roots, and a dependency cycle)', async () => {
    const admin = await adminToken();
    const twoRoots = await request(app)
      .post('/api/templates')
      .set(auth(admin))
      .send({
        name: 'bad',
        nodes: [
          { key: 'a', parentKey: null, name: 'A' },
          { key: 'b', parentKey: null, name: 'B' },
        ],
      });
    assert.equal(twoRoots.status, 400);

    const cycle = await request(app)
      .post('/api/templates')
      .set(auth(admin))
      .send({
        name: 'bad2',
        nodes: [
          { key: 'a', parentKey: null, name: 'A' },
          { key: 'b', parentKey: 'a', name: 'B' },
        ],
        dependencies: [
          { blockerKey: 'a', blockedKey: 'b' },
          { blockerKey: 'b', blockedKey: 'a' },
        ],
      });
    assert.equal(cycle.status, 400);
  });

  it('manually instantiates a real, independent tree with the label prefixed + filterable', async () => {
    const admin = await adminToken();
    const inspector = await seedUser({ email: 'insp@test.local', role: 'Member' });
    const tpl = await createTemplate(admin, twoLevelBody());

    const res = await request(app)
      .post(`/api/templates/${tpl.id}/instantiate`)
      .set(auth(admin))
      .send({
        instanceLabel: 'PO-4521',
        anchorStart: '2026-08-10T00:00:00.000Z',
        roleAssignments: [{ role: 'Inspector', assigneeId: inspector.id }],
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.taskIds.length, 2);

    // Root task: label prefixed onto the name, stored as its own field, dates
    // resolved from the offsets, role resolved to the chosen user.
    const rootRes = await request(app).get(`/api/tasks/${res.body.rootTaskId}`).set(auth(admin));
    assert.equal(rootRes.body.name, 'PO-4521: Inspect');
    assert.equal(rootRes.body.instanceLabel, 'PO-4521');
    assert.equal(rootRes.body.assigneeId, inspector.id);
    assert.equal(rootRes.body.startAt, new Date('2026-08-10T00:00:00.000Z').toISOString());
    assert.equal(rootRes.body.dueAt, new Date('2026-08-12T00:00:00.000Z').toISOString());
    // The child is a real, dependent task under the real parent.
    assert.equal(rootRes.body.children.length, 1);
    assert.equal(rootRes.body.blocks.length, 1, 'root blocks the child (dependency carried through)');

    // Instance label is a filterable attribute, not just baked into the name.
    const q = await request(app)
      .post('/api/tasks/query')
      .set(auth(admin))
      .send({ filters: { instanceLabel: 'PO-4521' } });
    assert.equal(q.body.total, 2, 'both generated tasks match the instance-label filter');
    const none = await request(app)
      .post('/api/tasks/query')
      .set(auth(admin))
      .send({ filters: { instanceLabel: 'ZZZ' } });
    assert.equal(none.body.total, 0);
  });

  it('fixed "every 3 weeks", limit 3 → materializes exactly 3, spaced 3 weeks, then stops', async () => {
    const admin = await adminToken();
    await setLeadDays(0);
    const tpl = await createTemplate(
      admin,
      twoLevelBody({
        recurrence: {
          recurrenceType: 'Fixed',
          intervalCount: 3,
          intervalUnit: 'Week',
          anchorDate: '2026-08-01T00:00:00.000Z',
          endType: 'AfterOccurrences',
          maxOccurrences: 3,
        },
      }),
    );

    const scheduledCount = async (): Promise<number> =>
      prisma.templateOccurrence.count({ where: { templateId: tpl.id, origin: 'scheduled' } });

    await runScheduler(new Date('2026-08-01T00:00:00.000Z'));
    assert.equal(await scheduledCount(), 1);
    await runScheduler(new Date('2026-08-15T00:00:00.000Z')); // before the 3-week mark
    assert.equal(await scheduledCount(), 1, 'no early second occurrence');
    await runScheduler(new Date('2026-08-22T00:00:00.000Z')); // +3 weeks
    assert.equal(await scheduledCount(), 2);
    await runScheduler(new Date('2026-09-12T00:00:00.000Z')); // +6 weeks
    assert.equal(await scheduledCount(), 3);
    await runScheduler(new Date('2026-10-03T00:00:00.000Z')); // +9 weeks → past the limit
    assert.equal(await scheduledCount(), 3, 'stops after the occurrence limit');

    const occ = await prisma.templateOccurrence.findMany({
      where: { templateId: tpl.id, origin: 'scheduled' },
      orderBy: { seq: 'asc' },
    });
    assert.deepEqual(
      occ.map((o) => o.anchorStart.toISOString()),
      [
        '2026-08-01T00:00:00.000Z',
        '2026-08-22T00:00:00.000Z',
        '2026-09-12T00:00:00.000Z',
      ],
      'occurrences are spaced exactly 3 weeks apart',
    );
  });

  it('relative-to-completion only schedules the next occurrence after the prior root completes', async () => {
    const admin = await adminToken();
    await setLeadDays(0);
    const tpl = await createTemplate(
      admin,
      {
        name: 'Relative series',
        nodes: [{ key: 'root', parentKey: null, name: 'Do the thing', dueOffsetDays: 1 }],
        recurrence: {
          recurrenceType: 'RelativeToCompletion',
          intervalCount: 3,
          intervalUnit: 'Day',
          anchorDate: '2026-08-01T00:00:00.000Z',
          endType: 'Never',
        },
      },
    );
    const scheduledCount = async (): Promise<number> =>
      prisma.templateOccurrence.count({ where: { templateId: tpl.id, origin: 'scheduled' } });

    await runScheduler(new Date('2026-08-01T00:00:00.000Z'));
    assert.equal(await scheduledCount(), 1, 'first occurrence fires at the anchor');

    // Long after, but the root is still open → no next occurrence.
    await runScheduler(new Date('2026-08-30T00:00:00.000Z'));
    assert.equal(await scheduledCount(), 1, 'no next occurrence while the prior root is open');

    // Complete the first root, then run past (completedAt + 3 days).
    const first = await prisma.templateOccurrence.findFirst({
      where: { templateId: tpl.id, seq: 1 },
      select: { rootTaskId: true },
    });
    await request(app).patch(`/api/tasks/${first!.rootTaskId}`).set(auth(admin)).send({ status: 'Completed' });
    const root = await prisma.task.findUnique({
      where: { id: first!.rootTaskId! },
      select: { statusChangedAt: true },
    });
    const after = new Date(root!.statusChangedAt!.getTime() + 4 * 24 * 60 * 60 * 1000);
    await runScheduler(after);
    assert.equal(await scheduledCount(), 2, 'the next occurrence is scheduled only after completion');
  });

  it('scheduled occurrences auto-assign the same person(s) as the previous instance', async () => {
    const admin = await adminToken();
    await setLeadDays(0);
    const owner = await seedUser({ email: 'owner@test.local', role: 'Member' });
    const tpl = await createTemplate(
      admin,
      {
        name: 'Owned series',
        nodes: [
          { key: 'root', parentKey: null, name: 'Owned task', assigneeRole: 'Owner', startOffsetDays: 0, dueOffsetDays: 1 },
        ],
        recurrence: {
          recurrenceType: 'Fixed',
          intervalCount: 1,
          intervalUnit: 'Week',
          anchorDate: '2026-08-01T00:00:00.000Z',
          endType: 'AfterOccurrences',
          maxOccurrences: 5,
        },
      },
    );

    // Seed the "previous instance" by manually instantiating with the owner mapped.
    await request(app)
      .post(`/api/templates/${tpl.id}/instantiate`)
      .set(auth(admin))
      .send({ anchorStart: '2026-07-01T00:00:00.000Z', roleAssignments: [{ role: 'Owner', assigneeId: owner.id }] });

    // The next scheduled fire carries the owner forward automatically.
    await runScheduler(new Date('2026-08-01T00:00:00.000Z'));
    const seq1 = await prisma.templateOccurrence.findFirst({
      where: { templateId: tpl.id, seq: 1 },
      include: { rootTask: { select: { assigneeId: true } } },
    });
    assert.equal(seq1?.rootTask?.assigneeId, owner.id, 'the scheduled root reuses the prior assignee');
  });

  it('computes fixed-schedule ghosts (not persisted) and none for relative-to-completion', async () => {
    const admin = await adminToken();
    const fixed = await createTemplate(
      admin,
      twoLevelBody({
        recurrence: {
          recurrenceType: 'Fixed',
          intervalCount: 2,
          intervalUnit: 'Week',
          anchorDate: '2026-08-01T00:00:00.000Z',
          endType: 'AfterOccurrences',
          maxOccurrences: 4,
        },
      }),
    );

    const ghosts = await request(app).get(`/api/templates/${fixed.id}/ghosts`).set(auth(admin));
    assert.equal(ghosts.status, 200);
    assert.equal(ghosts.body.length, 4, 'all four bounded occurrences are previewed as ghosts');
    assert.equal(ghosts.body[0].seq, 1);
    assert.equal(ghosts.body[0].sourceType, 'template');
    assert.equal(ghosts.body[0].startAt, new Date('2026-08-01T00:00:00.000Z').toISOString());
    // Ghosts are computed, never rows.
    assert.equal(await prisma.templateOccurrence.count({ where: { templateId: fixed.id } }), 0);

    const rel = await createTemplate(admin, {
      name: 'Relative',
      nodes: [{ key: 'root', parentKey: null, name: 'R', dueOffsetDays: 1 }],
      recurrence: {
        recurrenceType: 'RelativeToCompletion',
        intervalCount: 3,
        intervalUnit: 'Day',
        anchorDate: '2026-08-01T00:00:00.000Z',
        endType: 'Never',
      },
    });
    const relGhosts = await request(app).get(`/api/templates/${rel.id}/ghosts`).set(auth(admin));
    assert.deepEqual(relGhosts.body, [], 'relative-to-completion has no computable future ghosts');
  });

  it('materializes a ghost on click-through and it stops appearing as a ghost', async () => {
    const admin = await adminToken();
    const tpl = await createTemplate(
      admin,
      twoLevelBody({
        recurrence: {
          recurrenceType: 'Fixed',
          intervalCount: 1,
          intervalUnit: 'Month',
          anchorDate: '2026-08-01T00:00:00.000Z',
          endType: 'AfterOccurrences',
          maxOccurrences: 3,
        },
      }),
    );

    const res = await request(app)
      .post(`/api/templates/${tpl.id}/materialize`)
      .set(auth(admin))
      .send({ seq: 2 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.occurrence.seq, 2);
    assert.ok(res.body.rootTaskId);

    const ghosts = await request(app).get(`/api/templates/${tpl.id}/ghosts`).set(auth(admin));
    const seqs = ghosts.body.map((g: { seq: number }) => g.seq);
    assert.deepEqual(seqs.sort(), [1, 3], 'the materialized seq 2 is no longer a ghost');

    // Re-materializing the same seq is rejected.
    const dup = await request(app)
      .post(`/api/templates/${tpl.id}/materialize`)
      .set(auth(admin))
      .send({ seq: 2 });
    assert.equal(dup.status, 409);
  });

  it('"this and following": ghosts reflect edits live, and future instances update only on confirm', async () => {
    const admin = await adminToken();
    const tpl = await createTemplate(
      admin,
      twoLevelBody({
        recurrence: {
          recurrenceType: 'Fixed',
          intervalCount: 1,
          intervalUnit: 'Week',
          anchorDate: '2026-08-01T00:00:00.000Z',
          endType: 'AfterOccurrences',
          maxOccurrences: 4,
        },
      }),
    );
    const full = await request(app).get(`/api/templates/${tpl.id}`).set(auth(admin));
    const nodes = full.body.nodes as { id: number; parentNodeId: number | null; name: string }[];
    const rootId = nodes.find((n) => n.parentNodeId === null)!.id;
    const childId = nodes.find((n) => n.parentNodeId !== null)!.id;

    // Materialize seq 1 (a future, not-yet-started instance).
    await request(app).post(`/api/templates/${tpl.id}/materialize`).set(auth(admin)).send({ seq: 1 });

    // Edit the template: rename + re-prioritize the root ("this and following").
    const editRes = await request(app)
      .patch(`/api/templates/${tpl.id}`)
      .set(auth(admin))
      .send({
        nodes: [
          {
            id: rootId,
            key: 'root',
            parentKey: null,
            name: 'Inspect carefully',
            defaultPriority: 'Urgent',
            startOffsetDays: 0,
            dueOffsetDays: 2,
            assigneeRole: 'Inspector',
          },
          {
            id: childId,
            key: 'pack',
            parentKey: 'root',
            name: 'Pack',
            startOffsetDays: 2,
            dueOffsetDays: 4,
            assigneeRole: 'Packer',
          },
        ],
        dependencies: [{ blockerKey: 'root', blockedKey: 'pack' }],
      });
    assert.equal(editRes.status, 200, JSON.stringify(editRes.body));

    // Future ghosts recompute automatically — no extra work needed.
    const ghosts = await request(app).get(`/api/templates/${tpl.id}/ghosts`).set(auth(admin));
    assert.ok(
      ghosts.body.every((g: { name: string }) => g.name === 'Inspect carefully'),
      'ghosts reflect the edited template live',
    );

    // The already-materialized future instance is NOT auto-updated; it is offered
    // for an explicit confirm, then re-synced.
    const future = await request(app).get(`/api/templates/${tpl.id}/future`).set(auth(admin));
    assert.equal(future.body.length, 1, 'the materialized, not-yet-done instance is listed');
    const occId = future.body[0].occurrenceId;

    const rootTaskId = future.body[0].rootTaskId;
    const beforeApply = await request(app).get(`/api/tasks/${rootTaskId}`).set(auth(admin));
    assert.equal(beforeApply.body.name, 'Inspect', 'not silently rewritten before confirming');

    const apply = await request(app)
      .post(`/api/templates/${tpl.id}/apply-to-future`)
      .set(auth(admin))
      .send({ occurrenceIds: [occId] });
    assert.equal(apply.status, 200);
    assert.equal(apply.body.updatedOccurrences, 1);

    const afterApply = await request(app).get(`/api/tasks/${rootTaskId}`).set(auth(admin));
    assert.equal(afterApply.body.name, 'Inspect carefully', 'confirmed re-sync updates the task');
    assert.equal(afterApply.body.priority, 'Urgent');
  });

  it('never rewrites a completed instance when applying template edits', async () => {
    const admin = await adminToken();
    const tpl = await createTemplate(admin, {
      name: 'Single',
      nodes: [{ key: 'root', parentKey: null, name: 'Original', defaultPriority: 'Low', dueOffsetDays: 1 }],
    });
    const inst = await request(app)
      .post(`/api/templates/${tpl.id}/instantiate`)
      .set(auth(admin))
      .send({ anchorStart: '2026-08-10T00:00:00.000Z' });
    const rootTaskId = inst.body.rootTaskId;
    const occId = inst.body.occurrence.id;

    await request(app).patch(`/api/tasks/${rootTaskId}`).set(auth(admin)).send({ status: 'Completed' });

    // A completed occurrence is excluded from the future list...
    const future = await request(app).get(`/api/templates/${tpl.id}/future`).set(auth(admin));
    assert.equal(future.body.length, 0, 'completed instances are not offered for update');

    // ...and even a forced apply leaves the completed task untouched.
    const full = await request(app).get(`/api/templates/${tpl.id}`).set(auth(admin));
    const rootNodeId = full.body.nodes[0].id;
    await request(app)
      .patch(`/api/templates/${tpl.id}`)
      .set(auth(admin))
      .send({ nodes: [{ id: rootNodeId, key: 'root', parentKey: null, name: 'Changed', defaultPriority: 'Urgent', dueOffsetDays: 1 }] });
    await request(app)
      .post(`/api/templates/${tpl.id}/apply-to-future`)
      .set(auth(admin))
      .send({ occurrenceIds: [occId] });

    const task = await request(app).get(`/api/tasks/${rootTaskId}`).set(auth(admin));
    assert.equal(task.body.name, 'Original', 'past/completed work is never rewritten');
    assert.equal(task.body.priority, 'Low');
  });
});

describe('task-level recurrence (Phase 11)', () => {
  let runScheduler: (now: Date) => Promise<number>;
  before(async () => {
    ({ runScheduler } = await import('../src/services/scheduler.service.js'));
  });
  // Lead time is global now; these tests want immediate materialization.
  beforeEach(() => setLeadDays(0));

  async function memberToken(email: string): Promise<string> {
    await seedUser({ email, role: 'Member', password: MEMBER_PASSWORD });
    return login(email, MEMBER_PASSWORD);
  }

  const setRecurrence = (token: string, taskId: number, body: Record<string, unknown>) =>
    request(app).put(`/api/tasks/${taskId}/recurrence`).set(auth(token)).send(body);

  it('lets a Member set a regular task to recur AND see its ghosts', async () => {
    const mem = await memberToken('rec-mem@test.local');
    const t = await makeTask(mem, 'Weekly standup', {
      startAt: '2026-08-01T09:00:00.000Z',
      dueAt: '2026-08-01T10:00:00.000Z',
    });

    const set = await setRecurrence(mem, t.id, {
      recurrenceType: 'Fixed',
      intervalCount: 1,
      intervalUnit: 'Week',
      endType: 'AfterOccurrences',
      maxOccurrences: 6,
    });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.ok(set.body.recurrence, 'the task now carries a recurrence rule');
    assert.equal(set.body.recurrence.recurrenceType, 'Fixed');

    const ghosts = await request(app).get('/api/tasks/ghosts').set(auth(mem));
    assert.equal(ghosts.status, 200);
    const mine = ghosts.body.filter((g: { sourceId: number }) => g.sourceId === t.id);
    assert.equal(mine.length, 5, 'seq 2..6 are ghosts (the source task is occurrence #1)');
    assert.equal(mine[0].sourceType, 'task');
    // Ghosts are computed, never persisted rows.
    assert.equal(await prisma.task.count({ where: { recurrenceSourceId: t.id } }), 0);
  });

  it('requires a start or due date before a task can recur', async () => {
    const admin = await adminToken();
    const t = await makeTask(admin, 'No dates');
    const res = await setRecurrence(admin, t.id, {
      recurrenceType: 'Fixed',
      intervalCount: 1,
      intervalUnit: 'Week',
    });
    assert.equal(res.status, 400);
  });

  it('scheduler materializes due occurrences and carries the assignee forward', async () => {
    const admin = await adminToken();
    const owner = await seedUser({ email: 'rec-owner@test.local', role: 'Member' });
    const t = await makeTask(admin, 'Recurring job', {
      startAt: '2026-08-01T00:00:00.000Z',
      dueAt: '2026-08-01T02:00:00.000Z',
      assigneeId: owner.id,
    });
    await setRecurrence(admin, t.id, {
      recurrenceType: 'Fixed',
      intervalCount: 1,
      intervalUnit: 'Week',
      endType: 'AfterOccurrences',
      maxOccurrences: 4,
    });

    await runScheduler(new Date('2026-08-08T00:00:00.000Z')); // seq 2 is due (+1 week)
    const occ = await prisma.task.findFirst({
      where: { recurrenceSourceId: t.id, recurrenceSeq: 2 },
    });
    assert.ok(occ, 'the +1 week occurrence was materialized');
    assert.equal(occ!.assigneeId, owner.id, 'the assignee is carried forward from the prior instance');
    assert.equal(occ!.startAt?.toISOString(), '2026-08-08T00:00:00.000Z', 'dates shift by one interval');
    assert.equal(occ!.dueAt?.toISOString(), '2026-08-08T02:00:00.000Z');
    // seq 3 (+2 weeks) is not yet due.
    assert.equal(await prisma.task.count({ where: { recurrenceSourceId: t.id } }), 1);
  });

  it('relative-to-completion schedules the next only after the prior instance completes', async () => {
    const admin = await adminToken();
    const t = await makeTask(admin, 'Relative job', { dueAt: '2026-08-01T00:00:00.000Z' });
    await setRecurrence(admin, t.id, {
      recurrenceType: 'RelativeToCompletion',
      intervalCount: 3,
      intervalUnit: 'Day',
    });

    await runScheduler(new Date('2026-08-30T00:00:00.000Z')); // source still open
    assert.equal(await prisma.task.count({ where: { recurrenceSourceId: t.id } }), 0, 'nothing while open');

    await request(app).patch(`/api/tasks/${t.id}`).set(auth(admin)).send({ status: 'Completed' });
    const src = await prisma.task.findUnique({ where: { id: t.id }, select: { statusChangedAt: true } });
    await runScheduler(new Date(src!.statusChangedAt!.getTime() + 4 * 24 * 60 * 60 * 1000));
    assert.equal(
      await prisma.task.count({ where: { recurrenceSourceId: t.id } }),
      1,
      'the next instance is scheduled only after completion',
    );
  });

  it('materializes a task ghost on click-through and it stops being a ghost', async () => {
    const admin = await adminToken();
    const t = await makeTask(admin, 'Monthly report', {
      startAt: '2026-08-01T00:00:00.000Z',
      dueAt: '2026-08-01T01:00:00.000Z',
    });
    await setRecurrence(admin, t.id, {
      recurrenceType: 'Fixed',
      intervalCount: 1,
      intervalUnit: 'Month',
      endType: 'AfterOccurrences',
      maxOccurrences: 3,
    });

    const res = await request(app)
      .post(`/api/tasks/${t.id}/recurrence/materialize`)
      .set(auth(admin))
      .send({ seq: 2 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.recurrenceSeq, 2);
    assert.equal(res.body.recurrenceSourceId, t.id);
    assert.equal(res.body.startAt, '2026-09-01T00:00:00.000Z', 'one month after the source start');

    const ghosts = await request(app).get('/api/tasks/ghosts').set(auth(admin));
    const seqs = ghosts.body
      .filter((g: { sourceId: number }) => g.sourceId === t.id)
      .map((g: { seq: number }) => g.seq)
      .sort();
    assert.deepEqual(seqs, [3], 'seq 2 is now a real task; only seq 3 remains a ghost');

    const dup = await request(app)
      .post(`/api/tasks/${t.id}/recurrence/materialize`)
      .set(auth(admin))
      .send({ seq: 2 });
    assert.equal(dup.status, 409);
  });

  it('weekly "repeat on" generates occurrences only on the selected weekdays', async () => {
    const admin = await adminToken();
    const t = await makeTask(admin, 'Standup', {
      startAt: '2026-08-03T09:00:00.000Z',
      dueAt: '2026-08-03T09:30:00.000Z',
    });
    await setRecurrence(admin, t.id, {
      recurrenceType: 'Fixed',
      intervalCount: 1,
      intervalUnit: 'Week',
      weekdays: [1, 3], // Monday & Wednesday
      endType: 'AfterOccurrences',
      maxOccurrences: 6,
    });

    const ghosts = await request(app).get('/api/tasks/ghosts').set(auth(admin));
    const mine = ghosts.body.filter((g: { sourceId: number }) => g.sourceId === t.id);
    assert.equal(mine.length, 5, 'seq 2..6 are ghosts (seq 1 is the source task)');
    for (const g of mine as { startAt: string; dueAt: string }[]) {
      const wd = new Date(g.startAt).getUTCDay();
      assert.ok([1, 3].includes(wd), `ghost weekday ${wd} should be Mon(1) or Wed(3)`);
      // The 30-minute span is preserved on each occurrence.
      assert.equal(new Date(g.dueAt).getTime() - new Date(g.startAt).getTime(), 30 * 60 * 1000);
    }
  });
});

describe('task duplication (Phase 11 follow-on)', () => {
  it('duplicates a single task as a fresh copy (status reset, no descendants)', async () => {
    const tok = await adminToken();
    const t = await makeTask(tok, 'Original', { priority: 'High', tags: ['x'], dueAt: '2026-09-01T00:00:00.000Z' });
    await request(app).patch(`/api/tasks/${t.id}`).set(auth(tok)).send({ status: 'InProgress' });

    const res = await request(app)
      .post(`/api/tasks/${t.id}/duplicate`)
      .set(auth(tok))
      .send({ includeDescendants: false });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.notEqual(res.body.id, t.id);
    assert.equal(res.body.name, 'Original');
    assert.equal(res.body.priority, 'High');
    assert.deepEqual(res.body.tags, ['x']);
    assert.equal(res.body.status, 'Open', 'a copy starts fresh');
    assert.equal(res.body.children.length, 0);
  });

  it('duplicates a whole sub-tree with internal dependencies remapped', async () => {
    const tok = await adminToken();
    const parent = await makeTask(tok, 'Parent');
    const child = await makeTask(tok, 'Child');
    await request(app).put(`/api/tasks/${child.id}/parent`).set(auth(tok)).send({ parentId: parent.id });
    await request(app)
      .post(`/api/tasks/${parent.id}/dependencies`)
      .set(auth(tok))
      .send({ type: 'blocks', otherTaskId: child.id });

    const res = await request(app)
      .post(`/api/tasks/${parent.id}/duplicate`)
      .set(auth(tok))
      .send({ includeDescendants: true });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.notEqual(res.body.id, parent.id);
    assert.equal(res.body.children.length, 1, 'the sub-tree is cloned');
    const newChildId = res.body.children[0].id as number;
    assert.notEqual(newChildId, child.id);
    // The internal dependency is carried onto the copies (not the originals).
    assert.equal(res.body.blocks.length, 1);
    assert.equal(res.body.blocks[0].id, newChildId);

    const newChild = await request(app).get(`/api/tasks/${newChildId}`).set(auth(tok));
    assert.equal(newChild.body.parentId, res.body.id, 'the child copy hangs off the new root');

    // Duplicating just the parent (no descendants) leaves the copy childless.
    const solo = await request(app)
      .post(`/api/tasks/${parent.id}/duplicate`)
      .set(auth(tok))
      .send({ includeDescendants: false });
    assert.equal(solo.body.children.length, 0);
  });

  it('copies task attachments to independent blobs only when copyAttachments is set', async () => {
    const tok = await adminToken();
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const t = await makeTask(tok, 'WithFile');
    const srcKey = `tasks/${t.id}/seed-uuid/report.pdf`;
    memoryStorage.__put(srcKey, { size: 1234, contentType: 'application/pdf' });
    await prisma.attachment.create({
      data: {
        filename: 'report.pdf',
        contentType: 'application/pdf',
        size: 1234,
        storageKey: srcKey,
        uploadedById: admin.id,
        taskId: t.id,
      },
    });

    // Default (flag omitted): attachments are NOT copied.
    const noCopy = await request(app).post(`/api/tasks/${t.id}/duplicate`).set(auth(tok)).send({});
    assert.equal(noCopy.status, 201, JSON.stringify(noCopy.body));
    const noCopyAtt = await prisma.attachment.findMany({ where: { taskId: noCopy.body.id } });
    assert.equal(noCopyAtt.length, 0, 'attachments not copied by default');

    // With the flag: cloned to a fresh, independent storage key + blob.
    const copy = await request(app)
      .post(`/api/tasks/${t.id}/duplicate`)
      .set(auth(tok))
      .send({ copyAttachments: true });
    assert.equal(copy.status, 201, JSON.stringify(copy.body));
    const copied = await prisma.attachment.findMany({ where: { taskId: copy.body.id } });
    assert.equal(copied.length, 1, 'attachment cloned');
    assert.equal(copied[0].filename, 'report.pdf');
    assert.notEqual(copied[0].storageKey, srcKey, 'the copy gets its own storage key');
    assert.ok(copied[0].storageKey.startsWith(`tasks/${copy.body.id}/`), 'key namespaced to new task');
    assert.ok(await memoryStorage.headObject(copied[0].storageKey), 'blob copied into storage');
    assert.ok(await memoryStorage.headObject(srcKey), 'original blob untouched');
  });
});

describe('SMART goals: lifecycle & authorization (Phase 12)', () => {
  const SUP_PW = 'SupPass123!';
  const EMP_PW = 'EmpPass123!';

  // The scheduler's goal-review pass moves Active goals past their deadline to
  // Under Review; import it so the deadline tests can drive it deterministically.
  let runScheduler: (now: Date) => Promise<number>;
  before(async () => {
    ({ runScheduler } = await import('../src/services/scheduler.service.js'));
  });

  // A supervisor (Manager) + one direct report, a second unrelated supervisor +
  // report (to prove visibility/authority isolation), and their tokens.
  async function seedTeam() {
    const supervisor = await seedUser({ email: 'sup@test.local', role: 'Manager', password: SUP_PW });
    const employee = await seedUser({
      email: 'emp@test.local',
      role: 'Member',
      password: EMP_PW,
      supervisorId: supervisor.id,
    });
    const otherSup = await seedUser({ email: 'sup2@test.local', role: 'Manager', password: SUP_PW });
    const otherEmp = await seedUser({
      email: 'emp2@test.local',
      role: 'Member',
      password: EMP_PW,
      supervisorId: otherSup.id,
    });
    return {
      supervisor,
      employee,
      otherSup,
      otherEmp,
      supToken: await login('sup@test.local', SUP_PW),
      empToken: await login('emp@test.local', EMP_PW),
      otherSupToken: await login('sup2@test.local', SUP_PW),
      otherEmpToken: await login('emp2@test.local', EMP_PW),
    };
  }

  const validGoal = (extra: Record<string, unknown> = {}) => ({
    specific: 'Cut order-picking errors',
    metricType: 'Percentage',
    targetValue: 2,
    deadline: '2026-12-31T00:00:00.000Z',
    ...extra,
  });

  async function createGoal(token: string, body: Record<string, unknown> = {}) {
    const res = await request(app).post('/api/goals').set(auth(token)).send(validGoal(body));
    assert.equal(res.status, 201, `create goal failed: ${JSON.stringify(res.body)}`);
    return res.body as { id: number; status: string; [k: string]: unknown };
  }

  const post = (token: string, path: string, body?: unknown) =>
    request(app).post(path).set(auth(token)).send(body ?? {});

  it('runs the full Draft→PendingApproval→Approved→UnderReview→Resolved happy path', async () => {
    const t = await seedTeam();
    const goal = await createGoal(t.empToken);
    assert.equal(goal.status, 'Draft');
    assert.equal((goal as { ownerId: string }).ownerId, t.employee.id);

    // Employee submits for approval.
    const submitted = await post(t.empToken, `/api/goals/${goal.id}/submit`);
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.status, 'PendingApproval');
    assert.ok(submitted.body.submittedAt);

    // Supervisor approves → Active.
    const approved = await post(t.supToken, `/api/goals/${goal.id}/approve`);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, 'Approved');
    assert.equal(approved.body.approvedById, t.supervisor.id);

    // Employee records results + notes while Active.
    const progress = await request(app)
      .patch(`/api/goals/${goal.id}/progress`)
      .set(auth(t.empToken))
      .send({ resultValue: 1.5, notes: 'Halfway there' });
    assert.equal(progress.status, 200);
    assert.equal(progress.body.resultValue, 1.5);
    assert.equal(progress.body.notes, 'Halfway there');

    // Employee marks results final → Under Review.
    const finalized = await post(t.empToken, `/api/goals/${goal.id}/finalize`);
    assert.equal(finalized.status, 200);
    assert.equal(finalized.body.status, 'UnderReview');
    assert.ok(finalized.body.resultsFinalizedAt);

    // Supervisor resolves with a verdict + comments → Resolved (terminal).
    const resolved = await post(t.supToken, `/api/goals/${goal.id}/resolve`, {
      resolution: 'Met',
      supervisorComments: 'Solid improvement.',
    });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.status, 'Resolved');
    assert.equal(resolved.body.resolution, 'Met');
    assert.equal(resolved.body.supervisorComments, 'Solid improvement.');
    assert.equal(resolved.body.resolvedById, t.supervisor.id);
  });

  it('lets a supervisor draft a goal for a direct report, but not for a non-report', async () => {
    const t = await seedTeam();
    const forReport = await request(app)
      .post('/api/goals')
      .set(auth(t.supToken))
      .send(validGoal({ ownerId: t.employee.id }));
    assert.equal(forReport.status, 201);
    assert.equal(forReport.body.ownerId, t.employee.id);
    assert.equal(forReport.body.createdById, t.supervisor.id);

    const forStranger = await request(app)
      .post('/api/goals')
      .set(auth(t.supToken))
      .send(validGoal({ ownerId: t.otherEmp.id }));
    assert.equal(forStranger.status, 403);
  });

  it('allows ONLY the supervisor (or admin) to approve — not the employee or another manager', async () => {
    const t = await seedTeam();
    const goal = await createGoal(t.empToken);
    await post(t.empToken, `/api/goals/${goal.id}/submit`);

    // Employee cannot approve their own goal.
    assert.equal((await post(t.empToken, `/api/goals/${goal.id}/approve`)).status, 403);
    // A manager who is NOT this employee's supervisor cannot approve.
    assert.equal((await post(t.otherSupToken, `/api/goals/${goal.id}/approve`)).status, 403);
    // The direct supervisor can.
    assert.equal((await post(t.supToken, `/api/goals/${goal.id}/approve`)).status, 200);
  });

  it('allows ONLY the supervisor (or admin) to resolve — not the employee or another manager', async () => {
    const t = await seedTeam();
    const goal = await createGoal(t.empToken);
    await post(t.empToken, `/api/goals/${goal.id}/submit`);
    await post(t.supToken, `/api/goals/${goal.id}/approve`);
    await post(t.empToken, `/api/goals/${goal.id}/finalize`);

    const resolveBody = { resolution: 'Met', supervisorComments: 'ok' };
    assert.equal((await post(t.empToken, `/api/goals/${goal.id}/resolve`, resolveBody)).status, 403);
    assert.equal((await post(t.otherSupToken, `/api/goals/${goal.id}/resolve`, resolveBody)).status, 403);
    assert.equal((await post(t.supToken, `/api/goals/${goal.id}/resolve`, resolveBody)).status, 200);
  });

  it('rejects a Pending goal back to Draft with required comments, then allows edit & resubmit', async () => {
    const t = await seedTeam();
    const goal = await createGoal(t.empToken);
    await post(t.empToken, `/api/goals/${goal.id}/submit`);

    // Rejection comments are required.
    const empty = await post(t.supToken, `/api/goals/${goal.id}/reject`, { comments: '   ' });
    assert.equal(empty.status, 400);

    // The employee cannot reject their own goal (supervisor-only action).
    assert.equal(
      (await post(t.empToken, `/api/goals/${goal.id}/reject`, { comments: 'no' })).status,
      403,
    );

    const rejected = await post(t.supToken, `/api/goals/${goal.id}/reject`, {
      comments: 'Target is too easy — aim for 1%.',
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.status, 'Draft');
    assert.equal(rejected.body.rejectionComments, 'Target is too easy — aim for 1%.');

    // Employee edits and resubmits.
    const edited = await request(app)
      .patch(`/api/goals/${goal.id}`)
      .set(auth(t.empToken))
      .send({ targetValue: 1 });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.targetValue, 1);

    const resubmitted = await post(t.empToken, `/api/goals/${goal.id}/submit`);
    assert.equal(resubmitted.status, 200);
    assert.equal(resubmitted.body.status, 'PendingApproval');

    // Approval clears the stale rejection reason.
    const approved = await post(t.supToken, `/api/goals/${goal.id}/approve`);
    assert.equal(approved.body.rejectionComments, null);
  });

  it('lets the employee update Results/Notes/Risks/Mitigations while Active, but NOT once Resolved', async () => {
    const t = await seedTeam();
    const goal = await createGoal(t.empToken);
    await post(t.empToken, `/api/goals/${goal.id}/submit`);
    await post(t.supToken, `/api/goals/${goal.id}/approve`);

    // Active: allowed.
    const active = await request(app)
      .patch(`/api/goals/${goal.id}/progress`)
      .set(auth(t.empToken))
      .send({ resultValue: 1, risks: 'Staffing', mitigations: 'Cross-train' });
    assert.equal(active.status, 200);
    assert.equal(active.body.risks, 'Staffing');
    assert.equal(active.body.mitigations, 'Cross-train');

    // Drive it to Resolved.
    await post(t.empToken, `/api/goals/${goal.id}/finalize`);
    await post(t.supToken, `/api/goals/${goal.id}/resolve`, {
      resolution: 'Met',
      supervisorComments: 'Done.',
    });

    // Resolved is terminal: every edit path is rejected.
    assert.equal(
      (
        await request(app)
          .patch(`/api/goals/${goal.id}/progress`)
          .set(auth(t.empToken))
          .send({ resultValue: 99 })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(app)
          .patch(`/api/goals/${goal.id}`)
          .set(auth(t.empToken))
          .send({ notes: 'late edit' })
      ).status,
      409,
    );
    // And it cannot be resolved again.
    assert.equal(
      (await post(t.supToken, `/api/goals/${goal.id}/resolve`, { resolution: 'Missed', supervisorComments: 'x' }))
        .status,
      409,
    );
  });

  it('auto-moves an Active goal to Under Review when its deadline passes (scheduler)', async () => {
    const t = await seedTeam();
    // Deadline in the near future; approve while it is still ahead.
    const goal = await createGoal(t.empToken, { deadline: '2026-08-10T00:00:00.000Z' });
    await post(t.empToken, `/api/goals/${goal.id}/submit`);
    await post(t.supToken, `/api/goals/${goal.id}/approve`);

    // A tick BEFORE the deadline leaves it Active.
    await runScheduler(new Date('2026-08-09T00:00:00.000Z'));
    let current = await request(app).get(`/api/goals/${goal.id}`).set(auth(t.empToken));
    assert.equal(current.body.status, 'Approved');

    // A tick AFTER the deadline flips it to Under Review (with no resultsFinalizedAt,
    // distinguishing the deadline trigger from an employee finalize).
    await runScheduler(new Date('2026-08-11T00:00:00.000Z'));
    current = await request(app).get(`/api/goals/${goal.id}`).set(auth(t.empToken));
    assert.equal(current.body.status, 'UnderReview');
    assert.ok(current.body.underReviewAt);
    assert.equal(current.body.resultsFinalizedAt, null);
  });

  it('honors whichever-comes-first: an employee finalize before the deadline wins, deadline is a no-op after', async () => {
    const t = await seedTeam();
    const goal = await createGoal(t.empToken, { deadline: '2026-08-10T00:00:00.000Z' });
    await post(t.empToken, `/api/goals/${goal.id}/submit`);
    await post(t.supToken, `/api/goals/${goal.id}/approve`);

    // Employee marks final BEFORE the deadline → Under Review now.
    const finalized = await post(t.empToken, `/api/goals/${goal.id}/finalize`);
    assert.equal(finalized.body.status, 'UnderReview');
    assert.ok(finalized.body.resultsFinalizedAt);
    const firstUnderReviewAt = finalized.body.underReviewAt;

    // A later deadline-crossing tick must NOT touch it (already left Approved),
    // so underReviewAt stays the finalize time.
    await runScheduler(new Date('2026-08-11T00:00:00.000Z'));
    const current = await request(app).get(`/api/goals/${goal.id}`).set(auth(t.empToken));
    assert.equal(current.body.status, 'UnderReview');
    assert.equal(current.body.underReviewAt, firstUnderReviewAt);

    // And once Under Review, the employee can no longer finalize again.
    assert.equal((await post(t.empToken, `/api/goals/${goal.id}/finalize`)).status, 409);
  });

  it('scopes Team Goals to a supervisor\'s OWN direct reports only (admin sees all)', async () => {
    const t = await seedTeam();
    // A goal for each employee under their own supervisor.
    const mine = await createGoal(t.empToken);
    const theirs = await createGoal(t.otherEmpToken);

    // Supervisor sees only their report's goal.
    const supTeam = await post(t.supToken, '/api/goals/team');
    assert.equal(supTeam.status, 200);
    const supIds = (supTeam.body as { id: number; ownerId: string }[]).map((g) => g.id);
    assert.deepEqual(supIds, [mine.id]);
    assert.ok(!supIds.includes(theirs.id), 'must not see another team\'s goal');

    // The other supervisor sees only their own report's goal.
    const otherTeam = await post(t.otherSupToken, '/api/goals/team');
    assert.deepEqual((otherTeam.body as { id: number }[]).map((g) => g.id), [theirs.id]);

    // Admin sees both.
    const admin = await adminToken();
    const adminTeam = await post(admin, '/api/goals/team');
    const adminIds = (adminTeam.body as { id: number }[]).map((g) => g.id).sort((a, b) => a - b);
    assert.deepEqual(adminIds, [mine.id, theirs.id].sort((a, b) => a - b));
  });

  it('filters Team Goals by employee, status, and deadline range', async () => {
    const t = await seedTeam();
    // Second report under the same supervisor.
    const emp3 = await seedUser({
      email: 'emp3@test.local',
      role: 'Member',
      password: EMP_PW,
      supervisorId: t.supervisor.id,
    });
    const emp3Token = await login('emp3@test.local', EMP_PW);

    const g1 = await createGoal(t.empToken, { deadline: '2026-09-01T00:00:00.000Z' });
    const g2 = await createGoal(emp3Token, { deadline: '2026-12-01T00:00:00.000Z' });
    // Approve g2 so we can filter by status.
    await post(emp3Token, `/api/goals/${g2.id}/submit`);
    await post(t.supToken, `/api/goals/${g2.id}/approve`);

    // Filter by employee.
    const byEmp = await post(t.supToken, '/api/goals/team', { filters: { ownerIds: [emp3.id] } });
    assert.deepEqual((byEmp.body as { id: number }[]).map((g) => g.id), [g2.id]);

    // Filter by status.
    const byStatus = await post(t.supToken, '/api/goals/team', { filters: { statuses: ['Approved'] } });
    assert.deepEqual((byStatus.body as { id: number }[]).map((g) => g.id), [g2.id]);

    // Filter by deadline range (only g1's Sept deadline falls before Oct).
    const byRange = await post(t.supToken, '/api/goals/team', {
      filters: { deadlineTo: '2026-10-01T00:00:00.000Z' },
    });
    assert.deepEqual((byRange.body as { id: number }[]).map((g) => g.id), [g1.id]);

    // A supervisor cannot widen the ownerIds filter past their reports.
    const tryStranger = await post(t.supToken, '/api/goals/team', {
      filters: { ownerIds: [t.otherEmp.id] },
    });
    assert.deepEqual(tryStranger.body, []);
  });

  it('enforces My Goals = only the caller\'s own goals, across all statuses', async () => {
    const t = await seedTeam();
    const a = await createGoal(t.empToken);
    await createGoal(t.otherEmpToken); // belongs to someone else

    const mine = await request(app).get('/api/goals/mine').set(auth(t.empToken));
    assert.equal(mine.status, 200);
    assert.deepEqual((mine.body as { id: number; ownerId: string }[]).map((g) => g.id), [a.id]);
    assert.ok((mine.body as { ownerId: string }[]).every((g) => g.ownerId === t.employee.id));
  });

  it('hides a goal from users who are neither owner, supervisor, nor admin', async () => {
    const t = await seedTeam();
    const goal = await createGoal(t.empToken);
    // Unrelated employee cannot read it.
    assert.equal(
      (await request(app).get(`/api/goals/${goal.id}`).set(auth(t.otherEmpToken))).status,
      403,
    );
    // Unrelated manager cannot read it.
    assert.equal(
      (await request(app).get(`/api/goals/${goal.id}`).set(auth(t.otherSupToken))).status,
      403,
    );
    // Owner and supervisor can.
    assert.equal((await request(app).get(`/api/goals/${goal.id}`).set(auth(t.empToken))).status, 200);
    assert.equal((await request(app).get(`/api/goals/${goal.id}`).set(auth(t.supToken))).status, 200);
  });

  it('requires a unit label for a custom (Other) metric', async () => {
    const t = await seedTeam();
    const missing = await request(app)
      .post('/api/goals')
      .set(auth(t.empToken))
      .send(validGoal({ metricType: 'Other', unitLabel: '' }));
    assert.equal(missing.status, 400);

    const ok = await request(app)
      .post('/api/goals')
      .set(auth(t.empToken))
      .send(validGoal({ metricType: 'Other', unitLabel: 'pallets' }));
    assert.equal(ok.status, 201);
    assert.equal(ok.body.unitLabel, 'pallets');
  });
});

// Retroactive coverage for the trickiest Phase 10 & 11 business rules that were
// built before the "tests required" process rule existed. These target the
// specific gaps not already exercised elsewhere in this file: multi-blocker
// naming on the Kanban drag path, the template parent/child ANCESTRY cycle
// (distinct from the dependency-cycle test above), and materialize-exactly-once
// across BOTH triggers (a click-through vs. the scheduler racing on one seq).
describe('Phase 10 & 11 addendum coverage (Phase 12)', () => {
  let runScheduler: (now: Date) => Promise<number>;
  before(async () => {
    ({ runScheduler } = await import('../src/services/scheduler.service.js'));
  });

  async function createTemplate(token: string, body: Record<string, unknown>) {
    const res = await request(app).post('/api/templates').set(auth(token)).send(body);
    assert.equal(res.status, 201, `create template failed: ${JSON.stringify(res.body)}`);
    return res.body as { id: number };
  }

  // --- Phase 10: blocked-status rule via Kanban drag, MULTIPLE blockers ------

  it('Kanban drag of a task with several incomplete predecessors into Completed names ALL of them', async () => {
    const tok = await adminToken();
    const pred1 = await makeTask(tok, 'First predecessor');
    const pred2 = await makeTask(tok, 'Second predecessor');
    const task = await makeTask(tok, 'Doubly blocked');
    for (const pred of [pred1, pred2]) {
      await request(app)
        .post(`/api/tasks/${task.id}/dependencies`)
        .set(auth(tok))
        .send({ type: 'blockedBy', otherTaskId: pred.id });
    }

    // A Kanban drop onto the Completed column is a PATCH of `status` — the same
    // endpoint/rule as the Task Detail Status field.
    const res = await request(app).patch(`/api/tasks/${task.id}`).set(auth(tok)).send({ status: 'Completed' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, new RegExp(`#${pred1.id}`), 'names the first blocker');
    assert.match(res.body.error, new RegExp(`#${pred2.id}`), 'names the second blocker');

    // Completing one predecessor still leaves the other blocking (still named).
    await request(app).patch(`/api/tasks/${pred1.id}`).set(auth(tok)).send({ status: 'Completed' });
    const still = await request(app).patch(`/api/tasks/${task.id}`).set(auth(tok)).send({ status: 'Completed' });
    assert.equal(still.status, 400);
    assert.match(still.body.error, new RegExp(`#${pred2.id}`));
    assert.ok(!new RegExp(`#${pred1.id}\\b`).test(still.body.error), 'the completed predecessor drops off the list');
  });

  // --- Phase 11: template parent/child ANCESTRY cycle ------------------------

  it('rejects a template tree where a node would be its own ancestor (hierarchy cycle)', async () => {
    const admin = await adminToken();

    // A node whose parent is itself — the most direct "own ancestor".
    const selfParent = await request(app)
      .post('/api/templates')
      .set(auth(admin))
      .send({
        name: 'Self-parent',
        nodes: [
          { key: 'root', parentKey: null, name: 'Root' },
          { key: 'a', parentKey: 'a', name: 'A is its own parent' },
        ],
      });
    assert.equal(selfParent.status, 400, JSON.stringify(selfParent.body));

    // A deeper loop: b → c → b, with a valid single root present, so it passes
    // the "exactly one root" check and specifically exercises the ancestry walk.
    const deepLoop = await request(app)
      .post('/api/templates')
      .set(auth(admin))
      .send({
        name: 'Deep loop',
        nodes: [
          { key: 'root', parentKey: null, name: 'Root' },
          { key: 'b', parentKey: 'c', name: 'B' },
          { key: 'c', parentKey: 'b', name: 'C' },
        ],
      });
    assert.equal(deepLoop.status, 400, JSON.stringify(deepLoop.body));
  });

  // --- Phase 11: materialize exactly-once across BOTH triggers ---------------

  it('task recurrence: a ghost cannot be double-materialized by a click-through and the scheduler racing', async () => {
    const admin = await adminToken();
    // Global lead 30 so seq 2 (+1wk) and seq 3 (+2wk) are within the auto-
    // materialization window at the Aug-1 tick.
    await setLeadDays(30);
    const t = await makeTask(admin, 'Nightly sync', {
      startAt: '2026-08-01T00:00:00.000Z',
      dueAt: '2026-08-01T01:00:00.000Z',
    });
    await request(app)
      .put(`/api/tasks/${t.id}/recurrence`)
      .set(auth(admin))
      .send({
        recurrenceType: 'Fixed',
        intervalCount: 1,
        intervalUnit: 'Week',
        endType: 'AfterOccurrences',
        maxOccurrences: 3,
      });

    // Trigger A: user clicks the seq-2 ghost to materialize it now.
    const click = await request(app)
      .post(`/api/tasks/${t.id}/recurrence/materialize`)
      .set(auth(admin))
      .send({ seq: 2 });
    assert.equal(click.status, 201, JSON.stringify(click.body));

    // Trigger B: the scheduler runs over a window where seq 2 is also due. It
    // must NOT create a second seq-2 task (the unique (source, seq) claim holds).
    await runScheduler(new Date('2026-08-01T00:00:00.000Z'));

    const seq2Count = await prisma.task.count({
      where: { recurrenceSourceId: t.id, recurrenceSeq: 2 },
    });
    assert.equal(seq2Count, 1, 'exactly one real task for seq 2 despite both triggers');

    // Reverse race: the scheduler already made seq 2, so a later click is a 409.
    const dupClick = await request(app)
      .post(`/api/tasks/${t.id}/recurrence/materialize`)
      .set(auth(admin))
      .send({ seq: 2 });
    assert.equal(dupClick.status, 409, 'click-through after the scheduler is rejected');
  });

  it('template recurrence: a ghost cannot be double-materialized by a click-through and the scheduler racing', async () => {
    const admin = await adminToken();
    // Global lead 40 so seq 1 (Aug 1) and seq 2 (Sep 1) are within the window at Aug 1.
    await setLeadDays(40);
    const tpl = await createTemplate(admin, {
      name: 'Monthly audit',
      nodes: [{ key: 'root', parentKey: null, name: 'Audit', startOffsetDays: 0, dueOffsetDays: 1 }],
      recurrence: {
        recurrenceType: 'Fixed',
        intervalCount: 1,
        intervalUnit: 'Month',
        anchorDate: '2026-08-01T00:00:00.000Z',
        endType: 'AfterOccurrences',
        maxOccurrences: 3,
      },
    });

    // Trigger A: click-through materialize of seq 2.
    const click = await request(app)
      .post(`/api/templates/${tpl.id}/materialize`)
      .set(auth(admin))
      .send({ seq: 2 });
    assert.equal(click.status, 201, JSON.stringify(click.body));

    // Trigger B: the scheduler runs over the same window. seq 2 is already
    // claimed, so it fires only the remaining due seq(s), never a duplicate.
    await runScheduler(new Date('2026-08-01T00:00:00.000Z'));

    const seq2Occurrences = await prisma.templateOccurrence.count({
      where: { templateId: tpl.id, seq: 2 },
    });
    assert.equal(seq2Occurrences, 1, 'exactly one occurrence row for seq 2');

    const dupClick = await request(app)
      .post(`/api/templates/${tpl.id}/materialize`)
      .set(auth(admin))
      .send({ seq: 2 });
    assert.equal(dupClick.status, 409, 'click-through after the scheduler is rejected');
  });
});

// --- Phase 13: Task-Level Access Control + Due Date Performance Report ------

describe('Phase 13: task-level access control', () => {
  const PW = 'AccessPass123!';

  function mentionSpan(userId: string, label = 'u'): string {
    return `<span data-type="mention" data-id="${userId}">@${label}</span>`;
  }
  const getTask = (token: string, id: number) =>
    request(app).get(`/api/tasks/${id}`).set(auth(token));
  const addComment = (token: string, id: number, body: string) =>
    request(app).post(`/api/tasks/${id}/comments`).set(auth(token)).send({ body });

  it('full access = Admin, current Assignee, or a supervisor above them; others 404', async () => {
    const admin = await adminToken();
    const mgr = await seedUser({ email: 'fa-mgr@test.local', role: 'Manager', password: PW });
    const emp = await seedUser({ email: 'fa-emp@test.local', role: 'Member', password: PW, supervisorId: mgr.id });
    await seedUser({ email: 'fa-out@test.local', role: 'Member', password: PW });
    const empTok = await login('fa-emp@test.local', PW);
    const mgrTok = await login('fa-mgr@test.local', PW);
    const outTok = await login('fa-out@test.local', PW);
    const t = await makeTask(admin, 'Access task', { assigneeId: emp.id });

    assert.equal((await getTask(empTok, t.id)).status, 200, 'assignee sees it');
    assert.equal((await getTask(mgrTok, t.id)).status, 200, 'supervisor sees it');
    assert.equal((await getTask(admin, t.id)).status, 200, 'admin sees it');
    assert.equal((await getTask(outTok, t.id)).status, 404, 'unrelated member cannot');
  });

  it('recomputes access LIVE when the assignee supervisor changes', async () => {
    const admin = await adminToken();
    const mgrA = await seedUser({ email: 'lv-a@test.local', role: 'Manager', password: PW });
    const mgrB = await seedUser({ email: 'lv-b@test.local', role: 'Manager', password: PW });
    const emp = await seedUser({ email: 'lv-emp@test.local', role: 'Member', password: PW, supervisorId: mgrA.id });
    const aTok = await login('lv-a@test.local', PW);
    const bTok = await login('lv-b@test.local', PW);
    const t = await makeTask(admin, 'Live task', { assigneeId: emp.id });

    assert.equal((await getTask(aTok, t.id)).status, 200, 'original supervisor sees it');
    assert.equal((await getTask(bTok, t.id)).status, 404, 'the other manager does not');

    // Re-parent the employee under mgrB - nothing else changes.
    const moved = await request(app).patch(`/api/users/${emp.id}`).set(auth(admin)).send({ supervisorId: mgrB.id });
    assert.equal(moved.status, 200);

    assert.equal((await getTask(aTok, t.id)).status, 404, 'former supervisor lost access');
    assert.equal((await getTask(bTok, t.id)).status, 200, 'new supervisor gained access');
  });

  it('mention-only access is live: added on mention, removed when the mention is edited out', async () => {
    const admin = await adminToken();
    const emp = await seedUser({ email: 'mo-emp@test.local', role: 'Member', password: PW });
    const out = await seedUser({ email: 'mo-out@test.local', role: 'Member', password: PW });
    const empTok = await login('mo-emp@test.local', PW);
    const outTok = await login('mo-out@test.local', PW);
    const t = await makeTask(admin, 'Mention task', { assigneeId: emp.id });

    // Before any mention, the outsider cannot see it.
    assert.equal((await getTask(outTok, t.id)).status, 404);

    // The assignee mentions the outsider -> comment-level access.
    const added = await addComment(empTok, t.id, `<p>hi ${mentionSpan(out.id, 'out')}</p>`);
    assert.equal(added.status, 201);
    const seen = await getTask(outTok, t.id);
    assert.equal(seen.status, 200, 'mentioned user can now see it');
    assert.equal(seen.body.access, 'comment', 'access is comment-only');
    // The outsider CANNOT edit task fields, but CAN comment.
    assert.equal((await request(app).patch(`/api/tasks/${t.id}`).set(auth(outTok)).send({ priority: 'High' })).status, 403);
    assert.equal((await addComment(outTok, t.id, '<p>replying</p>')).status, 201);

    // Edit the mention out of the only comment -> access removed immediately.
    const commentId = added.body.comments[0].id as string;
    const edited = await request(app).patch(`/api/comments/${commentId}`).set(auth(empTok)).send({ body: '<p>no more mention</p>' });
    assert.equal(edited.status, 200);
    assert.equal((await getTask(outTok, t.id)).status, 404, 'access removed when mention edited out');
  });

  it('multi-task search flags mention-only rows and honours the includeReadOnly toggle', async () => {
    const admin = await adminToken();
    const emp = await seedUser({ email: 'ms-emp@test.local', role: 'Member', password: PW });
    const out = await seedUser({ email: 'ms-out@test.local', role: 'Member', password: PW });
    const empTok = await login('ms-emp@test.local', PW);
    const outTok = await login('ms-out@test.local', PW);
    const own = await makeTask(admin, 'Own task', { assigneeId: out.id }); // out is assignee -> full
    const other = await makeTask(admin, 'Other task', { assigneeId: emp.id });
    await addComment(empTok, other.id, `<p>${mentionSpan(out.id, 'out')}</p>`);

    const withReadOnly = await queryTasks(outTok, { includeReadOnly: true });
    const ids = new Set(withReadOnly.rows.map((r) => r.id));
    assert.ok(ids.has(own.id) && ids.has(other.id), 'both full and mention-only tasks appear');
    const ownRow = withReadOnly.rows.find((r) => r.id === own.id)!;
    const otherRow = withReadOnly.rows.find((r) => r.id === other.id)!;
    assert.equal(ownRow.mentionOnly, false, 'own task is full access');
    assert.equal(otherRow.mentionOnly, true, 'mentioned task is flagged read-only');

    const withoutReadOnly = await queryTasks(outTok, { includeReadOnly: false });
    const ids2 = new Set(withoutReadOnly.rows.map((r) => r.id));
    assert.ok(ids2.has(own.id) && !ids2.has(other.id), 'toggle hides read-only tasks');
  });

  it('assignment restriction: Member (immediate team) vs Manager (+ downline) vs Admin', async () => {
    const admin = await adminToken();
    // mgr -> {a, b, subMgr}; subMgr -> c. (Members can't be supervisors, so the
    // deep report c hangs off a Manager, not off Member a.)
    const mgr = await seedUser({ email: 'ar-mgr@test.local', role: 'Manager', password: PW });
    const subMgr = await seedUser({ email: 'ar-sub@test.local', role: 'Manager', password: PW, supervisorId: mgr.id });
    const a = await seedUser({ email: 'ar-a@test.local', role: 'Member', password: PW, supervisorId: mgr.id });
    const b = await seedUser({ email: 'ar-b@test.local', role: 'Member', password: PW, supervisorId: mgr.id }); // peer of a
    const c = await seedUser({ email: 'ar-c@test.local', role: 'Member', password: PW, supervisorId: subMgr.id }); // deep downline of mgr
    const outsider = await seedUser({ email: 'ar-out@test.local', role: 'Member', password: PW });
    const aTok = await login('ar-a@test.local', PW);
    const mgrTok = await login('ar-mgr@test.local', PW);

    const create = (tok: string, assigneeId: string) =>
      request(app).post('/api/tasks').set(auth(tok)).send({ name: 'Assign', assigneeId });

    // Member A: self, supervisor, and peers OK; anyone deeper or outside rejected.
    assert.equal((await create(aTok, a.id)).status, 201, 'member -> self ok');
    assert.equal((await create(aTok, mgr.id)).status, 201, 'member -> supervisor ok');
    assert.equal((await create(aTok, b.id)).status, 201, 'member -> peer ok');
    assert.equal((await create(aTok, c.id)).status, 403, 'member -> outside immediate team rejected');
    assert.equal((await create(aTok, outsider.id)).status, 403, 'member -> outsider rejected');

    // Manager: entire downline (a, b, subMgr, c) OK.
    assert.equal((await create(mgrTok, c.id)).status, 201, 'manager -> deep downline ok');
    assert.equal((await create(mgrTok, outsider.id)).status, 403, 'manager -> outsider rejected');

    // Admin: anyone.
    assert.equal((await create(admin, outsider.id)).status, 201, 'admin -> anyone ok');
  });

  it('Private task: suspends mention-only access and restricts @mention candidates', async () => {
    const admin = await adminToken();
    const mgr = await seedUser({ email: 'pv-mgr@test.local', role: 'Manager', password: PW });
    const emp = await seedUser({ email: 'pv-emp@test.local', role: 'Member', password: PW, supervisorId: mgr.id });
    const out = await seedUser({ email: 'pv-out@test.local', role: 'Member', password: PW });
    const empTok = await login('pv-emp@test.local', PW);
    const mgrTok = await login('pv-mgr@test.local', PW);
    const outTok = await login('pv-out@test.local', PW);
    const t = await makeTask(admin, 'Private-ish', { assigneeId: emp.id });
    await addComment(empTok, t.id, `<p>${mentionSpan(out.id, 'out')}</p>`);
    assert.equal((await getTask(outTok, t.id)).status, 200, 'outsider sees it via mention first');

    // The assignee cannot toggle privacy; their supervisor can.
    assert.equal((await request(app).patch(`/api/tasks/${t.id}/private`).set(auth(empTok)).send({ isPrivate: true })).status, 403);
    const made = await request(app).patch(`/api/tasks/${t.id}/private`).set(auth(mgrTok)).send({ isPrivate: true });
    assert.equal(made.status, 200);
    assert.equal(made.body.isPrivate, true);

    // Mention-only access is suspended the moment it goes private.
    assert.equal((await getTask(outTok, t.id)).status, 404, 'mention-only access suspended while private');
    assert.equal((await getTask(empTok, t.id)).status, 200, 'assignee still sees it');

    // The mention-candidate pool excludes the outsider now.
    const cands = await request(app).get(`/api/tasks/${t.id}/mention-candidates`).set(auth(mgrTok));
    assert.equal(cands.status, 200);
    const candIds = new Set((cands.body as { id: string }[]).map((u) => u.id));
    assert.ok(candIds.has(emp.id) && candIds.has(mgr.id), 'assignee + supervisor are candidates');
    assert.equal(candIds.has(out.id), false, 'the outsider is not a candidate on a private task');

    // A new comment mentioning the outsider does not grant them access (mention dropped).
    await addComment(mgrTok, t.id, `<p>${mentionSpan(out.id, 'out')}</p>`);
    assert.equal((await getTask(outTok, t.id)).status, 404, 'restricted mention cannot reach outside the private set');
  });

  it('reviewer-selection pool and Reviewed-button permission are two distinct checks', async () => {
    const admin = await adminToken();
    const top = await seedUser({ email: 'rv-top@test.local', role: 'Manager', password: PW });
    const reviewer = await seedUser({ email: 'rv-rev@test.local', role: 'Manager', password: PW, supervisorId: top.id });
    const worker = await seedUser({ email: 'rv-wrk@test.local', role: 'Member', password: PW, supervisorId: reviewer.id });
    const stranger = await seedUser({ email: 'rv-str@test.local', role: 'Member', password: PW });
    const revTok = await login('rv-rev@test.local', PW);
    const t = await makeTask(admin, 'Review pool', { assigneeId: worker.id, status: 'InProgress' });

    // The reviewer-selection POOL: only Admin or the assignee's supervisor chain.
    const pool = await request(app).get(`/api/tasks/${t.id}/reviewer-candidates`).set(auth(admin));
    const poolIds = new Set((pool.body as { id: string }[]).map((u) => u.id));
    assert.ok(poolIds.has(reviewer.id) && poolIds.has(top.id), 'chain supervisors are in the pool');
    assert.equal(poolIds.has(stranger.id), false, 'a stranger is not in the pool');
    assert.equal(poolIds.has(worker.id), false, 'the assignee is not their own reviewer');

    // Picking a stranger as reviewer is rejected (pool check).
    const bad = await request(app).patch(`/api/tasks/${t.id}`).set(auth(admin)).send({ status: 'Review', reviewerId: stranger.id });
    assert.equal(bad.status, 403, 'reviewer outside the pool is rejected');

    // Picking a chain supervisor works; they become the current assignee.
    const ok = await request(app).patch(`/api/tasks/${t.id}`).set(auth(admin)).send({ status: 'Review', reviewerId: reviewer.id });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));

    // The Reviewed-BUTTON check is DIFFERENT: the current assignee (the reviewer)
    // may click Reviewed - a permission the pool check never granted them.
    const done = await request(app).post(`/api/tasks/${t.id}/reviewed`).set(auth(revTok));
    assert.equal(done.status, 200, JSON.stringify(done.body));
  });

  it('Assignee is locked while Completed or Canceled - for every role, incl. Admin', async () => {
    const admin = await adminToken();
    const a = await seedUser({ email: 'al-a@test.local', role: 'Member', password: PW });
    const b = await seedUser({ email: 'al-b@test.local', role: 'Member', password: PW });
    for (const terminal of ['Completed', 'Canceled'] as const) {
      const t = await makeTask(admin, `Lock ${terminal}`, { assigneeId: a.id });
      await request(app).patch(`/api/tasks/${t.id}`).set(auth(admin)).send({ status: terminal });
      // Even Admin cannot reassign a terminal task.
      const blocked = await request(app).patch(`/api/tasks/${t.id}`).set(auth(admin)).send({ assigneeId: b.id });
      assert.equal(blocked.status, 400, `${terminal}: assignee change rejected`);
      assert.match(blocked.body.error, /Completed or Canceled/);
      // Reopen -> assignee editable again.
      await request(app).patch(`/api/tasks/${t.id}`).set(auth(admin)).send({ status: 'Open' });
      const reassigned = await request(app).patch(`/api/tasks/${t.id}`).set(auth(admin)).send({ assigneeId: b.id });
      assert.equal(reassigned.status, 200, `${terminal}: assignee editable after reopen`);
    }
  });
});

describe('Phase 13: Goals downline visibility vs direct-supervisor authority', () => {
  const PW = 'GoalAccess123!';

  it('Team Goals shows the full downline, but only the DIRECT supervisor may approve', async () => {
    await adminToken();
    const top = await seedUser({ email: 'g-top@test.local', role: 'Manager', password: PW });
    const mid = await seedUser({ email: 'g-mid@test.local', role: 'Manager', password: PW, supervisorId: top.id });
    const emp = await seedUser({ email: 'g-emp@test.local', role: 'Member', password: PW, supervisorId: mid.id });
    const topTok = await login('g-top@test.local', PW);
    const midTok = await login('g-mid@test.local', PW);
    const empTok = await login('g-emp@test.local', PW);

    const created = await request(app).post('/api/goals').set(auth(empTok)).send({
      specific: 'Reduce cycle time',
      metricType: 'Percentage',
      targetValue: 10,
      deadline: '2026-12-31T00:00:00.000Z',
    });
    assert.equal(created.status, 201);
    const goalId = created.body.id as number;
    await request(app).post(`/api/goals/${goalId}/submit`).set(auth(empTok)).send({});

    // Top (two levels up) SEES the goal via broadened downline visibility.
    const team = await request(app).post('/api/goals/team').set(auth(topTok)).send({});
    assert.equal(team.status, 200);
    assert.ok((team.body as { id: number }[]).some((g) => g.id === goalId), 'top sees the deep report goal');

    // ...but Top may NOT approve it - only the DIRECT supervisor (mid) can.
    const topApprove = await request(app).post(`/api/goals/${goalId}/approve`).set(auth(topTok)).send({});
    assert.equal(topApprove.status, 403, 'non-direct supervisor cannot approve');
    const midApprove = await request(app).post(`/api/goals/${goalId}/approve`).set(auth(midTok)).send({});
    assert.equal(midApprove.status, 200, 'direct supervisor approves');
  });
});

describe('Phase 13: Due Date Performance Report bucketing', () => {
  const NOW = new Date('2026-08-15T12:00:00.000Z');
  const day = 24 * 60 * 60 * 1000;
  const runReport = (token: string, body: Record<string, unknown> = {}) =>
    request(app).post('/api/reports/due-date').set(auth(token)).send({ now: NOW.toISOString(), ...body });
  // Build a task with precisely-controlled current fields via Prisma.
  const mk = async (token: string, name: string, data: Record<string, unknown>) => {
    const t = await makeTask(token, name);
    await prisma.task.update({ where: { id: t.id }, data });
    return t.id;
  };
  const bucketsById = (res: { body: { rows: { id: number; bucket: string }[] } }) =>
    new Map(res.body.rows.map((r) => [r.id, r.bucket]));

  it('places each task in exactly one of the seven buckets (due==completion = On Time)', async () => {
    const admin = await adminToken();
    const onTime = await mk(admin, 'onTime', { status: 'Completed', dueAt: new Date(NOW.getTime() + 2 * day), statusChangedAt: new Date(NOW.getTime() - day) });
    const boundary = await mk(admin, 'boundary', { status: 'Completed', dueAt: NOW, statusChangedAt: NOW }); // equal -> On Time
    const late = await mk(admin, 'late', { status: 'Completed', dueAt: new Date(NOW.getTime() - 2 * day), statusChangedAt: new Date(NOW.getTime() - day) });
    const overdue = await mk(admin, 'overdue', { status: 'InProgress', dueAt: new Date(NOW.getTime() - day) });
    // Open, future due, no start date yet -> Not Started.
    const notStarted = await mk(admin, 'notStarted', { status: 'Open', dueAt: new Date(NOW.getTime() + day), startAt: null });
    // In Progress, future due -> Not Completed (work has begun).
    const notCompleted = await mk(admin, 'notCompleted', { status: 'InProgress', dueAt: new Date(NOW.getTime() + day) });
    const cancelled = await mk(admin, 'cancelled', { status: 'Canceled', dueAt: new Date(NOW.getTime() - day) });
    const noDue = await mk(admin, 'noDue', { status: 'Completed', dueAt: null, statusChangedAt: new Date(NOW.getTime() - day) });

    const res = await runReport(admin);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const bucketById = bucketsById(res);
    assert.equal(bucketById.get(onTime), 'OnTime');
    assert.equal(bucketById.get(boundary), 'OnTime', 'due exactly equal to completion counts as On Time');
    assert.equal(bucketById.get(late), 'Late');
    assert.equal(bucketById.get(overdue), 'Overdue');
    assert.equal(bucketById.get(notStarted), 'NotStarted');
    assert.equal(bucketById.get(notCompleted), 'NotCompleted');
    assert.equal(bucketById.get(cancelled), 'Cancelled');
    assert.equal(bucketById.get(noDue), 'NoDueDate');

    // Totals sum to the row count (each task in exactly one bucket).
    const totals = res.body.bucketTotals as Record<string, number>;
    const sum = Object.values(totals).reduce((a, b) => a + b, 0);
    assert.equal(sum, res.body.rows.length);
  });

  it('a Cancelled task with no Due Date lands in Cancelled, not No Due Date', async () => {
    const admin = await adminToken();
    const id = await mk(admin, 'cancelledNoDue', { status: 'Canceled', dueAt: null });
    const res = await runReport(admin);
    assert.equal(bucketsById(res).get(id), 'Cancelled', 'Cancelled wins over No Due Date');
  });

  it('a Due Date range fully in the past yields zero Not Completed and zero Not Started', async () => {
    const admin = await adminToken();
    // Only a past-due task falls in range; the future-due Not Started / Not
    // Completed candidates are filtered out — and both buckets require a future
    // due date, so no task in the DB can populate them under this filter.
    await mk(admin, 'overduePast', { status: 'InProgress', dueAt: new Date(NOW.getTime() - day) });
    await mk(admin, 'notStartedFuture', { status: 'Open', dueAt: new Date(NOW.getTime() + day), startAt: null });
    await mk(admin, 'notCompletedFuture', { status: 'InProgress', dueAt: new Date(NOW.getTime() + day) });

    const res = await runReport(admin, {
      filters: {
        dueFrom: new Date(NOW.getTime() - 30 * day).toISOString(),
        dueTo: new Date(NOW.getTime() - 1000).toISOString(),
        includeNoDue: false,
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const totals = res.body.bucketTotals as Record<string, number>;
    assert.equal(totals.NotStarted, 0, 'no Not Started when the due range is fully past');
    assert.equal(totals.NotCompleted, 0, 'no Not Completed when the due range is fully past');
  });

  it('an In Progress task with a future or unset Start Date lands in Not Completed, not Not Started', async () => {
    const admin = await adminToken();
    // Not Started is reserved for the Open status; any other non-terminal status
    // lands in Not Completed regardless of Start Date.
    const unsetStart = await mk(admin, 'ipUnsetStart', { status: 'InProgress', dueAt: new Date(NOW.getTime() + day), startAt: null });
    const futureStart = await mk(admin, 'ipFutureStart', { status: 'InProgress', dueAt: new Date(NOW.getTime() + 3 * day), startAt: new Date(NOW.getTime() + day) });
    const bucketById = bucketsById(await runReport(admin));
    assert.equal(bucketById.get(unsetStart), 'NotCompleted', 'In Progress is never Not Started (unset start)');
    assert.equal(bucketById.get(futureStart), 'NotCompleted', 'In Progress is never Not Started (future start)');
  });

  it('an Open task whose Start Date has passed (Due has not) lands in Not Completed, not Not Started', async () => {
    const admin = await adminToken();
    const id = await mk(admin, 'openStarted', { status: 'Open', startAt: new Date(NOW.getTime() - day), dueAt: new Date(NOW.getTime() + day) });
    assert.equal(bucketsById(await runReport(admin)).get(id), 'NotCompleted', 'a started Open task is Not Completed');
  });
});

// --- Follow-up: Parent/Child tree access inheritance -----------------------

describe('Parent/Child tree access inheritance', () => {
  const PW = 'TreePass123!';
  const getTask = (token: string, id: number) =>
    request(app).get(`/api/tasks/${id}`).set(auth(token));
  const patch = (token: string, id: number, body: Record<string, unknown>) =>
    request(app).patch(`/api/tasks/${id}`).set(auth(token)).send(body);
  const setParent = (token: string, id: number, parentId: number) =>
    request(app).put(`/api/tasks/${id}/parent`).set(auth(token)).send({ parentId });

  /** admin + a manager, their direct member, and an unrelated outsider. */
  async function team() {
    const admin = await adminToken();
    const mgr = await seedUser({ email: 't-mgr@test.local', role: 'Manager', password: PW });
    const emp = await seedUser({ email: 't-emp@test.local', role: 'Member', password: PW, supervisorId: mgr.id });
    const out = await seedUser({ email: 't-out@test.local', role: 'Member', password: PW });
    return {
      admin,
      mgr,
      emp,
      out,
      mgrTok: await login('t-mgr@test.local', PW),
      empTok: await login('t-emp@test.local', PW),
      outTok: await login('t-out@test.local', PW),
    };
  }

  it('downward: full access to a parent grants READ-ONLY visibility to descendants at any depth', async () => {
    const t = await team();
    // P (emp → mgr full) → C1 (outsider) → C2 (outsider), a 3-deep chain.
    const p = await makeTask(t.admin, 'Par', { assigneeId: t.emp.id });
    const c1 = await makeTask(t.admin, 'C1', { assigneeId: t.out.id });
    const c2 = await makeTask(t.admin, 'C2', { assigneeId: t.out.id });
    await setParent(t.admin, c1.id, p.id);
    await setParent(t.admin, c2.id, c1.id);

    // mgr has full access to P (supervises the assignee) and read-only to C1/C2.
    assert.equal((await getTask(t.mgrTok, p.id)).body.access, 'full');
    const d1 = await getTask(t.mgrTok, c1.id);
    assert.equal(d1.status, 200);
    assert.equal(d1.body.access, 'tree', 'descendant is read-only tree access');
    assert.equal((await getTask(t.mgrTok, c2.id)).body.access, 'tree', 'grand-descendant too');
    // Read-only means edits are rejected on the inherited descendants.
    assert.equal((await patch(t.mgrTok, c1.id, { priority: 'High' })).status, 403);
    // …but the assignee (outsider) keeps full edit rights on their own task.
    assert.equal((await patch(t.outTok, c1.id, { priority: 'High' })).status, 200);
  });

  it('upward: access to a child grants READ-ONLY visibility to its ancestors', async () => {
    const t = await team();
    // P (outsider) → C (emp). emp accesses C (assignee) and inherits read-only P.
    const p = await makeTask(t.admin, 'UP', { assigneeId: t.out.id });
    const c = await makeTask(t.admin, 'UC', { assigneeId: t.emp.id });
    await setParent(t.admin, c.id, p.id);

    assert.equal((await getTask(t.empTok, c.id)).body.access, 'full');
    const up = await getTask(t.empTok, p.id);
    assert.equal(up.status, 200);
    assert.equal(up.body.access, 'tree', 'ancestor is read-only');
    assert.equal((await patch(t.empTok, p.id, { priority: 'High' })).status, 403);
  });

  it('a user with INDEPENDENT full access to a descendant keeps full edit there (not downgraded)', async () => {
    const t = await team();
    // P (emp) → C1 (emp, also full) → C2 (outsider, tree-only for mgr).
    const p = await makeTask(t.admin, 'IP', { assigneeId: t.emp.id });
    const c1 = await makeTask(t.admin, 'IC1', { assigneeId: t.emp.id });
    const c2 = await makeTask(t.admin, 'IC2', { assigneeId: t.out.id });
    await setParent(t.admin, c1.id, p.id);
    await setParent(t.admin, c2.id, c1.id);

    assert.equal((await getTask(t.mgrTok, c1.id)).body.access, 'full', 'independent full access wins over tree');
    assert.equal((await patch(t.mgrTok, c1.id, { priority: 'High' })).status, 200);
    assert.equal((await getTask(t.mgrTok, c2.id)).body.access, 'tree');
    assert.equal((await patch(t.mgrTok, c2.id, { priority: 'High' })).status, 403);
  });

  it('Private overrides inheritance in BOTH directions', async () => {
    const t = await team();
    // Downward: P (emp → mgr full) → C-private (outsider, Private). mgr must NOT see C.
    const p = await makeTask(t.admin, 'PP', { assigneeId: t.emp.id });
    const cPriv = await makeTask(t.admin, 'PC', { assigneeId: t.out.id });
    await setParent(t.admin, cPriv.id, p.id);
    await request(app).patch(`/api/tasks/${cPriv.id}/private`).set(auth(t.admin)).send({ isPrivate: true });
    assert.equal((await getTask(t.mgrTok, cPriv.id)).status, 404, 'Private descendant not inherited downward');

    // Upward: P-private (outsider) → C (emp). emp accesses C but must NOT see P.
    const pPriv = await makeTask(t.admin, 'UPP', { assigneeId: t.out.id });
    const c = await makeTask(t.admin, 'UPC', { assigneeId: t.emp.id });
    await setParent(t.admin, c.id, pPriv.id);
    await request(app).patch(`/api/tasks/${pPriv.id}/private`).set(auth(t.admin)).send({ isPrivate: true });
    assert.equal((await getTask(t.empTok, pPriv.id)).status, 404, 'Private ancestor not inherited upward');
  });

  it('degrades an inaccessible task reference to Id + lock + Status (no name), and updates live', async () => {
    const t = await team();
    // T (emp → mgr full) is blocked by X (outsider) — a DEPENDENCY, which does NOT
    // inherit — so mgr cannot see X and the reference degrades.
    const task = await makeTask(t.admin, 'DEP-T', { assigneeId: t.emp.id });
    const x = await makeTask(t.admin, 'SecretBlocker', { assigneeId: t.out.id });
    await request(app).post(`/api/tasks/${task.id}/dependencies`).set(auth(t.admin)).send({ type: 'blockedBy', otherTaskId: x.id });

    const before = await getTask(t.mgrTok, task.id);
    const ref = (before.body.isBlockedBy as { id: number; name: string; status: string; accessible: boolean }[])[0];
    assert.equal(ref.id, x.id);
    assert.equal(ref.accessible, false, 'invisible blocker is not accessible');
    assert.equal(ref.name, '', 'name is blanked, never leaked');
    assert.ok(ref.status, 'status is still shown');

    // Grant mgr access by moving X into their downline → the ref updates live.
    await patch(t.admin, x.id, { assigneeId: t.emp.id });
    const after = await getTask(t.mgrTok, task.id);
    const ref2 = (after.body.isBlockedBy as { id: number; name: string; accessible: boolean }[])[0];
    assert.equal(ref2.accessible, true, 'access change reflected on next view');
    assert.equal(ref2.name, 'SecretBlocker', 'name now visible');
  });

  it('blocked-status enforcement evaluates the real predecessor even when the actor cannot see it', async () => {
    const t = await team();
    const task = await makeTask(t.admin, 'BLK-T', { assigneeId: t.emp.id });
    const x = await makeTask(t.admin, 'HiddenPred', { assigneeId: t.out.id, status: 'InProgress' });
    await request(app).post(`/api/tasks/${task.id}/dependencies`).set(auth(t.admin)).send({ type: 'blockedBy', otherTaskId: x.id });

    // mgr (full on task, cannot see the outsider's blocker) still cannot complete it.
    const res = await patch(t.mgrTok, task.id, { status: 'Completed' });
    assert.equal(res.status, 400, 'blocked rule fires regardless of visibility');
    assert.match(res.body.error, new RegExp(`#${x.id}`));
    assert.equal(res.body.error.includes('HiddenPred'), false, 'the unseen blocker name is not leaked');
  });

  it('relationship picker only returns visible tasks; removing a link never needs access to the other side', async () => {
    const t = await team();
    const mine = await makeTask(t.admin, 'PickMine', { assigneeId: t.emp.id });
    const secret = await makeTask(t.admin, 'PickSecret', { assigneeId: t.out.id });

    const pick = await request(app).get('/api/tasks/search?q=Pick').set(auth(t.empTok));
    const ids = (pick.body as { id: number }[]).map((r) => r.id);
    assert.ok(ids.includes(mine.id), 'own task offered');
    assert.equal(ids.includes(secret.id), false, 'invisible task never offered by the picker');

    // Create a dependency to a currently-visible task, then make it invisible, then remove the link.
    const dep = await makeTask(t.admin, 'DepVisible', { assigneeId: t.emp.id });
    await request(app).post(`/api/tasks/${mine.id}/dependencies`).set(auth(t.empTok)).send({ type: 'blockedBy', otherTaskId: dep.id });
    await patch(t.admin, dep.id, { assigneeId: t.out.id }); // now invisible to emp
    assert.equal((await getTask(t.empTok, dep.id)).status, 404, 'the linked task is now invisible');
    const removed = await request(app)
      .delete(`/api/tasks/${mine.id}/dependencies`)
      .set(auth(t.empTok))
      .send({ type: 'blockedBy', otherTaskId: dep.id });
    assert.equal(removed.status, 200, 'removing a link to an inaccessible task is allowed');
  });
});

// --- Excel export timezone rendering ---------------------------------------

describe('Excel export renders dates in the requester timezone', () => {
  let toExcelLocalDate: (iso: string | null | undefined, tz: string | undefined) => Date | string;
  before(async () => {
    ({ toExcelLocalDate } = await import('../src/utils/excel-date.js'));
  });

  it('shifts a UTC instant to the local wall-clock (7pm EDT stored as 23:00Z -> 19:00)', () => {
    const d = toExcelLocalDate('2026-07-28T23:00:00.000Z', 'America/New_York');
    assert.ok(d instanceof Date);
    assert.equal((d as Date).getUTCHours(), 19, '7:00 PM local, not 23:00 UTC');
    assert.equal((d as Date).getUTCDate(), 28);
  });

  it('honours the winter (EST) offset too (DST-correct per instant)', () => {
    const d = toExcelLocalDate('2026-01-15T00:00:00.000Z', 'America/New_York') as Date;
    // 00:00Z on Jan 15 is 7:00 PM EST on Jan 14.
    assert.equal(d.getUTCHours(), 19);
    assert.equal(d.getUTCDate(), 14);
  });

  it('leaves the instant unchanged when no timezone is given, and blanks null', () => {
    const same = toExcelLocalDate('2026-07-28T23:00:00.000Z', undefined) as Date;
    assert.equal(same.getUTCHours(), 23);
    assert.equal(toExcelLocalDate(null, 'America/New_York'), '');
  });
});

// ===========================================================================
// Follow-up round: small fixes, template editor DnD, task->template conversion
// ===========================================================================

describe('notifications: manual mark-as-unread (follow-up)', () => {
  it('re-marks a read notification as unread and the bell count reflects it', async () => {
    const admin = await adminToken();
    const u = await seedUser({ email: 'unread-mem@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const uTok = await login('unread-mem@test.local', MEMBER_PASSWORD);

    // An assignment to the member creates one unread "assigned" notification.
    await makeTask(admin, 'Assigned to member', { assigneeId: u.id });
    assert.equal((await unread(uTok)).assigned, 1);
    assert.equal((await unread(uTok)).total, 1, 'bell shows one unread');

    const list = await getNotifs(uTok);
    const notifId = list.assigned[0]!.id;

    // Mark read → the bell count drops to zero.
    const read = await request(app).post(`/api/notifications/${notifId}/read`).set(auth(uTok));
    assert.equal(read.status, 204);
    assert.equal((await unread(uTok)).total, 0, 'bell clears after reading');
    assert.equal((await getNotifs(uTok)).assigned[0]!.read, true);

    // Manually re-mark unread → the bell count goes back up.
    const back = await request(app).post(`/api/notifications/${notifId}/unread`).set(auth(uTok));
    assert.equal(back.status, 204);
    assert.equal((await unread(uTok)).assigned, 1);
    assert.equal((await unread(uTok)).total, 1, 'bell shows the notification as unread again');
    assert.equal((await getNotifs(uTok)).assigned[0]!.read, false);

    // A different user cannot flip someone else's notification.
    const other = await seedUser({ email: 'unread-other@test.local', role: 'Member', password: MEMBER_PASSWORD });
    void other;
    const otherTok = await login('unread-other@test.local', MEMBER_PASSWORD);
    const forbidden = await request(app).post(`/api/notifications/${notifId}/unread`).set(auth(otherTok));
    assert.equal(forbidden.status, 404, "cannot touch another user's notification");
  });

  it('re-marks a due reminder as unread and it counts again', async () => {
    const admin = await adminToken();
    // Future Start (so Add is allowed) + an already-elapsed lead => due now.
    const startSoon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const t = await makeTask(admin, 'Due reminder task', { startAt: startSoon });
    const rem = await request(app).post(`/api/tasks/${t.id}/reminders`).set(auth(admin)).send({ leadMinutes: 60 });
    assert.equal(rem.status, 201);
    assert.equal((await unread(admin)).reminders, 1);

    await request(app).post(`/api/reminders/${rem.body.id}/read`).set(auth(admin));
    assert.equal((await unread(admin)).reminders, 0);

    const back = await request(app).post(`/api/reminders/${rem.body.id}/unread`).set(auth(admin));
    assert.equal(back.status, 204);
    assert.equal((await unread(admin)).reminders, 1, 'the reminder counts as unread again');
  });
});

describe('global materialization lead time (follow-up)', () => {
  let runScheduler: (now: Date) => Promise<number>;
  before(async () => {
    ({ runScheduler } = await import('../src/services/scheduler.service.js'));
  });

  function weeklyTemplate(name: string) {
    return {
      name,
      nodes: [{ key: 'root', parentKey: null, name: 'Do it', startOffsetDays: 0, dueOffsetDays: 1 }],
      recurrence: {
        recurrenceType: 'Fixed',
        intervalCount: 1,
        intervalUnit: 'Week',
        anchorDate: '2026-08-01T00:00:00.000Z',
        endType: 'AfterOccurrences',
        maxOccurrences: 4,
      },
    };
  }

  it('every recurring template respects the ONE global setting (no per-template override)', async () => {
    const admin = await adminToken();

    async function create(name: string): Promise<number> {
      const res = await request(app).post('/api/templates').set(auth(admin)).send(weeklyTemplate(name));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      // The lead time is no longer part of the template payload/DTO.
      assert.ok(!('leadTimeDays' in res.body), 'no per-template lead override remains');
      return res.body.id as number;
    }
    const t1 = await create('Series one');
    const t2 = await create('Series two');
    const scheduled = (id: number) =>
      prisma.templateOccurrence.count({ where: { templateId: id, origin: 'scheduled' } });

    // Global lead 0: at the anchor only seq 1 (Aug 1) is within the window; seq 2
    // (Aug 8) is a week out. Both templates behave identically.
    await setLeadDays(0);
    await runScheduler(new Date('2026-08-01T00:00:00.000Z'));
    assert.equal(await scheduled(t1), 1);
    assert.equal(await scheduled(t2), 1);

    // Raise the ONE global to 10 days: seq 2 (Aug 8) now falls in the window for
    // BOTH templates; seq 3 (Aug 15) is still out. No per-template edit was made.
    await setLeadDays(10);
    await runScheduler(new Date('2026-08-01T00:00:00.000Z'));
    assert.equal(await scheduled(t1), 2, 'template 1 picked up the new global lead');
    assert.equal(await scheduled(t2), 2, 'template 2 picked up the same global lead');
  });

  it('exposes the setting via GET /api/settings and gates PUT to Admin', async () => {
    const admin = await adminToken();
    const get = await request(app).get('/api/settings').set(auth(admin));
    assert.equal(get.status, 200);
    assert.equal(get.body.materializeLeadDays, 14, 'defaults to 14');

    await seedUser({ email: 'settings-mgr@test.local', role: 'Manager', password: MEMBER_PASSWORD });
    const mgr = await login('settings-mgr@test.local', MEMBER_PASSWORD);
    const forbidden = await request(app).put('/api/settings').set(auth(mgr)).send({ materializeLeadDays: 7 });
    assert.equal(forbidden.status, 403, 'only an admin may change global settings');

    const put = await request(app).put('/api/settings').set(auth(admin)).send({ materializeLeadDays: 21 });
    assert.equal(put.status, 200);
    assert.equal(put.body.materializeLeadDays, 21);
    assert.equal((await request(app).get('/api/settings').set(auth(mgr))).body.materializeLeadDays, 21);
  });
});

describe('template tree editor: subtree drag helpers (follow-up)', () => {
  // The editor renders from parentKey and reorders with moveTemplateNode; these
  // pure-data tests mirror what the drag handlers do in the browser.
  const tree = () => [
    { key: 'root', parentKey: null },
    { key: 'A', parentKey: 'root' },
    { key: 'A1', parentKey: 'A' },
    { key: 'A2', parentKey: 'A' },
    { key: 'B', parentKey: 'root' },
  ];

  it('dragging a sibling with descendants moves its whole subtree together', () => {
    const moved = moveTemplateNode(tree(), 'A', 'B', 'after');
    // A is now ordered after B among root's children.
    const rootKids = moved.filter((n) => n.parentKey === 'root').map((n) => n.key);
    assert.deepEqual(rootKids, ['B', 'A'], 'A reordered after its sibling B');
    // Its descendants came with it — still parented to A, still present.
    assert.deepEqual([...templateSubtreeKeys(moved, 'A')].sort(), ['A', 'A1', 'A2']);
    assert.equal(moved.find((n) => n.key === 'A1')!.parentKey, 'A');
    assert.equal(moved.find((n) => n.key === 'A2')!.parentKey, 'A');
    // The moved subtree is a contiguous block (A immediately followed by A1, A2).
    const keys = moved.map((n) => n.key);
    const ai = keys.indexOf('A');
    assert.deepEqual(keys.slice(ai, ai + 3), ['A', 'A1', 'A2']);
  });

  it('a collapsed node reorders identically to an expanded one (subtree intact)', () => {
    // Collapsing is display-only: the move operates on the full node array, so a
    // collapsed A (its children hidden) still carries A1/A2 when reordered.
    const moved = moveTemplateNode(tree(), 'A', 'B', 'after');
    assert.equal(moved.length, tree().length, 'no node lost or duplicated');
    for (const k of ['A1', 'A2']) {
      assert.ok(templateSubtreeKeys(moved, 'A').has(k), `${k} still under A`);
    }
  });

  it('never drops a node into its own descendant, and never moves the root', () => {
    assert.deepEqual(moveTemplateNode(tree(), 'A', 'A1', 'inside'), tree(), 'no-op into own subtree');
    assert.deepEqual(moveTemplateNode(tree(), 'root', 'A', 'after'), tree(), 'root cannot be moved');
  });
});

describe('task -> template conversion (follow-up)', () => {
  async function seedManagerWithMember() {
    // A manager who supervises a member (so the manager has full access to the
    // member's tasks), plus an unrelated member the manager cannot reach.
    const mgr = await seedUser({ email: 'conv-mgr@test.local', role: 'Manager', password: MEMBER_PASSWORD });
    const emp = await seedUser({ email: 'conv-emp@test.local', role: 'Member', password: MEMBER_PASSWORD, supervisorId: mgr.id });
    return { mgr, emp };
  }

  it('rejects a converter without Admin/Manager role, or without full edit access', async () => {
    const admin = await adminToken();
    const { emp } = await seedManagerWithMember();
    const empTok = await login('conv-emp@test.local', MEMBER_PASSWORD);

    // Task assigned to the member: the member has FULL access but is a Member.
    const own = await makeTask(admin, 'Member task', { assigneeId: emp.id });
    const roleBlocked = await request(app)
      .post(`/api/tasks/${own.id}/save-as-template`)
      .set(auth(empTok))
      .send({ name: 'Nope', includeDescendants: false, includeAttachments: false });
    assert.equal(roleBlocked.status, 403, 'a Member cannot convert even with full access');

    // A Manager with NO relationship to an admin-owned task has no access at all.
    const strangerMgr = await seedUser({ email: 'conv-stranger@test.local', role: 'Manager', password: MEMBER_PASSWORD });
    void strangerMgr;
    const strangerTok = await login('conv-stranger@test.local', MEMBER_PASSWORD);
    const adminTask = await makeTask(admin, 'Admin-only task');
    const accessBlocked = await request(app)
      .post(`/api/tasks/${adminTask.id}/save-as-template`)
      .set(auth(strangerTok))
      .send({ name: 'Nope', includeDescendants: false, includeAttachments: false });
    assert.equal(accessBlocked.status, 404, 'no full edit access → cannot snapshot the task');

    // The admin (full access + role) succeeds and does NOT alter the source task.
    const ok = await request(app)
      .post(`/api/tasks/${adminTask.id}/save-as-template`)
      .set(auth(admin))
      .send({ name: 'Admin template', includeDescendants: false, includeAttachments: false });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const src = await request(app).get(`/api/tasks/${adminTask.id}`).set(auth(admin));
    assert.equal(src.status, 200, 'the source task is untouched (non-destructive)');
    assert.equal(ok.body.recurrenceType, 'None', 'a converted template is manual-only');
  });

  it('converts a multi-level tree to anchor-relative offsets with mixed Start/Due', async () => {
    const admin = await adminToken();
    // Day 0 = the root's Start (Aug 1). Mixed dates across the tree.
    const root = await makeTask(admin, 'Root', {
      startAt: '2026-08-01T00:00:00.000Z',
      dueAt: '2026-08-03T00:00:00.000Z',
    });
    const childA = await makeTask(admin, 'Child A', {
      startAt: '2026-08-02T00:00:00.000Z',
      dueAt: '2026-08-05T00:00:00.000Z',
    });
    await setParent(admin, childA.id, root.id);
    const grandchild = await makeTask(admin, 'Grandchild', {
      dueAt: '2026-08-04T00:00:00.000Z', // due only, no start
    });
    await setParent(admin, grandchild.id, childA.id);
    const childB = await makeTask(admin, 'Child B', {
      startAt: '2026-08-08T00:00:00.000Z', // start only, no due
    });
    await setParent(admin, childB.id, root.id);

    const conv = await request(app)
      .post(`/api/tasks/${root.id}/save-as-template`)
      .set(auth(admin))
      .send({ name: 'From tree', includeDescendants: true, includeAttachments: false, rootRoleLabel: 'Owner' });
    assert.equal(conv.status, 201, JSON.stringify(conv.body));

    const nodes = conv.body.nodes as {
      name: string;
      startOffsetDays: number | null;
      dueOffsetDays: number | null;
      assigneeRole: string | null;
      parentNodeId: number | null;
    }[];
    const byName = (n: string) => nodes.find((x) => x.name === n)!;
    assert.equal(nodes.length, 4);
    assert.deepEqual(
      [byName('Root').startOffsetDays, byName('Root').dueOffsetDays],
      [0, 2],
      'root: Day 0 anchor, due +2',
    );
    assert.deepEqual([byName('Child A').startOffsetDays, byName('Child A').dueOffsetDays], [1, 4]);
    assert.deepEqual(
      [byName('Grandchild').startOffsetDays, byName('Grandchild').dueOffsetDays],
      [null, 3],
      'due-only stays due-only',
    );
    assert.deepEqual(
      [byName('Child B').startOffsetDays, byName('Child B').dueOffsetDays],
      [7, null],
      'start-only stays start-only',
    );
    // Root's role placeholder came from the override; the tree structure is preserved.
    assert.equal(byName('Root').assigneeRole, 'Owner');
    assert.equal(byName('Root').parentNodeId, null, 'exactly one root');

    // A task with NEITHER start nor due leaves the template dates blank.
    const noDates = await makeTask(admin, 'No dates');
    const conv2 = await request(app)
      .post(`/api/tasks/${noDates.id}/save-as-template`)
      .set(auth(admin))
      .send({ name: 'Blank dates', includeDescendants: false, includeAttachments: false });
    assert.equal(conv2.status, 201);
    assert.equal(conv2.body.nodes[0].startOffsetDays, null);
    assert.equal(conv2.body.nodes[0].dueOffsetDays, null);
  });

  it('copies attachments into independent template storage, re-copied onto each instantiation', async () => {
    const admin = await adminToken();
    const t = await makeTask(admin, 'Task with a file', {
      startAt: '2026-08-01T00:00:00.000Z',
      dueAt: '2026-08-02T00:00:00.000Z',
    });
    const att = await attachToTask(admin, t.id, { filename: 'spec.pdf', contentType: 'application/pdf', size: 2048 });
    assert.equal(att.status, 201, JSON.stringify(att.body));
    const src = await prisma.attachment.findFirst({ where: { taskId: t.id, commentId: null } });
    assert.ok(src, 'the source task has a task-level attachment');
    // Seed the source blob so the memory-fake copyObject produces a real copy.
    memoryStorage.__put(src!.storageKey, { size: src!.size, contentType: src!.contentType });

    // Convert WITH attachments.
    const conv = await request(app)
      .post(`/api/tasks/${t.id}/save-as-template`)
      .set(auth(admin))
      .send({ name: 'Template with file', includeDescendants: false, includeAttachments: true });
    assert.equal(conv.status, 201, JSON.stringify(conv.body));
    const rootNodeId = conv.body.nodes[0].id as number;
    assert.equal(conv.body.nodes[0].attachmentCount, 1, 'the node carries the copied default attachment');

    const tplAtt = await prisma.taskTemplateNodeAttachment.findFirst({ where: { templateNodeId: rootNodeId } });
    assert.ok(tplAtt, 'a template-scoped attachment row exists');
    assert.notEqual(tplAtt!.storageKey, src!.storageKey, 'it is a COPY (new key), not a reference to the original');
    assert.match(tplAtt!.storageKey, /^templates\//, 'stored under template-scoped storage');
    assert.ok(await memoryStorage.headObject(tplAtt!.storageKey), 'the template blob exists independently');

    // Instantiate → the generated task gets its OWN fresh copy (independent again).
    const inst = await request(app)
      .post(`/api/templates/${conv.body.id}/instantiate`)
      .set(auth(admin))
      .send({ anchorStart: '2026-09-01T00:00:00.000Z' });
    assert.equal(inst.status, 201, JSON.stringify(inst.body));
    const newRoot = inst.body.rootTaskId as number;
    const genAtt = await prisma.attachment.findFirst({ where: { taskId: newRoot, commentId: null } });
    assert.ok(genAtt, 'the instantiated task received the default attachment');
    assert.notEqual(genAtt!.storageKey, tplAtt!.storageKey, 'a fresh copy, independent of the template blob');
    assert.notEqual(genAtt!.storageKey, src!.storageKey);
    assert.match(genAtt!.storageKey, new RegExp(`^tasks/${newRoot}/`));
    assert.ok(await memoryStorage.headObject(genAtt!.storageKey), 'the generated task blob exists');

    // With attachments DISABLED, nothing carries over.
    const conv2 = await request(app)
      .post(`/api/tasks/${t.id}/save-as-template`)
      .set(auth(admin))
      .send({ name: 'No files', includeDescendants: false, includeAttachments: false });
    assert.equal(conv2.status, 201);
    assert.equal(conv2.body.nodes[0].attachmentCount, 0, 'no attachments when the toggle is off');
  });
});

// --- Optimistic concurrency: stale-write guard (backfill) -------------------
// Pins the SEQUENTIAL guard on shipped code: a write carrying an out-of-date
// expectedUpdatedAt is rejected 409 with details.code === 'STALE_WRITE'; the
// current token still saves. (The audit's real bug — the check is non-atomic,
// findUnique-then-write, so a truly concurrent pair can still lose an update —
// is a separate item that this sequential runner cannot exercise.)

describe('optimistic concurrency: stale-write guard (backfill)', () => {
  const PW = 'StalePass123!';

  it('task PATCH: stale token -> 409 STALE_WRITE, current token -> 200', async () => {
    const admin = await adminToken();
    const t = await makeTask(admin, 'Concurrency task');
    const loadedUpdatedAt = t.updatedAt as string;

    // A token from "before" the current state stands in for a concurrent write.
    const stale = new Date(new Date(loadedUpdatedAt).getTime() - 60_000).toISOString();
    const conflict = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(admin))
      .send({ priority: 'High', expectedUpdatedAt: stale });
    assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
    assert.equal(conflict.body.details?.code, 'STALE_WRITE');

    const ok = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(admin))
      .send({ priority: 'High', expectedUpdatedAt: loadedUpdatedAt });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.priority, 'High');
  });

  it('goal PATCH: stale token -> 409 STALE_WRITE, current token -> 200', async () => {
    await seedUser({ email: 'goalowner@test.local', role: 'Member', password: PW });
    const tok = await login('goalowner@test.local', PW);
    const created = await request(app).post('/api/goals').set(auth(tok)).send({
      specific: 'Reduce cycle time',
      metricType: 'Percentage',
      targetValue: 5,
      deadline: '2026-12-31T00:00:00.000Z',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const goalId = created.body.id as number;
    const loadedUpdatedAt = created.body.updatedAt as string;

    const stale = new Date(new Date(loadedUpdatedAt).getTime() - 60_000).toISOString();
    const conflict = await request(app)
      .patch(`/api/goals/${goalId}`)
      .set(auth(tok))
      .send({ specific: 'Reduce cycle time by half', expectedUpdatedAt: stale });
    assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
    assert.equal(conflict.body.details?.code, 'STALE_WRITE');

    const ok = await request(app)
      .patch(`/api/goals/${goalId}`)
      .set(auth(tok))
      .send({ specific: 'Reduce cycle time by half', expectedUpdatedAt: loadedUpdatedAt });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.specific, 'Reduce cycle time by half');
  });
});

// --- Reminders overhaul: access gate (A), add-blocks (B), removal+notify (C),
// terminal statuses (D) ------------------------------------------------------

describe('Reminders overhaul (A/B/C/D)', () => {
  const PW = 'RemindPass123!';

  // Future start so the add-block (B) passes; a large lead makes it due NOW
  // (surfaces when now >= startAt - lead), which is how a reminder becomes due
  // without ever being added on a past start.
  const futureStart = (mins = 30) => new Date(Date.now() + mins * 60_000).toISOString();
  const pastStart = (mins = 60) => new Date(Date.now() - mins * 60_000).toISOString();

  const addReminder = (tok: string, taskId: number, leadMinutes: number) =>
    request(app).post(`/api/tasks/${taskId}/reminders`).set(auth(tok)).send({ leadMinutes });
  const patchTask = (tok: string, taskId: number, body: Record<string, unknown>) =>
    request(app).patch(`/api/tasks/${taskId}`).set(auth(tok)).send(body);
  const reparent = (admin: string, userId: string, supervisorId: string) =>
    request(app).patch(`/api/users/${userId}`).set(auth(admin)).send({ supervisorId });

  // mgr -> emp (assignee); an unrelated member with no access to emp's task.
  async function seedAccessTeam() {
    const mgr = await seedUser({ email: 'rm-mgr@test.local', role: 'Manager', password: PW });
    const emp = await seedUser({ email: 'rm-emp@test.local', role: 'Member', password: PW, supervisorId: mgr.id });
    const out = await seedUser({ email: 'rm-out@test.local', role: 'Member', password: PW });
    return {
      mgr,
      emp,
      out,
      mgrTok: await login('rm-mgr@test.local', PW),
      empTok: await login('rm-emp@test.local', PW),
      outTok: await login('rm-out@test.local', PW),
    };
  }

  // A1 -----------------------------------------------------------------------
  it('A1: a user with no access cannot add a reminder (404, not 201) — closes the IDOR', async () => {
    const admin = await adminToken();
    const t = await seedAccessTeam();
    const task = await makeTask(admin, 'Private-ish task', { assigneeId: t.emp.id, startAt: futureStart() });

    // The unrelated member can't even see the task, so adding a reminder 404s
    // (indistinguishable from missing — no metadata leaks).
    const blocked = await addReminder(t.outTok, task.id, 60);
    assert.equal(blocked.status, 404, JSON.stringify(blocked.body));
    // The assignee (has access) can add one.
    assert.equal((await addReminder(t.empTok, task.id, 60)).status, 201);
  });

  // A2 -----------------------------------------------------------------------
  it('A2: a reminder set while accessible stops surfacing once access is lost', async () => {
    const admin = await adminToken();
    const mgrA = await seedUser({ email: 'a2-a@test.local', role: 'Manager', password: PW });
    const mgrB = await seedUser({ email: 'a2-b@test.local', role: 'Manager', password: PW });
    const emp = await seedUser({ email: 'a2-emp@test.local', role: 'Member', password: PW, supervisorId: mgrA.id });
    const mgrATok = await login('a2-a@test.local', PW);
    const task = await makeTask(admin, 'Live-access task', { assigneeId: emp.id, startAt: futureStart() });

    // mgrA (supervisor of the assignee) adds a due reminder and sees it.
    assert.equal((await addReminder(mgrATok, task.id, 60)).status, 201);
    assert.equal((await getNotifs(mgrATok)).reminders.length, 1, 'supervisor sees the due reminder');

    // Re-parent the employee under mgrB — mgrA loses access; the reminder is gone
    // from mgrA's feed even though the row still exists.
    assert.equal((await reparent(admin, emp.id, mgrB.id)).status, 200);
    assert.equal((await getNotifs(mgrATok)).reminders.length, 0, 'suppressed once access is lost');
  });

  // B ------------------------------------------------------------------------
  it('B: Add is blocked (400) for no start date, a past start date, and a Canceled task', async () => {
    const admin = await adminToken();

    const noStart = await makeTask(admin, 'No start');
    const b1 = await addReminder(admin, noStart.id, 60);
    assert.equal(b1.status, 400);
    assert.match(b1.body.error, /Requires Start Date/i);

    const past = await makeTask(admin, 'Past start', { startAt: pastStart() });
    const b2 = await addReminder(admin, past.id, 60);
    assert.equal(b2.status, 400);
    assert.match(b2.body.error, /Start date has passed/i);

    const canceled = await makeTask(admin, 'To cancel', { startAt: futureStart() });
    assert.equal((await patchTask(admin, canceled.id, { status: 'Canceled' })).status, 200);
    const b3 = await addReminder(admin, canceled.id, 60);
    assert.equal(b3.status, 400);
    assert.match(b3.body.error, /Task canceled/i);

    // A future start with an already-elapsed lead is NOT blocked (useful heads-up):
    // start is 5 min out, a 1-week lead means it's already "due", but Add is allowed.
    const future = await makeTask(admin, 'Future start', { startAt: futureStart(5) });
    const ok = await addReminder(admin, future.id, 10080);
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
  });

  // C: clearing the Start Date -----------------------------------------------
  it('C: clearing the Start Date removes reminders — actor hard-deleted, others soft-canceled + dismissible', async () => {
    const admin = await adminToken();
    const t = await seedAccessTeam();
    const task = await makeTask(admin, 'Start-clear task', { assigneeId: t.emp.id, startAt: futureStart() });

    // Both the assignee (actor) and their supervisor hold a due reminder.
    const empRem = await addReminder(t.empTok, task.id, 60);
    assert.equal(empRem.status, 201);
    assert.equal((await addReminder(t.mgrTok, task.id, 60)).status, 201);
    assert.equal((await getNotifs(t.empTok)).reminders.length, 1);
    assert.equal((await getNotifs(t.mgrTok)).reminders.length, 1);

    // The assignee clears the Start Date.
    assert.equal((await patchTask(t.empTok, task.id, { startAt: null })).status, 200);

    // Actor's own reminder is hard-deleted (feed + the task-detail management list).
    assert.equal((await getNotifs(t.empTok)).reminders.length, 0, "actor's reminder deleted");
    const empOnTask = await request(app).get(`/api/tasks/${task.id}/reminders`).set(auth(t.empTok));
    assert.equal(empOnTask.body.length, 0, 'gone from the task-detail list too');

    // The supervisor's reminder becomes a soft-canceled notice (they still have access).
    const mgrFeed = await getNotifs(t.mgrTok);
    assert.equal(mgrFeed.reminders.length, 1);
    assert.equal(mgrFeed.reminders[0]?.kind, 'canceled');
    assert.equal(mgrFeed.reminders[0]?.canceledReason, 'start-date-removed');

    // Dismiss (Remove) hard-deletes the notice — the only cleanup path.
    const del = await request(app).delete(`/api/reminders/${mgrFeed.reminders[0]!.id}`).set(auth(t.mgrTok));
    assert.equal(del.status, 204);
    assert.equal((await getNotifs(t.mgrTok)).reminders.length, 0);
    assert.equal(await prisma.reminder.count({ where: { taskId: task.id } }), 0, 'no rows remain');
  });

  // C: canceling the task, plus suppression once access is lost ---------------
  it('C: Canceling the task soft-cancels others reminders; a since-lost-access user sees nothing', async () => {
    const admin = await adminToken();
    const mgr = await seedUser({ email: 'c2-mgr@test.local', role: 'Manager', password: PW });
    const mgr2 = await seedUser({ email: 'c2-mgr2@test.local', role: 'Manager', password: PW });
    const emp = await seedUser({ email: 'c2-emp@test.local', role: 'Member', password: PW, supervisorId: mgr.id });
    const mgrTok = await login('c2-mgr@test.local', PW);
    const empTok = await login('c2-emp@test.local', PW);
    const task = await makeTask(admin, 'Cancel task', { assigneeId: emp.id, startAt: futureStart() });

    assert.equal((await addReminder(empTok, task.id, 60)).status, 201);
    assert.equal((await addReminder(mgrTok, task.id, 60)).status, 201);

    // The assignee Cancels the task.
    assert.equal((await patchTask(empTok, task.id, { status: 'Canceled' })).status, 200);

    // Actor's own reminder gone; supervisor sees a "task-canceled" notice.
    assert.equal((await getNotifs(empTok)).reminders.length, 0);
    const mgrFeed = await getNotifs(mgrTok);
    assert.equal(mgrFeed.reminders.length, 1);
    assert.equal(mgrFeed.reminders[0]?.kind, 'canceled');
    assert.equal(mgrFeed.reminders[0]?.canceledReason, 'task-canceled');

    // Re-parent the employee away from mgr — mgr loses access, so the cancel
    // notice is suppressed (A2 gate applies to notices too).
    assert.equal((await reparent(admin, emp.id, mgr2.id)).status, 200);
    assert.equal((await getNotifs(mgrTok)).reminders.length, 0, 'notice suppressed once access is lost');
  });

  // D ------------------------------------------------------------------------
  it('D: a Completed task still fires its reminder; a Canceled task does not', async () => {
    const admin = await adminToken();

    const done = await makeTask(admin, 'Will complete', { startAt: futureStart() });
    assert.equal((await addReminder(admin, done.id, 60)).status, 201);
    assert.equal((await patchTask(admin, done.id, { status: 'Completed' })).status, 200);

    const canceled = await makeTask(admin, 'Will cancel', { startAt: futureStart() });
    assert.equal((await addReminder(admin, canceled.id, 60)).status, 201);
    assert.equal((await patchTask(admin, canceled.id, { status: 'Canceled' })).status, 200);

    const feed = await getNotifs(admin);
    assert.equal(feed.reminders.length, 1, 'only the Completed task still fires');
    assert.equal(feed.reminders[0]?.taskId, done.id);
    assert.equal(feed.reminders[0]?.kind, 'due');
  });
});
