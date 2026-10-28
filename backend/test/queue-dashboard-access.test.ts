import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express, { type Express } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { PrismaClient, Role } from '@prisma/client';
import { startTestDb, type TestDb } from './db.js';

/**
 * The queue dashboard inside the API: an Admin who opens it with the website's
 * button gets in with no user name and password, until the browser is closed;
 * everyone else is asked for them, as before. Same harness as
 * integration.test.ts: a real ephemeral Postgres with the project's migrations.
 */

let db: TestDb;
let app: Express;
let prisma: PrismaClient;
let hashPassword: (plaintext: string) => Promise<string>;

const SECRET = 'queue-dashboard-test-secret';
const WEBSITE = 'http://localhost:5173';
const PASSWORD = 'TestPass123!';
const BOARD_USER = 'hl-team';
const BOARD_PASSWORD = 'a-long-random-password-1234';
const COOKIE = 'hl_queue_dashboard';

before(async () => {
  db = await startTestDb();
  process.env.DATABASE_URL = db.databaseUrl;
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.FRONTEND_URL = WEBSITE;
  process.env.CORS_ORIGIN = WEBSITE;
  process.env.EMAIL_PROVIDER = 'console';
  process.env.EMAIL_DELIVERY = 'direct';
  delete process.env.REDIS_URL;
  process.env.NODE_ENV = 'test';
  process.env.GOOGLE_CLIENT_ID = 'test-google-client.apps.googleusercontent.com';
  process.env.GOOGLE_ALLOWED_DOMAIN = '';
  process.env.STORAGE_DRIVER = 'memory';
  process.env.EXCLUSIVES_SWEEP_ENABLED = 'false';

  const [appMod, prismaMod, pwMod] = await Promise.all([
    import('../src/app.js'),
    import('../src/db/prisma.js'),
    import('../src/utils/password.js'),
  ]);
  // A stand-in for the board: the real one needs Redis.
  const router = express.Router();
  router.get('/', (_req, res) => {
    res.send('board');
  });
  router.get('/api/queues', (_req, res) => {
    res.json({ queues: [] });
  });
  app = appMod.createApp({
    queueDashboard: { path: '/bullmq', router, user: BOARD_USER, password: BOARD_PASSWORD },
  });
  prisma = prismaMod.prisma;
  hashPassword = pwMod.hashPassword;
});

after(async () => {
  await prisma?.$disconnect();
  await db?.stop();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" RESTART IDENTITY CASCADE');
});

// --- helpers ---------------------------------------------------------------

