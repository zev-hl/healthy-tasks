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
 * Dev mailer: prints the email (and any links inside it) to the server console.
 * This is what makes the password-reset flow observable end-to-end in dev
 * without a real provider.
 */
class ConsoleMailer implements Mailer {
  async send(email: Email): Promise<void> {
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

/** Convenience helper for the password-reset email. */
export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
  await mailer.send({
    to,
    subject: 'Reset your Healthy Tasks password',
    text: [
      'A password reset was requested for your Healthy Tasks account.',
      '',
      'Open this link to set a new password:',
      resetLink,
      '',
      "If you didn't request this, you can ignore this email.",
    ].join('\n'),
  });
}
