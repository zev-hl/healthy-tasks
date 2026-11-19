/* eslint-disable no-console */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  alertComparison,
  EXCLUSIVES_ALERT_TYPE_LABELS,
  type ExclusivesAlertType,
} from '@healthy-tasks/shared';

// Every email as a page to open in a browser (HLAI-135), to see how it looks
// without sending anything. The app's own email functions run with sample
// data, and each email is caught before it would leave: nothing is sent or
// queued. Each is written twice: as sent, and as it looks where the picture
// can't be shown (no logo, the name "HL Central" still at the top). index.html lists
// them all.
//
//   npm run email:preview --workspace backend
//   npm run email:preview --workspace backend -- <folder>
//
// Run it on this computer rather than in the container, so the files can be
// opened. The logo, attached inside a real email, is put straight into the page
// here, as a browser can't read an email's attachments. The sample links use
// FRONTEND_URL (http://localhost:5173 unless set).

// Before the email code loads, as its settings are read then: the console
// mailer (which keeps each email instead of sending it), no queue.
process.env.EMAIL_PROVIDER = 'console';
process.env.EMAIL_DELIVERY = 'direct';

const TO = 'someone@example.com';
/** A task name with characters HTML would read, to see they show as typed. */
const TASK = 'Check the price <before> & after the "Buy Box" change';

/** One sample alert of each type: its saved before/now and the message the app writes. */
const ALERTS: {
  type: ExclusivesAlertType;
  code: string;
  prev: string | null;
  now: string | null;
  message: string;
}[] = [
  {
    type: 'TitleChanged',
    code: 'TC',
    prev: 'Organic Green Tea, 100 Bags',
    now: 'Organic Green Tea with Mint, 100 Bags',
    message: 'Title changed.',
  },
  {
    type: 'BulletPointsChanged',
    code: 'BP',
    prev: '2. Brewed in five minutes\n4. Sealed for freshness',
    now: '2. Steeped in three minutes\n4. (none)',
    message: 'Bullets changed.',
  },
  {
    type: 'DescriptionChanged',
    code: 'DC',
    prev:
      'Our tea is picked by hand and made for busy mornings, brewed in five minutes with water ' +
      'just off the boil. Each bag is sealed for freshness and packed in a recyclable box.',
    now:
      'Our tea is picked by hand and made for busy mornings, steeped in three minutes with water ' +
      'just off the boil. Each bag is sealed and compostable, packed in a recyclable box.',
    message: 'Description changed.',
  },
  {
    type: 'MainImageChanged',
    code: 'IC',
    prev: 'https://placehold.co/400x400/png?text=Old+image',
    now: 'https://placehold.co/400x400/0f7b6c/ffffff/png?text=New+image',
    message: 'Main image changed.',
  },
  { type: 'BrandChanged', code: 'BC', prev: 'Acme Naturals', now: null, message: 'Brand changed.' },
  {
    type: 'CategoryChanged',
    code: 'CC',
    prev: 'Grocery > Tea > Green',
    now: 'Grocery > Tea > Herbal',
    message: 'Category changed.',
  },
  {
    type: 'DimensionsChanged',
    code: 'DM',
    prev: '10in x 5in x 2in',
    now: '10in x 6in',
    message: 'Dimensions changed.',
  },
  { type: 'PriceChanged', code: 'PC', prev: '34.99', now: '31.49', message: 'Price changed.' },
  { type: 'NumberOfSellersChanged', code: 'SC', prev: '3', now: '4', message: 'Offers changed.' },
  {
    type: 'CompetitivePriceChanged',
    code: 'CH',
    prev: '7.14',
    now: '7.86',
    message: "Amazon's competitive price changed from $7.14 to $7.86 (our HL price: $14.99).",
  },
  {
    type: 'CompetitivePriceBelowOurs',
    code: 'CB',
    prev: '15.5',
    now: '7.86',
    message:
      "Amazon's competitive price went from $15.50 to $7.86, now below our HL price of $14.99 " +
      '(price + shipping): the Buy Box is at risk.',
  },
  {
    type: 'CompetitivePriceAboveOurs',
    code: 'CA',
    prev: '12.5',
    now: '19.99',
    message:
      "Amazon's competitive price went from $12.50 to $19.99, now above our HL price of $14.99.",
  },
  {
    type: 'OurPriceAboveCompetitive',
    code: 'HA',
    prev: '11',
    now: '13.5',
    message:
      "Our HL price (price + shipping) went from $11.00 to $13.50, now above Amazon's competitive " +
      'price of $12.00: the Buy Box is at risk.',
  },
  {
    type: 'OurPriceBelowCompetitive',
    code: 'HB',
    prev: '13.5',
    now: '11',
    message:
      "Our HL price (price + shipping) went from $13.50 to $11.00, now below Amazon's competitive " +
      'price of $12.00.',
  },
  {
    type: 'BuyBoxLost',
    code: 'BL',
    prev: 'A1',
    now: 'B2',
    message: 'Buy Box lost to a competitor at $33.99 (we were at $34.99).',
  },
];

