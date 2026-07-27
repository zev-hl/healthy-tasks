import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient, Role } from '@prisma/client';
import { startTestDb, type TestDb } from './db.js';

let db: TestDb;
let app: Express;
let prisma: PrismaClient;
let hashPassword: (plaintext: string) => Promise<string>;

const ADMIN_EMAIL = 'admin@test.local';
const ADMIN_PASSWORD = 'AdminPass123!';

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
    'TRUNCATE TABLE "Task", "PasswordResetToken", "User" RESTART IDENTITY CASCADE',
  );
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
      .send({ email: 'newbie@test.local', role: 'Member', title: 'Analyst' });

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
      .send({ email: 'report@test.local', role: 'Member', supervisorId: member.id });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /Manager or Admin/);
  });

  it('allows a Manager as supervisor', async () => {
    const token = await adminToken();
    const mgr = await seedUser({ email: 'boss@test.local', role: 'Manager' });

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'report2@test.local', role: 'Member', supervisorId: mgr.id });

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
      .send({ email: 'reset@test.local', role: 'Member' });
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
      .send({ email: 'once@test.local', role: 'Member' });
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
    // Minimal ref shape — no role/supervisor leakage.
    assert.equal('role' in res.body[0], false);
    assert.equal('supervisorId' in res.body[0], false);
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
    const { pred, task } = await taskBlockedBy(tok);

    const done = await request(app)
      .patch(`/api/tasks/${pred.id}`)
      .set(auth(tok))
      .send({ status: 'Completed' });
    assert.equal(done.status, 200);

    const review = await request(app)
      .patch(`/api/tasks/${task.id}`)
      .set(auth(tok))
      .send({ status: 'Review' });
    assert.equal(review.status, 200);

    const completed = await request(app)
      .patch(`/api/tasks/${task.id}`)
      .set(auth(tok))
      .send({ status: 'Completed' });
    assert.equal(completed.status, 200);
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
