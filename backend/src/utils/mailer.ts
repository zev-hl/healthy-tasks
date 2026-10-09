import { env } from '../config/env.js';

export interface Email {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(email: Email): Promise<void>;
}

/**
 * Outbox for the console mailer: every send is also recorded here so tests can
 * assert on outbound mail without a provider or console scraping. Capped so a
 * long-running dev process cannot grow it without bound.
 */
export const sentEmails: Email[] = [];
const SENT_EMAILS_CAP = 100;

/** Test seam: clear the console mailer's outbox. */
export function __resetSentEmails(): void {
  sentEmails.length = 0;
}

/**
 * Dev mailer: prints the email (and any links inside it) to the server console.
 * This is what makes the password-reset flow observable end-to-end in dev
 * without a real provider.
 */
class ConsoleMailer implements Mailer {
  async send(email: Email): Promise<void> {
    sentEmails.push(email);
    if (sentEmails.length > SENT_EMAILS_CAP) sentEmails.shift();
    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '📧 ───────────────────────────────────────────────',
        `From:    ${env.email.from}`,
        `To:      ${email.to}`,
        `Subject: ${email.subject}`,
        '───────────────────────────────────────────────',
        email.text,
        '───────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
  }
}

/**
 * SMTP mailer using nodemailer. Only constructed when EMAIL_PROVIDER=smtp so
 * that the console path has zero external dependencies at runtime.
 */
class SmtpMailer implements Mailer {
  async send(email: Email): Promise<void> {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: env.email.smtpHost,
      port: env.email.smtpPort,
      auth:
        env.email.smtpUser && env.email.smtpPass
          ? { user: env.email.smtpUser, pass: env.email.smtpPass }
          : undefined,
    });
    await transport.sendMail({
      from: env.email.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  }
}

export const mailer: Mailer =
  env.email.provider === 'smtp' ? new SmtpMailer() : new ConsoleMailer();

/**
 * Hand an email to the mailer without making the caller wait for it.
 *
 * An SMTP send logs in to the provider first, which takes a second or more, so
 * awaiting it held every response that sends mail (adding a user, a reset, a
 * mention) until the provider answered. By the time a caller gets here its own
 * work is saved, so a failed send must not turn the request into an error
 * either: it is logged instead. Never rethrown — a rejection nobody awaits
 * would stop the Node process.
 *
 * `send` starts synchronously, so the console mailer's outbox is already filled
 * when this returns.
 */
export function sendInBackground(what: string, send: () => Promise<void>): void {
  send().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`Email not sent (${what}):`, err);
  });
}

/** "60 minutes", "24 hours", "7 days" — how long a link stays valid from now. */
function timeLeft(until: Date): string {
  const minutes = Math.max(1, Math.round((until.getTime() - Date.now()) / 60_000));
  const [n, unit] =
    minutes < 120
      ? [minutes, 'minute']
      : minutes < 48 * 60
        ? [Math.round(minutes / 60), 'hour']
        : [Math.round(minutes / (24 * 60)), 'day'];
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * The first email a new password account receives: a welcome, then the link
 * to choose a password. The link is an ordinary reset link; only the wording
 * differs, because "a password reset was requested" makes no sense to someone
 * who has never had a password.
 */
export async function sendNewAccountEmail(
  to: string,
  setPasswordLink: string,
  expiresAt: Date,
): Promise<void> {
  await mailer.send({
    to,
    subject: 'Welcome to HL Central',
    text: [
      'Welcome aboard!',
      '',
      `An HL Central account has been created for you. You'll sign in with this email address: ${to}`,
      '',
      'To get started, open this link and choose your password:',
      setPasswordLink,
      '',
      `The link works for the next ${timeLeft(expiresAt)}. If it has expired, use "Forgot password" ` +
        'on the sign-in page, or ask an administrator to send you a new one.',
      '',
      'See you inside,',
      'The HL Central team',
    ].join('\n'),
  });
}

/**
 * Sent instead of a reset link when the new account can use Sign in with
 * Google. There is no password to set, so a reset link would only confuse —
 * and would hand out a credential nobody needs.
 */
export async function sendGoogleWelcomeEmail(to: string, signInUrl: string): Promise<void> {
  await mailer.send({
    to,
    subject: 'Your HL Central account is ready',
    text: [
      'An HL Central account has been created for you.',
      '',
      'Open the app and choose "Sign in with Google", using this same work',
      'account. There is no password to set up.',
      '',
      signInUrl,
      '',
      'If you cannot sign in, ask an administrator.',
    ].join('\n'),
  });
}

/** Convenience helper for the password-reset email. */
export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
  await mailer.send({
    to,
    subject: 'Reset your HL Central password',
    text: [
      'A password reset was requested for your HL Central account.',
      '',
      'Open this link to set a new password:',
      resetLink,
      '',
      "If you didn't request this, you can ignore this email.",
    ].join('\n'),
  });
}