/**
 * An Immediate assignment email for each alert type, and a Daily one carrying
 * several alerts, their boxes made as the app makes them.
 */
function alertSamples(
  notices: typeof import('../src/utils/notification-emails.js'),
  link: string,
): [string, () => import('../src/utils/mailer.js').Email][] {
  const at = 'Nov 12, 2026, 8:42 AM EST (New York)';
  const shown = (a: (typeof ALERTS)[number], asin = 'B0ABC12345') => ({
    asin,
    marketplace: 'USA',
    title: 'Organic Green Tea, 100 Bags',
    message: a.message,
    at,
    comparison: alertComparison(
      { alertType: a.type, previousValue: a.prev, newValue: a.now, message: a.message },
      { excerpts: true },
    ),
  });
  const email = (a: (typeof ALERTS)[number], alerts: ReturnType<typeof shown>[]) =>
    notices.assignmentEmail({
      to: TO,
      action: 'added',
      taskId: 42,
      taskName: `WasiU_${a.code}_263160842: Review`,
      link,
      alert: {
        typeLabel: EXCLUSIVES_ALERT_TYPE_LABELS[a.type],
        groupName: 'Wasif - US',
        alerts,
        more: 0,
      },
    });
  const daily = ALERTS.find((a) => a.type === 'CompetitivePriceChanged')!;
  return [
    ...ALERTS.map((a): [string, () => import('../src/utils/mailer.js').Email] => [
      `alert-immediate-${a.code}`,
      () => email(a, [shown(a)]),
    ]),
    [
      'alert-daily-CH',
      () =>
        email(daily, [
          shown(daily, 'B0ABC12345'),
          shown(
            {
              ...daily,
              prev: '21',
              now: '19.5',
              message: daily.message.replace('$14.99', '$24.99'),
            },
            'B0ABC67890',
          ),
          shown({ ...daily, prev: null, now: '9.99' }, 'B0ABC24680'),
        ]),
    ],
  ];
}

