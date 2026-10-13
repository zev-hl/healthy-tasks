import { queueEmail } from '../queue/email-queue.js';

// The emails about a person's account: the welcome for a new account (with a
// set-password link, or the Google sign-in note) and the password reset. They
// go out the way EMAIL_DELIVERY says (queue/email-queue.ts); the controllers
// call them through `sendInBackground` so no reply waits on them.

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
  await queueEmail(
    {
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
    },
    { kind: 'new-account' },
  );
}

/**
 * Sent instead of a reset link when the new account can use Sign in with
 * Google. There is no password to set, so a reset link would only confuse —
 * and would hand out a credential nobody needs.
 */
export async function sendGoogleWelcomeEmail(to: string, signInUrl: string): Promise<void> {
  await queueEmail(
    {
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
    },
    { kind: 'google-welcome' },
  );
}

/** Convenience helper for the password-reset email. */
export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
  await queueEmail(
    {
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
    },
    { kind: 'password-reset' },
  );
}