async function seedUser(email: string, role: Role) {
  return prisma.user.create({
    data: {
      email,
      role,
      firstName: email.split('@')[0]!,
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

/** The website's button: its form, sent from `origin`. */
function enter(token: string | undefined, origin: string | null = WEBSITE) {
  const req = request(app).post('/bullmq/enter').type('form');
  if (origin !== null) req.set('Origin', origin);
  return req.send(token === undefined ? {} : { token });
}

const setCookies = (res: request.Response): string[] => {
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  return raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
};

/** The pass the button gave, as the browser sends it back. */
function passFrom(res: request.Response): string {
  const cookie = setCookies(res).find((c) => c.startsWith(`${COOKIE}=`));
  assert.ok(cookie, 'a pass was given');
  return cookie.split(';')[0]!.slice(COOKIE.length + 1);
}

const board = (pass: string, path = '/bullmq') =>
  request(app).get(path).set('Cookie', `${COOKIE}=${pass}`);

const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

async function adminPass(email = 'ada@test.local') {
  const user = await seedUser(email, 'Admin');
  const res = await enter(await login(email));
  return { user, pass: passFrom(res) };
}

function assertAsked(res: request.Response) {
  assert.equal(res.status, 401);
  assert.match(res.headers['www-authenticate'] ?? '', /^Basic realm="HL Central queues"/);
  assert.doesNotMatch(res.text, /board/);
}

// --- tests -----------------------------------------------------------------

describe('the dashboard’s button', () => {
  it('lets an Admin in with no user name and password, until the browser is closed', async () => {
    await seedUser('ada@test.local', 'Admin');
    const res = await enter(await login('ada@test.local'));

    assert.equal(res.status, 303);
    assert.equal(res.headers.location, '/bullmq');
    const cookie = setCookies(res).find((c) => c.startsWith(`${COOKIE}=`));
    assert.ok(cookie);
    const flags = cookie.split(';').map((f) => f.trim().toLowerCase());
    for (const flag of ['path=/bullmq', 'httponly', 'secure', 'samesite=lax']) {
      assert.ok(flags.includes(flag), `${flag} in ${cookie}`);
    }
    // No date of its own: the browser drops it when it is closed.
    assert.ok(!flags.some((f) => f.startsWith('expires=') || f.startsWith('max-age=')), cookie);

    for (const path of ['/bullmq', '/bullmq/api/queues']) {
      const page = await board(passFrom(res), path);
      assert.equal(page.status, 200, path);
      assert.equal(page.headers['www-authenticate'], undefined);
      assert.equal(page.headers['cache-control'], 'no-store');
    }
    assert.equal((await board(passFrom(res))).text, 'board');
  });

  it('gives a pass that lasts 12 hours at most, even if the browser is never closed', async () => {
    const { pass } = await adminPass();
    const { iat, exp } = jwt.decode(pass) as { iat: number; exp: number };
    assert.equal(exp - iat, 12 * 3600);
  });

  it('gives no pass to anyone else, who is asked for the user name and password', async () => {
    await seedUser('ada@test.local', 'Admin');
    await seedUser('max@test.local', 'Manager');
    await seedUser('mia@test.local', 'Member');
    const adminSignIn = await login('ada@test.local');
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'ada@test.local' } });
    const expired = jwt.sign(
      {
        sub: admin.id,
        email: admin.email,
        role: 'Admin',
        tv: admin.tokenVersion,
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      SECRET,
    );
    const tries: [string, string | undefined, string | null][] = [
      ['a Manager', await login('max@test.local'), WEBSITE],
      ['a Member', await login('mia@test.local'), WEBSITE],
      ['no sign-in', undefined, WEBSITE],
      ['an expired sign-in', expired, WEBSITE],
      ['an altered sign-in', `${adminSignIn.slice(0, -2)}xx`, WEBSITE],
      ['another site', adminSignIn, 'https://elsewhere.example'],
      ['no Origin', adminSignIn, null],
    ];
    for (const [who, token, origin] of tries) {
      const res = await enter(token, origin);
      assert.equal(res.status, 303, who);
      assert.equal(res.headers.location, '/bullmq', who);
      assert.deepEqual(setCookies(res), [], who);
    }
    assertAsked(await request(app).get('/bullmq'));
  });

  it('stops letting an Admin in once they are switched off, made a Manager, or signed out everywhere', async () => {
    const changes = [
      { isActive: false },
      { role: 'Manager' as const },
      { tokenVersion: { increment: 1 } },
    ];
    for (const [i, change] of changes.entries()) {
      const { user, pass } = await adminPass(`admin${i}@test.local`);
      assert.equal((await board(pass)).status, 200);
      await prisma.user.update({ where: { id: user.id }, data: change });

      const res = await board(pass);
      assertAsked(res);
      // The pass is dropped, so it isn't tried again.
      const cleared = setCookies(res).find((c) => c.startsWith(`${COOKIE}=;`));
      assert.ok(cleared, JSON.stringify(change));
      assert.match(cleared, /Expires=Thu, 01 Jan 1970/);
    }
  });

  it('refuses an altered pass, and an HL Central sign-in in its place', async () => {
    await seedUser('ada@test.local', 'Admin');
    const signIn = await login('ada@test.local');
    const pass = passFrom(await enter(signIn));
    assertAsked(await board(`${pass.slice(0, -2)}xx`));
    assertAsked(await board(signIn));
  });

  it('a pass is no sign-in to the rest of the API', async () => {
    const { pass } = await adminPass();
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${pass}`);
    assert.equal(res.status, 401);
  });

  it('still lets the user name and password in, with no pass', async () => {
    assertAsked(await request(app).get('/bullmq'));
    const res = await request(app)
      .get('/bullmq')
      .set('Authorization', basic(BOARD_USER, BOARD_PASSWORD));
    assert.equal(res.status, 200);
    assert.equal(res.text, 'board');
  });
});