async function main() {
  const folder = path.resolve(process.argv[2] ?? path.join(tmpdir(), 'hl-central-email-previews'));
  const { sentEmails } = await import('../src/utils/mailer.js');
  const account = await import('../src/utils/account-emails.js');
  const notices = await import('../src/utils/notification-emails.js');
  const { escapeHtml, LOGO_CID, LOGO_FILE } = await import('../src/utils/email-content.js');
  const app = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const logoSrc = `src="cid:${LOGO_CID}"`;
  const logoInPage = `src="data:image/png;base64,${(await readFile(LOGO_FILE)).toString('base64')}"`;
  const setPasswordLink = `${app}/reset-password?token=sample-token`;
  const inAnHour = new Date(Date.now() + 60 * 60_000);
  const inADay = new Date(Date.now() + 24 * 60 * 60_000);
  const taskLink = `${app}/tasks/42`;

  /** Each sample: a file name, and the email (sent through the console mailer, or built). */
  const samples: [string, () => Promise<void> | import('../src/utils/mailer.js').Email][] = [
    ['new-account', () => account.sendNewAccountEmail(TO, setPasswordLink, inADay)],
    ['google-welcome', () => account.sendGoogleWelcomeEmail(TO, app)],
    ['password-reset', () => account.sendPasswordResetEmail(TO, setPasswordLink)],
    [
      'email-changed-to-google',
      () =>
        account.sendEmailChangedEmail(TO, {
          fromMethod: 'password',
          toMethod: 'google',
          signInUrl: app,
        }),
    ],
    [
      'email-changed-google-to-google',
      () =>
        account.sendEmailChangedEmail(TO, {
          fromMethod: 'google',
          toMethod: 'google',
          signInUrl: app,
        }),
    ],
    [
      'email-changed-to-password',
      () =>
        account.sendEmailChangedEmail(TO, {
          fromMethod: 'google',
          toMethod: 'password',
          signInUrl: app,
          setPassword: { link: setPasswordLink, expiresAt: inAnHour },
        }),
    ],
    [
      'email-changed-inactive',
      () =>
        account.sendEmailChangedEmail(TO, {
          fromMethod: 'google',
          toMethod: 'password',
          signInUrl: app,
          inactive: true,
        }),
    ],
    [
      'email-changed-password-to-password',
      () =>
        account.sendEmailChangedEmail(TO, {
          fromMethod: 'password',
          toMethod: 'password',
          signInUrl: app,
        }),
    ],
    ['email-change-notice', () => account.sendEmailChangeNoticeEmail('old@example.com', TO)],
    [
      'mention',
      () =>
        notices.mentionEmail({
          to: TO,
          by: 'colleague@example.com',
          taskId: 42,
          taskName: TASK,
          link: taskLink,
        }),
    ],
    [
      'assignment-added',
      () =>
        notices.assignmentEmail({
          to: TO,
          action: 'added',
          taskId: 42,
          taskName: TASK,
          link: taskLink,
        }),
    ],
    ...alertSamples(notices, taskLink),
    [
      'assignment-removed',
      () =>
        notices.assignmentEmail({
          to: TO,
          action: 'removed',
          taskId: 42,
          taskName: TASK,
          link: taskLink,
        }),
    ],
    [
      'reminder',
      () =>
        notices.reminderEmail({
          to: TO,
          taskId: 42,
          taskName: TASK,
          starts: 'Fri, Oct 23, 2026, 9:00 AM EDT — 1 hour before',
          link: taskLink,
        }),
    ],
    [
      'reminder-no-start',
      () => notices.reminderEmail({ to: TO, taskId: 42, taskName: TASK, link: taskLink }),
    ],
    [
      'admin-alert',
      () =>
        notices.adminAlertEmail({
          to: TO,
          subject: 'HL Central recurrence scheduler is not running',
          lines: [
            'The background scheduler that generates recurring tasks has stopped ticking.',
            'Last run: 2026-10-23T13:00:00.000Z (~2h ago).',
            '',
            'Recurring occurrences will not be materialized until it is restored.',
          ],
          appUrl: app,
        }),
    ],
    ['test', () => notices.testEmail(TO, new Date().toISOString())],
  ];

  await mkdir(folder, { recursive: true });
  const index: string[] = [];
  const log = console.log;
  for (const [name, make] of samples) {
    let built: import('../src/utils/mailer.js').Email | void;
    console.log = () => {}; // the console mailer prints each email
    try {
      built = await make();
    } finally {
      console.log = log;
    }
    const email = built ?? sentEmails.at(-1);
    if (!email?.html?.includes(logoSrc)) throw new Error(`${name}: no HTML version with the logo`);
    await writeFile(path.join(folder, `${name}.html`), email.html.replace(logoSrc, logoInPage));
    await writeFile(
      path.join(folder, `${name}-images-off.html`),
      email.html.replace(logoSrc, 'src=""'),
    );
    index.push(
      `<li><b>${escapeHtml(email.subject)}</b> — <a href="${name}.html">${name}</a>` +
        ` · <a href="${name}-images-off.html">images off</a></li>`,
    );
  }
  const indexFile = path.join(folder, 'index.html');
  await writeFile(
    indexFile,
    '<!doctype html><meta charset="utf-8"><title>HL Central emails</title>' +
      '<body style="font-family:Arial,sans-serif;line-height:1.8;padding:24px">' +
      `<h1>HL Central emails (${samples.length})</h1><ul>${index.join('')}</ul></body>`,
  );
  console.log(`${samples.length} emails written. Open:\n  ${indexFile}`);
}

main().catch((err) => {
  console.error('Could not write the email previews:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
