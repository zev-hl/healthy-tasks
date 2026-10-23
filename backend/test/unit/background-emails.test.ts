import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Settings are read at import time: console mailer, direct delivery, no Redis.
let mailer: typeof import('../../src/utils/mailer.js');

before(async () => {
  process.env.EMAIL_PROVIDER = 'console';
  process.env.EMAIL_DELIVERY = 'direct';
  delete process.env.REDIS_URL;
  mailer = await import('../../src/utils/mailer.js');
});

const later = (ms: number, then: () => void) =>
  new Promise<void>((resolve) => setTimeout(() => (then(), resolve()), ms));

// A script (alert-tasks:run) waits on these before it closes the email queue
// and exits, so no email it started is cut off.
describe('backgroundEmailsSent', () => {
  it('returns at once when nothing is being sent', async () => {
    await mailer.backgroundEmailsSent();
  });

  it('waits for every email still being handed over', async () => {
    const done: string[] = [];
    mailer.sendInBackground('one', () => later(30, () => done.push('one')));
    mailer.sendInBackground('two', () => later(60, () => done.push('two')));
    assert.deepEqual(done, []);

    await mailer.backgroundEmailsSent();
    assert.deepEqual(done, ['one', 'two']);
  });

  it('does not fail on an email that could not be sent', async () => {
    const error = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => logged.push(args[0]);
    try {
      mailer.sendInBackground('broken', () => Promise.reject(new Error('SMTP down')));
      await mailer.backgroundEmailsSent();
    } finally {
      console.error = error;
    }
    assert.deepEqual(logged, ['Email not sent (broken):']);
  });
});
