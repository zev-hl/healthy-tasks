import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient, Role } from '@prisma/client';
import { startTestDb, type TestDb } from './db.js';
import { memoryStorage } from '../src/storage/memory.storage.js';

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
    'TRUNCATE TABLE "Task", "PasswordResetToken", "User" RESTART IDENTITY CASCADE',
  );
  // CASCADE also clears Comment/Attachment/CommentMention/MentionEvent.
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
      .send({ email: 'newbie@test.local', firstName: 'New', lastName: 'Bie', role: 'Member', title: 'Analyst' });

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
      .send({ email: 'report@test.local', firstName: 'Rep', lastName: 'Ort', role: 'Member', supervisorId: member.id });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /Manager or Admin/);
  });

  it('allows a Manager as supervisor', async () => {
    const token = await adminToken();
    const mgr = await seedUser({ email: 'boss@test.local', role: 'Manager' });

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'report2@test.local', firstName: 'Rep', lastName: 'Two', role: 'Member', supervisorId: mgr.id });

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
    const res = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set(auth(tok))
      .send({
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
    await seedUser({
      email: 'memB@test.local',
      role: 'Member',
      password: MEMBER_PASSWORD,
      supervisorId: manager.id,
    });
    await seedUser({ email: 'memC@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const memberTok = await login('memB@test.local', MEMBER_PASSWORD);
    const outsiderTok = await login('memC@test.local', MEMBER_PASSWORD);
    const managerTok = await login('mgrA@test.local', MEMBER_PASSWORD);
    const t = await makeTask(admin, 'Perm');

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
    await seedUser({ email: 'author@test.local', role: 'Member', password: MEMBER_PASSWORD });
    await seedUser({ email: 'other@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const authorTok = await login('author@test.local', MEMBER_PASSWORD);
    const otherTok = await login('other@test.local', MEMBER_PASSWORD);
    const t = await makeTask(admin, 'Commented');

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
    const edited = (res.body.comments as { id: string; editedAt: string | null; body: string }[]).find(
      (x) => x.id === c.id,
    )!;
    assert.ok(edited.editedAt, 'editedAt should be set after an edit');
    assert.match(edited.body, /Edited/);

    // Author deletes.
    res = await request(app).delete(`/api/comments/${c.id}`).set(auth(authorTok));
    assert.equal(res.status, 200);
    assert.equal(res.body.comments.length, 0);
  });

  it('restricts comment attachments to the comment author', async () => {
    const admin = await adminToken();
    await seedUser({ email: 'ca@test.local', role: 'Member', password: MEMBER_PASSWORD });
    await seedUser({ email: 'cb@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const aTok = await login('ca@test.local', MEMBER_PASSWORD);
    const bTok = await login('cb@test.local', MEMBER_PASSWORD);
    const t = await makeTask(admin, 'CommentAtt');
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
    await seedUser({ email: 'mauthor@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const authorTok = await login('mauthor@test.local', MEMBER_PASSWORD);
    const t = await makeTask(admin, 'Mentions');
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
    const u1 = await seedUser({ email: 'm1@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const u2 = await seedUser({ email: 'm2@test.local', role: 'Member', password: MEMBER_PASSWORD });
    await seedUser({ email: 'm3@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const authorTok = await login('m3@test.local', MEMBER_PASSWORD);
    const t = await makeTask(admin, 'MentionsAdd');

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
    await request(app).patch(`/api/tasks/${t1.id}`).set(auth(tok)).send({ tags: ['apple'] });
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
      .send({ status: 'InProgress', priority: 'High', assigneeId: assignee.id, dueAt: '2026-09-01T10:00:00Z' });

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
    await request(app).put(`/api/tasks/${child.id}/parent`).set(auth(tok)).send({ parentId: parent.id });
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
    const confirm = await attachToTask(tok, t.id, { filename: 'report.pdf', contentType: 'application/pdf' });
    const attId = (confirm.body.attachments as { id: string }[])[0].id;
    await request(app).delete(`/api/attachments/${attId}`).set(auth(tok));

    const attEntries = (await history(tok, t.id)).filter((e) => e.field === 'attachment');
    assert.equal(attEntries.length, 2);
    assert.ok(attEntries.every((e) => e.detail === 'report.pdf'));
    assert.deepEqual(attEntries.map((e) => e.changeType).sort(), ['added', 'removed']);
  });

  it('logs comment add/edit/delete (by the author) without storing the text', async () => {
    const admin = await adminToken();
    await seedUser({ email: 'cauth@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const authorTok = await login('cauth@test.local', MEMBER_PASSWORD);
    const t = await makeTask(admin, 'Cmt hist');

    const add = await request(app).post(`/api/tasks/${t.id}/comments`).set(auth(authorTok)).send({ body: '<p>hi</p>' });
    const cid = add.body.comments[0].id as string;
    await request(app).patch(`/api/comments/${cid}`).set(auth(authorTok)).send({ body: '<p>edited</p>' });
    await request(app).delete(`/api/comments/${cid}`).set(auth(authorTok));

    const cmt = (await history(admin, t.id)).filter((e) => e.field === 'comment');
    assert.deepEqual(cmt.map((e) => e.changeType).sort(), ['added', 'removed', 'updated']);
    assert.ok(cmt.every((e) => e.previousValue === null && e.newValue === null && e.detail === null));
    assert.ok(cmt.every((e) => e.user?.email === 'cauth@test.local'));
  });

  it('is visible to any authenticated user with access to the task', async () => {
    const admin = await adminToken();
    await seedUser({ email: 'viewer@test.local', role: 'Member', password: MEMBER_PASSWORD });
    const viewerTok = await login('viewer@test.local', MEMBER_PASSWORD);
    const t = await makeTask(admin, 'Shared');
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
      .send({ firstName: 'Jane', lastName: 'Doe', title: 'Lead', role: 'Manager', isActive: false });
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
    const report = await seedUser({ email: 'report3@test.local', role: 'Member', supervisorId: dup.id });

    // A task created by the duplicate, and a task assigned to the duplicate.
    const dupTok = await login('dup@test.local', MEMBER_PASSWORD);
    const created = await makeTask(dupTok, 'By dup');
    const assigned = await makeTask(adminTok, 'Assigned to dup');
    await request(app).patch(`/api/tasks/${assigned.id}`).set(auth(adminTok)).send({ assigneeId: dup.id });

    const merge = await request(app)
      .post('/api/users/merge')
      .set(auth(adminTok))
      .send({
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
    const res = await request(app)
      .post('/api/users/merge')
      .set(auth(adminTok))
      .send({
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
    const res = await request(app)
      .post('/api/users/merge')
      .set(auth(memberTok))
      .send({
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

  it('due-date range respects the include-no-due toggle', async () => {
    const tok = await adminToken();
    await makeTask(tok, 'Has due', { dueAt: '2026-09-15T12:00:00Z' });
    await makeTask(tok, 'No due');

    const withNoDue = await queryTasks(tok, {
      filters: { dueFrom: '2026-09-01T00:00:00Z', dueTo: '2026-09-30T23:59:59Z' },
    });
    assert.equal(withNoDue.total, 2, 'no-due task included by default');

    const excluded = await queryTasks(tok, {
      filters: { dueFrom: '2026-09-01T00:00:00Z', dueTo: '2026-09-30T23:59:59Z', includeNoDue: false },
    });
    assert.equal(excluded.total, 1);
    assert.equal(excluded.rows[0]?.name, 'Has due');
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
    await request(app).put(`/api/tasks/${child.id}/parent`).set(auth(tok)).send({ parentId: parent.id });

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
  return { now: now.toISOString(), todayStart: todayStart.toISOString(), todayEnd: todayEnd.toISOString() };
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
      .send({ sort: [{ field: 'firstName', dir: 'asc' }, { field: 'lastName', dir: 'asc' }], pageSize: 2, page: 1 });
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
