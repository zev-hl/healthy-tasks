import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

// The modules read their settings at import time, so set them first and load
// the modules afterwards: console mailer, direct delivery, no Redis.
let jobs: typeof import('../../src/queue/email-job.js');
let queue: typeof import('../../src/queue/email-queue.js');
let mailer: typeof import('../../src/utils/mailer.js');

before(async () => {
  process.env.EMAIL_PROVIDER = 'console';
  process.env.EMAIL_DELIVERY = 'direct';
  delete process.env.REDIS_URL;
  jobs = await import('../../src/queue/email-job.js');
  queue = await import('../../src/queue/email-queue.js');
  mailer = await import('../../src/utils/mailer.js');
});

describe('email job options', () => {
  it('retries 10 times after the first try, 2 minutes apart, by default', () => {
    const opts = jobs.emailJobOptions({ maxRetries: 10, retryDelayMs: 120_000 });
    assert.equal(opts.attempts, 11);
    assert.deepEqual(opts.backoff, { type: 'fixed', delay: 120_000 });
  });

  it('keeps sent jobs a day and failed ones two weeks', () => {
    const opts = jobs.emailJobOptions({ maxRetries: 10, retryDelayMs: 120_000 });
    assert.deepEqual(opts.removeOnComplete, { age: 24 * 60 * 60 });
    assert.deepEqual(opts.removeOnFail, { age: 14 * 24 * 60 * 60 });
  });
});

describe('email job data', () => {
  it('carries the email, its kind and a fresh id', () => {
    const email = { to: 'a@example.com', subject: 'Hi', text: 'Hello' };
    const one = jobs.emailJobData(email, 'mention');
    const two = jobs.emailJobData(email, 'mention');
    assert.equal(one.v, 1);
    assert.equal(one.kind, 'mention');
    assert.match(one.emailId, /^[0-9a-f-]{36}$/);
    assert.notEqual(one.emailId, two.emailId);
    assert.deepEqual(jobs.emailFromJob(one), email);
  });

  it('keeps a fixed id when given one, so the queue sends that email once', () => {
    const email = { to: 'a@example.com', subject: 'Reminder', text: 'Soon' };
    const one = jobs.emailJobData(email, 'reminder', 'reminder-r1');
    const two = jobs.emailJobData(email, 'reminder', 'reminder-r1');
    assert.equal(one.emailId, 'reminder-r1');
    assert.equal(two.emailId, one.emailId);
  });

  it('keeps html only when the email has it', () => {
    const plain = jobs.emailJobData({ to: 'a@example.com', subject: 'Hi', text: 'Hello' }, 'test');
    assert.equal('html' in plain, false);
    const rich = jobs.emailJobData(
      { to: 'a@example.com', subject: 'Hi', text: 'Hello', html: '<p>Hello</p>' },
      'test',
    );
    assert.equal(jobs.emailFromJob(rich).html, '<p>Hello</p>');
  });
});

describe('queueEmail in direct mode', () => {
  it('sends straight away, without touching Redis', async () => {
    mailer.__resetSentEmails();
    const pending = queue.queueEmail(
      { to: 'b@example.com', subject: 'Direct', text: 'Sent in-process' },
      { kind: 'test' },
    );
    // Already in the outbox before anything is awaited — callers rely on it.
    assert.equal(mailer.sentEmails.length, 1);
    assert.equal(mailer.sentEmails[0]?.to, 'b@example.com');
    await pending;
  });
});

describe('email processor', () => {
  // Recording failures in the database is covered in failed-email.test.ts.
  const noRecorder = { recordFailure: async () => {}, clearFailure: async () => {} };
  const firstTry = (to: string) => ({
    data: jobs.emailJobData({ to, subject: 'S', text: 'T' }, 'test'),
    attemptsMade: 0,
    opts: { attempts: 11 },
  });

  it('sends the job through the given mailer', async () => {
    const { createEmailProcessor } = await import('../../src/queue/email.processor.js');
    const sent: unknown[] = [];
    const process = createEmailProcessor(
      { send: async (email) => void sent.push(email) },
      noRecorder,
    );
    await process(firstTry('c@example.com'));
    assert.deepEqual(sent, [{ to: 'c@example.com', subject: 'S', text: 'T' }]);
  });

  it('fails the try when the send fails, so BullMQ retries it', async () => {
    const { createEmailProcessor } = await import('../../src/queue/email.processor.js');
    const process = createEmailProcessor(
      {
        send: async () => {
          throw new Error('mail server down');
        },
      },
      noRecorder,
    );
    await assert.rejects(process(firstTry('c@example.com')), /mail server down/);
  });
});

describe('describeTry', () => {
  it('counts automatic tries, and says when a try was pressed by hand', async () => {
    const { describeTry } = await import('../../src/queue/email.processor.js');
    assert.equal(describeTry(1, { opts: { attempts: 11 } }), 'try 1 of 11');
    assert.equal(describeTry(11, { opts: { attempts: 11 } }), 'try 11 of 11');
    assert.equal(describeTry(12, { opts: { attempts: 11 } }), 'try 12, retried by hand');
  });
});

describe('quietErrorLog', () => {
  it('prints each distinct message once, however often it repeats', async () => {
    const { quietErrorLog } = await import('../../src/queue/redis.js');
    const printed: string[] = [];
    const error = console.error;
    console.error = (line: string) => void printed.push(line);
    try {
      const log = quietErrorLog('[test] ');
      for (let i = 0; i < 50; i++) log(new Error('connect ECONNREFUSED'));
      log(new Error('getaddrinfo ENOTFOUND redis'));
      log(new Error('connect ECONNREFUSED'));
    } finally {
      console.error = error;
    }
    assert.deepEqual(printed, [
      '[test] connect ECONNREFUSED',
      '[test] getaddrinfo ENOTFOUND redis',
    ]);
  });
});
