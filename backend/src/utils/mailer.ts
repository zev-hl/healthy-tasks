import { existsSync } from 'node:fs';
import type { Transporter } from 'nodemailer';
import { emailConfig } from '../config/email-config.js';
import { LOGO_CID, LOGO_FILE } from './email-content.js';

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

/** Whether each logo file is there, looked at once per process. */
const logoFound = new Map<string, boolean>();

/**
 * The logo ships with the code, so a missing file means a broken deploy. An
 * email then still goes, without its picture, rather than fail (a password
 * reset matters more than a logo), and the log says so once.
 */
function logoAvailable(file: string): boolean {
  let found = logoFound.get(file);
  if (found === undefined) {
    found = existsSync(file);
    logoFound.set(file, found);
    // eslint-disable-next-line no-console
    if (!found) console.error(`Email logo not found (${file}): emails go out without it`);
  }
  return found;
}

/**
 * What goes to the mail server: the HTML and, unless EMAIL_SEND_TEXT is
 * "false", the text version beside it. An email with no HTML (one queued before
 * HTML came in) keeps its text whatever the switch says, or it would be empty.
 * The logo the HTML shows is attached here, as a picture inside the email
 * (`LOGO_CID`), rather than queued with it: the queue keeps only text.
 */
export function smtpMessage(email: Email, from: string, sendText: boolean, logoFile = LOGO_FILE) {
  const showsLogo = (email.html?.includes(`cid:${LOGO_CID}`) ?? false) && logoAvailable(logoFile);
  return {
    from,
    to: email.to,
    subject: email.subject,
    ...(sendText || !email.html ? { text: email.text } : {}),
    ...(email.html ? { html: email.html } : {}),
    ...(showsLogo
      ? {
          attachments: [
            {
              filename: 'hl-logo.png',
              path: logoFile,
              cid: LOGO_CID,
              contentType: 'image/png',
              contentDisposition: 'inline' as const,
            },
          ],
        }
      : {}),
  };
}

/** The console mailer's "Parts:" line: what a real send would carry. */
function partsLine(email: Email): string {
  if (!email.html) return 'text only';
  const html = `HTML (${email.html.length} characters)`;
  return emailConfig.sendText
    ? `${html} and text`
    : `${html} only; the text below is not sent (EMAIL_SEND_TEXT is "false")`;
}

/**
 * Dev mailer: prints the email (and any links inside it) to the server console.
 * This is what makes the password-reset flow observable end-to-end in dev
 * without a real provider. It prints the text version, which reads better here
 * than the HTML (see `npm run email:preview` for how that looks).
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
        `Parts:   ${partsLine(email)}`,
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
    await transport.sendMail(smtpMessage(email, emailConfig.from, emailConfig.sendText));
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
