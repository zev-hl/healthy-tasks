import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { alertLogHref, isAlertLogHref, readAlertLogLink } from '@healthy-tasks/shared';
import { sanitizeRichText } from '../../src/utils/rich-text.js';

/**
 * HLAI-112: the Daily alert task's link to the Alert Log — how it is written and
 * read, and that it is the only link rich text may keep.
 */

const FROM = '2026-10-19T12:30:00.000Z';
const TO = '2026-10-20T12:30:00.000Z';

describe('Alert Log links', () => {
  it('carry the dates, alert types and groups, and read back the same', () => {
    const href = alertLogHref({
      from: FROM,
      to: TO,
      alertTypes: ['ListingSuppressed'],
      groupIds: [113],
    });
    assert.equal(
      href,
      '/exclusives/log?from=2026-10-19T12%3A30%3A00.000Z&to=2026-10-20T12%3A30%3A00.000Z&type=ListingSuppressed&group=113',
    );
    assert.deepEqual(readAlertLogLink(href.slice(href.indexOf('?'))), {
      from: FROM,
      to: TO,
      alertTypes: ['ListingSuppressed'],
      groupIds: [113],
      search: '',
    });
    assert.equal(alertLogHref({}), '/exclusives/log');
  });

  it('can carry what goes in the search box (a Daily task row’s ASIN)', () => {
    const href = alertLogHref({ alertTypes: ['BuyBoxLost'], search: 'B0ABC12345' });
    assert.equal(href, '/exclusives/log?type=BuyBoxLost&q=B0ABC12345');
    assert.equal(readAlertLogLink(href.slice(href.indexOf('?'))).search, 'B0ABC12345');
    assert.equal(readAlertLogLink('?q=%20%20B0ABC12345%20').search, 'B0ABC12345');
  });

  it('ignore what they do not recognise', () => {
    assert.deepEqual(
      readAlertLogLink(
        '?from=yesterday&type=Nope&type=BuyBoxLost&type=BuyBoxLost&group=-1&group=x&group=7&utm=1',
      ),
      { from: '', to: '', alertTypes: ['BuyBoxLost'], groupIds: [7], search: '' },
    );
  });

  it('are told apart from every other link', () => {
    assert.equal(isAlertLogHref('/exclusives/log'), true);
    assert.equal(isAlertLogHref('/exclusives/log?type=BuyBoxLost'), true);
    for (const other of [
      '/exclusives/logs',
      '/exclusives/log/../tasks',
      '/tasks/1',
      'https://example.com/exclusives/log',
      '//example.com/exclusives/log',
      'javascript:alert(1)',
    ]) {
      assert.equal(isAlertLogHref(other), false, other);
    }
  });
});

describe('links in rich text', () => {
  const LINK = `<p><a href="/exclusives/log?from=${FROM}&amp;type=ListingSuppressed">View these alerts in the Alert Log</a></p>`;

  it('keeps a link to the Alert Log, with nothing but its address', () => {
    const dirty = `<p><a href="/exclusives/log?from=${FROM}&amp;type=ListingSuppressed" target="_blank" onclick="x()" class="y">View these alerts in the Alert Log</a></p>`;
    assert.equal(sanitizeRichText(dirty), LINK);
    assert.equal(sanitizeRichText(LINK, { allowMentions: true }), LINK);
  });

  it('turns every other link into plain text', () => {
    for (const href of [
      'https://example.com',
      'javascript:alert(1)',
      '//example.com/exclusives/log',
      '/tasks/1',
      '',
    ]) {
      const html = `<p>See <a href="${href}">this</a>.</p>`;
      assert.equal(sanitizeRichText(html), '<p>See <span>this</span>.</p>', href);
      assert.equal(
        sanitizeRichText(html, { allowMentions: true }),
        '<p>See <span>this</span>.</p>',
        href,
      );
    }
    assert.equal(sanitizeRichText('<p><a>no address</a></p>'), '<p><span>no address</span></p>');
  });
});
