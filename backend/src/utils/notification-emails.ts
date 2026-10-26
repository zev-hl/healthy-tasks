import type { AssignAction } from '@healthy-tasks/shared';
import { renderEmail, type EmailBlock } from './email-content.js';
import type { Email } from './mailer.js';

// The emails that tell someone something happened — a mention, an assignment,
// a reminder, the Admins' alert — and the queue's test email, in HTML with
// their text version (HLAI-135). Only the wording lives here: the caller looks
// up the names and builds the links, so these can be tested and previewed
// with no database.

/** The task's link: a button in the HTML, "Open the task:" and the link in the text. */
const openTask = (link: string): EmailBlock => ({
  button: { label: 'Open the task', url: link, lead: 'Open the task:' },
});

export function mentionEmail(o: {
  to: string;
  /** Who wrote the comment (their address). */
  by: string;
  taskId: number;
  taskName: string;
  link: string;
}): Email {
  return {
    to: o.to,
    subject: `You were mentioned on “${o.taskName}”`,
    ...renderEmail({
      blocks: [
        { text: `${o.by} mentioned you in a comment on task #${o.taskId} (“${o.taskName}”).` },
        openTask(o.link),
      ],
    }),
  };
}

export function assignmentEmail(o: {
  to: string;
  action: AssignAction;
  taskId: number;
  taskName: string;
  link: string;
}): Email {
  const verb = o.action === 'added' ? 'assigned to' : 'unassigned from';
  return {
    to: o.to,
    subject: `You were ${verb} “${o.taskName}”`,
    ...renderEmail({
      blocks: [{ text: `You were ${verb} task #${o.taskId} (“${o.taskName}”).` }, openTask(o.link)],
    }),
  };
}

export function reminderEmail(o: {
  to: string;
  taskId: number;
  taskName: string;
  /** When the task starts and how far ahead this is, written out; none without a start. */
  starts?: string;
  link: string;
}): Email {
  const about = `Reminder for task #${o.taskId} (“${o.taskName}”).`;
  return {
    to: o.to,
    subject: `Reminder: “${o.taskName}”`,
    ...renderEmail({
      blocks: [{ text: o.starts ? `${about}\nStarts: ${o.starts}` : about }, openTask(o.link)],
    }),
  };
}

/**
 * To an Admin when the scheduler is unwell. `lines` as written for the text: an
 * empty one between paragraphs.
 */
export function adminAlertEmail(o: {
  to: string;
  subject: string;
  lines: string[];
  appUrl: string;
}): Email {
  const paragraphs = o.lines
    .join('\n')
    .split(/\n{2,}/)
    .filter((p) => p.trim() !== '');
  return {
    to: o.to,
    subject: o.subject,
    ...renderEmail({
      blocks: [
        ...paragraphs.map((text) => ({ text })),
        { text: `Check the API service (${o.appUrl.replace(/\/$/, '')}).` },
      ],
    }),
  };
}

/** `npm run queue:test-email`: proves the queue and the email worker end to end. */
export function testEmail(to: string, queuedAt: string): Email {
  return {
    to,
    subject: 'HL Central test email (queue)',
    ...renderEmail({
      blocks: [
        { text: 'This is a test email from the HL Central email queue.' },
        {
          text: `Queued at ${queuedAt}. If you are reading it, the queue and the email worker are working.`,
        },
      ],
    }),
  };
}
