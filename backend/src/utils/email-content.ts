import { fileURLToPath } from 'node:url';

// Every email's HTML and text versions (HLAI-135), made from one description of
// the email so the two always say the same thing. The HTML is the shared look:
// a white card with the logo and "HL Central" at its top, the message, the main
// link as a button, a footer.
// It is written the way mail apps can show it — tables, styles inside each tag,
// common fonts (the app's own font doesn't load in most mail apps), a button
// drawn as a table cell so Outlook shows it too.

/** One piece of an email, in order. */
export type EmailBlock =
  /** A paragraph. A line break in it stays a line break. */
  | { text: string }
  /**
   * The email's main link, as a button with the plain link under it, for mail
   * apps that block buttons and for opening it on another device. The text
   * version has no button: it says `lead` and puts the link on the next line,
   * or, with no `lead`, has the link on its own.
   */
  | { button: { label: string; url: string; lead?: string } };

export interface EmailContent {
  /**
   * The line mail apps show beside the subject in the inbox list. Unset: the
   * first paragraph.
   */
  preview?: string;
  blocks: EmailBlock[];
}

export interface RenderedEmail {
  text: string;
  html: string;
}

/** The app's colours (frontend styles.css). */
const GREEN = '#0f7b6c';
const INK = '#211d19';
const MUTED = '#7d746a';
const CANVAS = '#f7f4ef';
const BORDER = '#e7e1d8';
const FONT = 'Arial, Helvetica, sans-serif';

/**
 * The logo travels inside each email, as a picture attached to it, so it shows
 * wherever the email is opened: from a local copy, if the site is down, and in
 * mail apps that block pictures from the internet. The HTML points at it by
 * this id; the mailer attaches the file (`smtpMessage`). backend/assets/
 * email-logo.png is the app's logo (frontend/public/hl-logo.png) at 64 x 60,
 * shown at half that size so it stays sharp on phone screens. Found from here
 * both in src/ and in the built dist/.
 */
export const LOGO_CID = 'hl-logo@hlcentral';
export const LOGO_FILE = fileURLToPath(new URL('../../assets/email-logo.png', import.meta.url));
const LOGO_WIDTH = 32;
const LOGO_HEIGHT = 30;

/** Text as HTML: shown exactly as typed, never read as tags. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only web addresses go in a link; anything else is a mistake in the code. */
function webAddress(url: string): string {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new Error(`Email link is not an address: ${url}`);
  }
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new Error(`Email link must start with http:// or https://: ${url}`);
  }
  return url;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 18px;">${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
}

function button(label: string, url: string): string {
  const href = escapeHtml(webAddress(url));
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 14px;">' +
    `<tr><td bgcolor="${GREEN}" style="border-radius:8px;">` +
    `<a href="${href}" style="display:inline-block;padding:12px 22px;font-family:${FONT};` +
    `font-size:15px;font-weight:bold;line-height:1.2;color:#ffffff;text-decoration:none;` +
    `border-radius:8px;">${escapeHtml(label)}</a>` +
    '</td></tr></table>' +
    `<p style="margin:0 0 18px;font-size:13px;line-height:1.5;color:${MUTED};">` +
    "If the button doesn't work, copy this link into your browser:<br>" +
    `<a href="${href}" style="color:${GREEN};word-break:break-all;">${escapeHtml(url)}</a></p>`
  );
}

function textVersion(blocks: EmailBlock[]): string {
  return blocks
    .map((b) => {
      if ('text' in b) return b.text;
      const url = webAddress(b.button.url);
      return b.button.lead ? `${b.button.lead}\n${url}` : url;
    })
    .join('\n\n');
}

function htmlVersion(blocks: EmailBlock[], preview: string): string {
  const body = blocks
    .map((b) => ('text' in b ? paragraph(b.text) : button(b.button.label, b.button.url)))
    .join('');
  // After the preview, blank space so mail apps don't run on into the email's
  // first words in the inbox list.
  const previewFill = '&#847;&zwnj;&nbsp;'.repeat(60);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    '<title>HL Central</title>',
    '</head>',
    `<body style="margin:0;padding:0;background:${CANVAS};">`,
    '<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">' +
      `${escapeHtml(preview)}${previewFill}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CANVAS}" style="background:${CANVAS};">`,
    '<tr><td align="center" style="padding:28px 12px;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">',
    // The card, with the app's name at its top as in the app's menu: the logo
    // (on white, as its own pale background is) and "HL Central" beside it. The
    // logo's alt text is empty, so where the picture can't be shown the name
    // shows once, not twice.
    `<tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid ${BORDER};border-radius:12px;` +
      `padding:24px 28px 10px;font-family:${FONT};font-size:15px;line-height:1.55;color:${INK};">` +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;"><tr>' +
      '<td style="vertical-align:middle;">' +
      `<img src="cid:${LOGO_CID}" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" alt="" ` +
      'style="display:block;border:0;outline:none;"></td>' +
      `<td style="vertical-align:middle;padding-left:10px;font-family:${FONT};font-size:18px;` +
      `font-weight:bold;line-height:1.2;letter-spacing:-0.01em;color:${INK};">HL Central</td>` +
      '</tr></table>' +
      `${body}</td></tr>`,
    `<tr><td style="padding:16px 4px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED};">` +
      'Sent by HL Central.</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');
}

/** An email's text and HTML versions, from one description of it. */
export function renderEmail(content: EmailContent): RenderedEmail {
  const firstParagraph = content.blocks.find((b) => 'text' in b) as { text: string } | undefined;
  const preview = content.preview ?? firstParagraph?.text ?? '';
  return {
    text: textVersion(content.blocks),
    html: htmlVersion(content.blocks, preview),
  };
}
