import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { startTestDb, type TestDb } from './db.js';

/** Nov 2026 plan, Stage 5 (HL Central's part): keep me signed in, sign out everywhere. */

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
