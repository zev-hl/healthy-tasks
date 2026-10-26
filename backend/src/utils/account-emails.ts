import { queueEmail } from '../queue/email-queue.js';
import { renderEmail, type EmailBlock } from './email-content.js';

// The emails about a person's account: the welcome for a new account (with a
// set-password link, or the Google sign-in note), the password reset, and the
// pair sent when an admin changes someone's sign-in address. Each is HTML with
// its text version (renderEmail, HLAI-135). They go out the way EMAIL_DELIVERY
// says (queue/email-queue.ts); the controllers call them through
// `sendInBackground` so no reply waits on them.

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

/** After a set-password link: how long it works, and what to do once it has expired. */
function linkLasts(expiresAt: Date): string {
  return (
    `The link works for the next ${timeLeft(expiresAt)}. If it has expired, use "Forgot password" ` +
    'on the sign-in page, or ask an administrator to send you a new one.'
  );
}

/** The app's sign-in page: a button in the HTML, the link on its own in the text. */
const openApp = (signInUrl: string): EmailBlock => ({
  button: { label: 'Open HL Central', url: signInUrl },
});

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
      ...renderEmail({
        preview: 'An HL Central account has been created for you.',
        blocks: [
          { text: 'Welcome aboard!' },
          {
            text:
              "An HL Central account has been created for you. You'll sign in with this email " +
              `address: ${to}`,
          },
          {
            button: {
              label: 'Choose your password',
              url: setPasswordLink,
              lead: 'To get started, open this link and choose your password:',
            },
          },
          { text: linkLasts(expiresAt) },
          { text: 'See you inside,\nThe HL Central team' },
        ],
      }),
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
      ...renderEmail({
        blocks: [
          { text: 'An HL Central account has been created for you.' },
          {
            text:
              'Open the app and choose "Sign in with Google", using this same work account. ' +
              'There is no password to set up.',
          },
          openApp(signInUrl),
          { text: 'If you cannot sign in, ask an administrator.' },
        ],
      }),
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
      ...renderEmail({
        blocks: [
          { text: 'A password reset was requested for your HL Central account.' },
          {
            button: {
              label: 'Set a new password',
              url: resetLink,
              lead: 'Open this link to set a new password:',
            },
          },
          { text: "If you didn't request this, you can ignore this email." },
        ],
      }),
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
  const howToSignIn = (): EmailBlock[] => {
    if (change.toMethod === 'google') {
      return change.fromMethod === 'google'
        ? [
            {
              text:
                'Keep using "Sign in with Google", now with your work Google account for this ' +
                `address (${to}).`,
            },
            openApp(change.signInUrl),
          ]
        : [
            {
              text:
                'Your account now signs in with Google. Open the app and choose "Sign in with ' +
                `Google", using your work Google account for this address (${to}).\n` +
                'Your old password no longer works.',
            },
            openApp(change.signInUrl),
          ];
    }
    if (change.setPassword) {
      return [
        {
          button: {
            label: 'Choose your password',
            url: change.setPassword.link,
            lead: 'This address signs in with a password. Open this link and choose your password:',
          },
        },
        { text: linkLasts(change.setPassword.expiresAt) },
      ];
    }
    if (change.fromMethod === 'google') {
      // Needs a password but got no link: the account is inactive.
      return [
        {
          text:
            'This address signs in with a password. Once your account is reactivated, use ' +
            '"Forgot password" on the sign-in page to choose one.',
        },
        openApp(change.signInUrl),
      ];
    }
    return [{ text: 'Your password stays the same.' }, openApp(change.signInUrl)];
  };

  await queueEmail(
    {
      to,
      subject: 'Your HL Central sign-in email has changed',
      ...renderEmail({
        blocks: [
          {
            text:
              'An administrator has changed the email address you use to sign in to HL Central.\n' +
              `From now on, sign in with: ${to}`,
          },
          ...(change.inactive
            ? [
                {
                  text:
                    'Your account is currently inactive: you can sign in once an administrator ' +
                    'reactivates it.',
                },
              ]
            : []),
          ...howToSignIn(),
          { text: 'If you have any trouble signing in, ask an administrator.' },
          { text: 'The HL Central team' },
        ],
      }),
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
      // No button and no link, in either version.
      ...renderEmail({
        blocks: [
          {
            text:
              'An administrator changed the email address used to sign in to your HL Central ' +
              `account, from this address (${oldAddress}) to ${newAddress}.`,
          },
          { text: 'Emails from HL Central will go to the new address from now on.' },
          { text: "If you didn't expect this change, contact your HL Central administrator." },
        ],
      }),
    },
    { kind: 'email-change-notice' },
  );
}
