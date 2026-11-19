import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { startTestDb, type TestDb } from './db.js';

/**
 * Nov 2026 plan, Stage 5 (HL Central's part): keep me signed in, sign out
 * everywhere; and the file cabinet (I3).
 */

let db: TestDb;
let app: Express;
let prisma: PrismaClient;
let prismaWithDeleted: PrismaClient;
let hashPassword: (plaintext: string) => Promise<string>;

const PW = 'Stage5Pass123!';
const ME = 'me@test.local';

before(async () => {
  db = await startTestDb();
  process.env.DATABASE_URL = db.databaseUrl;
  process.env.JWT_SECRET = 'stage5-test-secret';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.KEEP_SIGNED_IN_DAYS = '30';
  process.env.FRONTEND_URL = 'http://localhost:5173';
  process.env.EMAIL_PROVIDER = 'console';
  process.env.EMAIL_DELIVERY = 'direct';
  delete process.env.REDIS_URL;
  process.env.NODE_ENV = 'test';
  process.env.GOOGLE_ALLOWED_DOMAIN = '';
  process.env.STORAGE_DRIVER = 'memory';
  process.env.EXCLUSIVES_SWEEP_ENABLED = 'false';
  const [appMod, prismaMod, pwMod] = await Promise.all([
    import('../src/app.js'),
    import('../src/db/prisma.js'),
    import('../src/utils/password.js'),
  ]);
  app = appMod.createApp();
  prisma = prismaMod.prisma;
  prismaWithDeleted = prismaMod.prismaWithDeleted;
  hashPassword = pwMod.hashPassword;
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
  await prisma.user.create({
    data: { email: ME, role: 'Member', passwordHash: await hashPassword(PW) },
  });
});

async function signIn(remember?: boolean): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: ME, password: PW, ...(remember !== undefined && { remember }) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token as string;
}

/** Seconds from issue to expiry. */
const lifetime = (token: string) => {
  const p = jwt.decode(token) as { iat: number; exp: number; rm?: boolean };
  return { secs: p.exp - p.iat, rm: p.rm };
};
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Keep me signed in on this device', () => {
  it('without it, a sign-in lasts the short idle window', async () => {
    const t = await signIn();
    assert.deepEqual(lifetime(t), { secs: 15 * 60, rm: undefined });
    assert.equal(lifetime(await signIn(false)).secs, 15 * 60);
  });

  it('with it, a sign-in lasts KEEP_SIGNED_IN_DAYS, and stays so as it slides', async () => {
    const t = await signIn(true);
    assert.deepEqual(lifetime(t), { secs: 30 * 86400, rm: true });
    const res = await request(app).get('/api/auth/me').set(auth(t));
    assert.equal(res.status, 200);
    const refreshed = res.headers['x-refreshed-token'] as string;
    assert.deepEqual(lifetime(refreshed), { secs: 30 * 86400, rm: true });
  });

  it('a short sign-in never turns into a long one as it slides', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set(auth(await signIn()));
    assert.equal(lifetime(res.headers['x-refreshed-token'] as string).secs, 15 * 60);
  });

  it('refuses anything but true/false', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ME, password: PW, remember: 'yes' });
    assert.equal(res.status, 400);
  });
});

describe('Sign out everywhere', () => {
  it('ends every sign-in of mine, kept ones and this one', async () => {
    const kept = await signIn(true);
    const here = await signIn();
    const res = await request(app).post('/api/auth/sign-out-everywhere').set(auth(here));
    assert.equal(res.status, 204);
    for (const t of [kept, here]) {
      assert.equal((await request(app).get('/api/auth/me').set(auth(t))).status, 401);
    }
    // A fresh sign-in works again.
    assert.equal(
      (
        await request(app)
          .get('/api/auth/me')
          .set(auth(await signIn()))
      ).status,
      200,
    );
  });

  it('needs a sign-in', async () => {
    assert.equal((await request(app).post('/api/auth/sign-out-everywhere')).status, 401);
  });
});

