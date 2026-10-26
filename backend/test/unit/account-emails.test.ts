import { before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactTokens } from '../../src/queue/failed-email.recorder.js';

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

  it('sends every account email in HTML too, with its button (HLAI-135)', async () => {
    const link = 'http://localhost:5173/reset-password?token=abc';
    const app = 'http://localhost:5173';
    const inAnHour = new Date(Date.now() + 60 * 60_000);
    const cases: [string, () => Promise<void>, string | null][] = [
      [
        'new account',
        () => emails.sendNewAccountEmail('n@x.test', link, inAnHour),
        'Choose your password',
      ],
      ['Google welcome', () => emails.sendGoogleWelcomeEmail('g@x.test', app), 'Open HL Central'],
      ['reset', () => emails.sendPasswordResetEmail('r@x.test', link), 'Set a new password'],
      [
        'changed, to a password',
        () =>
          emails.sendEmailChangedEmail('c@x.test', {
            fromMethod: 'google',
            toMethod: 'password',
            signInUrl: app,
            setPassword: { link, expiresAt: inAnHour },
          }),
        'Choose your password',
      ],
      [
        'changed, to Google',
        () =>
          emails.sendEmailChangedEmail('c@x.test', {
            fromMethod: 'password',
            toMethod: 'google',
            signInUrl: app,
          }),
        'Open HL Central',
      ],
      [
        'notice to the old address',
        () => emails.sendEmailChangeNoticeEmail('o@x.test', 'n@x.test'),
        null,
      ],
    ];
    for (const [what, send, button] of cases) {
      mailer.__resetSentEmails();
      await quietly(send);
      const [email] = mailer.sentEmails;
      const html = email!.html ?? '';
      assert.match(html, /^<!doctype html>/, `${what}: an HTML version`);
      assert.match(
        html,
        /cid:hl-logo@hlcentral[^>]*><\/td><td [^>]*>HL Central</,
        `${what}: the logo and name`,
      );
      if (button) {
        assert.match(html, new RegExp(`>${button}</a>`), `${what}: its button`);
      } else {
        // The old address's mailbox is no longer the account's: nothing to click.
        assert.doesNotMatch(html, /<a /, `${what}: no link`);
        assert.doesNotMatch(html, /If the button/, `${what}: no button`);
      }
    }
  });

  it('keeps the text versions of the welcome emails, line for line', async () => {
    const link = 'http://localhost:5173/reset-password?token=abc';
    await quietly(() =>
      emails.sendNewAccountEmail('new@example.com', link, new Date(Date.now() + 60 * 60_000)),
    );
    assert.equal(
      mailer.sentEmails[0]!.text,
      [
        'Welcome aboard!',
        '',
        "An HL Central account has been created for you. You'll sign in with this email address: new@example.com",
        '',
        'To get started, open this link and choose your password:',
        link,
        '',
        'The link works for the next 60 minutes. If it has expired, use "Forgot password" on the ' +
          'sign-in page, or ask an administrator to send you a new one.',
        '',
        'See you inside,',
        'The HL Central team',
      ].join('\n'),
    );
    mailer.__resetSentEmails();
    await quietly(() => emails.sendGoogleWelcomeEmail('g@example.com', 'http://localhost:5173'));
    assert.equal(
      mailer.sentEmails[0]!.text,
      [
        'An HL Central account has been created for you.',
        '',
        'Open the app and choose "Sign in with Google", using this same work account. There is no ' +
          'password to set up.',
        '',
        'http://localhost:5173',
        '',
        'If you cannot sign in, ask an administrator.',
      ].join('\n'),
    );
  });

  it('sends the password reset link', async () => {
    const link = 'http://localhost:5173/reset-password?token=xyz';
    await quietly(() => emails.sendPasswordResetEmail('a@example.com', link));
    const [email] = mailer.sentEmails;
    assert.equal(email!.to, 'a@example.com');
    assert.equal(email!.subject, 'Reset your HL Central password');
    assert.ok(email!.text.includes(link));
  });

  it('sends the reset in HTML, with the same words in its text version (HLAI-135)', async () => {
    const link = 'http://localhost:5173/reset-password?token=xyz';
    await quietly(() => emails.sendPasswordResetEmail('a@example.com', link));
    const [email] = mailer.sentEmails;
    assert.equal(
      email!.text,
      [
        'A password reset was requested for your HL Central account.',
        '',
        'Open this link to set a new password:',
        link,
        '',
        "If you didn't request this, you can ignore this email.",
      ].join('\n'),
    );
    const html = email!.html ?? '';
    assert.match(html, /A password reset was requested for your HL Central account\./);
    assert.match(html, />Set a new password<\/a>/);
    assert.equal(html.split(`href="${link}"`).length - 1, 2, 'the button and the plain link');
    assert.match(html, /If you didn&#39;t request this, you can ignore this email\./);
    // The copy kept of a failed email never holds the token, in either version.
    assert.doesNotMatch(redactTokens(html), /xyz/);
    assert.doesNotMatch(redactTokens(email!.text), /xyz/);
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
    // One sentence, no longer broken across two lines by hand (HLAI-135).
    assert.match(email!.text, /Once your account is reactivated, use "Forgot password"/);
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
