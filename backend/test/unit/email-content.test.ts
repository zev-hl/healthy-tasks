import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSendText } from '../../src/config/email-config.js';
import { escapeHtml, LOGO_CID, LOGO_FILE, renderEmail } from '../../src/utils/email-content.js';
import { smtpMessage } from '../../src/utils/mailer.js';

// HLAI-135: every email's HTML and text versions from one description of it.

const LINK = 'https://app.example.com/reset-password?token=abc&next=1';

const sample = () =>
  renderEmail({
    blocks: [
      { text: 'First line.\nSecond line.' },
      { button: { label: 'Open it', url: LINK, lead: 'Open this link:' } },
      { text: 'The end.' },
    ],
  });

/** The visible text of an HTML version, roughly: tags out, entities back. */
const visible = (html: string) =>
  html
    .replace(/<div style="display:none[\s\S]*?<\/div>/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&');

describe('the text version', () => {
  it('is the paragraphs, a blank line apart, with the link under its lead', () => {
    assert.equal(
      sample().text,
      ['First line.\nSecond line.', '', 'Open this link:', LINK, '', 'The end.'].join('\n'),
    );
  });
});

describe('the HTML version', () => {
  it('says the same words, a line break kept as one', () => {
    const { html } = sample();
    assert.match(html, /<p[^>]*>First line\.<br>Second line\.<\/p>/);
    assert.match(visible(html), /The end\./);
  });

  it('has the main link as a button, with the plain link under it', () => {
    const { html } = sample();
    const href = `href="${LINK.replace('&', '&amp;')}"`;
    assert.equal(html.split(href).length - 1, 2, 'the button and the plain link');
    assert.match(html, />Open it<\/a>/);
    assert.match(html, /If the button doesn't work, copy this link into your browser:/);
    assert.ok(visible(html).includes(LINK));
  });

  it('opens with the logo and "HL Central" beside it, and ends with the footer', () => {
    const { html } = sample();
    const img = /<img src="([^"]+)" width="32" height="30" alt=""/.exec(html);
    assert.ok(img, 'the logo, with no alt text of its own');
    assert.equal(img[1], `cid:${LOGO_CID}`, 'the picture inside the email, not a web address');
    assert.match(html, /<img [^>]*><\/td><td [^>]*>HL Central<\/td>/, 'the name beside it');
    assert.match(html, /Sent by HL Central\./);
  });

  it('has the first paragraph as its inbox preview, unless given one', () => {
    assert.match(sample().html, /<div style="display:none[^>]*>First line\.\nSecond line\./);
    const own = renderEmail({ preview: 'Look here', blocks: [{ text: 'Body.' }] });
    assert.match(own.html, /<div style="display:none[^>]*>Look here/);
  });

  it('shows typed text as typed, never as tags', () => {
    const name = `<b>Bold</b> & "quoted" 'too'`;
    const { html, text } = renderEmail({
      preview: name,
      blocks: [
        { text: `Task “${name}”` },
        { button: { label: name, url: 'https://x.test/?a=<b>', lead: 'Go:' } },
      ],
    });
    assert.doesNotMatch(html, /<b>/);
    assert.ok(html.includes('&lt;b&gt;Bold&lt;/b&gt; &amp; &quot;quoted&quot; &#39;too&#39;'));
    assert.ok(text.includes(`Task “${name}”`), 'the text version as typed');
  });

  it('refuses a link that is not a web address', () => {
    for (const url of ['javascript:alert(1)', 'mailto:a@b.test', 'not a link']) {
      assert.throws(
        () => renderEmail({ blocks: [{ button: { label: 'x', url, lead: 'x' } }] }),
        /Email link/,
        url,
      );
    }
  });
});

describe('escapeHtml', () => {
  it('escapes the five characters HTML reads', () => {
    assert.equal(
      escapeHtml(`<a href="x">'&'</a>`),
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('EMAIL_SEND_TEXT', () => {
  it('is on unless set to "false"', () => {
    assert.equal(parseSendText(undefined), true);
    assert.equal(parseSendText(''), true);
    assert.equal(parseSendText('true'), true);
    assert.equal(parseSendText('false'), false);
  });

  it('refuses anything else, so a typo fails at boot', () => {
    assert.throws(() => parseSendText('no'), /EMAIL_SEND_TEXT must be "true" or "false"/);
    assert.throws(() => parseSendText('False'), /EMAIL_SEND_TEXT must be "true" or "false"/);
  });
});

describe('what goes to the mail server', () => {
  const email = { to: 'a@b.test', subject: 'Hi', ...sample() };

  it('carries the HTML and the text, or the HTML only with the switch off', () => {
    const both = smtpMessage(email, 'HL <x@y.test>', true);
    assert.equal(both.html, email.html);
    assert.equal(both.text, email.text);
    const htmlOnly = smtpMessage(email, 'HL <x@y.test>', false);
    assert.equal(htmlOnly.html, email.html);
    assert.equal('text' in htmlOnly, false);
  });

  it('keeps the text of an email with no HTML, whatever the switch says', () => {
    const plain = smtpMessage({ to: 'a@b.test', subject: 'Hi', text: 'Hello' }, 'x@y.test', false);
    assert.equal(plain.text, 'Hello');
    assert.equal('html' in plain, false);
    assert.equal('attachments' in plain, false, 'no logo to attach');
  });

  it('attaches the logo, with or without the text version', () => {
    for (const sendText of [true, false]) {
      const message = smtpMessage(email, 'x@y.test', sendText);
      assert.deepEqual(message.attachments, [
        {
          filename: 'hl-logo.png',
          path: LOGO_FILE,
          cid: LOGO_CID,
          contentType: 'image/png',
          contentDisposition: 'inline',
        },
      ]);
    }
  });

  it('still sends an email whose logo file is missing, only without the picture', () => {
    const log = console.error;
    const said: string[] = [];
    console.error = (msg: string) => said.push(msg);
    try {
      const message = smtpMessage(email, 'x@y.test', true, '/nowhere/email-logo.png');
      assert.equal(message.html, email.html);
      assert.equal('attachments' in message, false);
      smtpMessage(email, 'x@y.test', true, '/nowhere/email-logo.png');
    } finally {
      console.error = log;
    }
    assert.equal(said.length, 1, 'said once');
    assert.match(said[0]!, /Email logo not found/);
  });

  it('has the logo file: a small PNG, 64 x 60', () => {
    const png = readFileSync(LOGO_FILE);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 64, 'width');
    assert.equal(png.readUInt32BE(20), 60, 'height');
    assert.ok(png.length < 20_000, `${png.length} bytes`);
  });

  it('is sent as both parts, or as HTML alone (as nodemailer builds it)', async () => {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const raw = async (sendText: boolean) =>
      String((await transport.sendMail(smtpMessage(email, 'x@y.test', sendText))).message);

    const both = await raw(true);
    assert.match(both, /multipart\/alternative/);
    assert.match(both, /Content-Type: text\/plain/);
    assert.match(both, /Content-Type: text\/html/);

    const htmlOnly = await raw(false);
    assert.doesNotMatch(htmlOnly, /text\/plain/);
    assert.match(htmlOnly, /Content-Type: text\/html/);

    // Either way the logo travels with the HTML, as a picture it points at.
    for (const message of [both, htmlOnly]) {
      assert.match(message, /multipart\/related/);
      assert.match(message, /Content-Type: image\/png; name=hl-logo\.png/);
      assert.match(message, /Content-ID: <hl-logo@hlcentral>/);
      assert.match(message, /Content-Disposition: inline; filename=hl-logo\.png/);
    }
  });
});
