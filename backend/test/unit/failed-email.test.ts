import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Mailer } from '../../src/utils/mailer.js';
import type { EmailJobData } from '../../src/queue/email-job.js';
import { createEmailProcessor } from '../../src/queue/email.processor.js';
import {
  createFailedEmailRecorder,
  redactTokens,
  type FailedEmailRecorder,
  type FailedEmailTable,
  type FailedTry,
} from '../../src/queue/failed-email.recorder.js';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const TWO_MINUTES = 120_000;

const data: EmailJobData = {
  v: 1,
  emailId: 'email-1',
  kind: 'password-reset',
  to: 'a@example.com',
  subject: 'Reset your HL Central password',
  text: 'Open this link: http://localhost:5173/reset-password?token=abc123secret',
};

/** A job on its `tryNumber`-th try, with the default 11 tries, 2 min apart. */
function job(tryNumber: number) {
  return {
    data,
    attemptsMade: tryNumber - 1,
    opts: { attempts: 11, backoff: { type: 'fixed', delay: TWO_MINUTES } },
  };
}

function mailerThat(fails: boolean): Mailer {
  return {
    async send() {
      if (fails) throw new Error('Connection refused');
    },
  };
}

/** Remembers what the processor asked it to record. */
function spyRecorder() {
  const calls: { failures: FailedTry[]; cleared: string[] } = { failures: [], cleared: [] };
  const recorder: FailedEmailRecorder = {
    async recordFailure(failure) {
      calls.failures.push(failure);
    },
    async clearFailure(emailId) {
      calls.cleared.push(emailId);
    },
  };
  return { recorder, calls };
}

describe('email processor and the FailedEmail table', () => {
  it('writes nothing when the first try succeeds', async () => {
    const { recorder, calls } = spyRecorder();
    await createEmailProcessor(mailerThat(false), recorder, () => NOW)(job(1));
    assert.deepEqual(calls, { failures: [], cleared: [] });
  });

  it('records a retrying row, due in 2 minutes, and still fails the try', async () => {
    const { recorder, calls } = spyRecorder();
    const process = createEmailProcessor(mailerThat(true), recorder, () => NOW);
    await assert.rejects(process(job(1)), /Connection refused/);
    assert.equal(calls.failures.length, 1);
    const failure = calls.failures[0]!;
    assert.equal(failure.attempts, 1);
    assert.equal(failure.data.emailId, 'email-1');
    assert.equal(failure.nextRetryAt?.getTime(), NOW + TWO_MINUTES);
  });

  it('records the 11th failure as having no next try', async () => {
    const { recorder, calls } = spyRecorder();
    const process = createEmailProcessor(mailerThat(true), recorder, () => NOW);
    await assert.rejects(process(job(10)));
    await assert.rejects(process(job(11)));
    assert.notEqual(calls.failures[0]!.nextRetryAt, null);
    assert.equal(calls.failures[1]!.attempts, 11);
    assert.equal(calls.failures[1]!.nextRetryAt, null);
  });

  it('treats a failed retry pressed on the dashboard as failed, not retrying', async () => {
    const { recorder, calls } = spyRecorder();
    await assert.rejects(createEmailProcessor(mailerThat(true), recorder, () => NOW)(job(12)));
    assert.equal(calls.failures[0]!.attempts, 12);
    assert.equal(calls.failures[0]!.nextRetryAt, null);
  });

  it('clears the row when a later try succeeds', async () => {
    const { recorder, calls } = spyRecorder();
    await createEmailProcessor(mailerThat(false), recorder, () => NOW)(job(4));
    assert.deepEqual(calls.cleared, ['email-1']);
    assert.equal(calls.failures.length, 0);
  });
});

