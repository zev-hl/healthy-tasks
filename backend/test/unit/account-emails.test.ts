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

describe('sign-in address changed by an admin', () => {
  const APP = 'http://localhost:5173';
  const changed = async (
    fromMethod: 'google' | 'password',
    toMethod: 'google' | 'password',
    setPassword?: { link: string; expiresAt: Date },
  ) => {
    await quietly(() =>
      emails.sendEmailChangedEmail('new@example.com', {
        fromMethod,
        toMethod,
        signInUrl: APP,
        ...(setPassword && { setPassword }),
      }),
    );
    assert.equal(mailer.sentEmails.length, 1);
    const [email] = mailer.sentEmails;
    assert.equal(email!.to, 'new@example.com');
    assert.equal(email!.subject, 'Your HL Central sign-in email has changed');
    assert.match(email!.text, /From now on, sign in with: new@example\.com/);
    return email!.text;
  };

  it('moving onto Google: use Google from now on, and the old password is gone', async () => {
    const text = await changed('password', 'google');
    assert.match(text, /now signs in with Google/);
    assert.match(text, /"Sign in with Google"/);
    assert.match(text, /old password no longer works/);
    assert.ok(text.includes(APP));
    assert.doesNotMatch(text, /token=/);
  });

  it('from one Google account to another: keep using Google', async () => {
    const text = await changed('google', 'google');
    assert.match(text, /Keep using "Sign in with Google"/);
    assert.doesNotMatch(text, /old password/);
    assert.doesNotMatch(text, /token=/);
  });

  it('moving off Google: a link to choose a password, and how long it lasts', async () => {
    const link = `${APP}/reset-password?token=abc`;
    const text = await changed('google', 'password', {
      link,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    assert.match(text, /signs in with a password/);
    assert.ok(text.includes(link));
    assert.match(text, /for the next 60 minutes/);
    assert.doesNotMatch(text, /Sign in with Google/);
  });

  it('from one password address to another: the password stays the same', async () => {
    const text = await changed('password', 'password');
    assert.match(text, /Your password stays the same/);
    assert.doesNotMatch(text, /token=/);
    assert.doesNotMatch(text, /Sign in with Google/);
    assert.doesNotMatch(text, /inactive/);
  });

  it('an inactive account is told so, and moving off Google points at "Forgot password"', async () => {
    await quietly(() =>
      emails.sendEmailChangedEmail('new@example.com', {
        fromMethod: 'google',
        toMethod: 'password',
        signInUrl: APP,
        inactive: true,
      }),
    );
    const [email] = mailer.sentEmails;
    assert.match(email!.text, /From now on, sign in with: new@example\.com/);
    assert.match(email!.text, /currently inactive: you can sign in once an administrator/);
    assert.match(email!.text, /Once your account is reactivated, use\n"Forgot password"/);
    assert.doesNotMatch(email!.text, /token=/);
  });

  it('tells the old address where the account went, with nothing to click', async () => {
    await quietly(() => emails.sendEmailChangeNoticeEmail('old@example.com', 'new@example.com'));
    const [email] = mailer.sentEmails;
    assert.equal(email!.to, 'old@example.com');
    assert.equal(email!.subject, 'Your HL Central sign-in email was changed');
    assert.ok(email!.text.includes('old@example.com'));
    assert.ok(email!.text.includes('new@example.com'));
    assert.match(email!.text, /didn't expect this change/);
    assert.doesNotMatch(email!.text, /https?:\/\//);
  });
});
