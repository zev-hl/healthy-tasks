import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { queueDashboardMode } from '../../src/config/startup-checks.js';
import { basicCredentials, requireBasicAuth } from '../../src/middleware/basic-auth.js';
import { emailForDisplay } from '../../src/queue/dashboard-board.js';

// createApp loads env.ts, which needs these two; any value will do here.
process.env.DATABASE_URL ??= 'postgresql://unit:unit@localhost:5432/unit';
process.env.JWT_SECRET ??= 'unit-test-secret';
const { createApp } = await import('../../src/app.js');

const USER = 'hl-team';
const PASSWORD = 'a-long-random-password-1234';

function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

describe('whether the API serves the queue dashboard', () => {
  it('is off, quietly, when neither setting is given', () => {
    const mode = queueDashboardMode({ emailDelivery: 'queue' });
    assert.equal(mode.on, false);
    assert.equal(mode.misconfigured, false);
    assert.equal(mode.summary, 'queue dashboard: off');
  });

  it('is on with the queue, both settings and a long enough password', () => {
    const mode = queueDashboardMode({ emailDelivery: 'queue', user: USER, password: PASSWORD });
    assert.equal(mode.on, true);
    assert.match(mode.summary, /on at \/bullmq \(password protected\)/);
    assert.ok(mode.on && mode.user === USER && mode.password === PASSWORD);
  });

  it('stays off, with a warning, when the settings cannot be used', () => {
    const cases = [
      [{ emailDelivery: 'queue', user: USER }, /set both/],
      [{ emailDelivery: 'queue', password: PASSWORD }, /set both/],
      [{ emailDelivery: 'direct', user: USER, password: PASSWORD }, /EMAIL_DELIVERY/],
      [{ emailDelivery: 'queue', user: USER, password: 'fifteen-chars!!' }, /shorter than 16/],
    ] as const;
    for (const [cfg, reason] of cases) {
      const mode = queueDashboardMode(cfg);
      assert.equal(mode.on, false);
      assert.equal(mode.misconfigured, true);
      assert.match(mode.summary, reason);
    }
  });

  it('accepts a password of exactly 16 characters', () => {
    const mode = queueDashboardMode({
      emailDelivery: 'queue',
      user: USER,
      password: 'x'.repeat(16),
    });
    assert.equal(mode.on, true);
  });
});

describe('reading the browser’s sign-in', () => {
  it('reads the user name and password', () => {
    assert.deepEqual(basicCredentials(basic(USER, PASSWORD)), { user: USER, password: PASSWORD });
  });

  it('keeps a colon inside the password', () => {
    assert.deepEqual(basicCredentials(basic('a', 'b:c')), { user: 'a', password: 'b:c' });
  });

  it('ignores anything that is not a Basic sign-in', () => {
    assert.equal(basicCredentials(undefined), undefined);
    assert.equal(basicCredentials(''), undefined);
    assert.equal(basicCredentials('Bearer abc.def.ghi'), undefined);
    assert.equal(basicCredentials('Basic not base64!'), undefined);
    assert.equal(
      basicCredentials(`Basic ${Buffer.from('no-colon').toString('base64')}`),
      undefined,
    );
  });
});

describe('the password check', () => {
  const app = express();
  app.use('/bullmq', requireBasicAuth(USER, PASSWORD, 'HL Central queues'), (_req, res) => {
    res.send('board');
  });

  it('asks the browser for a sign-in when none is sent', async () => {
    const res = await request(app).get('/bullmq');
    assert.equal(res.status, 401);
    assert.match(res.headers['www-authenticate'] ?? '', /^Basic realm="HL Central queues"/);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.doesNotMatch(res.text, /board/);
  });

  it('refuses a wrong password, a wrong user name and an app token', async () => {
    for (const authorization of [
      basic(USER, 'wrong-password-but-long'),
      basic('someone-else', PASSWORD),
      basic(USER, `${PASSWORD}x`),
      'Bearer abc.def.ghi',
    ]) {
      const res = await request(app).get('/bullmq').set('Authorization', authorization);
      assert.equal(res.status, 401, authorization);
    }
  });

  it('lets the right user name and password through, on every page below it', async () => {
    for (const path of ['/bullmq', '/bullmq/api/queues']) {
      const res = await request(app).get(path).set('Authorization', basic(USER, PASSWORD));
      assert.equal(res.status, 200, path);
      assert.equal(res.text, 'board');
      assert.equal(res.headers['cache-control'], 'no-store');
    }
  });
});

describe('the dashboard inside the API', () => {
  const router = express.Router();
  router.get('/', (_req, res) => {
    res.send('board');
  });

  it('does not exist unless server.ts passes it (as under every test)', async () => {
    const res = await request(createApp()).get('/bullmq');
    assert.equal(res.status, 404);
  });

  it('sits behind the password when passed', async () => {
    const app = createApp({
      queueDashboard: { path: '/bullmq', router, user: USER, password: PASSWORD },
    });
    assert.equal((await request(app).get('/bullmq')).status, 401);
    const res = await request(app).get('/bullmq').set('Authorization', basic(USER, PASSWORD));
    assert.equal(res.status, 200);
    assert.equal(res.text, 'board');
    // The rest of the API is unaffected.
    assert.equal((await request(app).get('/health')).status, 200);
  });
});

describe('emails on the dashboard', () => {
  const job = {
    v: 1,
    emailId: 'email-1',
    kind: 'password-reset',
    to: 'a@example.com',
    subject: 'Reset your HL Central password',
    text: 'Open this link: https://hl.example/reset-password?token=abc123secret',
    html: '<a href="https://hl.example/reset-password?token=abc123secret">Reset</a>',
  };

  it('hides the sign-in token in links', () => {
    const shown = emailForDisplay(job) as typeof job;
    assert.equal(shown.text, 'Open this link: https://hl.example/reset-password?token=[redacted]');
    assert.doesNotMatch(shown.html, /abc123secret/);
    assert.equal(shown.to, job.to);
    assert.equal(shown.subject, job.subject);
  });

  it('leaves the job itself untouched, so a retry sends the real link', () => {
    emailForDisplay(job);
    assert.match(job.text, /token=abc123secret/);
  });

  it('passes anything that is not an email through', () => {
    assert.equal(emailForDisplay(undefined), undefined);
    assert.equal(emailForDisplay('text'), 'text');
    assert.deepEqual(emailForDisplay({ deleted: 3 }), { deleted: 3 });
  });
});