/** A FailedEmail table that keeps what it is sent, or always throws. */
function fakeTable(broken = false) {
  const upserts: Parameters<FailedEmailTable['upsert']>[0][] = [];
  const deletes: string[] = [];
  const table: FailedEmailTable = {
    async upsert(args) {
      if (broken) throw new Error('database is down');
      upserts.push(args);
    },
    async deleteMany(args) {
      if (broken) throw new Error('database is down');
      deletes.push(args.where.emailId);
    },
  };
  return { table, upserts, deletes };
}

describe('FailedEmail recorder', () => {
  const failedAt = new Date(NOW);

  it('writes a retrying row with the tokens taken out', async () => {
    const { table, upserts } = fakeTable();
    const recorder = createFailedEmailRecorder({ failedEmail: table }, () => failedAt);
    const nextRetryAt = new Date(NOW + TWO_MINUTES);
    await recorder.recordFailure({ data, attempts: 1, error: new Error('boom'), nextRetryAt });

    const { where, create, update } = upserts[0]!;
    assert.deepEqual(where, { emailId: 'email-1' });
    assert.equal(create.kind, 'password-reset');
    assert.equal(create.recipient, 'a@example.com');
    assert.equal(create.subject, 'Reset your HL Central password');
    assert.deepEqual(create.payload, {
      to: 'a@example.com',
      subject: 'Reset your HL Central password',
      text: 'Open this link: http://localhost:5173/reset-password?token=[redacted]',
    });
    assert.deepEqual(update, {
      status: 'retrying',
      attempts: 1,
      lastError: 'boom',
      nextRetryAt,
      failedAt: null,
    });
  });

  it('marks it failed, with failedAt, once no try is left', async () => {
    const { table, upserts } = fakeTable();
    const recorder = createFailedEmailRecorder({ failedEmail: table }, () => failedAt);
    await recorder.recordFailure({ data, attempts: 11, error: 'boom', nextRetryAt: null });
    const { update } = upserts[0]!;
    assert.equal(update.status, 'failed');
    assert.equal(update.failedAt, failedAt);
    assert.equal(update.nextRetryAt, null);
  });

  it('shortens long errors', async () => {
    const { table, upserts } = fakeTable();
    const recorder = createFailedEmailRecorder({ failedEmail: table });
    await recorder.recordFailure({ data, attempts: 1, error: 'x'.repeat(2000), nextRetryAt: null });
    assert.equal(upserts[0]!.create.lastError.length, 500);
  });

  it('deletes the row by email id', async () => {
    const { table, deletes } = fakeTable();
    await createFailedEmailRecorder({ failedEmail: table }).clearFailure('email-1');
    assert.deepEqual(deletes, ['email-1']);
  });

  it('never throws when the database is down', async () => {
    const { table } = fakeTable(true);
    const recorder = createFailedEmailRecorder({ failedEmail: table });
    const quiet = console.error;
    console.error = () => {};
    try {
      await recorder.recordFailure({ data, attempts: 1, error: 'boom', nextRetryAt: null });
      await recorder.clearFailure('email-1');
    } finally {
      console.error = quiet;
    }
  });

  it('a broken database does not change whether the email is retried', async () => {
    const recorder = createFailedEmailRecorder({ failedEmail: fakeTable(true).table });
    const quiet = console.error;
    console.error = () => {};
    try {
      await assert.rejects(
        createEmailProcessor(mailerThat(true), recorder)(job(1)),
        /Connection refused/,
      );
      await createEmailProcessor(mailerThat(false), recorder)(job(3));
    } finally {
      console.error = quiet;
    }
  });
});

describe('redactTokens', () => {
  it('hides the token in reset and set-password links', () => {
    assert.equal(
      redactTokens('https://x.test/reset-password?token=AbC-12_3&next=1 and ?a=1&token=zz'),
      'https://x.test/reset-password?token=[redacted]&next=1 and ?a=1&token=[redacted]',
    );
  });

  it('leaves text without a token alone', () => {
    assert.equal(redactTokens('No links here.'), 'No links here.');
  });
});
