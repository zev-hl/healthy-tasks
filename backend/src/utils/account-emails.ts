import { queueEmail } from '../queue/email-queue.js';

// The emails about a person's account: the welcome for a new account (with a
// set-password link, or the Google sign-in note), the password reset, and the
// pair sent when an admin changes someone's sign-in address. They go out the
// way EMAIL_DELIVERY says (queue/email-queue.ts); the controllers call them
// through `sendInBackground` so no reply waits on them.

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

/** How an address change affects signing in, and so what the new address is told. */
export interface EmailChangeDetails {
  /** How the person signed in before, and how they sign in from now on. */
  fromMethod: 'google' | 'password';
  toMethod: 'google' | 'password';
  /** The app's address, for the "open the app" line. */
  signInUrl: string;
  /** Google → password only: the link to choose a password, and when it lapses. */
  setPassword?: { link: string; expiresAt: Date };
  /**
   * The account is deactivated: it cannot sign in until an admin reactivates
   * it, and a set-password link would be refused, so none is sent.
   */
  inactive?: boolean;
}

/**
 * To the NEW address after an admin changes someone's sign-in address: the
 * address to sign in with, and how. Moving onto or off the company domain
 * changes the way in — Google for a company account, a password for any other
 * — so each case says what to do now.
 */
export async function sendEmailChangedEmail(to: string, change: EmailChangeDetails): Promise<void> {
  const howToSignIn = (): string[] => {
    if (change.toMethod === 'google') {
      return change.fromMethod === 'google'
        ? [
            'Keep using "Sign in with Google", now with your work Google account',
            `for this address (${to}).`,
            '',
            change.signInUrl,
          ]
        : [
            'Your account now signs in with Google. Open the app and choose',
            `"Sign in with Google", using your work Google account for this address (${to}).`,
            'Your old password no longer works.',
            '',
            change.signInUrl,
          ];
    }
    if (change.setPassword) {
      return [
        'This address signs in with a password. Open this link and choose your password:',
        change.setPassword.link,
        '',
        `The link works for the next ${timeLeft(change.setPassword.expiresAt)}. If it has expired, ` +
          'use "Forgot password" on the sign-in page, or ask an administrator to send you a new one.',
      ];
    }
    if (change.fromMethod === 'google') {
      // Needs a password but got no link: the account is inactive.
      return [
        'This address signs in with a password. Once your account is reactivated, use',
        '"Forgot password" on the sign-in page to choose one.',
        '',
        change.signInUrl,
      ];
    }
    return ['Your password stays the same.', '', change.signInUrl];
  };

  await queueEmail(
    {
      to,
      subject: 'Your HL Central sign-in email has changed',
      text: [
        'An administrator has changed the email address you use to sign in to HL Central.',
        `From now on, sign in with: ${to}`,
        ...(change.inactive
          ? [
              '',
              'Your account is currently inactive: you can sign in once an administrator',
              'reactivates it.',
            ]
          : []),
        '',
        ...howToSignIn(),
        '',
        'If you have any trouble signing in, ask an administrator.',
        '',
        'The HL Central team',
      ].join('\n'),
    },
    { kind: 'email-changed' },
  );
}

/**
 * To the OLD address: a heads-up that the account moved, in case the change
 * was not expected. No links — it goes to a mailbox the account no longer
 * uses, so nothing in it should open the account.
 */
export async function sendEmailChangeNoticeEmail(
  oldAddress: string,
  newAddress: string,
): Promise<void> {
  await queueEmail(
    {
      to: oldAddress,
      subject: 'Your HL Central sign-in email was changed',
      text: [
        `An administrator changed the email address used to sign in to your HL Central account,`,
        `from this address (${oldAddress}) to ${newAddress}.`,
        '',
        'Emails from HL Central will go to the new address from now on.',
        '',
        "If you didn't expect this change, contact your HL Central administrator.",
      ].join('\n'),
    },
    { kind: 'email-change-notice' },
  );
}