describe('File cabinet (I3)', () => {
  /** Two people; a department with a duty; tasks with files on them and in comments. */
  async function setUp() {
    const me = await prisma.user.findUniqueOrThrow({ where: { email: ME } });
    const other = await prisma.user.create({
      data: { email: 'other@test.local', role: 'Member', passwordHash: await hashPassword(PW) },
    });
    const dept = await prisma.department.create({
      data: { name: 'Listings', nameKey: 'listings', color: '#3366ff' },
    });
    const duty = await prisma.duty.create({
      data: { departmentId: dept.id, name: 'Photos', nameKey: 'photos' },
    });
    const task = (name: string, assigneeId: string, extra: Record<string, unknown> = {}) =>
      prisma.task.create({
        data: { name, creatorId: assigneeId, assigneeId, ...extra },
      });
    const mine = await task('Product shots', me.id, { dutyId: duty.id });
    const open = await task('Supplier contract', other.id);
    const secret = await task('Salary review', other.id, { isPrivate: true });
    const gone = await task('Old task', me.id, { deletedAt: new Date() });
    const comment = await prisma.comment.create({
      data: { taskId: open.id, authorId: other.id, body: '<p>here</p>' },
    });
    let n = 0;
    const file = (
      filename: string,
      contentType: string,
      on: { taskId?: number; commentId?: string },
      extra: Record<string, unknown> = {},
    ) =>
      prisma.attachment.create({
        data: {
          filename,
          contentType,
          size: 1000,
          storageKey: `k/${++n}`,
          uploadedById: on.commentId ? other.id : me.id,
          createdAt: new Date(Date.UTC(2026, 10, 1 + n, 15)),
          ...on,
          ...extra,
        },
      });
    await file('front.jpg', 'image/jpeg', { taskId: mine.id });
    await file('contract.pdf', 'application/pdf', { taskId: open.id });
    await file(
      'note.webm',
      'audio/webm',
      { commentId: comment.id },
      {
        recording: 'voice',
        durationMs: 4000,
        transcript: 'call the supplier about pallets',
      },
    );
    await file('song.mp3', 'audio/mpeg', { commentId: comment.id });
    await file('pay.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', {
      taskId: secret.id,
    });
    await file('old.png', 'image/png', { taskId: gone.id });
    return { me, other, dept, mine, open };
  }

  const list = async (token: string, query: Record<string, string> = {}) => {
    const res = await request(app).get('/api/files').query(query).set(auth(token));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body as {
      files: { filename: string; on: string; task: { name: string }; department: unknown }[];
      next: string | null;
    };
  };
  const names = (b: { files: { filename: string }[] }) => b.files.map((f) => f.filename);

  it('lists the files I may see, newest first: not a private task of someone else, not a deleted task', async () => {
    const { dept } = await setUp();
    const b = await list(await signIn());
    assert.deepEqual(names(b), ['song.mp3', 'note.webm', 'contract.pdf', 'front.jpg']);
    const front = b.files.find((f) => f.filename === 'front.jpg')!;
    assert.equal(front.on, 'task');
    assert.deepEqual(front.department, { id: dept.id, name: 'Listings', color: '#3366ff' });
    const note = b.files.find((f) => f.filename === 'note.webm')!;
    assert.equal(note.on, 'comment');
    assert.equal(note.task.name, 'Supplier contract');
  });

  it("an Admin sees private tasks' files too (never a deleted task's)", async () => {
    await setUp();
    await prisma.user.update({ where: { email: ME }, data: { role: 'Admin' } });
    assert.ok(names(await list(await signIn())).includes('pay.xlsx'));
    assert.ok(!names(await list(await signIn())).includes('old.png'));
  });

  it('filters by kind, words (name, transcript, task), department, uploader and dates', async () => {
    const { other, dept } = await setUp();
    const t = await signIn();
    assert.deepEqual(names(await list(t, { kind: 'recording' })), ['note.webm']);
    assert.deepEqual(names(await list(t, { kind: 'audio' })), ['song.mp3']);
    assert.deepEqual(names(await list(t, { kind: 'document' })), ['contract.pdf']);
    assert.deepEqual(names(await list(t, { kind: 'image' })), ['front.jpg']);
    assert.deepEqual(names(await list(t, { q: 'PALLETS' })), ['note.webm']);
    assert.deepEqual(names(await list(t, { q: 'shots' })), ['front.jpg']);
    assert.deepEqual(names(await list(t, { departmentId: dept.id })), ['front.jpg']);
    assert.deepEqual(names(await list(t, { uploadedById: other.id })), ['song.mp3', 'note.webm']);
    // Created Nov 2, 3, 4, 5 at 15:00 UTC.
    assert.deepEqual(names(await list(t, { from: '2026-11-03', to: '2026-11-04' })), [
      'note.webm',
      'contract.pdf',
    ]);
    const bad = await request(app).get('/api/files').query({ kind: 'pics' }).set(auth(t));
    assert.equal(bad.status, 400);
  });

  it('pages through 50 at a time', async () => {
    const { mine, me } = await setUp();
    await prisma.attachment.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        filename: `bulk-${i}.txt`,
        contentType: 'text/plain',
        size: 1,
        storageKey: `bulk/${i}`,
        uploadedById: me.id,
        taskId: mine.id,
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)),
      })),
    });
    const t = await signIn();
    const first = await list(t);
    assert.equal(first.files.length, 50);
    assert.ok(first.next);
    const second = await list(t, { cursor: first.next! });
    assert.equal(second.files.length, 14);
    assert.equal(second.next, null);
    assert.equal(new Set([...names(first), ...names(second)]).size, 64);
  });
});
