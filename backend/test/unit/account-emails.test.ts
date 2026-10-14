import { before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Settings are read at import time: console mailer, direct delivery, no Redis.
// (With EMAIL_DELIVERY=queue the same emails go to the queue instead; that path
// is the same queueEmail call, covered in email-queue.test.ts.)
let emails: typeof import('../../src/utils/account-emails.js');
let mailer: typeof import('../../src/utils/mailer.js');

before(async () => {
  process.env.EMAIL_PROVIDER = 'console';
  process.env.EMAIL_DELIVERY = 'direct';
  delete process.env.REDIS_URL;
  emails = await import('../../src/utils/account-emails.js');
  mailer = await import('../../src/utils/mailer.js');
});

beforeEach(() => mailer.__resetSentEmails());

/** The console mailer prints each email; keep test output quiet. */
async function quietly(send: () => Promise<void>): Promise<void> {
  const log = console.log;
  console.log = () => {};
  try {
    await send();
  } finally {
    console.log = log;
  }
}

describe('account emails', () => {
  it('welcomes a new password account with its set-password link', async () => {
    const link = 'http://localhost:5173/reset-password?token=abc';
    const expiresAt = new Date(Date.now() + 60 * 60_000);
    await quietly(() => emails.sendNewAccountEmail('new@example.com', link, expiresAt));

    assert.equal(mailer.sentEmails.length, 1);
    const [email] = mailer.sentEmails;
    assert.equal(email!.to, 'new@example.com');
    assert.equal(email!.subject, 'Welcome to HL Central');
    assert.match(email!.text, /Welcome aboard!/);
    assert.ok(email!.text.includes(link));
    assert.match(email!.text, /for the next 60 minutes/);
  });

  it('tells a Google account where to sign in, with no link to set a password', async () => {
    await quietly(() =>
      emails.sendGoogleWelcomeEmail('someone@company.test', 'http://localhost:5173'),
    );
    const [email] = mailer.sentEmails;
    assert.equal(email!.subject, 'Your HL Central account is ready');
    assert.match(email!.text, /Sign in with Google/);
    assert.ok(email!.text.includes('http://localhost:5173'));
    assert.doesNotMatch(email!.text, /token=/);
  });

  it('sends the password reset link', async () => {
    const link = 'http://localhost:5173/reset-password?token=xyz';
    await quietly(() => emails.sendPasswordResetEmail('a@example.com', link));
    const [email] = mailer.sentEmails;
    assert.equal(email!.to, 'a@example.com');
    assert.equal(email!.subject, 'Reset your HL Central password');
    assert.ok(email!.text.includes(link));
  });

  it('has the email in the outbox as soon as the call returns, before it is awaited', async () => {
    const log = console.log;
    console.log = () => {};
    let pending: Promise<void>;
    try {
      pending = emails.sendPasswordResetEmail('b@example.com', 'http://x.test/?token=1');
      assert.equal(mailer.sentEmails.length, 1);
    } finally {
      console.log = log;
    }
    await pending;
  });
});
