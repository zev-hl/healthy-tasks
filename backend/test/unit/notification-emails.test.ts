import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  adminAlertEmail,
  assignmentEmail,
  mentionEmail,
  reminderEmail,
  testEmail,
} from '../../src/utils/notification-emails.js';
import type { Email } from '../../src/utils/mailer.js';

// HLAI-135: the mention, assignment, reminder, Admin alert and test emails, in
// HTML with their text version.

const LINK = 'http://localhost:5173/tasks/42';
/** A task name with characters HTML would read. */
const NAME = 'Fix <b>price</b> & "Buy Box"';
const NAME_IN_HTML = 'Fix &lt;b&gt;price&lt;/b&gt; &amp; &quot;Buy Box&quot;';

/** Both versions, the shared look, and the task's button where there is one. */
function looksRight(email: Email, opts: { button?: string } = {}) {
  assert.ok(email.text.length > 0, 'a text version');
  const html = email.html ?? '';
  assert.match(html, /^<!doctype html>/, 'an HTML version');
  assert.match(html, /cid:hl-logo@hlcentral[^>]*><\/td><td [^>]*>HL Central</, 'the logo and name');
  assert.match(html, /Sent by HL Central\./, 'the footer');
  if (opts.button) assert.match(html, new RegExp(`>${opts.button}</a>`), 'the button');
  assert.doesNotMatch(html, /<b>/, 'typed text never read as a tag');
  return html;
}

describe('the task emails', () => {
  it('mention: who, which task, and a button to open it', () => {
    const email = mentionEmail({
      to: 'a@b.test',
      by: 'c@d.test',
      taskId: 42,
      taskName: NAME,
      link: LINK,
    });
    assert.equal(email.subject, `You were mentioned on “${NAME}”`);
    assert.equal(
      email.text,
      `c@d.test mentioned you in a comment on task #42 (“${NAME}”).\n\nOpen the task:\n${LINK}`,
    );
    const html = looksRight(email, { button: 'Open the task' });
    assert.ok(html.includes(`on task #42 (“${NAME_IN_HTML}”).`));
    assert.equal(html.split(`href="${LINK}"`).length - 1, 2, 'the button and the plain link');
  });

  it('assignment: assigned to, or unassigned from', () => {
    const added = assignmentEmail({
      to: 'a@b.test',
      action: 'added',
      taskId: 42,
      taskName: NAME,
      link: LINK,
    });
    assert.equal(added.subject, `You were assigned to “${NAME}”`);
    assert.match(added.text, /^You were assigned to task #42/);
    assert.ok(looksRight(added, { button: 'Open the task' }).includes(NAME_IN_HTML));

    const removed = assignmentEmail({
      to: 'a@b.test',
      action: 'removed',
      taskId: 42,
      taskName: NAME,
      link: LINK,
    });
    assert.equal(removed.subject, `You were unassigned from “${NAME}”`);
    assert.match(removed.text, /^You were unassigned from task #42/);
    looksRight(removed, { button: 'Open the task' });
  });

  it('reminder: with its start time on the next line, or without one', () => {
    const starts = 'Fri, Oct 23, 2026, 9:00 AM EDT — 1 hour before';
    const email = reminderEmail({ to: 'a@b.test', taskId: 42, taskName: NAME, starts, link: LINK });
    assert.equal(email.subject, `Reminder: “${NAME}”`);
    assert.equal(
      email.text,
      `Reminder for task #42 (“${NAME}”).\nStarts: ${starts}\n\nOpen the task:\n${LINK}`,
    );
    assert.ok(looksRight(email, { button: 'Open the task' }).includes(`<br>Starts: ${starts}`));

    const noStart = reminderEmail({ to: 'a@b.test', taskId: 42, taskName: NAME, link: LINK });
    assert.doesNotMatch(noStart.text, /Starts:/);
    assert.doesNotMatch(noStart.html ?? '', /Starts:/);
  });
});

describe('the Admin alert', () => {
  it('keeps its lines and paragraphs, then where to look', () => {
    const email = adminAlertEmail({
      to: 'admin@b.test',
      subject: 'HL Central recurrence scheduler is not running',
      lines: ['It stopped.', 'Last run: earlier.', '', 'Nothing recurs until it is back.'],
      appUrl: 'https://app.example.com/',
    });
    assert.equal(email.subject, 'HL Central recurrence scheduler is not running');
    assert.equal(
      email.text,
      'It stopped.\nLast run: earlier.\n\nNothing recurs until it is back.\n\n' +
        'Check the API service (https://app.example.com).',
    );
    const html = looksRight(email);
    assert.match(html, /It stopped\.<br>Last run: earlier\.<\/p>/);
    assert.match(html, /Check the API service \(https:\/\/app\.example\.com\)\./);
  });
});

describe('the queue test email', () => {
  it('says when it was queued', () => {
    const email = testEmail('a@b.test', '2026-10-23T15:00:00.000Z');
    assert.equal(email.subject, 'HL Central test email (queue)');
    assert.match(email.text, /Queued at 2026-10-23T15:00:00\.000Z\./);
    assert.match(looksRight(email), /Queued at 2026-10-23T15:00:00\.000Z\./);
  });
});
