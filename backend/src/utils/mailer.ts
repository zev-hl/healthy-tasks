import type { Transporter } from 'nodemailer';
import { emailConfig } from '../config/email-config.js';

export interface Email {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(email: Email): Promise<void>;
  /** Close any open connections to the mail server (process shutdown). */
  close?(): Promise<void>;
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
        `From:    ${emailConfig.from}`,
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
 *
 * Keeps a small pool of connections open and reuses them, instead of logging
 * in to the mail server for every email — that login was most of the 1–2
 * seconds a send took. The pool is opened by the first email.
 *
 * The timeouts stay under the email worker's 30-second job lock, so a mail
 * server that stops answering fails the send (and it is retried) rather than
 * leaving the job hanging.
 */
class SmtpMailer implements Mailer {
  private transport: Promise<Transporter> | undefined;

  private getTransport(): Promise<Transporter> {
    this.transport ??= import('nodemailer').then((nodemailer) =>
      nodemailer.createTransport({
        pool: true,
        maxConnections: 3,
        maxMessages: 100,
        host: emailConfig.smtpHost,
        port: emailConfig.smtpPort,
        secure: emailConfig.smtpPort === 465,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        auth:
          emailConfig.smtpUser && emailConfig.smtpPass
            ? { user: emailConfig.smtpUser, pass: emailConfig.smtpPass }
            : undefined,
      }),
    );
    return this.transport;
  }

  async send(email: Email): Promise<void> {
    const transport = await this.getTransport();
    await transport.sendMail({
      from: emailConfig.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  }

  async close(): Promise<void> {
    const transport = this.transport;
    this.transport = undefined;
    (await transport)?.close();
  }
}

export const mailer: Mailer =
  emailConfig.provider === 'smtp' ? new SmtpMailer() : new ConsoleMailer();

/**
 * Hand an email to the mailer without making the caller wait for it.
 *
 * An SMTP send logs in to the provider first, which takes a second or more, so
 * awaiting it held every response that sends mail (adding a user, a reset, a
 * mention) until the provider answered. With EMAIL_DELIVERY=queue the wait is
 * only for Redis to take the email, but a failure there falls back to sending
 * directly, so the same holds. By the time a caller gets here its own
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
